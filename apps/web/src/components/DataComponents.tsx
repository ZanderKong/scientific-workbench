import { useEffect, useState } from "react";
import type { Attachment, DataComponent } from "@workbench/core";
import { Modal } from "./Modal";

export function DataComponents({
  components,
  files,
  change,
  preview,
  newText,
}: {
  components: DataComponent[];
  files: Attachment[];
  change: (components: DataComponent[]) => void;
  preview: (file: Attachment) => void;
  newText: number;
}) {
  const [editing, setEditing] = useState<DataComponent>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!newText) return;
    setEditing({
      id: crypto.randomUUID(),
      kind: "text",
      name: "数据描述",
      role: "description",
      content: "",
      creator: "human",
      provenance: "",
      derivedFrom: [],
      createdAt: new Date().toISOString(),
    });
  }, [newText]);
  const apply = () => {
    if (!editing || !editing.name.trim() || !editing.role.trim()) {
      setError("请填写组件名称和角色");
      return;
    }
    change(
      components.some((component) => component.id === editing.id)
        ? components.map((component) =>
            component.id === editing.id ? editing : component,
          )
        : [...components, editing],
    );
    setEditing(undefined);
    setError("");
  };
  return (
    <>
      {components.length > 0 && (
        <div className="dataBox">
          <div className="eyebrow">DATA COMPONENTS</div>
          <div className="componentList">
            {components.map((component) => {
              const file = files.find(
                (file) => file.id === component.attachmentId,
              );
              return (
                <div className="componentRow" key={component.id}>
                  <span className="componentKind">
                    {file?.mimeType.startsWith("image/")
                      ? "图"
                      : component.kind === "file"
                        ? "文件"
                        : component.role === "ai_description"
                          ? "描述"
                          : "文本"}{" "}
                    ·{" "}
                    {component.role === "raw"
                      ? "RAW"
                      : component.role === "ai_description"
                        ? "AI"
                        : component.derivedFrom.length
                          ? "派生"
                          : component.creator === "external"
                            ? "外部"
                            : "人工"}
                  </span>
                  <button
                    className="componentMain componentOpen"
                    onClick={() =>
                      file ? preview(file) : setEditing(component)
                    }
                  >
                    <b>{component.name}</b>
                    <span>
                      {file
                        ? `${file.mimeType} · ${file.sizeBytes.toLocaleString()} 字节 · SHA-256 已记录`
                        : component.content}
                      {component.derivedFrom.length
                        ? ` · derived_from → ${component.derivedFrom.map((id) => components.find((source) => source.id === id)?.name || id).join(" · ")}`
                        : ""}
                    </span>
                  </button>
                  <button
                    className="componentRole"
                    aria-label={`编辑组件 ${component.name}`}
                    onClick={() => {
                      setEditing(component);
                      setError("");
                    }}
                  >
                    {component.role}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {editing && (
        <Modal
          title="编辑数据组件"
          close={() => setEditing(undefined)}
          footer={
            <button className="primary" onClick={apply}>
              使用组件
            </button>
          }
        >
          <div className="propertyRows">
            <label>
              名称
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </label>
            <label>
              角色
              <input
                list="data-component-roles"
                value={editing.role}
                onChange={(event) =>
                  setEditing({ ...editing, role: event.target.value })
                }
              />
              <datalist id="data-component-roles">
                {[
                  "raw",
                  "processed",
                  "plot",
                  "description",
                  "ai_description",
                ].map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </label>
            {editing.kind === "text" && (
              <label>
                文本内容
                <textarea
                  value={editing.content}
                  onChange={(event) =>
                    setEditing({ ...editing, content: event.target.value })
                  }
                />
              </label>
            )}
            <label>
              来源说明
              <textarea
                value={editing.provenance}
                onChange={(event) =>
                  setEditing({ ...editing, provenance: event.target.value })
                }
              />
            </label>
          </div>
          <p className="noteIntro">
            创建者：{editing.creator === "human" ? "人工" : "外部工具"} ·{" "}
            {editing.createdAt}
          </p>
          <div className="columnChecks">
            {components
              .filter((component) => component.id !== editing.id)
              .map((component) => (
                <label key={component.id}>
                  <input
                    type="checkbox"
                    checked={editing.derivedFrom.includes(component.id)}
                    onChange={() =>
                      setEditing({
                        ...editing,
                        derivedFrom: editing.derivedFrom.includes(component.id)
                          ? editing.derivedFrom.filter(
                              (id) => id !== component.id,
                            )
                          : [...editing.derivedFrom, component.id],
                      })
                    }
                  />
                  派生自 {component.name}
                </label>
              ))}
          </div>
          {error && <p role="alert">{error}</p>}
          {components.some((component) => component.id === editing.id) && (
            <button
              className="addLink"
              onClick={() => {
                if (
                  components.some((component) =>
                    component.derivedFrom.includes(editing.id),
                  )
                ) {
                  setError("此组件仍被派生组件引用，请先处理派生来源");
                  return;
                }
                change(
                  components.filter((component) => component.id !== editing.id),
                );
                setEditing(undefined);
              }}
            >
              解除组件引用
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
