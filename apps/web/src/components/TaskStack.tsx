import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";

interface AgentAttention {
  kind: "permission" | "question";
  id: string;
  summary: string;
  canQuickAllow: boolean;
}

interface AgentRunView {
  id: string;
  name: string;
  jobStatus: "queued" | "running" | "failed" | "succeeded";
  uiState: "queued" | "running" | "attention" | "failed" | "completed";
  createdAt: string;
  updatedAt: string;
  sessionUrl?: string;
  attention?: AgentAttention;
  error?: string;
}

interface AgentRunState {
  runs: AgentRunView[];
  notices: unknown[];
  eventConnected: boolean;
}

interface Banner {
  id: string;
  name: string;
  sessionUrl?: string;
  leaving: boolean;
}

const MAX_BLOCKS = 10;
const LONG_PRESS_MS = 450;
const BANNER_MS = 5000;
const PARTICLES = [0, 1, 2, 3, 4, 5, 6, 7];

function openSession(url?: string) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function tooltip(run: AgentRunView): string[] {
  if (run.uiState === "queued") return [run.name, "等待开始"];
  if (run.uiState === "attention" && run.attention?.kind === "permission")
    return [
      run.name,
      "",
      `需要权限：${run.attention.summary}`,
      "",
      "点击允许一次",
      "长按打开 OpenCode",
    ];
  if (run.uiState === "attention" && run.attention?.kind === "question")
    return [run.name, "", "OpenCode 需要你的输入", "", "长按打开 OpenCode"];
  if (run.uiState === "failed")
    return [
      run.name,
      "",
      `执行失败：${run.error ?? "未知错误"}`,
      "",
      "点击隐藏",
      "长按打开 OpenCode",
    ];
  return [run.name, "OpenCode · 正在运行"];
}

export function TaskStack() {
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [pulsing, setPulsing] = useState<string | null>(null);
  const previous = useRef<Map<string, AgentRunView>>(new Map());
  const press = useRef<{
    timer?: number;
    longPressed: boolean;
    x: number;
    y: number;
  }>({ longPressed: false, x: 0, y: 0 });

  const applyState = useCallback((state: AgentRunState) => {
    const now = new Map(state.runs.map((run) => [run.id, run]));
    const fresh: Banner[] = [];
    for (const run of state.runs) {
      if (run.uiState !== "completed") continue;
      const before = previous.current.get(run.id);
      if (!before || before.uiState === "completed") continue;
      fresh.push({
        id: run.id,
        name: run.name,
        sessionUrl: run.sessionUrl,
        leaving: false,
      });
      window.setTimeout(
        () =>
          setBanners((current) =>
            current.map((banner) =>
              banner.id === run.id ? { ...banner, leaving: true } : banner,
            ),
          ),
        BANNER_MS,
      );
      window.setTimeout(
        () =>
          setBanners((current) =>
            current.filter((banner) => banner.id !== run.id),
          ),
        BANNER_MS + 700,
      );
    }
    if (fresh.length) setBanners((current) => [...current, ...fresh]);
    previous.current = now;
    setRuns(state.runs.filter((run) => run.uiState !== "completed"));
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/v1/agent-runs/events");
    const onSnapshot = (event: MessageEvent) => {
      try {
        applyState(JSON.parse(event.data) as AgentRunState);
      } catch {
        /* ignore malformed snapshot */
      }
    };
    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.addEventListener("error", () => {
      request<AgentRunState>("/agent-runs/state")
        .then((state) => applyState(state))
        .catch(() => undefined);
    });
    return () => {
      source.removeEventListener("snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [applyState]);

  useEffect(() => {
    const attention = runs.find(
      (run) => run.uiState === "attention" && run.attention?.kind === "permission",
    );
    if (!attention) return;
    setPulsing(attention.id);
    const timer = window.setTimeout(() => setPulsing(null), 650);
    return () => window.clearTimeout(timer);
  }, [runs]);

  const refresh = () =>
    request<AgentRunState>("/agent-runs/state")
      .then((state) => applyState(state))
      .catch(() => undefined);

  const allow = async (run: AgentRunView) => {
    if (run.attention?.kind !== "permission") return;
    try {
      await request(`/agent-runs/${run.id}/permission/allow`, {
        method: "POST",
        body: JSON.stringify({ permissionId: run.attention.id }),
      });
    } catch {
      /* stale permission: fall through to a fresh snapshot */
    }
    await refresh();
  };

  const dismiss = async (run: AgentRunView) => {
    try {
      await request(`/agent-runs/${run.id}/dismiss`, { method: "POST" });
    } catch {
      /* ignore */
    }
    await refresh();
  };

  const onPointerDown = (run: AgentRunView, event: React.PointerEvent) => {
    const state = press.current;
    state.longPressed = false;
    state.x = event.clientX;
    state.y = event.clientY;
    state.timer = window.setTimeout(() => {
      state.longPressed = true;
      openSession(run.sessionUrl);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    const state = press.current;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = undefined;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const state = press.current;
    if (Math.abs(event.clientX - state.x) > 8 || Math.abs(event.clientY - state.y) > 8)
      cancelPress();
  };
  const onClick = (run: AgentRunView) => {
    const state = press.current;
    cancelPress();
    if (state.longPressed) {
      state.longPressed = false;
      return;
    }
    if (run.uiState === "attention" && run.attention?.kind === "permission")
      void allow(run);
    else if (run.uiState === "failed") void dismiss(run);
  };

  const ordered = [...runs].reverse();
  const visible =
    ordered.length > MAX_BLOCKS
      ? ordered.slice(ordered.length - MAX_BLOCKS)
      : ordered;
  const hidden = ordered.slice(0, Math.max(0, ordered.length - MAX_BLOCKS));
  const hiddenAttention = hidden.some((run) => run.uiState === "attention");

  if (!runs.length && !banners.length) return null;

  return (
    <div className="taskStack" aria-live="polite">
      {banners.map((banner) => (
        <div
          key={banner.id}
          className={`taskCompletion${banner.leaving ? " leaving" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => openSession(banner.sessionUrl)}
          onKeyDown={(event) => {
            if (event.key === "Enter") openSession(banner.sessionUrl);
          }}
        >
          <span className="taskCompletionText">✓ {banner.name} 完成</span>
          {banner.leaving &&
            PARTICLES.map((particle) => (
              <i key={particle} className={`taskParticle p${particle}`} />
            ))}
        </div>
      ))}
      <div className="taskBlocks">
        {visible.map((run) => (
          <div key={run.id} className="taskBlockWrap">
            <button
              className={`taskBlock ${run.uiState}${
                pulsing === run.id ? " pulse" : ""
              }`}
              aria-label={`${run.name} ${run.uiState}`}
              data-run-id={run.id}
              onPointerDown={(event) => onPointerDown(run, event)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              onPointerMove={onPointerMove}
              onClick={() => onClick(run)}
            >
              <span className="taskTooltip">
                {tooltip(run).map((line, index) => (
                  <span key={index}>{line || "\u00a0"}</span>
                ))}
              </span>
            </button>
          </div>
        ))}
        {hidden.length > 0 && (
          <div
            className={`taskOverflow${hiddenAttention ? " attention" : ""}`}
            title={hiddenAttention ? "有待处理的权限或输入" : `${hidden.length} 个更早任务`}
          >
            +{hidden.length}
          </div>
        )}
      </div>
    </div>
  );
}
