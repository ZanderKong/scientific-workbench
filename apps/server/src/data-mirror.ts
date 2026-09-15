import { blockLines, sha256, stripInternalMarkers, uuid } from '@workbench/core';

export const dataMirrorHash = (body: string) => sha256(stripInternalMarkers(body));
export function mapDataBlocks(body: string, mapping: Record<string, string>, direction: 'toMirror' | 'toData') {
  const reverse = new Map(Object.entries(mapping).map(([data, mirror]) => [mirror, data]));
  return body.replace(/<!-- swb:block id="([^"]+)" -->/g, (_marker, id: string) => {
    if (direction === 'toMirror') { mapping[id] ??= uuid(); return `<!-- swb:block id="${mapping[id]}" -->`; }
    const dataId = reverse.get(id) || uuid(); mapping[dataId] = id;
    return `<!-- swb:block id="${dataId}" -->`;
  });
}

/** Replace just one Data subtree. Other operation IDs and text remain byte-for-byte intact. */
export function replaceDataMirror(body: string, blockId: string, name: string, dataBody: string): string {
  const blocks = blockLines(body);
  const index = blocks.findIndex(block => block.id === blockId);
  if (index < 0) throw new Error('Data 来源区块不存在');
  const block = blocks[index], lines = body.split('\n');
  const next = blocks.slice(index + 1).find(candidate => candidate.indent <= block.indent);
  let end = next ? next.line - 1 : lines.length;
  if (next && /^\s*<!--\s*swb:block/.test(lines[end - 1])) end--;
  const prefix = ' '.repeat(block.indent);
  const replacement = [`${prefix}- [数据] ${name}`, ...dataBody.split('\n').filter((line, position, all) => line || position < all.length - 1).map(line => `${prefix}  ${line}`)];
  lines.splice(block.line - 1, end - block.line + 1, ...replacement);
  return lines.join('\n');
}
