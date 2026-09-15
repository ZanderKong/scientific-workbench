import type { ReactNode } from "react";

export type Navigation =
  "samples" | "analysis" | "data" | "claims" | "resources";
const navigation: [Navigation, string, string][] = [
  ["samples", "◇", "样品"],
  ["analysis", "◫", "分析"],
  ["data", "▥", "数据"],
  ["claims", "◌", "论点"],
  ["resources", "⌘", "资源"],
];

export function Shell({
  active,
  navigate,
  search,
  settings,
  help,
  status,
  children,
}: {
  active: Navigation;
  navigate: (page: Navigation) => void;
  search: () => void;
  settings: () => void;
  help: () => void;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">科研工作台</div>
        <nav className="nav">
          {navigation.map(([key, icon, label]) => (
            <button
              key={key}
              className={`navItem ${active === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <span className="icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sideBottom">
          <button className="sideAction" onClick={search}>
            ⌕ 搜索
          </button>
          <button className="sideAction" onClick={settings}>
            ⚙ 设置
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topLeft">
            <span>Scientific R&amp;D Workspace</span>
          </div>
          <div className="topRight">
            <span>{status}</span>
            <button onClick={search}>⌘K</button>
            <button onClick={help}>?</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
