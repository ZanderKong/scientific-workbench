import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
const daily = ['read', 'write', 'export', 'backup'] as const;
const dangerous = ['delete', 'merge', 'cleanup', 'restore'] as const;
export type Scope = typeof daily[number] | typeof dangerous[number];
interface Token { id: string; name: string; hash: string; scopes: Scope[]; createdAt: string; revokedAt?: string; }
interface Principal { id: string; kind: 'ui' | 'token'; scopes: readonly string[]; }
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
export class LocalAuthorization {
  private readonly tokensFile: string;
  private tokens: Token[];
  private sessions = new Map<string, { id: string; expires: number }>();
  private grants = new Map<string, { session: string; scope: Scope; expires: number }>();
  constructor(root: string, bootstrapToken?: string) {
    this.tokensFile = path.join(root, 'private', 'api-tokens.json');
    this.tokens = fs.existsSync(this.tokensFile) ? JSON.parse(fs.readFileSync(this.tokensFile, 'utf8')) : [];
    if (bootstrapToken && !this.tokens.some(token => token.hash === hash(bootstrapToken))) {
      this.tokens.push({ id: crypto.randomUUID(), name: '启动配置连接', hash: hash(bootstrapToken), scopes: [...daily], createdAt: new Date().toISOString() }); this.persist();
    }
  }
  private persist() {
    const temporary = this.tokensFile + '.new';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.tokens)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.tokensFile); fs.chmodSync(this.tokensFile, 0o600);
  }
  list() { return this.tokens.map(({ hash: _hash, ...token }) => token); }
  create(name: string, scopes: Scope[] = [...daily]) {
    if (!name.trim() || !Array.isArray(scopes) || scopes.some(scope => ![...daily, ...dangerous].includes(scope))) throw new Error('连接名称或权限无效');
    const token = secret(), record: Token = { id: crypto.randomUUID(), name: name.trim(), scopes: [...new Set(scopes)], hash: hash(token), createdAt: new Date().toISOString() };
    this.tokens.push(record); this.persist(); return { id: record.id, token, scopes: record.scopes };
  }
  revoke(id: string) { const token = this.tokens.find(token => token.id === id); if (!token) throw new Error('连接不存在'); token.revokedAt = new Date().toISOString(); this.persist(); }
  sessionCookie() { const value = secret(); this.sessions.set(hash(value), { id: crypto.randomUUID(), expires: Date.now() + 8 * 3600000 }); return `swb_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`; }
  identify(request: Pick<FastifyRequest, 'headers'>): Principal | undefined {
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('swb_session='))?.slice('swb_session='.length);
    const session = cookie && this.sessions.get(hash(cookie));
    if (session && session.expires > Date.now()) return { id: session.id, kind: 'ui', scopes: daily };
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer && this.tokens.find(token => !token.revokedAt && token.hash === hash(bearer));
    return token ? { id: token.id, kind: 'token', scopes: token.scopes } : undefined;
  }
  grant(principal: Principal, scope: Scope) {
    if (principal.kind !== 'ui' || !dangerous.includes(scope as typeof dangerous[number])) throw new Error('仅本机界面可单次授权此操作');
    const value = secret(); this.grants.set(hash(value), { session: principal.id, scope, expires: Date.now() + 60000 }); return value;
  }
  allows(principal: Principal, scope: Scope, grant?: string) {
    if (principal.scopes.includes(scope)) return true;
    const found = grant && this.grants.get(hash(grant));
    if (!found || found.session !== principal.id || found.scope !== scope || found.expires < Date.now()) return false;
    this.grants.delete(hash(grant!)); return true;
  }
}
export function installAuthorization(app: FastifyInstance, auth: LocalAuthorization, port: number) {
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  app.addHook('onRequest', async (request, reply) => {
    if (!hosts.has(request.headers.host || '') || request.headers.origin && !origins.has(request.headers.origin)) return reply.code(403).send({ code: 'ORIGIN_DENIED', error: '仅允许本机应用访问' });
    const pathname = request.url.split('?')[0];
    if (!pathname.startsWith('/api/')) {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html') && auth.identify(request)?.kind !== 'ui') reply.header('Set-Cookie', auth.sessionCookie());
      return;
    }
    if (pathname === '/api/v1/health') return;
    const principal = auth.identify(request);
    if (!principal) return reply.code(401).send({ code: 'UNAUTHENTICATED', error: '需要有效的本机会话或 API token' });
    if (pathname.startsWith('/api/v1/auth/')) {
      if (principal.kind !== 'ui') return reply.code(403).send({ code: 'SCOPE_DENIED', error: '连接管理仅限本机界面' });
      return;
    }
    const scope: Scope = /\/restore(?:$|\/)/.test(pathname) ? 'restore' : /\/merge(?:$|\/)/.test(pathname) ? 'merge' : /\/cleanup(?:$|\/)/.test(pathname) ? 'cleanup' : request.method === 'DELETE' ? 'delete' : pathname === '/api/v1/backups' ? 'backup' : /\/export(?:$|\/)/.test(pathname) ? 'export' : ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? 'read' : 'write';
    if (!auth.allows(principal, scope, String(request.headers['x-workbench-grant'] || ''))) return reply.code(403).send({ code: 'SCOPE_DENIED', requiredScope: scope, error: `此操作需要 ${scope} 权限` });
  });
  app.get('/api/v1/auth/tokens', async () => auth.list());
  app.post<{ Body: { name: string; scopes?: Scope[] } }>('/api/v1/auth/tokens', async request => auth.create(request.body.name, request.body.scopes));
  app.delete<{ Params: { id: string } }>('/api/v1/auth/tokens/:id', async request => { auth.revoke(request.params.id); return { revoked: true }; });
  app.post<{ Body: { scope: Scope } }>('/api/v1/auth/grants', async request => ({ grant: auth.grant(auth.identify(request)!, request.body.scope) }));
}
