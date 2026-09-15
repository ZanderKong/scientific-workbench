import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uuid, type DataComponent } from '@workbench/core';
import { WorkbenchStore } from './store';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it('preserves component roles, text and derivation through file rebuild and fixed evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-components-')); roots.push(root);
  let store = new WorkbenchStore({ dataDir: root });
  try {
    const data = store.createData({ name: 'FTIR' });
    const raw = store.saveAttachment(Buffer.from('raw simulated'), 'raw.csv', 'text/csv');
    const processed = store.saveAttachment(Buffer.from('processed simulated'), 'processed.csv', 'text/csv');
    const components: DataComponent[] = [
      { id: uuid(), kind: 'file', name: '原始导出', role: 'raw', creator: 'human', provenance: '模拟仪器文件', createdAt: raw.createdAt, attachmentId: raw.id, derivedFrom: [] },
      { id: uuid(), kind: 'file', name: '处理结果', role: 'processed', creator: 'external', provenance: '外部工具处理，仅供软件验收', createdAt: processed.createdAt, attachmentId: processed.id, derivedFrom: [] },
      { id: uuid(), kind: 'text', name: '趋势记录', role: 'ai_description', creator: 'external', provenance: '测试外部客户端', createdAt: new Date().toISOString(), content: '模拟趋势描述，不解释机理', derivedFrom: [] },
    ];
    components[1].derivedFrom = [components[0].id]; components[2].derivedFrom = [components[0].id, components[1].id];
    const saved = store.updateData(data.id, { components, expectedVersion: data.version });
    expect(saved.componentIds).toEqual([raw.id, processed.id]);
    const claim = store.createClaim({ hostType: 'data', hostId: data.id, text: '仍待验证' });
    expect(claim.evidence[0].content).toContain('模拟趋势描述');
    expect(claim.evidence[0].manifest?.relations).toContainEqual({ fromId: components[1].id, toId: components[0].id, kind: 'derived-from' });
    expect(() => store.updateData(data.id, { components: components.slice(1), expectedVersion: saved.version })).toThrow('来源组件不存在');
    expect(() => store.updateData(data.id, { components: components.map((component, index) => index ? component : { ...component, attachmentId: processed.id }), expectedVersion: saved.version })).toThrow('创建新组件');
    expect(store.getData(data.id)).toEqual(saved);
    store.close(); fs.rmSync(path.join(root, 'index'), { recursive: true });
    store = new WorkbenchStore({ dataDir: root });
    expect(store.getData(data.id)).toEqual(saved);
    store.updateData(data.id, { expectedVersion: saved.version, components: components.map(component => component.kind === 'text' ? { ...component, content: '新的趋势描述' } : component) });
    expect(store.getClaim(claim.id).evidence).toEqual(claim.evidence);
    expect(store.exportContext('data', data.id).context).toContain('新的趋势描述');
  } finally { store.close(); }
});
