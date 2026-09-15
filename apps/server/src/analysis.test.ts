import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchStore } from './store';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
it('retains analysis layout, ordered columns and artifacts without the index, while old evidence keeps removed artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-analysis-')); directories.push(dir);
  let store = new WorkbenchStore({ dataDir: dir });
  try {
    const a = store.createSample({ code: 'A' }), b = store.createSample({ code: 'B' });
    const file = store.saveAttachment(Buffer.from('simulated curve'), 'curve.txt', 'text/plain');
    const analysis = store.createAnalysis({ title: '组织比较', itemIds: [a.id, b.id] });
    const saved = store.updateAnalysis(analysis.id, { expectedVersion: analysis.version, itemIds: [b.id, a.id], attachmentIds: [file.id], layout: { visibleSections: ['compare', 'artifacts'], hiddenColumns: ['water:temperature'], columnOrder: ['stir:time', 'water:temperature'] } });
    expect(() => store.updateAnalysis(analysis.id, { expectedVersion: analysis.version, itemIds: [] })).toThrow('版本冲突');
    expect(() => store.updateAnalysis(analysis.id, { expectedVersion: saved.version, attachmentIds: ['missing'] })).toThrow();
    expect(store.getAnalysis(analysis.id)).toEqual(saved);
    const claim = store.createClaim({ hostType: 'analysis', hostId: analysis.id, text: '模拟图仍有待验证' });
    expect(claim.evidence[0].attachmentIds).toEqual([file.id]);
    expect(claim.evidence[0].manifest?.relations).toContainEqual({ fromId: analysis.id, toId: file.id, kind: 'artifact' });
    store.close(); fs.rmSync(path.join(dir, 'index'), { recursive: true });
    store = new WorkbenchStore({ dataDir: dir });
    expect(store.getAnalysis(analysis.id)).toEqual(saved);
    store.updateAnalysis(analysis.id, { expectedVersion: saved.version, attachmentIds: [] });
    expect(store.exportContext('analysis', analysis.id).manifest.attachments).toEqual([]);
    expect(store.getClaim(claim.id).evidence[0]).toEqual(claim.evidence[0]);
    expect(fs.readFileSync(store.getAttachment(file.id).localPath, 'utf8')).toBe('simulated curve');
  } finally { store.close(); }
});
