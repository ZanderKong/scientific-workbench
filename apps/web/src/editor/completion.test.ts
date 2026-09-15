import { describe, expect, it } from 'vitest';
import type { PropertyDefinition } from '@workbench/core';
import { completions } from './completion';
const property = (id: string, name: string, usageCount = 0, aliases: string[] = []): PropertyDefinition => ({ id, version: 1, canonicalName: name, usageCount, aliases });
describe('completion ranking', () => {
  it('shows ten recent entries before frequent entries, capped at twenty without duplicates', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ ...property(String(index), `属性${index}`, 30 - index), lastUsedAt: new Date(2026, 0, index + 1).toISOString() }));
    const result = completions(items, '');
    expect(result.map(item => item.id).slice(0, 10)).toEqual(['29','28','27','26','25','24','23','22','21','20']);
    expect(result[10].id).toBe('0'); expect(new Set(result.map(item => item.id)).size).toBe(20);
  });
  it('orders exact, prefix, alias, contains and subsequence while returning standard names', () => {
    const items = [property('5', '温控装置度数'), property('4', '水温度'), property('3', '样品热状态', 99, ['温度']), property('2', '温度计'), property('1', '温度')];
    expect(completions(items, '温度').map(item => item.id)).toEqual(['1','2','3','4','5']);
  });
});
