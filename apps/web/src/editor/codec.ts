import { fileLinks, fileLink } from "@workbench/core/attachments";
import type { JSONContent } from "@tiptap/core";
import type { ReferenceOccurrence } from "@workbench/core";

const marker = /^\s*<!--\s*swb:block\s+id="([^"<>]+)"\s*-->\s*$/;
const bullet = /^(\s*)- (.*)$/;
const textNode = (text: string): JSONContent[] =>
  text ? [{ type: "text", text }] : [];

function inlineFiles(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let offset = 0;
  for (const link of fileLinks(text)) {
    nodes.push(...textNode(text.slice(offset, link.start)), {
      type: "fileToken",
      attrs: { fileId: link.id, name: link.name, raw: link.raw },
    });
    offset = link.end;
  }
  nodes.push(...textNode(text.slice(offset)));
  return nodes;
}
const dataLine = (text: string) => /^(?:\[数据\]|【数据】|［数据］)/.test(text);

/** Plain text nodes keep brackets/backslashes exactly; Markdown formatting is never guessed. */
export function decodeBody(
  body: string,
  bindings: ReferenceOccurrence[] = [],
): JSONContent {
  const content: JSONContent[] = [];
  const stack: { indent: number; item: JSONContent; list: JSONContent }[] = [];
  const lines = body.split("\n");
  let pending: string | undefined;
  for (const [lineIndex, line] of lines.entries()) {
    const id = line.match(marker)?.[1];
    if (id && bullet.test(lines[lineIndex + 1] || "")) {
      pending = id;
      continue;
    }
    const match = line.match(bullet);
    if (!match) {
      const current = stack[stack.length - 1];
      if (!line.trim() && current) {
        (current.item.content ??= []).push({
          type: "literalLine",
          content: textNode(line),
        });
      } else if (
        current &&
        line.startsWith(" ".repeat(current.indent + 2)) &&
        line.trim()
      ) {
        const paragraph =
          current.item.content![current.item.content!.length - 1];
        if (paragraph.type === "paragraph")
          (paragraph.content ??= []).push(
            { type: "hardBreak" },
            ...textNode(line.slice(current.indent + 2)),
          );
        else
          current.item.content!.push({
            type: "literalLine",
            content: textNode(line),
          });
      } else {
        content.push({ type: "literalLine", content: textNode(line) });
        stack.length = 0;
      }
      continue;
    }
    const indent = match[1].replace(/\t/g, "  ").length;
    const blockId = pending || crypto.randomUUID();
    const inline: JSONContent[] = [];
    let offset = 0;
    for (const binding of bindings
      .filter(
        (binding) =>
          binding.blockId === blockId && (binding.objectId || binding.intentId),
      )
      .sort((a, b) => a.start - b.start)) {
      const token = match[2].slice(binding.start, binding.end);
      if (
        binding.start < offset ||
        token.slice(1, -1).trim() !== binding.rawText
      )
        continue;
      inline.push(...textNode(match[2].slice(offset, binding.start)));
      inline.push({
        type: "text",
        text: token,
        marks: [
          {
            type: "objectReference",
            attrs: {
              objectId: binding.objectId,
              intentId: binding.intentId,
              rawToken: token,
              role: binding.role,
            },
          },
        ],
      });
      offset = binding.end;
    }
    const isDataChild = stack.some(
      (parent) =>
        parent.indent < indent &&
        dataLine(plainText(parent.item.content?.[0] || {})),
    );
    inline.push(
      ...(isDataChild
        ? inlineFiles(match[2].slice(offset))
        : textNode(match[2].slice(offset))),
    );
    const item: JSONContent = {
      type: "listItem",
      attrs: { id: blockId },
      content: [{ type: "paragraph", content: inline }],
    };
    pending = undefined;
    while (stack.length && stack[stack.length - 1].indent >= indent)
      stack.pop();
    const parent = stack[stack.length - 1]?.item;
    const destination = parent ? (parent.content ??= []) : content;
    let list = destination[destination.length - 1];
    if (list?.type !== "bulletList") {
      list = { type: "bulletList", content: [] };
      destination.push(list);
    }
    list.content!.push(item);
    stack.push({ indent, item, list });
  }
  return {
    type: "doc",
    content: content.length
      ? content
      : [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                attrs: { id: crypto.randomUUID() },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
  };
}

export function encodeBindings(document: JSONContent): ReferenceOccurrence[] {
  const result: ReferenceOccurrence[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "listItem") {
      let offset = 0;
      for (const paragraph of (node.content || []).filter(
        (child) => child.type !== "bulletList",
      ))
        for (const text of paragraph.content || []) {
          const value =
            text.text ||
            (text.type === "hardBreak"
              ? "\n"
              : text.type === "fileToken"
                ? text.attrs?.raw ||
                  fileLink(text.attrs?.fileId, text.attrs?.name)
                : "");
          const mark = text.marks?.find(
            (mark) => mark.type === "objectReference",
          );
          if (
            (mark?.attrs?.objectId || mark?.attrs?.intentId) &&
            mark.attrs.rawToken === value
          )
            result.push({
              id: `${node.attrs!.id}:${offset}`,
              blockId: node.attrs!.id,
              objectId: mark.attrs.objectId || undefined,
              intentId: mark.attrs.intentId || undefined,
              rawText: value.slice(1, -1).trim(),
              role: mark.attrs.role,
              start: offset,
              end: offset + value.length,
              status: mark.attrs.intentId ? "create-intent" : "bound",
            });
          offset += value.length;
        }
    }
    for (const child of node.content || []) visit(child);
  };
  visit(document);
  return result;
}

const plainText = (node: JSONContent): string =>
  node.type === "fileToken"
    ? node.attrs?.raw || fileLink(node.attrs?.fileId, node.attrs?.name)
    : node.type === "text"
      ? node.text || ""
      : node.type === "hardBreak"
        ? "\n"
        : (node.content || []).map(plainText).join("");

export function encodeBody(document: JSONContent): string {
  const lines: string[] = [];
  const walk = (nodes: JSONContent[], depth: number) => {
    for (const node of nodes) {
      if (node.type === "bulletList") {
        walk(node.content || [], depth);
        continue;
      }
      if (node.type === "listItem") {
        const id = node.attrs?.id;
        if (!id) throw new Error("区块缺少稳定 ID，正文尚未提交");
        const indent = "  ".repeat(depth);
        lines.push(`${indent}<!-- swb:block id="${id}" -->`);
        const children = node.content || [];
        const first = children[0];
        const firstLines =
          first?.type === "paragraph" ? plainText(first).split("\n") : [""];
        lines.push(`${indent}- ${firstLines[0]}`);
        for (const continuation of firstLines.slice(1))
          lines.push(`${indent}  ${continuation}`);
        for (const child of children.slice(
          first?.type === "paragraph" ? 1 : 0,
        )) {
          if (child.type === "bulletList") walk([child], depth + 1);
          else if (child.type === "literalLine") lines.push(plainText(child));
          else
            for (const continuation of plainText(child).split("\n"))
              lines.push(`${indent}  ${continuation}`);
        }
      } else {
        lines.push(plainText(node));
      }
    }
  };
  walk(document.content || [], 0);
  return lines.join("\n");
}
