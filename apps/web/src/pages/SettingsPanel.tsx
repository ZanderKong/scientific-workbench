import { useEffect, useState } from "react";
import { ConnectionSettings } from "../components/ConnectionSettings";
import { BackupSettings } from "../components/BackupSettings";
import { request } from "../api";
interface StorageConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  keepLocal: boolean;
  thresholdBytes: number;
  minAgeDays: number;
}
interface Settings {
  dataDir: string;
  server: { host: string; port: number };
  storage: StorageConfig;
}
interface Job {
  id: string;
  type: string;
  status: string;
  error?: string;
}
interface CleanupAttachment {
  id: string;
  originalName: string;
  sizeBytes: number;
  eligible: boolean;
  references: { type: string; id: string; name: string }[];
}
export function SettingsPanel({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [config, setConfig] = useState<StorageConfig>();
  const [accessKey, setAccessKey] = useState("");
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState("本机");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cleanupRows, setCleanupRows] = useState<CleanupAttachment[]>([]);
  const [cleanupSelection, setCleanupSelection] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all([
      request<Settings>("/workspace/settings"),
      request<Job[]>("/jobs"),
    ])
      .then(([value, tasks]) => {
        setSettings(value);
        setConfig(value.storage);
        setJobs(tasks);
      })
      .catch((error) => notify(error.message));
  }, []);
  const saveStorage = async () => {
    try {
      const saved = await request<StorageConfig>("/storage/s3", {
        method: "PUT",
        body: JSON.stringify({
          ...config,
          ...(accessKey ? { accessKeyId: accessKey } : {}),
          ...(secret ? { secretAccessKey: secret } : {}),
        }),
      });
      setConfig(saved);
      setAccessKey("");
      setSecret("");
      notify("存储配置已保存");
    } catch (error) {
      notify(String(error));
    }
  };
  const inspectCleanup = async () => {
    try {
      const rows = await request<CleanupAttachment[]>("/attachments/orphans");
      setCleanupRows(rows);
      setCleanupSelection((current) =>
        current.filter((id) =>
          rows.some((row) => row.id === id && row.eligible),
        ),
      );
    } catch (error) {
      notify(String(error));
    }
  };
  const cleanup = async () => {
    try {
      const { grant } = await request<{ grant: string }>("/auth/grants", {
        method: "POST",
        body: JSON.stringify({ scope: "cleanup" }),
      });
      await request("/attachments/cleanup", {
        method: "POST",
        headers: { "X-Workbench-Grant": grant },
        body: JSON.stringify({ ids: cleanupSelection }),
      });
      notify(`已永久清理 ${cleanupSelection.length} 个无引用附件`);
      setCleanupSelection([]);
      await inspectCleanup();
    } catch (error) {
      notify(String(error));
    }
  };
  return (
    <>
      <div className="tabs">
        {["本机", "附件存储", "任务", "备份与恢复", "接口"].map((name) => (
          <button
            className={tab === name ? "active" : ""}
            key={name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "本机" && (
        <>
          <div className="field">
            <label>实际数据目录</label>
            <code className="workspacePath">
              {settings?.dataDir || "读取中"}
            </code>
          </div>
          <div className="field">
            <label>编辑器</label>
            <p>
              正文自动保存：停止输入 500 ms，持续输入最长 2
              秒。完成编辑后提取结构。
            </p>
            <p>正文历史仅查看、复制；不会回滚关联数据或证据。</p>
          </div>
          <div className="field">
            <label>访问地址</label>
            <span>
              {settings
                ? `http://${settings.server.host}:${settings.server.port}`
                : "读取中"}
            </span>
          </div>
        </>
      )}
      {tab === "附件存储" && config && (
        <>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) =>
                  setConfig({ ...config, enabled: event.target.checked })
                }
              />
              启用 S3 兼容存储
            </label>
          </div>
          {(["endpoint", "region", "bucket", "prefix"] as const).map((key) => (
            <div className="field" key={key}>
              <label>
                {key}
                <input
                  value={config[key]}
                  onChange={(event) =>
                    setConfig({ ...config, [key]: event.target.value })
                  }
                />
              </label>
            </div>
          ))}
          <div className="field">
            <label>
              Access key
              <input
                autoComplete="off"
                value={accessKey}
                placeholder="留空保留当前配置"
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Secret key
              <input
                type="password"
                autoComplete="new-password"
                value={secret}
                placeholder="留空保留当前配置"
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          </div>
          <div className="field">
            <label>
              严格大于此大小（字节）
              <input
                type="number"
                min="0"
                value={config.thresholdBytes}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    thresholdBytes: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="field">
            <label>
              本地保存满多少天后上传
              <input
                type="number"
                min="0"
                value={config.minAgeDays}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    minAgeDays: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={config.keepLocal}
                onChange={(event) =>
                  setConfig({ ...config, keepLocal: event.target.checked })
                }
              />
              上传校验后保留本地副本
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.forcePathStyle}
                onChange={(event) =>
                  setConfig({ ...config, forcePathStyle: event.target.checked })
                }
              />
              Path-style
            </label>
          </div>
          <button className="primary" onClick={() => void saveStorage()}>
            保存配置
          </button>
          <button
            className="ghost"
            onClick={() =>
              void request("/storage/s3/test", { method: "POST" })
                .then(() => notify("连接测试通过"))
                .catch((error) => notify(error.message))
            }
          >
            测试已保存连接
          </button>
          <div className="field">
            <label>附件清理</label>
            <p>先检查当前引用；正式论点证据引用的旧附件不会进入可清理项。</p>
            <button className="ghost" onClick={() => void inspectCleanup()}>
              检查可清理附件
            </button>
          </div>
          {cleanupRows.length > 0 && (
            <div className="propertyRows">
              {cleanupRows.map((row) => (
                <label key={row.id} className="check">
                  <input
                    type="checkbox"
                    disabled={!row.eligible}
                    checked={cleanupSelection.includes(row.id)}
                    onChange={(event) =>
                      setCleanupSelection((current) =>
                        event.target.checked
                          ? [...current, row.id]
                          : current.filter((id) => id !== row.id),
                      )
                    }
                  />
                  <span>
                    {row.originalName} · {row.sizeBytes} 字节
                    {!row.eligible && ` · ${row.references.length} 处引用`}
                  </span>
                </label>
              ))}
              <button
                className="ghost"
                disabled={!cleanupSelection.length}
                onClick={() => void cleanup()}
              >
                授权并永久清理所选附件
              </button>
            </div>
          )}
        </>
      )}
      {tab === "任务" && (
        <>
          <button
            className="addLink"
            onClick={() =>
              void request<Job[]>("/jobs")
                .then(setJobs)
                .catch((error) => notify(error.message))
            }
          >
            刷新任务
          </button>
          <div className="propertyRows">
            {jobs.map((job) => (
              <div key={job.id}>
                <span>{job.type}</span>
                <b>
                  {job.status}
                  {job.error ? `：${job.error}` : ""}
                </b>
                {job.status === "running" && (
                  <button
                    className="ghost"
                    onClick={() =>
                      void request(`/jobs/${job.id}/cancel`, { method: "POST" })
                        .then(() => request<Job[]>("/jobs"))
                        .then(setJobs)
                        .catch((error) => notify(error.message))
                    }
                  >
                    取消
                  </button>
                )}
                {job.status === "failed" &&
                  job.type === "attachment-upload" && (
                    <button
                      className="ghost"
                      onClick={() =>
                        void request(`/jobs/${job.id}/retry`, {
                          method: "POST",
                        })
                          .then(() => request<Job[]>("/jobs"))
                          .then(setJobs)
                          .catch((error) => notify(error.message))
                      }
                    >
                      重试
                    </button>
                  )}
              </div>
            ))}
          </div>
          {!jobs.length && <p>暂无任务</p>}
        </>
      )}
      {tab === "备份与恢复" && <BackupSettings notify={notify} />}
      {tab === "接口" && (
        <>
          <div className="field">
            <label>REST API</label>
            <code>/api/v1</code>
          </div>
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            查看当前 OpenAPI
          </a>
          <ConnectionSettings notify={notify} />
          <p>MCP 通过 stdio 桥接本机服务。</p>
        </>
      )}
    </>
  );
}
