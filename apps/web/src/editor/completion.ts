import type { PropertyDefinition, ResearchObject } from '@workbench/core';
type Candidate = PropertyDefinition | ResearchObject;
function subsequence(query: string, name: string) {
  let index = 0;
  for (const letter of name) if (letter === query[index]) index++;
  return index === query.length;
}
export function completions<T extends Candidate>(items: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  const frequency = (item: T) => 'usageCount' in item ? item.usageCount : 0;
  if (!q) {
    const recent = items.filter(item => 'lastUsedAt' in item && item.lastUsedAt).sort((a, b) => String('lastUsedAt' in b ? b.lastUsedAt : '').localeCompare(String('lastUsedAt' in a ? a.lastUsedAt : ''))).slice(0, 10);
    return [...new Map([...recent, ...[...items].sort((a, b) => frequency(b) - frequency(a))].map(item => [item.id, item])).values()].slice(0, 20);
  }
  const rank = (item: T) => {
    const name = item.canonicalName.toLocaleLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (item.aliases.some(alias => alias.toLocaleLowerCase().includes(q))) return 2;
    if (name.includes(q)) return 3;
    if (subsequence(q, name)) return 4;
    return 99;
  };
  return items.map(item => ({ item, rank: rank(item) })).filter(item => item.rank < 99).sort((a, b) => a.rank - b.rank || frequency(b.item) - frequency(a.item)).slice(0, 20).map(item => item.item);
}
