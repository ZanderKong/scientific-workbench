import { useCallback, useEffect, useRef, useState } from "react";
import {
  SAMPLE_IMPORT_MAX_IMAGES,
  SAMPLE_IMPORT_MAX_IMAGE_BYTES,
  SAMPLE_IMPORT_MAX_TOTAL_BYTES,
  type SampleImportConfirm,
} from "@workbench/core";
import { request } from "../api";
import { Modal } from "./Modal";
import "./sample-import.css";

interface UploadItem {
  key: string;
  file: File;
  preview: string;
  attachmentId?: string;
  status: "uploading" | "failed" | "ready";
  error?: string;
}
interface Readiness {
  ready: boolean;
  detail: string;
  reasonCode?: string;
  model?: string;
}
interface Submission {
  attemptId: string;
  expectedVersion: number;
  note: string;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function SampleImportModal({ close }: { close: () => void }) {
  const [importId] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [prepared, setPrepared] = useState<SampleImportConfirm>();
  const [readiness, setReadiness] = useState<Readiness>();
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  // The current page list, so two rapid selections validate against each other
  // instead of a stale render value.
  const itemsRef = useRef<UploadItem[]>([]);
  const submission = useRef<Submission | undefined>(undefined);

  useEffect(() => {
    // StrictMode runs effects twice in development; re-arm on every mount so a
    // simulated unmount cannot leave the modal permanently inert.
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);

  const applyItems = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    if (mounted.current) setItems(next);
  }, []);

  const upload = useCallback(
    async (item: UploadItem) => {
      applyItems(
        itemsRef.current.map((value) =>
          value.key === item.key
            ? { ...value, status: "uploading", error: undefined }
            : value,
        ),
      );
      try {
        const body = new FormData();
        body.append("file", item.file);
        const saved = await request<{ id: string }>("/attachments/stream", {
          method: "POST",
          body,
        });
        applyItems(
          itemsRef.current.map((value) =>
            value.key === item.key
              ? { ...value, status: "ready", attachmentId: saved.id }
              : value,
          ),
        );
      } catch (failure) {
        applyItems(
          itemsRef.current.map((value) =>
            value.key === item.key
              ? {
                  ...value,
                  status: "failed",
                  error: failure instanceof Error ? failure.message : "上传失败",
                }
              : value,
          ),
        );
      }
    },
    [applyItems],
  );

  const frozen = busy || Boolean(prepared) || Boolean(submission.current);

  function add(files: File[]) {
    if (frozen || !files.length) return;
    const total = [...itemsRef.current.map((item) => item.file), ...files];
    if (total.length > SAMPLE_IMPORT_MAX_IMAGES) {
      setError("最多选择 10 张图片");
      return;
    }
    if (files.some((file) => !ACCEPTED.includes(file.type))) {
      setError("请选择 JPEG、PNG 或 WebP 图片");
      return;
    }
    if (
      files.some((file) => file.size > SAMPLE_IMPORT_MAX_IMAGE_BYTES) ||
      total.reduce((sum, file) => sum + file.size, 0) > SAMPLE_IMPORT_MAX_TOTAL_BYTES
    ) {
      setError("单张最多 10 MiB，合计最多 30 MiB");
      return;
    }
    setError("");
    const added = files.map((file) => {
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      return {
        key: crypto.randomUUID(),
        file,
        preview,
        status: "uploading" as const,
      };
    });
    applyItems([...itemsRef.current, ...added]);
    for (const item of added) void upload(item);
  }

  function move(index: number, direction: number) {
    if (frozen) return;
    const next = [...itemsRef.current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    applyItems(next);
  }

  function remove(key: string) {
    if (frozen) return;
    const item = itemsRef.current.find((value) => value.key === key);
    if (item) {
      URL.revokeObjectURL(item.preview);
      urls.current.delete(item.preview);
    }
    applyItems(itemsRef.current.filter((value) => value.key !== key));
  }

  /**
   * Prepare once, then start. A lost prepare response is reconciled with the
   * same importId and never re-fingerprints the source images; a lost start
   * response is retried with the same attempt and version.
   */
  async function start() {
    if (busy || !itemsRef.current.length) return;
    if (itemsRef.current.some((item) => item.status !== "ready")) return;
    setBusy(true);
    setError("");
    try {
      let confirmation = prepared;
      if (!confirmation) {
        setAttempted(true);
        setStatus("正在登记来源图片…");
        try {
          confirmation = await request<SampleImportConfirm>("/sample-imports", {
            method: "POST",
            body: JSON.stringify({
              importId,
              attachmentIds: itemsRef.current.map((item) => item.attachmentId),
            }),
          });
        } catch (failure) {
          confirmation = await request<SampleImportConfirm>(
            `/sample-imports/${importId}`,
          ).catch(() => {
            throw failure;
          });
        }
        if (mounted.current) setPrepared(confirmation);
      }
      if (!submission.current) {
        setStatus("正在验证受限运行环境…");
        const state = await request<Readiness>(
          `/sample-imports/${importId}/agent/readiness`,
        );
        if (mounted.current) setReadiness(state);
        if (!state.ready) throw new Error(state.detail);
        submission.current = {
          attemptId: confirmation.attempt.id,
          expectedVersion: confirmation.recordVersion,
          note,
        };
      }
      setStatus("正在启动导入任务…");
      const started = await request<{ jobId: string }>(
        `/sample-imports/${importId}/agent/start`,
        { method: "POST", body: JSON.stringify(submission.current) },
      );
      void started;
      if (mounted.current) {
        setStatus("已提交，任务在右下角继续。");
        close();
      }
    } catch (failure) {
      if (mounted.current) {
        setStatus("");
        setError(
          failure instanceof Error
            ? failure.message
            : "启动结果未确认，请用同一导入重试",
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      title="AI 从实验记录新建样品"
      close={close}
      footer={
        <>
          <button onClick={close}>关闭</button>
          <button
            className="primary"
            disabled={
              busy ||
              !items.length ||
              items.some((item) => item.status !== "ready")
            }
            onClick={() => void start()}
          >
            {busy
              ? "正在启动…"
              : attempted
                ? "查询并重试启动"
                : "开始导入"}
          </button>
        </>
      }
    >
      <div className="sampleImport">
        <p>
          上传实验记录图片，按阅读顺序排列。关键歧义会在任务中请求澄清；完成后由你刷新样品列表。
        </p>
        <p className="sampleImportModel">
          模型：{readiness?.model ?? "deepseek/deepseek-v4-flash-vision-exp"}
        </p>
        <p className="sampleImportHint">
          {readiness?.detail ??
            "上传完成后检查已验证的运行环境。JPEG / PNG / WebP；最多 10 张，单张 10 MiB，合计 30 MiB。"}
        </p>
        <input
          data-initial-focus
          type="file"
          aria-label="选择实验记录图片"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={frozen}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <ol className="sampleImportPages">
          {items.map((item, index) => (
            <li key={item.key}>
              <img src={item.preview} alt={`第 ${index + 1} 页预览`} />
              <div>
                <b>第 {index + 1} 页</b>
                <span>{item.file.name}</span>
                <span>
                  {item.status === "uploading"
                    ? "上传中…"
                    : item.status === "ready"
                      ? "已上传"
                      : item.error}
                </span>
              </div>
              <div className="sampleImportPageActions">
                <button
                  disabled={frozen || index === 0}
                  aria-label={`第 ${index + 1} 页上移`}
                  onClick={() => move(index, -1)}
                >
                  上移
                </button>
                <button
                  disabled={frozen || index === items.length - 1}
                  aria-label={`第 ${index + 1} 页下移`}
                  onClick={() => move(index, 1)}
                >
                  下移
                </button>
                <button
                  disabled={frozen}
                  aria-label={`移除第 ${index + 1} 页`}
                  onClick={() => remove(item.key)}
                >
                  移除
                </button>
                {item.status === "failed" && (
                  <button
                    disabled={frozen}
                    aria-label={`重试上传第 ${index + 1} 页`}
                    onClick={() => void upload(item)}
                  >
                    重试上传
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <label>
          补充说明（可选）
          <textarea
            aria-label="导入补充说明"
            maxLength={4000}
            value={note}
            disabled={busy || Boolean(submission.current)}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {status && !error && <p className="sampleImportHint">{status}</p>}
        {error && (
          <p role="alert" className="sampleImportError">
            {error}
          </p>
        )}
        <small>
          关闭弹窗不会取消已开始的任务，也不会删除来源图片或来源数据。
        </small>
      </div>
    </Modal>
  );
}
