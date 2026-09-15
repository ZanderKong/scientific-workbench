import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileRepository } from './file-repository';
const directories: string[] = [];
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-journal-')); directories.push(dir); return dir; };
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
describe('durable file repository', () => {
  it('holds one process writer lock and releases it on close', () => {
    const dir = root(), first = new FileRepository(dir);
    expect(() => new FileRepository(dir)).toThrow('已有写入进程');
    first.close(); const next = new FileRepository(dir); next.close();
  });
  it.each(['journal', 'file', 'index'] as const)('recovers all business files after failure at %s', phase => {
    const dir = root(); let failed = false, committed = false;
    const repository = new FileRepository(dir, current => { if (current === phase && !failed) { failed = true; throw Error('simulated crash'); } });
    expect(() => repository.commit(() => { repository.write('samples/a.md', '最新正文'); repository.write('registry/objects.json', '["object"]'); }, () => { committed = true; }, () => {})).toThrow('simulated crash');
    expect(() => repository.commit(() => {}, () => {}, () => {})).toThrow('需要恢复');
    repository.close();
    const reopened = new FileRepository(dir); const journals = reopened.recover();
    expect(reopened.read('samples/a.md')).toBe('最新正文');
    expect(reopened.read('registry/objects.json')).toBe('["object"]');
    expect(journals).toHaveLength(1); reopened.acknowledgeRecovery(journals); reopened.close();
    expect(committed).toBe(phase === 'index');
  });
  it('refuses escaping paths before any write is committed', () => {
    const repository = new FileRepository(root());
    expect(() => repository.commit(() => repository.write('../outside', 'no'), () => {}, () => {})).toThrow('越界');
    repository.close();
  });
});
