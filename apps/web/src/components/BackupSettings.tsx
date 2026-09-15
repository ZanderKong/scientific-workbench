import { useEffect, useState } from "react";
import { request } from "../api";
interface BackupJob {
  id: string;
  type: string;
  status: string;
  error?: string;
  payload: { result?: { file: string; files: number } };
}
export function BackupSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [jobs, setJobs] = useState<BackupJob[]>([]),
    [target, setTarget] = useState("local");
  const [zipPath, setZipPath] = useState(""),
    [targetDir, setTargetDir] = useState(""),
    [restoring, setRestoring] = useState(false);
  const refresh = () =>
    request<BackupJob[]>("/jobs").then((rows) =>
      setJobs(rows.filter((job) => job.type === "backup")),
    );
  useEffect(() => {
    void refresh().catch((error) => notify(error.message));
    const timer = setInterval(() => {
      void refresh().catch((error) => notify(error.message));
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  const create = async () => {
    try {
      await request("/backups", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  };
  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const { grant } = await request<{ grant: string }>("/auth/grants", {
        method: "POST",
        body: JSON.stringify({ scope: "restore" }),
      });
      const result = await request<{
        targetDir: string;
        selectedForNextStart: boolean;
        selectionReason?: string;
      }>("/backups/restore", {
        method: "POST",
        headers: { "X-Workbench-Grant": grant },
        body: JSON.stringify({ zipPath, targetDir }),
      });
      notify(
        result.selectedForNextStart
          ? `已恢复到 ${result.targetDir}。重启应用后切换到该工作区。`
          : `已恢复到 ${result.targetDir}。${result.selectionReason ?? "当前启动参数固定了原工作区。"}`,
      );
    } catch (error) {
      notify(String(error));
    } finally {
      setRestoring(false);
    }
  };
  return (
    <>
      <p>
        完整备份包含业务文件、正文历史、证据和所有附件字节。缺件会报告失败。
      </p>
      <div className="field">
        <label>
          备份位置
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="local">本地</option>
            <option value="s3">本地并上传 S3</option>
          </select>
        </label>
      </div>
      <button className="primary" onClick={() => void create()}>
        创建完整备份
      </button>
      <div className="propertyRows">
        {jobs.map((job) => (
          <div key={job.id}>
            <span>
              {job.status}
              {job.error ? ` · ${job.error}` : ""}
            </span>
            {job.status === "succeeded" && (
              <>
                <a href={`/api/v1/backups/${job.id}/download`}>下载完整备份</a>
                <button
                  onClick={() => setZipPath(job.payload.result?.file || "")}
                >
                  用于恢复
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="field">
        <label>
          备份 ZIP 路径
          <input
            value={zipPath}
            onChange={(event) => setZipPath(event.target.value)}
          />
        </label>
      </div>
      <div className="field">
        <label>
          全新恢复目录
          <input
            value={targetDir}
            onChange={(event) => setTargetDir(event.target.value)}
          />
        </label>
      </div>
      <p>恢复会逐项校验并在新目录重建索引，原目录保留。恢复后 S3 默认关闭。</p>
      <button
        className="ghost"
        disabled={!zipPath || !targetDir || restoring}
        onClick={() => void restore()}
      >
        {restoring ? "校验与恢复中…" : "授权并恢复到新目录"}
      </button>
    </>
  );
}
