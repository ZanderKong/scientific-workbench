import type { JSONContent } from "@tiptap/core";
import { decodeBody, encodeBody } from "./codec";

const inlineText = (node: JSONContent): string =>
  node.type === "hardBreak"
    ? "\n"
    : (node.text ?? (node.content ?? []).map(inlineText).join(""));
/** Explicitly submitted parent bullets become separate claims; children stay with their parent. */
export function claimDrafts(body: string): { blockId: string; text: string }[] {
  return (decodeBody(body).content ?? []).flatMap((list) => {
    if (list.type !== "bulletList") return [];
    return (list.content ?? []).flatMap((item) => {
      const parent = inlineText(item.content?.[0] ?? {})
        .trim()
        .replace(/^(?:\[论点\]|【论点】|［论点］)\s*/, "");
      if (!parent) return [];
      const children = encodeBody({
        type: "doc",
        content: (item.content ?? []).slice(1),
      })
        .replace(/^\s*<!--\s*swb:block[^\n]*-->\n?/gm, "")
        .trimEnd();
      return [
        {
          blockId: item.attrs!.id,
          text:
            parent +
            (children
              ? "\n" +
                children
                  .split("\n")
                  .map((line) => "  " + line)
                  .join("\n")
              : ""),
        },
      ];
    });
  });
}
