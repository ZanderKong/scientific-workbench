import { useEffect, useState } from "react";
import { request } from "../api";
interface Connection {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  revokedAt?: string;
}
export function ConnectionSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]),
    [name, setName] = useState("外部 AI"),
    [scopes, setScopes] = useState(["read", "write", "export", "backup"]),
    [issued, setIssued] = useState("");
  const refresh = () =>
    request<Connection[]>("/auth/tokens").then(setConnections);
  useEffect(() => {
    void refresh().catch((error) => notify(error.message));
  }, []);
  const create = async () => {
    try {
      const result = await request<{ token: string }>("/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name, scopes }),
      });
      setIssued(result.token);
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  };
  return (
    <>
      <div className="field">
        <label>
          连接名称
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      <div className="checkGrid">
        {[
          ["read", "读取"],
          ["write", "日常编辑"],
          ["export", "导出"],
          ["backup", "备份"],
          ["delete", "永久删除"],
          ["merge", "对象合并"],
          ["cleanup", "清理历史和附件"],
          ["restore", "恢复"],
        ].map(([scope, label]) => (
          <label className="check" key={scope}>
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={() =>
                setScopes((current) =>
                  current.includes(scope)
                    ? current.filter((value) => value !== scope)
                    : [...current, scope],
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
      <button className="primary" onClick={() => void create()}>
        创建连接凭据
      </button>
      {issued && (
        <div className="field">
          <label>
            凭据仅显示一次
            <input readOnly type="password" value={issued} />
          </label>
          <button onClick={() => void navigator.clipboard.writeText(issued)}>
            复制 token
          </button>
          <button onClick={() => setIssued("")}>已保存，隐藏</button>
        </div>
      )}
      <div className="propertyRows">
        {connections.map((connection) => (
          <div key={connection.id}>
            <span>
              {connection.name} · {connection.scopes.join(" / ")}
            </span>
            {connection.revokedAt ? (
              <span>已撤销</span>
            ) : (
              <button
                onClick={() =>
                  void request(`/auth/tokens/${connection.id}`, {
                    method: "DELETE",
                  })
                    .then(refresh)
                    .catch((error) => notify(error.message))
                }
              >
                撤销
              </button>
            )}
          </div>
        ))}
      </div>
      <p>
        MCP 环境变量 WORKBENCH_API_TOKEN 使用此
        token。服务端绑定权限，请求头不能自行授予权限。
      </p>
    </>
  );
}
