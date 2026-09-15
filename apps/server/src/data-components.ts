import type { Attachment, DataComponent } from "@workbench/core";

export function legacyComponents(
  ids: string[],
  attachment: (id: string) => Attachment,
): DataComponent[] {
  return [...new Set(ids)].map((id) => {
    const file = attachment(id);
    return {
      id,
      kind: "file",
      name: file.originalName,
      role: "raw",
      attachmentId: id,
      creator: "human",
      provenance: "文件上传",
      derivedFrom: [],
      createdAt: file.createdAt,
    };
  });
}

export function validateComponents(
  components: DataComponent[],
  previous: DataComponent[],
  attachment: (id: string) => Attachment,
): DataComponent[] {
  const invalid = (message: string): never => {
    throw Object.assign(new Error(message), { code: "INVALID_INPUT" });
  };
  if (!Array.isArray(components)) invalid("组件清单必须为数组");
  const ids = new Set<string>();
  for (const component of components) {
    if (
      !component ||
      typeof component.id !== "string" ||
      !component.id ||
      ids.has(component.id)
    )
      invalid("组件身份缺失或重复");
    ids.add(component.id);
    if (
      !["file", "text"].includes(component.kind) ||
      !["human", "external"].includes(component.creator) ||
      typeof component.name !== "string" ||
      !component.name.trim() ||
      typeof component.role !== "string" ||
      !component.role.trim() ||
      typeof component.provenance !== "string" ||
      !Array.isArray(component.derivedFrom) ||
      component.derivedFrom.some((id) => typeof id !== "string") ||
      !Number.isFinite(Date.parse(component.createdAt))
    )
      invalid("组件字段格式无效");
    if (component.kind === "file") {
      if (!component.attachmentId || component.content !== undefined)
        invalid("文件组件必须指定附件，不能内嵌字节");
      attachment(component.attachmentId!);
    } else if (
      typeof component.content !== "string" ||
      component.attachmentId !== undefined
    )
      invalid("文本组件必须保留正文，不能充当附件");
    const prior = previous.find((item) => item.id === component.id);
    if (
      prior &&
      (prior.kind !== component.kind ||
        prior.attachmentId !== component.attachmentId ||
        (prior.role === "raw" && prior.content !== component.content))
    )
      invalid("替换原始内容需创建新组件；已有附件字节不可改写");
    if (
      prior &&
      (prior.creator !== component.creator ||
        prior.createdAt !== component.createdAt)
    )
      invalid("已有组件的创建来源和时间不能改写");
  }
  const byId = new Map(
    components.map((component) => [component.id, component]),
  );
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) invalid("组件派生关系不能形成循环");
    if (visited.has(id)) return;
    const component = byId.get(id);
    if (!component) invalid("派生来源组件不存在；先处理派生引用再解除原始组件");
    visiting.add(id);
    component!.derivedFrom.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  components.forEach((component) => visit(component.id));
  return components.map((component) => ({
    ...component,
    derivedFrom: [...new Set(component.derivedFrom)],
  }));
}
