import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchStore } from './store';

const opened: WorkbenchStore[] = [];
function setup() {
  const store = new WorkbenchStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'swb-data-sync-')) });
  opened.push(store);
  const sample = store.createSample({ body: '- 检测\n  - [数据] FTIR\n    - 初始数据\n  - [数据] DSC\n    - 第二数据\n- 另一步操作' });
  store.finalizeDocument(sample.id);
  return { store, sample, data: store.listData().find(item => item.name === 'FTIR')! };
}
afterEach(() => { for (const store of opened.splice(0)) { store.close(); fs.rmSync(store.dataDir, { recursive: true, force: true }); } });
describe('Data mirror CAS', () => {
  it('refreshes an unmodified sample mirror without overwriting independently edited Data', () => {
    const { store, sample, data } = setup();
    const updated = store.updateData(data.id, { body: data.body.replace('初始数据', '独立页面更新'), expectedVersion: data.version });
    store.finalizeDocument(sample.id);
    expect(store.readDocument(sample.id).body).toContain('独立页面更新');
    expect(store.readDocument(sample.id).body).toContain('第二数据');
    expect(store.readDocument(sample.id).body).toContain('另一步操作');
    store.finalizeDocument(sample.id);
    expect(store.getData(data.id).version).toBe(updated.version);
  });
  it('rejects two-sided changes, retaining the sample draft and the newer Data', () => {
    const { store, sample, data } = setup();
    const doc = store.readDocument(sample.id);
    store.saveDocument(sample.id, doc.body.replace('初始数据', '样品草稿'), doc.head.contentVersion);
    store.updateData(data.id, { body: data.body.replace('初始数据', '数据页新内容'), expectedVersion: data.version });
    expect(() => store.finalizeDocument(sample.id)).toThrow('两个入口均有修改');
    expect(store.readDocument(sample.id).body).toContain('样品草稿');
    expect(store.getData(data.id).body).toContain('数据页新内容');
  });
  it('updates only the modified Data once and removes only references on deletion', () => {
    const { store, sample, data } = setup();
    const doc = store.readDocument(sample.id);
    store.saveDocument(sample.id, doc.body.replace('初始数据', '样品侧修改'), doc.head.contentVersion);
    store.finalizeDocument(sample.id); store.finalizeDocument(sample.id);
    expect(store.getData(data.id).version).toBe(data.version + 1);
    expect(store.listData()).toHaveLength(2);
    const current = store.readDocument(sample.id);
    store.saveDocument(sample.id, '- 删除引用后仍保留数据', current.head.contentVersion);
    store.finalizeDocument(sample.id);
    expect(store.listData()).toHaveLength(2);
    expect(store.readDocument(sample.id).head.blocks).toEqual({});
  });
});
