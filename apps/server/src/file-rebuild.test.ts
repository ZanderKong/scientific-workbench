import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchStore } from './store';
const directories: string[] = [];
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-rebuild-')); directories.push(dir); return dir; }
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
describe('business files are sufficient without SQLite', () => {
  it('rebuilds all entities, aliases, About, components, order, history and fixed evidence', () => {
    const dir = directory(); const store = new WorkbenchStore({ dataDir: dir });
    const water = store.createObject({ canonicalName: '水', role: 'material', aliases: ['纯水'] });
    store.createProperty({ canonicalName: '添加量', recommendedUnit: 'g', aliases: ['用量'] });
    const a = store.createSample({ code: 'REBUILD-01', title: '保留完整标题', body: '- [水]\n  - [水]｜添加量：5 g\n  - [数据] 光谱\n    - 模拟记录' });
    const b = store.createSample({ code: 'REBUILD-02' });
    store.finalizeDocument(a.id);
    const data = store.listData()[0];
    const attachment = store.saveAttachment(Buffer.from('模拟附件'), '中文.csv', 'text/csv');
    store.updateData(data.id, { expectedVersion: data.version, aboutSampleIds: [b.id, a.id], componentIds: [attachment.id] });
    const analysis = store.createAnalysis({ title: '比较分析', question: '研究问题', body: '- 分析正文', itemIds: [data.id, a.id, b.id] });
    const claim = store.createClaim({ hostType: 'data', hostId: data.id, text: '待验证的判断' });
    const expectedData = store.getData(data.id), expectedAnalysis = store.getAnalysis(analysis.id), expectedClaim = store.getClaim(claim.id);
    store.close();
    fs.rmSync(path.join(dir, 'index'), { recursive: true });
    const rebuilt = new WorkbenchStore({ dataDir: dir });
    try {
      expect(rebuilt.listSamples()).toHaveLength(2);
      expect(rebuilt.getSample(a.id).title).toBe('保留完整标题');
      expect(rebuilt.getSample(a.id).properties[0].value_text).toBe('5 g');
      expect(rebuilt.searchObjects().find(object => object.id === water.id)).toEqual(water);
      expect(rebuilt.searchProperties()[0].aliases).toEqual(['用量']);
      expect(rebuilt.getData(data.id)).toEqual(expectedData);
      expect(rebuilt.getAnalysis(analysis.id)).toEqual(expectedAnalysis);
      expect(rebuilt.getClaim(claim.id)).toEqual(expectedClaim);
      expect(rebuilt.listSnapshots(a.id)).toHaveLength(1);
      expect(fs.readFileSync(rebuilt.getAttachment(attachment.id).localPath, 'utf8')).toBe('模拟附件');
      expect(fs.readFileSync(path.join(dir, 'attachments/manifest.json'), 'utf8')).not.toContain(dir);
    } finally { rebuilt.close(); }
  });
  it('will not open a legacy directory in place', () => {
    const dir = directory(); fs.mkdirSync(path.join(dir, 'samples'));
    fs.writeFileSync(path.join(dir, 'samples/old.md'), 'legacy data');
    expect(() => new WorkbenchStore({ dataDir: dir })).toThrow('禁止原地迁移');
    expect(fs.readFileSync(path.join(dir, 'samples/old.md'), 'utf8')).toBe('legacy data');
  });
});
