import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, Node, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type {
  ResearchObject,
  PropertyDefinition,
  ReferenceOccurrence,
  ObjectRole,
  Attachment,
} from "@workbench/core";
import { decodeBody, encodeBody, encodeBindings } from "./codec";
import { FileToken } from "./FileToken";
import { attachmentTarget, insertAttachments } from "./attachment-location";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { ResearchKeyboard, moveOperation } from "./operations";
import { ReferenceMark } from "./ReferenceMark";
import { request } from "../api";
import { completions } from "./completion";

const literalLine = Node.create({
  name: "literalLine",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "div[data-literal-line]" }],
  renderHTML: () => [
    "div",
    { "data-literal-line": "", class: "literalLine" },
    0,
  ],
});

interface Query {
  kind: "object" | "property";
  text: string;
  from: number;
  to: number;
  x: number;
  y: number;
}
export function ResearchEditor({
  body,
  bindings,
  onChange,
  onError,
  label = "样品正文",
  placeholder = "直接开始记录……输入 [名称] 引用对象，[数据] 创建数据",
  focusBlock,
  allowCreateIntents = false,
  trackUpload,
}: {
  body: string;
  bindings?: ReferenceOccurrence[];
  onChange: (body: string, bindings: ReferenceOccurrence[]) => void;
  onError: (message: string) => void;
  label?: string;
  placeholder?: string;
  focusBlock?: string;
  allowCreateIntents?: boolean;
  trackUpload?: (task: Promise<void>) => void;
}) {
  const [objects, setObjects] = useState<ResearchObject[]>([]);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [query, setQuery] = useState<Query | null>(null);
  const [preview, setPreview] = useState<Attachment>();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<ReturnType<typeof attachmentTarget>>(undefined);
  const openUpload = useRef<(position?: number) => void>(() => {});
  const onFiles = useRef<(files: File[]) => void>(() => {});
  const [choice, setChoice] = useState(0);
  const callback = useRef(onChange);
  callback.current = onChange;
  const errors = useRef(onError);
  errors.current = onError;
  const composition = useRef(false);
  const draggedOperation = useRef<string | undefined>(undefined);
  const currentQuery = useRef<Query | null>(null);
  const insertCurrent = useRef<() => boolean>(() => false);
  const folded = useRef(new Set<string>());
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;
  const updateQuery = useCallback((editor: Editor) => {
    if (composition.current || editor.view.composing) return;
    const { $from, from, empty } = editor.state.selection;
    if (!empty || !$from.parent.isTextblock) {
      setQuery(null);
      currentQuery.current = null;
      return;
    }
    const prefix = $from.parent.textBetween(0, $from.parentOffset, "\n");
    const object = prefix.match(/[\[【［]([^\[\]【】［］]*)$/);
    const property = prefix.match(/[|｜]([^|｜:：]*)$/);
    const match = object || property;
    if (!match) {
      setQuery(null);
      currentQuery.current = null;
      return;
    }
    const rect = editor.view.coordsAtPos(from);
    const next: Query = {
      kind: object ? "object" : "property",
      text: match[1],
      from: from - match[0].length,
      to: from,
      x: Math.max(178, Math.min(window.innerWidth - 372, rect.left)),
      y: Math.min(window.innerHeight - 300, rect.bottom + 5),
    };
    setQuery(next);
    currentQuery.current = next;
    setChoice(0);
  }, []);
  const editor: Editor | null = useEditor({
    extensions: [
      StarterKit.configure({
        trailingNode: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        orderedList: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        link: false,
      }),
      literalLine,
      ResearchKeyboard.configure({
        warn: (message) => errors.current(message),
      }),
      ReferenceMark,
      FileToken.configure({
        open: (id) =>
          void request<Attachment>(`/attachments/${id}`)
            .then(setPreview)
            .catch((error) => errors.current(error.message)),
      }),
      UniqueID.configure({ types: ["listItem"], attributeName: "id" }),
      Extension.create({
        name: "folding",
        addProseMirrorPlugins: () => [
          new Plugin({
            key: new PluginKey("research-fold"),
            props: {
              decorations(state) {
                const decorations: Decoration[] = [];
                state.doc.descendants((node, pos) => {
                  if (
                    node.type.name === "listItem" &&
                    node.firstChild?.content.size === 0 &&
                    node.childCount === 1 &&
                    state.doc.resolve(pos).depth === 1
                  ) {
                    decorations.push(
                      Decoration.node(pos, pos + node.nodeSize, {
                        class: "emptyResearchLine",
                      }),
                    );
                    decorations.push(
                      Decoration.node(
                        pos + 1,
                        pos + 1 + node.firstChild!.nodeSize,
                        {
                          "data-placeholder":
                            state.doc.firstChild?.childCount === 1
                              ? placeholder
                              : "继续记录……",
                        },
                      ),
                    );
                  }

                  if (
                    trackUpload &&
                    node.isTextblock &&
                    node.content.size === 0 &&
                    attachmentTarget(state, pos + 1)?.childBlockId
                  ) {
                    decorations.push(
                      Decoration.widget(
                        pos,
                        () => {
                          const button = document.createElement("button");
                          button.type = "button";
                          button.className = "fileChip attachmentPrompt";
                          button.textContent = "＋ 添加附件";
                          button.contentEditable = "false";
                          button.addEventListener("mousedown", (event) =>
                            event.preventDefault(),
                          );
                          button.addEventListener("click", () =>
                            openUpload.current(pos + 1),
                          );
                          return button;
                        },
                        { side: -1, key: `attachment-${pos}`, ignoreSelection: true },
                      ),
                    );
                  }
                  if (node.isTextblock) {
                    const text = node.textBetween(
                      0,
                      node.content.size,
                      "\n",
                      "\ufffc",
                    );
                    if (/^(?:\[数据\]|【数据】|［数据］)/.test(text)) {
                      decorations.push(
                        Decoration.node(pos, pos + node.nodeSize, {
                          class: "researchDataLine",
                        }),
                      );
                      for (const separator of text.matchAll(/[|｜]/g)) {
                        decorations.push(
                          Decoration.inline(
                            pos + 1 + separator.index!,
                            pos + 2 + separator.index!,
                            { class: "dataMetaSep" },
                          ),
                        );
                      }
                    }
                    const pattern =
                      /\[([^\[\]【】［］]+)\]|【([^\[\]【】［］]+)】|［([^\[\]【】［］]+)］/g;
                    for (const match of text.matchAll(pattern)) {
                      const name = match[1] || match[2] || match[3];
                      if (
                        state.doc.rangeHasMark(
                          pos + 1 + match.index!,
                          pos + 1 + match.index! + match[0].length,
                          state.schema.marks.objectReference,
                        )
                      )
                        continue;
                      const known = objectsRef.current.filter(
                        (item) =>
                          item.canonicalName === name &&
                          item.lifecycle !== "merged",
                      );
                      const semantic =
                        match.index === 0 &&
                        (name === "数据" || name === "论点");
                      const className = semantic
                        ? `semanticBadge ${name === "数据" ? "dataBadge" : "claimEditorBadge"}`
                        : known.length === 1
                          ? `ref ${known[0].role === "sample" ? "sampleRef" : known[0].role}`
                          : "unresolvedReference";
                      decorations.push(
                        Decoration.inline(
                          pos + 1 + match.index!,
                          pos + 1 + match.index! + match[0].length,
                          {
                            class: className,
                            title: semantic
                              ? name === "论点"
                                ? "样品中的论点仅作为文本保留"
                                : "数据行"
                              : known.length === 1
                                ? known[0].canonicalName
                                : "请选择已有对象或明确创建类别",
                          },
                        ),
                      );
                    }
                  }
                  if (
                    node.type.name === "listItem" &&
                    node.content.childCount > 1 &&
                    state.doc.resolve(pos).depth === 1
                  ) {
                    const id = String(node.attrs.id);
                    decorations.push(
                      Decoration.widget(
                        pos + 1,
                        () => {
                          const button = document.createElement("button");
                          button.className = "fold researchFold";
                          button.type = "button";
                          button.contentEditable = "false";
                          button.draggable = true;
                          button.title =
                            "点击折叠；拖动调整操作顺序（也可用 Alt＋上下方向键）";
                          button.addEventListener("dragstart", (event) => {
                            draggedOperation.current = id;
                            event.dataTransfer?.setData(
                              "application/x-workbench-operation",
                              id,
                            );
                            if (event.dataTransfer)
                              event.dataTransfer.effectAllowed = "move";
                          });
                          button.addEventListener("dragend", () => {
                            draggedOperation.current = undefined;
                          });
                          button.textContent = folded.current.has(id)
                            ? "›"
                            : "⌄";
                          button.setAttribute(
                            "aria-label",
                            folded.current.has(id) ? "展开操作" : "折叠操作",
                          );
                          button.onclick = (event) => {
                            event.preventDefault();
                            if (folded.current.has(id))
                              folded.current.delete(id);
                            else folded.current.add(id);
                            editor?.view.dispatch(
                              editor.state.tr.setMeta("fold", true),
                            );
                          };
                          return button;
                        },
                        {
                          side: -1,
                          key: `fold-${id}-${folded.current.has(id)}`,
                        },
                      ),
                    );
                    if (folded.current.has(id))
                      decorations.push(
                        Decoration.node(pos, pos + node.nodeSize, {
                          class: "researchFolded",
                        }),
                      );
                  }
                });
                const selection = state.selection;
                if (selection.empty && !composition.current) {
                  const prefix = selection.$from.parent.textBetween(
                    0,
                    selection.$from.parentOffset,
                  );
                  const name = prefix
                    .match(/[|｜]([^|｜:：]+)[:：]\s*$/)?.[1]
                    ?.trim();
                  const property = propertiesRef.current.find(
                    (item) => item.canonicalName === name,
                  );
                  if (property?.recommendedUnit)
                    decorations.push(
                      Decoration.widget(
                        selection.from,
                        () => {
                          const hint = document.createElement("span");
                          hint.className = "unitHint";
                          hint.textContent = property.recommendedUnit!;
                          hint.contentEditable = "false";
                          hint.setAttribute("aria-hidden", "true");
                          return hint;
                        },
                        { side: 1, key: `unit-${property.id}` },
                      ),
                    );
                }
                return DecorationSet.create(state.doc, decorations);
              },
            },
          }),
        ],
      }),
    ],
    content: decodeBody(body || "- ", bindings),
    onUpdate({ editor, transaction }) {
      try {
        if (!transaction.getMeta("bindingDecoration")) {
          const document = editor.getJSON();
          callback.current(encodeBody(document), encodeBindings(document));
        }
      } catch (error) {
        errors.current(String(error));
      }
      updateQuery(editor);
    },
    onSelectionUpdate: ({ editor }) => updateQuery(editor),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        spellcheck: "false",
      },
      handleDrop(view, event) {
        if (
          draggedOperation.current && !event.dataTransfer?.files.length
        ) {
          const hit = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (hit) {
            const line = view.coordsAtPos(hit.pos);
            const tr = moveOperation(
              view.state,
              draggedOperation.current,
              hit.pos,
              event.clientY >= (line.top + line.bottom) / 2,
            );
            if (tr) view.dispatch(tr);
          }
          draggedOperation.current = undefined;
          event.preventDefault();
          return true;
        }
        if (!trackUpload || !event.dataTransfer?.files.length) return false;
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        const target =
          pos === undefined ? undefined : attachmentTarget(view.state, pos);
        event.preventDefault();
        if (!target) {
          errors.current("请将附件拖到 Data 行或其子级");
          return true;
        }
        uploadTarget.current = target;
        onFiles.current(Array.from(event.dataTransfer.files));
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => {
          composition.current = true;
          return false;
        },
        compositionend: () => {
          composition.current = false;
          requestAnimationFrame(() => {
            if (editor && !editor.isDestroyed) updateQuery(editor);
          });
          return false;
        },
      },
      handleKeyDown(_view, event) {
        if (composition.current || event.isComposing || !currentQuery.current)
          return false;
        if (event.key === "Escape") {
          setQuery(null);
          currentQuery.current = null;
          return true;
        }
        if (event.key === "ArrowDown") {
          setChoice((current) => current + 1);
          return true;
        }
        if (event.key === "ArrowUp") {
          setChoice((current) => Math.max(0, current - 1));
          return true;
        }
        if (event.key === "Enter") return insertCurrent.current();
        return false;
      },
    },
  });
  openUpload.current = (position) => {
    if (!editor) return;
    const target = attachmentTarget(editor.state, position);
    if (!target) {
      errors.current("请在 Data 行的子级添加附件");
      return;
    }
    uploadTarget.current = target;
    fileInput.current?.click();
  };
  onFiles.current = (files) => {
    const target = uploadTarget.current;
    if (!editor || !target || !trackUpload || !files.length) return;
    uploadTarget.current = undefined;
    const task = (async () => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const saved = await request<Attachment>("/attachments/stream", {
          method: "POST",
          body: form,
        });
        if (editor.isDestroyed)
          throw Error("编辑器已关闭，文件已在本地保存，请重新关联");
        insertAttachments(editor, target, [
          {
            type: "fileToken",
            attrs: { fileId: saved.id, name: saved.originalName },
          },
        ]);
      }
    })();
    trackUpload(task);
    void task.catch((error) => errors.current(error.message));
  };
  useEffect(() => {
    let active = true;
    void Promise.all([
      request<ResearchObject[]>("/objects"),
      request<PropertyDefinition[]>("/properties"),
    ])
      .then(([o, p]) => {
        if (active) {
          setObjects(o);
          setProperties(p);
        }
      })
      .catch((error) => errors.current(error.message));
    return () => {
      active = false;
    };
  }, [bindings]);
  useEffect(() => {
    if (editor)
      editor.view.dispatch(
        editor.state.tr.setMeta("dictionaryDecoration", true),
      );
  }, [editor, objects, properties]);
  useEffect(() => {
    if (!editor || !focusBlock) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id === focusBlock)
        editor.commands.setTextSelection(pos + 2);
    });
    editor.commands.scrollIntoView();
    editor.commands.focus();
  }, [editor, focusBlock]);
  useEffect(() => {
    if (!editor || !bindings?.length) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "listItem") return;
      for (const binding of bindings.filter(
        (binding) =>
          binding.blockId === node.attrs.id &&
          (binding.objectId || binding.intentId),
      )) {
        const token = node.firstChild?.textContent.slice(
          binding.start,
          binding.end,
        );
        if (!token || token.slice(1, -1).trim() !== binding.rawText) continue;
        const from = pos + 2 + binding.start,
          to = pos + 2 + binding.end;
        const mark = editor.schema.marks.objectReference.create({
          objectId: binding.objectId || null,
          intentId: binding.intentId || null,
          rawToken: token,
          role: binding.role,
        });
        const existingMark = editor.state.doc
          .resolve(from)
          .nodeAfter?.marks.find((existing) => existing.type === mark.type);
        if (!existingMark?.eq(mark)) tr.addMark(from, to, mark);
      }
    });
    if (tr.steps.length)
      editor.view.dispatch(
        tr.setMeta("addToHistory", false).setMeta("bindingDecoration", true),
      );
  }, [editor, bindings]);
  const candidates = query?.kind === "object" ? objects : properties;
  const normalized = query?.text.trim().toLowerCase() || "";
  const ranked = completions<ResearchObject | PropertyDefinition>(
    candidates,
    normalized,
  );
  const insert = (
    name: string,
    object?: Pick<ResearchObject, "id" | "role">,
    intentId?: string,
  ) => {
    if (!editor || !query) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: query.from, to: query.to },
        {
          type: "text",
          text: query.kind === "object" ? `[${name}]` : `｜${name}：`,
          ...(object
            ? {
                marks: [
                  {
                    type: "objectReference",
                    attrs: {
                      objectId: intentId ? null : object.id,
                      intentId: intentId || null,
                      rawToken: `[${name}]`,
                      role: object.role,
                    },
                  },
                ],
              }
            : {}),
        },
      )
      .run();
    setQuery(null);
    currentQuery.current = null;
  };
  insertCurrent.current = () => {
    const item = ranked[choice % Math.max(1, ranked.length)];
    if (!item) return false;
    insert(item.canonicalName, "role" in item ? item : undefined);
    return true;
  };
  const createObject = (role: ObjectRole) => {
    if (!query?.text.trim() || !allowCreateIntents) return;
    const name = query.text.trim();
    if (["数据", "论点"].includes(name)) return;
    const intentId = crypto.randomUUID();
    insert(name, { id: intentId, role }, intentId);
  };
  return (
    <>
      <EditorContent editor={editor} className="researchEditor" />
      {trackUpload && (
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="添加 Data 附件"
          onChange={(event) => {
            if (!uploadTarget.current && editor)
              uploadTarget.current = attachmentTarget(editor.state);
            onFiles.current(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
      )}
      {preview && (
        <AttachmentPreview file={preview} close={() => setPreview(undefined)} />
      )}
      {query && (
        <div
          className="objectPicker"
          role="listbox"
          style={{ left: query.x, top: query.y }}
        >
          {ranked.map((item, index) => (
            <button
              role="option"
              aria-selected={choice % Math.max(1, ranked.length) === index}
              className="objectResult"
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                insert(item.canonicalName, "role" in item ? item : undefined)
              }
            >
              <span>{item.canonicalName}</span>
              <span className="roleTag">
                {"role" in item ? item.role : item.recommendedUnit || "属性"}
              </span>
            </button>
          ))}
          {allowCreateIntents &&
            query.kind === "object" &&
            query.text.trim() &&
            !["数据", "论点"].includes(query.text.trim()) &&
            !objects.some(
              (item) => item.canonicalName === query.text.trim(),
            ) && (
              <>
                <div className="objectPickerSep" />
                {(
                  [
                    ["material", "原料"],
                    ["equipment", "设备"],
                    ["process", "过程"],
                  ] as const
                ).map(([role, label]) => (
                  <button
                    className="objectResult"
                    key={role}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void createObject(role)}
                  >
                    创建「{query.text}」
                    <span className="roleTag createTag">{label}</span>
                  </button>
                ))}
              </>
            )}
        </div>
      )}
    </>
  );
}
