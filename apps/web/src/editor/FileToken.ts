import { Node } from "@tiptap/core";
import { fileLink } from "@workbench/core/attachments";

export const FileToken = Node.create<{ open: (id: string) => void }>({
  name: "fileToken",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  addOptions: () => ({ open: () => {} }),
  addAttributes: () => ({
    fileId: { default: "" },
    name: { default: "" },
    raw: { default: "" },
  }),
  parseHTML: () => [
    {
      tag: "span[data-file-id]",
      getAttrs: (element) => ({
        fileId: element.getAttribute("data-file-id"),
        name: element.getAttribute("data-file-name"),
        raw: element.getAttribute("data-file-raw"),
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    {
      "data-file-id": node.attrs.fileId,
      "data-file-name": node.attrs.name,
      "data-file-raw": node.attrs.raw,
      class: "fileChip",
    },
    [
      "span",
      { class: "fileIcon" },
      node.attrs.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE",
    ],
    ["span", { class: "fileName" }, node.attrs.name],
  ],
  renderText: ({ node }) =>
    node.attrs.raw || fileLink(node.attrs.fileId, node.attrs.name),
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      dom.dataset.fileId = node.attrs.fileId;
      dom.dataset.fileName = node.attrs.name;
      dom.dataset.fileRaw = node.attrs.raw;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fileChip";
      button.title = node.attrs.name;
      const icon = document.createElement("span");
      icon.className = "fileIcon";
      icon.textContent =
        node.attrs.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
      const name = document.createElement("span");
      name.className = "fileName";
      name.textContent = node.attrs.name;
      const click = () => this.options.open(node.attrs.fileId);
      button.addEventListener("click", click);
      button.append(icon, name);
      dom.append(button);
      return { dom, destroy: () => button.removeEventListener("click", click) };
    };
  },
});
