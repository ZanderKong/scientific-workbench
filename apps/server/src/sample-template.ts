import { blockLines, uuid } from "@workbench/core";

/** Copy procedural content, excluding result subtrees and their identities. */
export function sampleTemplate(body: string) {
  const lines = body.split(/\r?\n/);
  const blocks = blockLines(body);
  const removed = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (
      !/^(?:\[(?:数据|论点)\]|【(?:数据|论点)】|［(?:数据|论点)］)/.test(
        block.text,
      )
    )
      continue;
    let end = i + 1;
    while (end < blocks.length && blocks[end].indent > block.indent) end++;
    let startLine = block.line - 1;
    if (startLine > 0 && /<!--\s*swb:block/.test(lines[startLine - 1]))
      startLine--;
    let endLine = end < blocks.length ? blocks[end].line - 1 : lines.length;
    if (endLine > 0 && /<!--\s*swb:block/.test(lines[endLine - 1])) endLine--;
    for (let line = startLine; line < endLine; line++) removed.add(line);
    i = end - 1;
  }
  const ids = new Map<string, string>();
  const content = lines
    .filter((_, index) => !removed.has(index))
    .join("\n")
    .replace(/<!-- swb:block id="([^"]+)" -->/g, (_marker, old: string) => {
      const next = uuid();
      ids.set(old, next);
      return `<!-- swb:block id="${next}" -->`;
    });
  return { body: content, ids };
}
