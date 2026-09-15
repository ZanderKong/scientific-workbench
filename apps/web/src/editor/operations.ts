import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";

const isData = (node: ProseMirrorNode) =>
  /^(?:\[数据\]|【数据】|［数据］)/.test(node.firstChild?.textContent || "");

export function topOperation(state: EditorState, position: number) {
  const resolved = state.doc.resolve(position);
  for (let depth = 1; depth <= resolved.depth; depth++) {
    if (resolved.node(depth).type.name === "listItem")
      return {
        node: resolved.node(depth),
        pos: resolved.before(depth),
        parent: resolved.node(depth - 1),
        index: resolved.index(depth - 1),
      };
  }
}

/** Move the actual subtree in a single undoable transaction, retaining all identities. */
export function moveOperation(
  state: EditorState,
  id: string,
  targetPosition: number,
  after: boolean,
): Transaction | undefined {
  let source: { node: ProseMirrorNode; pos: number } | undefined;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "listItem" && node.attrs.id === id)
      source = { node, pos };
  });
  const target = topOperation(state, targetPosition);
  if (!source || !target || source.node === target.node) return;
  const destination = target.pos + (after ? target.node.nodeSize : 0);
  const tr = state.tr.delete(source.pos, source.pos + source.node.nodeSize);
  const insertAt = tr.mapping.map(destination, after ? 1 : -1);
  tr.insert(insertAt, source.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)));
  return tr.scrollIntoView();
}

export const ResearchKeyboard = Extension.create<{
  warn: (message: string) => void;
}>({
  name: "researchKeyboard",
  priority: 1000,
  addOptions: () => ({ warn: () => {} }),
  addKeyboardShortcuts() {
    const move = (direction: number) => {
      const state = this.editor.state;
      const current = topOperation(state, state.selection.from);
      if (!current) return false;
      const index = current.index + direction;
      if (index < 0 || index >= current.parent.childCount) return true;
      const target =
        direction < 0
          ? current.pos - current.parent.child(index).nodeSize + 2
          : current.pos + current.node.nodeSize + 2;
      const tr = moveOperation(
        state,
        current.node.attrs.id,
        target,
        direction > 0,
      );
      if (tr) this.editor.view.dispatch(tr);
      return true;
    };
    return {
      Tab: () => {
        if (this.editor.view.composing) return false;
        const { $from, $to } = this.editor.state.selection;
        let depth = $from.depth;
        while (depth && $from.node(depth).type.name !== "listItem") depth--;
        if (!depth || $from.node(depth) !== $to.node(depth)) return true;
        const parent = $from.node(depth - 1);
        const index = $from.index(depth - 1);
        const level = Array.from({ length: depth }, (_, i) =>
          $from.node(i + 1),
        ).filter((node) => node.type.name === "listItem").length;
        const previous = index ? parent.child(index - 1) : undefined;
        if (level >= 3 || (level === 2 && (!previous || !isData(previous)))) {
          this.options.warn(
            "普通操作最多两层；只有 Data 子级可缩进到第三层。原文已保留。",
          );
          return true;
        }
        this.editor.commands.sinkListItem("listItem");
        return true;
      },
      "Shift-Tab": () =>
        this.editor.view.composing
          ? false
          : this.editor.commands.liftListItem("listItem"),
      "Alt-ArrowUp": () => move(-1),
      "Alt-ArrowDown": () => move(1),
    };
  },
});
