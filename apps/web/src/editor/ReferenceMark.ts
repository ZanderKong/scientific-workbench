import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/** Editable text with identity. Editing any character invalidates the old identity immediately. */
export const ReferenceMark = Mark.create({
  name: "objectReference",
  inclusive: false,
  addAttributes: () => ({
    objectId: { default: null },
    intentId: { default: null },
    rawToken: { default: "" },
    role: { default: "other" },
  }),
  parseHTML: () => [
    {
      tag: "span[data-raw-token]",
      getAttrs: (element) => ({
        objectId: element.getAttribute("data-object-id"),
        intentId: element.getAttribute("data-create-intent"),
        rawToken: element.getAttribute("data-raw-token"),
        role: element.getAttribute("data-object-role") || "other",
      }),
    },
  ],
  renderHTML: ({ mark, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      "data-object-id": mark.attrs.objectId,
      "data-create-intent": mark.attrs.intentId,
      title: mark.attrs.intentId
        ? "完成编辑后创建；修改引用会取消此创建意图"
        : undefined,
      "data-raw-token": mark.attrs.rawToken,
      "data-object-role": mark.attrs.role,
      class: `ref ${mark.attrs.role === "sample" ? "sampleRef" : mark.attrs.role}`,
    }),
    0,
  ],
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((transaction) => transaction.docChanged))
            return null;
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (!node.isTextblock) return;
            node.forEach((child, offset) => {
              const mark = child.marks.find((mark) => mark.type === type);
              if (mark && child.text !== mark.attrs.rawToken)
                tr.removeMark(
                  pos + 1 + offset,
                  pos + 1 + offset + child.nodeSize,
                  type,
                );
            });
          });
          return tr.steps.length ? tr : null;
        },
      }),
    ];
  },
});
