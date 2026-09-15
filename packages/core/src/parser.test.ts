import { describe, expect, it } from 'vitest';
import { parseBody } from './parser';

describe('scientific workbench parser', () => {
  it('does not infer categories or extract ambiguous/Data/Claim child properties', () => {
    const r = parseBody('doc', '- [设备]\n  - [设备]｜备注：[另一对象]\n  - 【数据】 FTIR\n    - [设备]｜温度：20\n  - ［论点］ 文本\n    - [设备]｜温度：30');
    expect(r.intents).toEqual([]);
    expect(r.records[0].properties).toEqual([]);
    expect(r.invalidSegments).toHaveLength(1);
    expect(r.records[0].data?.name).toBe('FTIR');
    expect(parseBody('doc', '- 测试\n  - [数据】 错配').records[0].data).toBeUndefined();
  });
  it('parses full/half width syntax and keeps invalid segments', () => {
    const r = parseBody('doc', '<!-- swb:block id="p" -->\n- 使用 [水]\n  <!-- swb:block id="c" -->\n  - [水]｜添加量：80 g|温度:95 ℃｜缺少冒号\n');
    expect(r.records[0].properties.map(p => [p.propertyName, p.valueText])).toEqual([['添加量', '80 g'], ['温度', '95 ℃']]);
    expect(r.invalidSegments).toHaveLength(1);
  });
  it('warns only when same object/property has different text values', () => {
    const r = parseBody('doc', '- 操作 [水]\n  - [水]｜添加量：1 g\n  - [水]｜添加量：1000 mg\n');
    expect(r.warnings).toHaveLength(1);
    const same = parseBody('doc', '- 操作 [水]\n  - [水]｜添加量：1 g\n  - [水]｜添加量：1 g\n');
    expect(same.warnings).toHaveLength(0);
  });
  it('keeps data and claim line markers out of object references', () => {
    const r = parseBody('doc', '- 操作\n  - [数据] FTIR\n  - [论点] 仅作样品文本\n');
    expect(r.records[0].references).toHaveLength(0);
    expect(r.records[0].data?.name).toBe('FTIR');
  });
});
