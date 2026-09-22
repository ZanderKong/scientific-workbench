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
  importTask?: boolean;
  jobStatus: "queued" | "running" | "failed" | "succeeded";
  uiState: "queued" | "running" | "attention" | "failed" | "completed";
  createdAt: string;
  updatedAt: string;
  sessionUrl?: string;
  attention?: AgentAttention;
  error?: string;
}

interface TerminalNotice {
  id: string;
  kind: "completed" | "failed";
  name: string;
  sessionUrl?: string;
  message?: string;
  action?: "refresh-samples";
  createdAt: number;
}

interface AgentRunState {
  runs: AgentRunView[];
  notices: TerminalNotice[];
  eventConnected: boolean;
}

interface Banner {
  id: string;
  name: string;
  sessionUrl?: string;
  message?: string;
  action?: "refresh-samples";
  leaving: boolean;
}

interface BannerLifecycle {
  phase: "shown" | "leaving";
  remaining: number;
  startedAt: number;
  timer?: number;
}

const MAX_BLOCKS = 10;
const LONG_PRESS_MS = 450;
const BANNER_MS = 5000;
const BANNER_LEAVE_MS = 700;
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

/** Import-specific summary; its ordinary transition is not a failure state. */
function importSummary(run: AgentRunView): string[] {
  if (run.uiState === "queued") return [run.name, "等待开始"];
  if (run.uiState === "attention" && run.attention?.kind === "question")
    return [run.name, "", "实验记录需要澄清后才能导入", "", "回答后才会提交"];
  if (run.uiState === "attention")
    return [run.name, "", run.error ?? "正在对账，请稍候", "", "不会重复发送"];
  if (run.uiState === "failed")
    return [run.name, "", run.error ?? "导入未完成", "", "可取消后重试"];
  return [run.name, "正在导入实验记录"];
}

export function TaskStack({
  refreshSamples,
}: {
  refreshSamples?: () => Promise<void>;
}) {
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [pulsing, setPulsing] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const seenNotices = useRef<Set<string>>(new Set());
  const bannerState = useRef<Map<string, BannerLifecycle>>(new Map());
  const held = useRef<Set<string>>(new Set());
  const press = useRef<{
    timer?: number;
    longPressed: boolean;
    x: number;
    y: number;
  }>({ longPressed: false, x: 0, y: 0 });

  const clearBannerTimer = useCallback((id: string) => {
    const state = bannerState.current.get(id);
    if (!state?.timer) return;
    window.clearTimeout(state.timer);
    state.timer = undefined;
  }, []);

  /** Runs one banner phase, freezing in place while it is held. */
  const runBanner = useCallback(
    (id: string) => {
      const state = bannerState.current.get(id);
      if (!state) return;
      clearBannerTimer(id);
      if (held.current.has(id) && state.phase === "shown") return;
      state.startedAt = Date.now();
      state.timer = window.setTimeout(() => {
        const current = bannerState.current.get(id);
        if (!current) return;
        current.timer = undefined;
        if (held.current.has(id) && current.phase === "shown") {
          current.remaining -= Date.now() - current.startedAt;
          return;
        }
        if (current.phase === "shown") {
          current.phase = "leaving";
          current.remaining = BANNER_LEAVE_MS;
          setBanners((list) =>
            list.map((banner) =>
              banner.id === id ? { ...banner, leaving: true } : banner,
            ),
          );
          runBanner(id);
          return;
        }
        bannerState.current.delete(id);
        setBanners((list) => list.filter((banner) => banner.id !== id));
        void request(`/agent-runs/${id}/dismiss`, { method: "POST" }).catch(
          () => undefined,
        );
      }, Math.max(0, state.remaining));
    },
    [clearBannerTimer],
  );

  const hold = useCallback(
    (id: string) => {
      held.current.add(id);
      const state = bannerState.current.get(id);
      if (state?.timer && state.phase === "shown") {
        state.remaining -= Date.now() - state.startedAt;
        clearBannerTimer(id);
      }
    },
    [clearBannerTimer],
  );
  const release = useCallback(
    (id: string) => {
      held.current.delete(id);
      const state = bannerState.current.get(id);
      if (state && state.phase === "shown" && !state.timer) runBanner(id);
    },
    [runBanner],
  );

  const applyState = useCallback(
    (state: AgentRunState) => {
      // Terminal notices (not run transitions) drive the completion banner so it
      // also survives a browser refresh or SSE reconnect within the server TTL.
      const fresh: Banner[] = [];
      for (const notice of state.notices) {
        if (notice.kind !== "completed") continue;
        if (seenNotices.current.has(notice.id)) continue;
        seenNotices.current.add(notice.id);
        fresh.push({
          id: notice.id,
          name: notice.name,
          sessionUrl: notice.sessionUrl,
          message: notice.message,
          action: notice.action,
          leaving: false,
        });
      }
      if (fresh.length) {
        setBanners((current) => [...current, ...fresh]);
        for (const banner of fresh) {
          bannerState.current.set(banner.id, {
            phase: "shown",
            remaining: BANNER_MS,
            startedAt: Date.now(),
          });
          runBanner(banner.id);
        }
      }
      setRuns(state.runs.filter((run) => run.uiState !== "completed"));
    },
    [runBanner],
  );

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

  useEffect(
    () => () => {
      for (const id of [...bannerState.current.keys()])
        clearBannerTimer(id);
      bannerState.current.clear();
      if (press.current.timer) window.clearTimeout(press.current.timer);
    },
    [clearBannerTimer],
  );

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

  /** Import task actions. Ordinary runs never take this path. */
  const act = async (
    run: AgentRunView,
    action: "cancel" | "retry",
    path: string,
  ) => {
    if (busyAction) return;
    setBusyAction(run.id);
    setActionError((current) => ({ ...current, [run.id]: "" }));
    try {
      await request(path, { method: "POST" });
      await refresh();
    } catch (failure) {
      setActionError((current) => ({
        ...current,
        [run.id]:
          failure instanceof Error
            ? failure.message
            : action === "cancel"
              ? "取消失败，可再试"
              : "重试失败，可再试",
      }));
    } finally {
      setBusyAction(null);
    }
  };

  const onRefreshSamples = async (banner: Banner) => {
    if (!refreshSamples || refreshing) return;
    setRefreshing(banner.id);
    setRefreshError(null);
    hold(banner.id);
    try {
      await refreshSamples();
      release(banner.id);
      // The action is done: let the banner finish its own lifecycle.
      bannerState.current.set(banner.id, {
        phase: "shown",
        remaining: 1200,
        startedAt: Date.now(),
      });
      runBanner(banner.id);
    } catch (failure) {
      setRefreshError(
        failure instanceof Error ? failure.message : "刷新失败，请重试",
      );
      setRefreshing(null);
      release(banner.id);
      return;
    }
    setRefreshing(null);
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
    if (run.importTask) {
      setOpenRun((current) => (current === run.id ? null : run.id));
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
          className={`taskCompletion${banner.leaving ? " leaving" : ""}${
            banner.action === "refresh-samples" ? " withAction" : ""
          }`}
          role={banner.action === "refresh-samples" ? undefined : "button"}
          tabIndex={banner.action === "refresh-samples" ? undefined : 0}
          data-notice-id={banner.id}
          onMouseEnter={() => hold(banner.id)}
          onMouseLeave={() => release(banner.id)}
          onFocus={() => hold(banner.id)}
          onBlur={() => release(banner.id)}
          onClick={
            banner.action === "refresh-samples"
              ? undefined
              : () => openSession(banner.sessionUrl)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && banner.action !== "refresh-samples")
              openSession(banner.sessionUrl);
          }}
        >
          <span className="taskCompletionText">
            {banner.action === "refresh-samples"
              ? (banner.message ?? "实验记录导入完成，刷新样品列表查看")
              : `✓ ${banner.name} 完成`}
          </span>
          {banner.action === "refresh-samples" && (
            <button
              className="taskRefresh"
              disabled={refreshing === banner.id}
              onClick={(event) => {
                event.stopPropagation();
                void onRefreshSamples(banner);
              }}
            >
              {refreshing === banner.id ? "刷新中…" : "刷新样品"}
            </button>
          )}
          {banner.leaving &&
            PARTICLES.map((particle) => (
              <i key={particle} className={`taskParticle p${particle}`} />
            ))}
        </div>
      ))}
      {refreshError && (
        <div className="taskRefreshError" role="alert">
          {refreshError}
        </div>
      )}
      <div className="taskBlocks">
        {visible.map((run) => (
          <div
            key={run.id}
            className={`taskBlockWrap${run.importTask ? " importTask" : ""}`}
          >
            <button
              className={`taskBlock ${run.uiState}${
                pulsing === run.id ? " pulse" : ""
              }`}
              aria-label={`${run.name} ${run.uiState}`}
              aria-expanded={run.importTask ? openRun === run.id : undefined}
              data-run-id={run.id}
              {...(run.importTask ? { "data-import-task": "true" } : {})}
              onPointerDown={(event) => onPointerDown(run, event)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              onPointerMove={onPointerMove}
              onClick={() => onClick(run)}
            >
              {!run.importTask && (
                <span className="taskTooltip">
                  {tooltip(run).map((line, index) => (
                    <span key={index}>{line || "\u00a0"}</span>
                  ))}
                </span>
              )}
            </button>
            {run.importTask && (
              <div
                className={`taskPanel${openRun === run.id ? " pinned" : ""}`}
                data-run-panel={run.id}
              >
                {importSummary(run).map((line, index) => (
                  <span key={index}>{line || "\u00a0"}</span>
                ))}
                {actionError[run.id] && (
                  <span className="taskActionError" role="alert">
                    {actionError[run.id]}
                  </span>
                )}
                <div className="taskActions">
                  {run.uiState === "attention" &&
                    run.attention?.kind === "question" && (
                      <button
                        disabled={!run.sessionUrl}
                        onClick={() => openSession(run.sessionUrl)}
                      >
                        打开会话澄清
                      </button>
                    )}
                  {(run.uiState === "running" ||
                    run.uiState === "queued" ||
                    run.uiState === "attention") && (
                    <button
                      disabled={busyAction === run.id}
                      onClick={() =>
                        void act(run, "cancel", `/jobs/${run.id}/cancel`)
                      }
                    >
                      {busyAction === run.id ? "取消中…" : "取消"}
                    </button>
                  )}
                  {run.uiState === "failed" && (
                    <>
                      <button
                        disabled={busyAction === run.id}
                        onClick={() =>
                          void act(run, "retry", `/jobs/${run.id}/retry`)
                        }
                      >
                        {busyAction === run.id ? "重试中…" : "重试"}
                      </button>
                      {run.sessionUrl && (
                        <button onClick={() => openSession(run.sessionUrl)}>
                          打开会话
                        </button>
                      )}
                      <button
                        disabled={busyAction === run.id}
                        onClick={() => void dismiss(run)}
                      >
                        移除
                      </button>
                    </>
                  )}
                  {run.uiState === "attention" && run.sessionUrl && (
                    <button onClick={() => openSession(run.sessionUrl)}>
                      打开会话
                    </button>
                  )}
                </div>
              </div>
            )}
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
