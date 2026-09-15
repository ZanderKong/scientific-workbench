import { sha256 } from './hash';
import { blockLines } from './markdown';
import type { ParseResult, ParsedRecord, PropertyValue, ReferenceOccurrence } from './types';

const brackets: Record<string, string> = { '[': ']', '【': '】', '［': '］' };
export function semanticMarker(text: string): '数据' | '论点' | undefined {
  const close = brackets[text[0]];
  if (!close) return;
  const end = text.indexOf(close, 1);
  const name = text.slice(1, end);
  if (end > 0 && (name === '数据' || name === '论点')) return name;
}

export function parseObjectRefs(text: string, _line: number, blockId: string): ReferenceOccurrence[] {
  const refs: ReferenceOccurrence[] = [];
  for (let i = 0; i < text.length; i++) {
    const close = brackets[text[i]];
    if (!close) continue;
    const end = text.indexOf(close, i + 1);
    if (end < 0) continue;
    const name = text.slice(i + 1, end).trim();
    if (!name || /[\[\]【】［］]/.test(name)) continue;
    if (i === 0 && semanticMarker(text)) { i = end; continue; }
    refs.push({ id: sha256(`${blockId}:ref:${refs.length}`).slice(0, 32), blockId, rawText: name, role: 'unresolved', start: i, end: end + 1, status: 'unresolved' });
    i = end;
  }
  return refs;
}

export function parsePropertyLine(text: string, line: number, blockId: string, refs: ReferenceOccurrence[]): { properties: PropertyValue[]; invalid: string[] } {
  const trimmed = text.trimStart();
  const close = brackets[trimmed[0]];
  const end = close ? trimmed.indexOf(close, 1) : -1;
  if (!close || end <= 1 || !/^[|｜]/.test(trimmed.slice(end + 1))) return { properties: [], invalid: [] };
  if (refs.length !== 1) return { properties: [], invalid: [text] };
  const name = trimmed.slice(1, end).trim();
  if (!name || /[\[\]【】［］]/.test(name)) return { properties: [], invalid: [text] };
  const properties: PropertyValue[] = [], invalid: string[] = [];
  let offset = text.length - trimmed.length + end + 2;
  for (const [index, segment] of trimmed.slice(end + 1).split(/[|｜]/).slice(1).entries()) {
    const colon = segment.search(/[:：]/);
    const propertyName = colon >= 0 ? segment.slice(0, colon).trim() : '';
    const valueText = colon >= 0 ? segment.slice(colon + 1).trim() : '';
    if (!propertyName || !valueText) invalid.push(segment);
    else properties.push({ id: sha256(`${blockId}:property:${index}`).slice(0, 32), blockId, objectId: name, propertyId: '', propertyName, valueText, sourceLine: line, sourceColumn: offset });
    offset += segment.length + 1;
  }
  return { properties, invalid };
}

export function parseBody(documentId: string, body: string): ParseResult {
  const blocks = blockLines(body), lines = body.split(/\r?\n/);
  const records: ParsedRecord[] = [];
  for (let start = 0; start < blocks.length;) {
    const parent = blocks[start];
    let stop = start + 1;
    while (stop < blocks.length && blocks[stop].indent > parent.indent) stop++;
    const record: ParsedRecord = { blockId: parent.id, line: parent.line, text: parent.text, references: [], properties: [], warnings: [], invalidSegments: [], dataItems: [] };
    for (let index = start; index < stop; index++) {
      const block = blocks[index];
      const marker = semanticMarker(block.text);
      if (marker) {
        let end = index + 1;
        while (end < stop && blocks[end].indent > block.indent) end++;
        if (marker === '数据') {
          let rawEnd = end < blocks.length ? blocks[end].line - 1 : lines.length;
          if (rawEnd > block.line && /^\s*<!--\s*swb:block/.test(lines[rawEnd - 1])) rawEnd--;
          const raw = lines.slice(block.line, rawEnd).map(line => line.startsWith(' '.repeat(block.indent + 2)) ? line.slice(block.indent + 2) : line).join('\n').replace(/\n+$/, '');
          record.dataItems!.push({ id: '', blockId: block.id, name: block.text.slice(block.text.indexOf(brackets[block.text[0]]) + 1).split(/[|｜]/)[0].trim() || '未命名数据', body: raw });
        }
        index = end - 1;
        continue;
      }
      const refs = parseObjectRefs(block.text, block.line, block.id);
      record.references.push(...refs);
      if (index !== start) {
        const result = parsePropertyLine(block.text, block.line, block.id, refs);
        record.properties.push(...result.properties);
        record.invalidSegments!.push(...result.invalid.map(text => ({ line: block.line, text, reason: refs.length > 1 ? '同一属性行有多个对象，无法确定归属' : '属性段格式无效' })));
      }
    }
    const grouped = new Map<string, Set<string>>();
    for (const property of record.properties) {
      const key = `${property.objectId}\0${property.propertyName}`;
      const values = grouped.get(key) || new Set<string>(); values.add(property.valueText); grouped.set(key, values);
    }
    for (const [key, values] of grouped) if (values.size > 1) record.warnings.push(`此操作中，“${key.split('\0')[0]}”的属性有多个不同记录，请检查是否需要拆分操作。`);
    record.data = record.dataItems?.[0]; records.push(record); start = stop;
  }
  return { documentId, bodyHash: sha256(body), records, invalidSegments: records.flatMap(record => record.invalidSegments || []), warnings: records.flatMap(record => record.warnings), intents: [] };
}
