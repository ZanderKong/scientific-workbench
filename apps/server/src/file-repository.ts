import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

interface JournalEntry { path: string; content: string; sha256: string; }
interface Journal { schema: 'swb.write/1'; id: string; entries: JournalEntry[]; }
const hash = (content: string) => crypto.createHash('sha256').update(content).digest('hex');

/** Files commit before the rebuildable index. A durable intent is replayed after a crash. */
export class FileRepository {
  private readonly lock: Database.Database;
  private pending = new Map<string, string>();
  private active = false;
  private poisoned = false;
  constructor(readonly root: string, private readonly checkpoint?: (phase: 'journal' | 'file' | 'index') => void) {
    fs.mkdirSync(path.join(root, 'jobs'), { recursive: true });
    this.lock = new Database(path.join(root, 'jobs', '.writer-lock.sqlite'), { timeout: 0 });
    try { this.lock.pragma('journal_mode = DELETE'); this.lock.exec('BEGIN EXCLUSIVE'); }
    catch (error) { this.lock.close(); throw new Error('该数据目录已有写入进程，请使用已有服务', { cause: error }); }
  }
  close() { this.lock.exec('ROLLBACK'); this.lock.close(); }
  /** True after a durable journal could not be completed; all business reads must stop. */
  recoveryRequired() { return this.poisoned; }
  resolve(relative: string) {
    if (path.isAbsolute(relative) || relative.includes('\\')) throw new Error('业务文件路径必须相对工作区');
    const result = path.resolve(this.root, relative);
    if (!result.startsWith(path.resolve(this.root) + path.sep)) throw new Error('业务文件路径越界');
    let parent = path.dirname(result);
    while (parent !== path.resolve(this.root)) {
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('业务目录不允许符号链接');
      parent = path.dirname(parent);
    }
    if (fs.existsSync(result) && fs.lstatSync(result).isSymbolicLink()) throw new Error('业务文件不允许符号链接');
    return result;
  }
  read(relative: string) { return this.pending.get(relative) ?? fs.readFileSync(this.resolve(relative), 'utf8'); }
  has(relative: string) { return this.pending.has(relative) || fs.existsSync(this.resolve(relative)); }
  write(relative: string, content: string) {
    this.resolve(relative);
    if (!this.active) throw new Error('文件写入必须处于持久提交中');
    this.pending.set(relative, content);
  }
  private atomic(relative: string, content: string) {
    const target = this.resolve(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    const parent = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  }
  recover() {
    const recovered: string[] = [];
    for (const name of fs.readdirSync(path.join(this.root, 'jobs')).filter(name => /^write-.*\.json$/.test(name)).sort()) {
      const relative = `jobs/${name}`;
      const journal: Journal = JSON.parse(this.read(relative));
      if (journal.schema !== 'swb.write/1' || !Array.isArray(journal.entries)) throw new Error(`无法恢复写入记录：${name}`);
      for (const entry of journal.entries) {
        if (typeof entry.content !== 'string' || hash(entry.content) !== entry.sha256) throw new Error(`写入记录校验失败：${name}`);
        this.atomic(entry.path, entry.content);
      }
      // Keep the journal until the caller has successfully rebuilt its index.
      recovered.push(relative);
    }
    this.poisoned = false;
    return recovered;
  }
  acknowledgeRecovery(journals: string[]) { for (const file of journals) fs.unlinkSync(this.resolve(file)); }
  commit<T>(prepare: () => T, commitIndex: () => void, rollbackIndex: () => void): T {
    if (this.poisoned) throw new Error('先前写入需要恢复，请重新启动服务');
    if (this.active) return prepare();
    this.active = true; this.pending = new Map();
    let journalPath: string | undefined;
    try {
      const result = prepare();
      const entries = [...this.pending].map(([relative, content]) => ({ path: relative, content, sha256: hash(content) }));
      const id = crypto.randomUUID(); journalPath = `jobs/write-${id}.json`;
      this.atomic(journalPath, JSON.stringify({ schema: 'swb.write/1', id, entries } satisfies Journal));
      this.checkpoint?.('journal');
      for (const entry of entries) { this.atomic(entry.path, entry.content); this.checkpoint?.('file'); }
      commitIndex(); this.checkpoint?.('index');
      fs.unlinkSync(this.resolve(journalPath));
      return result;
    } catch (error) {
      rollbackIndex();
      // Once intent is durable, restart recovery must finish it. No later writes may overtake it.
      if (journalPath && fs.existsSync(this.resolve(journalPath))) this.poisoned = true;
      throw error;
    } finally { this.active = false; this.pending.clear(); }
  }
}
