import {
  fileLinks,
  sha256,
  type Attachment,
  type DataComponent,
} from "@workbench/core";

export function bodyAttachments(
  dataId: string,
  body: string,
  components: DataComponent[],
  attachment: (id: string) => Attachment,
  warnings: string[] = [],
) {
  const links = new Map(fileLinks(body).map((link) => [link.id, link]));
  const next = components.filter(
    (component) => !component.bodyLinked || links.has(component.attachmentId!),
  );
  for (const link of links.values()) {
    if (next.some((component) => component.attachmentId === link.id)) continue;
    let file: Attachment;
    try {
      file = attachment(link.id);
    } catch (error) {
      if (error instanceof Error && error.message === "附件不存在") {
        warnings.push(`附件「${link.name}」不存在，已保留链接文字。`);
        continue;
      }
      throw error;
    }
    next.push({
      id: sha256(`${dataId}:body-file:${file.id}`).slice(0, 32),
      kind: "file",
      name: file.originalName,
      role: "raw",
      creator: "human",
      provenance: "Data 正文附件引用",
      createdAt: file.createdAt,
      derivedFrom: [],
      attachmentId: file.id,
      bodyLinked: true,
    });
  }
  return next;
}
