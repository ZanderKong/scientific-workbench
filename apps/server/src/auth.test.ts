import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { LocalAuthorization, installAuthorization } from './auth';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it('rejects forged scope, revoked token and foreign origins; dangerous grants are single-use and session-bound', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-auth-')); roots.push(root); fs.mkdirSync(path.join(root, 'private'));
  const auth = new LocalAuthorization(root), app = Fastify(); installAuthorization(app, auth, 4317);
  app.get('/', async () => 'UI'); app.get('/api/v1/samples', async () => []); app.post('/api/v1/backups/restore', async () => ({ ok: true }));
  const token = auth.create('AI 日常操作');
  const headers = { host: '127.0.0.1:4317', authorization: `Bearer ${token.token}` };
  try {
    expect((await app.inject({ url: '/api/v1/samples', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/backups/restore', headers: { ...headers, 'x-workbench-scope': 'destructive' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/samples', headers: { ...headers, origin: 'https://untrusted.example' } })).statusCode).toBe(403);
    const bootstrap = await app.inject({ url: '/', headers: { host: headers.host } });
    const cookie = String(bootstrap.headers['set-cookie']).split(';')[0];
    const ui = { host: headers.host, cookie };
    const grantResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/grants', headers: ui, payload: { scope: 'restore' } });
    const grant = grantResponse.json().grant;
    expect((await app.inject({ method: 'POST', url: '/api/v1/backups/restore', headers: { ...headers, 'x-workbench-grant': grant } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/backups/restore', headers: { ...ui, 'x-workbench-grant': grant } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/backups/restore', headers: { ...ui, 'x-workbench-grant': grant } })).statusCode).toBe(403);
    auth.revoke(token.id);
    expect((await app.inject({ url: '/api/v1/samples', headers })).statusCode).toBe(401);
    const raw = fs.readFileSync(path.join(root, 'private/api-tokens.json'), 'utf8');
    expect(raw).not.toContain(token.token);
    expect(fs.statSync(path.join(root, 'private/api-tokens.json')).mode & 0o777).toBe(0o600);
  } finally { await app.close(); }
});
