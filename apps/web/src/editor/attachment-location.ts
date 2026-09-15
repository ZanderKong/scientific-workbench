import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/core";
export interface AttachmentTarget {
  dataBlockId: string;
  childBlockId?: string;
}
const isData = (text: string) => /^(?:\[数据\]|【数据】|［数据］)/.test(text);
export function attachmentTarget(
  state: EditorState,
  position = state.selection.from,
): AttachmentTarget | undefined {
  const resolved = state.doc.resolve(position);
  let childBlockId: string | undefined;
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (node.type.name !== "listItem") continue;
    if (isData(node.firstChild?.textContent || ""))
      return { dataBlockId: node.attrs.id, childBlockId };
    childBlockId = node.attrs.id;
  }
}
/** Locate again after upload; never append to the old numeric cursor position. */
export function insertAttachments(
  editor: Editor,
  target: AttachmentTarget,
  tokens: JSONContent[],
) {
  let dataPosition: number | undefined, childPosition: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (
      node.type.name === "listItem" &&
      node.attrs.id === target.dataBlockId &&
      isData(node.firstChild?.textContent || "")
    )
      dataPosition = pos;
    if (node.type.name === "listItem" && node.attrs.id === target.childBlockId)
      childPosition = pos;
  });
  if (dataPosition === undefined)
    throw Error("原 Data 行已删除，文件已在本地保存，请重新关联");
  const data = editor.state.doc.nodeAt(dataPosition)!;
  if (
    childPosition !== undefined &&
    childPosition > dataPosition &&
    childPosition < dataPosition + data.nodeSize
  ) {
    const child = editor.state.doc.nodeAt(childPosition)!;
    editor.commands.insertContentAt(
      childPosition + child.firstChild!.nodeSize,
      tokens,
    );
    return;
  }
  const item: JSONContent = {
    type: "listItem",
    attrs: { id: crypto.randomUUID() },
    content: [{ type: "paragraph", content: tokens }],
  };
  const children = data.lastChild;
  if (children?.type.name === "bulletList")
    editor.commands.insertContentAt(dataPosition + data.nodeSize - 2, item);
  else
    editor.commands.insertContentAt(dataPosition + data.nodeSize - 1, {
      type: "bulletList",
      content: [item],
    });
}
