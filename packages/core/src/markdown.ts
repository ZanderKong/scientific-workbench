import YAML from "yaml";
import { sha256, uuid } from "./hash";
import type { DocumentFile, DocumentHead } from "./types";

const OPEN = "<!-- swb:block ";

export function createHead(
  entityType: DocumentHead["entityType"],
  id: string,
  body = "",
): DocumentHead {
  const schema = `swb.${entityType}/2` as DocumentHead["schema"];
  return {
    schema,
    entityType,
    id,
    contentVersion: 1,
    bodyHash: sha256(body),
    extractionStatus: "pending",
    projectionVersion: 0,
    blocks: {},
    updatedAt: new Date().toISOString(),
  };
}

export function parseDocument(text: string): DocumentFile {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!match) throw new Error("文档缺少 YAML 元数据头");
  const parsed = YAML.parse(match[1]) as DocumentHead;
  return { head: parsed, body: match[2] ?? "" };
}

export function serializeDocument(doc: DocumentFile): string {
  const head = {
    ...doc.head,
    bodyHash: sha256(doc.body),
    updatedAt: new Date().toISOString(),
  };
  return `---\n${YAML.stringify(head).trimEnd()}\n---\n${doc.body}`;
}

export function ensureBlockIds(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.includes(OPEN)) {
      const id = line.match(/id="([^"]+)"/)?.[1];
      if (id && seen.has(id)) {
        out.push(`<!-- swb:block id="${uuid()}" -->`);
        continue;
      }
      if (id) seen.add(id);
    }
    if (/^\s*-\s+/.test(line) && !out[out.length - 1]?.includes(OPEN)) {
      out.push(`<!-- swb:block id="${uuid()}" -->`);
    }
    out.push(line);
  }
  return out.join("\n");
}

export function stripInternalMarkers(body: string): string {
  return body
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^[ \t]*<!--\s*swb:block\s+id="[^"<>]+"\s*-->[ \t]*$/.test(line),
    )
    .join("\n");
}

export function blockLines(
  body: string,
): { id: string; line: number; indent: number; text: string }[] {
  const lines = body.split(/\r?\n/);
  const result: { id: string; line: number; indent: number; text: string }[] =
    [];
  let pending: string | undefined;
  lines.forEach((line, index) => {
    const id = line.match(/<!--\s*swb:block\s+id="([^"]+)"\s*-->/)?.[1];
    if (id) pending = id;
    const item = line.match(/^(\s*)-\s+(.*)$/);
    if (item) {
      result.push({
        id: pending ?? uuid(),
        line: index + 1,
        indent: item[1].length,
        text: item[2],
      });
      pending = undefined;
    }
  });
  return result;
}
