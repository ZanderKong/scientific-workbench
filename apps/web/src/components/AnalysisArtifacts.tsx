import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "@workbench/core";
import { request } from "../api";
import { Modal } from "./Modal";
import { AttachmentPreview } from "./AttachmentPreview";

export function AnalysisArtifacts({
  ids,
  change,
  notify,
  trackUpload,
}: {
  trackUpload: (task: Promise<void>) => void;
  ids: string[];
  change: (ids: string[]) => void;
  notify: (message: string) => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment>();
  const [manage, setManage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latestIds = useRef(ids);
  latestIds.current = ids;
  useEffect(() => {
    let active = true;
    void Promise.all(ids.map((id) => request<Attachment>(`/attachments/${id}`)))
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch((error) => {
        if (active) notify(error.message);
      });
    return () => {
      active = false;
    };
  }, [ids.join("|"), notify]);
  const close = useCallback(() => setPreview(undefined), []);
  const upload = async (selected: FileList | null) => {
    if (!selected || uploading) return;
    setUploading(true);
    const filesToUpload = Array.from(selected);
    const task = (async () => {
      for (const file of filesToUpload) {
        const body = new FormData();
        body.append("file", file);
        const saved = await request<Attachment>("/attachments/stream", {
          method: "POST",
          body,
        });
        const next = [...new Set([...latestIds.current, saved.id])];
        latestIds.current = next;
        change(next);
      }
    })();
    trackUpload(task);
    try {
      await task;
    } catch (error) {
      notify(String(error));
    } finally {
      setUploading(false);
    }
  };
  return (
    <section className="block" aria-label="分析产物">
      <div className="blockTitle">
        <span>
          Artifact ·{" "}
          {files.length === 1
            ? files[0].originalName.replace(/\.[^.]+$/, "")
            : "分析产物"}
        </span>
        <button
          disabled={uploading}
          onClick={() =>
            files.length ? setManage(true) : input.current?.click()
          }
        >
          {uploading ? "上传中" : files.length ? "•••" : "＋ 添加文件"}
        </button>
      </div>
      {!files.length && (
        <div
          className="dataDropZone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void upload(event.dataTransfer.files);
          }}
        >
          添加外部生成的图、表或分析附件
        </div>
      )}
      {files.map((file) => (
        <div className="analysisArtifact" key={file.id}>
          {/^(image\/(png|jpeg|gif|webp))$/.test(file.mimeType) ? (
            <button
              className="chart artifactPreview"
              aria-label={`预览 ${file.originalName}`}
              onClick={() => setPreview(file)}
            >
              <img
                src={`/api/v1/attachments/${file.id}/content`}
                alt={file.originalName}
              />
            </button>
          ) : (
            <button className="assetRow" onClick={() => setPreview(file)}>
              <div>
                <b>{file.originalName}</b>
                <small>
                  {file.mimeType} · {file.sizeBytes.toLocaleString()} 字节
                </small>
              </div>
              <span>↗</span>
            </button>
          )}
        </div>
      ))}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="添加分析产物"
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      {manage && (
        <Modal title="管理分析产物" close={() => setManage(false)}>
          <button className="addLink" onClick={() => input.current?.click()}>
            ＋ 添加文件
          </button>
          {files.map((file) => (
            <div className="assetRow" key={file.id}>
              <button
                className="componentOpen"
                onClick={() => setPreview(file)}
              >
                {file.originalName}
              </button>
              <button
                className="addLink"
                onClick={() =>
                  change(latestIds.current.filter((id) => id !== file.id))
                }
              >
                解除引用
              </button>
            </div>
          ))}
        </Modal>
      )}
      {preview && <AttachmentPreview file={preview} close={close} />}
    </section>
  );
}
