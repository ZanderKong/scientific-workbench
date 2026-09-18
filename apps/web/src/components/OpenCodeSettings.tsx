import { useEffect, useState } from "react";
import { request } from "../api";

interface ModelRef {
  providerId: string;
  modelId: string;
}

interface OpenCodeConfigView {
  baseUrl: string;
  username: string;
  executionDir: string;
  permissionMode: "ask" | "auto-allow";
  textModel: ModelRef | null;
  visionModel: ModelRef | null;
  hasPassword: boolean;
  connectionLocked: boolean;
}

interface OpenCodeStatusView {
  connected: boolean;
  version?: string;
  error?: string;
  mcp: { state: "connected" | "missing" | "error"; detail?: string };
}

interface OpenCodeModelOption {
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
  available: boolean;
  supportsImage: true | false | "unknown";
}

interface SettingsResponse {
  config: OpenCodeConfigView;
  status: OpenCodeStatusView;
}

const DEFAULT_BASE_URL_PLACEHOLDER = "http://127.0.0.1:49374";

function modelKey(ref: ModelRef | null) {
  return ref ? `${ref.providerId}\u0000${ref.modelId}` : "";
}
function parseModelKey(key: string): ModelRef | null {
  if (!key) return null;
  const [providerId, modelId] = key.split("\u0000");
  return providerId && modelId ? { providerId, modelId } : null;
}
function modelLabel(model: OpenCodeModelOption) {
  return `${model.providerName} / ${model.modelName}`;
}

export function OpenCodeSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [config, setConfig] = useState<OpenCodeConfigView>();
  const [status, setStatus] = useState<OpenCodeStatusView>();
  const [models, setModels] = useState<OpenCodeModelOption[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const loadModels = async () => {
    try {
      const result = await request<{ models: OpenCodeModelOption[] }>(
        "/integrations/opencode/models",
      );
      setModels(result.models);
    } catch {
      setModels([]);
    }
  };
  const load = async () => {
    try {
      const result = await request<SettingsResponse>("/integrations/opencode");
      setConfig(result.config);
      setStatus(result.status);
      if (result.config.baseUrl) void loadModels();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const patch = (changes: Partial<OpenCodeConfigView>) =>
    setConfig((current) => (current ? { ...current, ...changes } : current));

  const saveAndTest = async () => {
    if (!config) return;
    setBusy(true);
    try {
      const saved = await request<SettingsResponse>("/integrations/opencode", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          username: config.username,
          executionDir: config.executionDir,
          permissionMode: config.permissionMode,
          textModel: config.textModel,
          visionModel: config.visionModel,
          ...(password ? { password } : {}),
        }),
      });
      setConfig(saved.config);
      setStatus(saved.status);
      setPassword("");
      await loadModels();
      if (saved.status.connected) {
        try {
          const tested = await request<{
            connected: boolean;
            version?: string;
            modelCount: number;
            mcp: OpenCodeStatusView["mcp"];
          }>("/integrations/opencode/test", {
            method: "POST",
            body: JSON.stringify({}),
          });
          setStatus({
            connected: tested.connected,
            version: tested.version,
            mcp: tested.mcp,
          });
        } catch (error) {
          setStatus({
            connected: false,
            error: (error as Error).message,
            mcp: saved.status.mcp,
          });
        }
      }
      notify("OpenCode 配置已保存");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const visionModels = models.filter(
    (model) => model.supportsImage !== false,
  );
  const textModelOptions = models.filter(
    (model) => model.providerId !== undefined,
  );

  return (
    <>
      <div className="field">
        <label>连接</label>
        <p>工作台只连接已经运行的 OpenCode Server，不会启动或修改 OpenCode。</p>
        {config?.connectionLocked && (
          <p>有 OpenCode 任务正在运行，连接设置暂时锁定。</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="opencode-base-url">OpenCode Server</label>
        <input
          id="opencode-base-url"
          value={config?.baseUrl ?? ""}
          placeholder={DEFAULT_BASE_URL_PLACEHOLDER}
          disabled={config?.connectionLocked}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
        <p>
          运行 `opencode pair` 后粘贴显示的 URL；固定端口 `opencode serve`
          用户填写对应地址。
        </p>
      </div>
      <div className="field">
        <label htmlFor="opencode-username">用户名</label>
        <input
          id="opencode-username"
          value={config?.username ?? ""}
          placeholder="opencode"
          disabled={config?.connectionLocked}
          onChange={(event) => patch({ username: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="opencode-password">密码</label>
        <input
          id="opencode-password"
          type="password"
          value={password}
          placeholder={
            config?.hasPassword ? "已配置时留空保持不变" : "尚未配置密码"
          }
          disabled={config?.connectionLocked}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="opencode-execution-dir">Agent 工作目录</label>
        <input
          id="opencode-execution-dir"
          value={config?.executionDir ?? ""}
          disabled={config?.connectionLocked}
          onChange={(event) => patch({ executionDir: event.target.value })}
        />
        <p>必须与科研数据目录分离；科研数据仍通过 Workbench MCP 访问。</p>
      </div>
      <div className="field">
        <label>连接状态</label>
        <p>
          {status?.connected
            ? `● 已连接${status.version ? ` · ${status.version}` : ""}`
            : `○ 未连接${status?.error ? ` · ${status.error}` : ""}`}
        </p>
      </div>

      <div className="field">
        <label htmlFor="opencode-text-model">默认文本模型</label>
        <select
          id="opencode-text-model"
          value={modelKey(config?.textModel ?? null)}
          onChange={(event) =>
            patch({ textModel: parseModelKey(event.target.value) })
          }
        >
          <option value="">跟随 OpenCode 默认</option>
          {textModelOptions.map((model) => (
            <option
              key={`${model.providerId}/${model.modelId}`}
              value={`${model.providerId}\u0000${model.modelId}`}
            >
              {modelLabel(model)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="opencode-vision-model">多模态模型</label>
        <select
          id="opencode-vision-model"
          value={modelKey(config?.visionModel ?? null)}
          onChange={(event) =>
            patch({ visionModel: parseModelKey(event.target.value) })
          }
        >
          <option value="">跟随文本模型</option>
          {visionModels.map((model) => (
            <option
              key={`${model.providerId}/${model.modelId}`}
              value={`${model.providerId}\u0000${model.modelId}`}
            >
              {modelLabel(model)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="opencode-permission-mode">权限处理</label>
        <select
          id="opencode-permission-mode"
          value={config?.permissionMode ?? "ask"}
          onChange={(event) =>
            patch({
              permissionMode: event.target.value as OpenCodeConfigView["permissionMode"],
            })
          }
        >
          <option value="ask">每次询问</option>
          <option value="auto-allow">自动允许</option>
        </select>
        <p>
          仅自动批准由科研工作台创建的 OpenCode Session
          的单次权限请求；不会修改 OpenCode 全局或项目长期权限规则。
        </p>
      </div>

      <div className="field">
        <label>Workbench MCP</label>
        <p>
          {status?.mcp.state === "connected"
            ? "● 已连接"
            : status?.mcp.state === "error"
              ? `○ 未连接 · ${status.mcp.detail ?? "OpenCode 报告错误"}`
              : "○ 未连接"}
        </p>
        {status?.mcp.state !== "connected" && (
          <p>请在 OpenCode 中配置 scientific-workbench MCP。</p>
        )}
      </div>

      <button
        className="addLink"
        disabled={busy || !config}
        onClick={() => void saveAndTest()}
      >
        保存并测试
      </button>
    </>
  );
}
