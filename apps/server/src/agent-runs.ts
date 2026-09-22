import crypto from "node:crypto";
import type { Job } from "@workbench/core";
import {
  OpenCodeError,
  type OpenCodeAdapter,
  type OpenCodeConfig,
  type OpenCodeModelRef,
  type NormalizedOpenCodeEvent,
  assertSeparateDirectories,
  ensureExecutionDirectory,
  validateOpenCodeBaseUrl,
} from "./opencode";

export interface AgentJobStore {
  listJobs(): Job[];
  getSampleImport?(id: string): { status: string; attempt: { id: string }; receipt?: { createdSampleIds: string[] } };
  createJob(type: string, payload: Record<string, unknown>): Job;
  updateJob(
    id: string,
    status: string,
    payload: Record<string, unknown>,
    error?: string,
  ): void;
}

export interface AgentRunPayload extends Record<string, unknown> {
  name: string;
  runtime: "opencode";
  mode: "text" | "vision";
  directory: string;
  sessionId?: string;
  promptMessageId?: string;
  providerId?: string;
  modelId?: string;
  resultText?: string;
}

export type AgentUiState =
  | "queued"
  | "running"
  | "attention"
  | "failed"
  | "completed";

export interface AgentAttention {
  kind: "permission" | "question";
  id: string;
  summary: string;
  canQuickAllow: boolean;
}

export interface AgentRunView {
  importTask?: boolean;
  id: string;
  name: string;
  jobStatus: "queued" | "running" | "failed" | "succeeded";
  uiState: AgentUiState;
  createdAt: string;
  updatedAt: string;
  model?: OpenCodeModelRef;
  sessionUrl?: string;
  attention?: AgentAttention;
  error?: string;
}

export interface TerminalNotice {
  action?: "refresh-samples";
  id: string;
  kind: "completed" | "failed";
  name: string;
  sessionUrl?: string;
  message?: string;
  createdAt: number;
}

export interface AgentRunState {
  runs: AgentRunView[];
  notices: TerminalNotice[];
  eventConnected: boolean;
}

export interface AgentRunServiceOptions {
  store: AgentJobStore;
  getConfig: () => OpenCodeConfig;
  getDataDir?: () => string;
  clock?: () => number;
  healthyPollMs?: number;
  unhealthyPollMs?: number;
  completionNoticeTtlMs?: number;
}

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export class AgentRunService {
  private adapter: OpenCodeAdapter | null = null;
  private monitor: {
    controller: AbortController;
    timer?: NodeJS.Timeout;
    subscription?: Promise<void>;
  } | null = null;
  private eventConnected = false;
  private readonly owners = new Map<string, string>();
  private readonly attention = new Map<string, AgentAttention>();
  private readonly notices = new Map<string, TerminalNotice>();
  private readonly dismissed = new Set<string>();
  private readonly noticeTimers = new Map<string, NodeJS.Timeout>();
  private readonly reconciling = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(state: AgentRunState) => void>();
  private stopped = false;
  private readonly clock: () => number;
  private readonly healthyPollMs: number;
  private readonly unhealthyPollMs: number;
  private readonly completionNoticeTtlMs: number;

  constructor(private readonly options: AgentRunServiceOptions) {
    this.clock = options.clock ?? Date.now;
    this.healthyPollMs = options.healthyPollMs ?? 15_000;
    this.unhealthyPollMs = options.unhealthyPollMs ?? 5_000;
    this.completionNoticeTtlMs = options.completionNoticeTtlMs ?? 30_000;
  }

  setAdapter(adapter: OpenCodeAdapter | null) {
    this.adapter = adapter;
  }

  private get store() {
    return this.options.store;
  }

  private requireAdapter(): OpenCodeAdapter {
    if (!this.adapter)
      throw new OpenCodeError(
        "OPENCODE_UNREACHABLE",
        "OpenCode 尚未连接，请先在设置中配置",
      );
    return this.adapter;
  }

  private payload(job: Job): AgentRunPayload {
    return job.payload as AgentRunPayload;
  }

  private activeJobs(): Job[] {
    return this.store
      .listJobs()
      .filter((job) => job.type === "agent-run" && ACTIVE_STATUSES.has(job.status));
  }

  private agentJobs(): Job[] {
    return this.store
      .listJobs()
      .filter(
        (job) =>
          job.type === "agent-run" &&
          job.status !== "cancelled",
      );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof OpenCodeError) return error.message;
    return String((error as { message?: string })?.message ?? error);
  }

  async createRun(input: {
    name: string;
    prompt: string;
    mode?: "text" | "vision";
  }): Promise<AgentRunView> {
    const name = String(input.name ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();
    const mode = input.mode ?? "text";
    if (!name) throw new Error("请填写任务名称");
    if (name.length > 120) throw new Error("任务名称不能超过 120 字符");
    if (!prompt) throw new Error("请填写任务内容");
    if (mode !== "text" && mode !== "vision")
      throw new Error("任务模式无效");

    const config = this.options.getConfig();
    validateOpenCodeBaseUrl(config.baseUrl);
    const dataDir = this.options.getDataDir?.();
    const directory = assertSeparateDirectories(
      dataDir ?? process.cwd(),
      config.executionDir,
    );
    const adapter = this.requireAdapter();
    await adapter.health();
    ensureExecutionDirectory(directory);

    const model = await this.resolveModel(adapter, config, mode);

    const payload: AgentRunPayload = {
      name,
      runtime: "opencode",
      mode,
      directory,
      ...(model ? { providerId: model.providerId, modelId: model.modelId } : {}),
    };
    const job = this.store.createJob("agent-run", payload);
    try {
      const { id: sessionId } = await adapter.createSession({
        title: name,
        directory,
        model,
      });
      payload.sessionId = sessionId;
      this.store.updateJob(job.id, "queued", payload);
      this.owners.set(sessionId, job.id);
      const messageId = crypto.randomUUID();
      const { promptMessageId } = await adapter.submitPrompt({
        sessionId,
        directory,
        prompt,
        model,
        messageId,
      });
      payload.promptMessageId = promptMessageId;
      this.store.updateJob(job.id, "running", payload);
      this.emitState();
      await this.ensureMonitor();
      await this.reconcileJob(this.findJob(job.id) ?? job);
      return this.view(this.findJob(job.id) ?? job)!;
    } catch (error) {
      this.store.updateJob(job.id, "failed", payload, this.errorMessage(error));
      this.pushNotice(job.id, "failed", payload);
      this.emitState();
      throw error;
    }
  }

  private async resolveModel(
    adapter: OpenCodeAdapter,
    config: OpenCodeConfig,
    mode: "text" | "vision",
  ): Promise<OpenCodeModelRef | undefined> {
    const requested =
      mode === "vision"
        ? (config.visionModel ?? config.textModel)
        : config.textModel;
    if (!requested) return undefined;
    const models = await adapter.listModels();
    const found = models.find(
      (model) =>
        model.providerId === requested.providerId &&
        model.modelId === requested.modelId,
    );
    if (!found || !found.available)
      throw new OpenCodeError(
        "MODEL_UNAVAILABLE",
        "所选模型当前不可用，请重新选择",
        422,
      );
    if (mode === "vision" && found.supportsImage === false)
      throw new OpenCodeError(
        "VISION_MODEL_UNAVAILABLE",
        "所选模型不支持图像输入，请更换多模态模型",
        422,
      );
    return requested;
  }

  private findJob(id: string): Job | undefined {
    return this.store.listJobs().find((job) => job.id === id);
  }

  private view(job: Job): AgentRunView | null {
    if (job.status === "cancelled") return null;
    const payload = this.payload(job);
    const attention = this.attention.get(job.id);
    const uiState: AgentUiState =
      job.status === "queued"
        ? "queued"
        : job.status === "failed"
          ? "failed"
          : job.status === "succeeded"
            ? "completed"
            : attention
              ? "attention"
              : "running";
    return {
      id: job.id,
      name: payload.name,
      jobStatus: job.status as AgentRunView["jobStatus"],
      uiState,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(payload.providerId && payload.modelId
        ? {
            model: {
              providerId: payload.providerId,
              modelId: payload.modelId,
            },
          }
        : {}),
      ...(payload.sessionId && this.adapter
        ? { sessionUrl: this.adapter.buildSessionUrl(payload.sessionId) }
        : {}),
      ...(attention ? { attention } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  snapshot(): AgentRunState {
    return {
      runs: this.agentJobs()
        .map((job) => this.view(job))
        .filter(
          (view): view is AgentRunView =>
            view !== null && !this.dismissed.has(view.id),
        ),
      notices: [...this.notices.values()].sort(
        (a, b) => a.createdAt - b.createdAt,
      ),
      eventConnected: this.eventConnected,
    };
  }

  subscribe(listener: (state: AgentRunState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitState() {
    if (this.stopped) return;
    const state = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        /* listener errors must not break the service */
      }
    }
  }

  /** Internal verification/product hook: model text cannot establish success. */
  publishImportReceipt(jobId: string): boolean {
    const job = this.store.listJobs().find(item => item.id === jobId);
    if (!job || job.type !== "sample-import" || typeof job.payload.importId !== "string") return false;
    const imported = this.store.getSampleImport?.(job.payload.importId);
    if (imported?.status !== "committed" || imported.attempt.id !== job.payload.attemptId || !imported.receipt?.createdSampleIds.length) return false;
    if (job.status === "succeeded") return true;
    this.store.updateJob(jobId, "succeeded", job.payload);
    // The notice carries its action from the first snapshot the client sees, so
    // a later snapshot cannot deliver the same notice without it.
    this.pushNotice(jobId, "completed", this.payload(job), undefined, "refresh-samples");
    this.emitState();
    return true;
  }

  private pushNotice(
    jobId: string,
    kind: TerminalNotice["kind"],
    payload: AgentRunPayload,
    error?: string,
    action?: TerminalNotice["action"],
  ) {
    const notice: TerminalNotice = {
      id: jobId,
      kind,
      name: payload.name,
      createdAt: this.clock(),
      ...(action ? { action } : {}),
      ...(payload.sessionId && this.adapter
        ? { sessionUrl: this.adapter.buildSessionUrl(payload.sessionId) }
        : {}),
      ...(error ? { message: error } : {}),
    };
    this.notices.set(jobId, notice);
    const existing = this.noticeTimers.get(jobId);
    if (existing) clearTimeout(existing);
    if (kind === "completed") {
      const timer = setTimeout(() => {
        this.notices.delete(jobId);
        this.noticeTimers.delete(jobId);
        this.emitState();
      }, this.completionNoticeTtlMs);
      timer.unref?.();
      this.noticeTimers.set(jobId, timer);
    }
  }

  sessionUrl(jobId: string): string | null {
    const job = this.findJob(jobId);
    if (!job || job.type !== "agent-run") return null;
    const sessionId = this.payload(job).sessionId;
    if (!sessionId || !this.adapter) return null;
    return this.adapter.buildSessionUrl(sessionId);
  }
  dismiss(jobId: string): boolean {
    const existed = this.notices.delete(jobId);
    const timer = this.noticeTimers.get(jobId);
    if (timer) clearTimeout(timer);
    this.noticeTimers.delete(jobId);
    this.dismissed.add(jobId);
    this.emitState();
    return existed;
  }

  private async ensureMonitor() {
    if (this.stopped) return;
    if (!this.activeJobs().length) return;
    if (this.monitor) return;
    const controller = new AbortController();
    this.monitor = { controller };
    this.monitor.subscription = this.runEventLoop(controller.signal);
    this.schedulePoll();
  }

  private stopMonitor() {
    if (!this.monitor) return;
    this.monitor.controller.abort();
    if (this.monitor.timer) clearTimeout(this.monitor.timer);
    this.monitor = null;
    this.eventConnected = false;
  }

  private maybeStopMonitor() {
    if (!this.activeJobs().length) this.stopMonitor();
  }

  private schedulePoll() {
    if (!this.monitor || this.stopped) return;
    if (this.monitor.timer) clearTimeout(this.monitor.timer);
    const interval = this.eventConnected
      ? this.healthyPollMs
      : this.unhealthyPollMs;
    const timer = setTimeout(() => {
      void this.reconcileAll()
        .catch(() => undefined)
        .finally(() => {
          if (this.monitor) this.schedulePoll();
        });
    }, interval);
    timer.unref?.();
    this.monitor.timer = timer;
  }

  private async runEventLoop(signal: AbortSignal) {
    const backoff = [1000, 2000, 5000, 10000, 30000];
    let attempt = 0;
    while (!signal.aborted && !this.stopped) {
      try {
        this.eventConnected = true;
        this.emitState();
        await this.requireAdapter().subscribeEvents((event) => {
          void this.onEvent(event);
        }, signal);
      } catch {
        /* reconnect below */
      }
      if (signal.aborted || this.stopped) break;
      this.eventConnected = false;
      this.emitState();
      const wait = backoff[Math.min(attempt, backoff.length - 1)];
      attempt += 1;
      await sleep(wait, signal);
      void this.reconcileAll().catch(() => undefined);
    }
    this.eventConnected = false;
    this.emitState();
  }

  private async onEvent(event: NormalizedOpenCodeEvent) {
    if (event.type === "other") return;
    if (event.type === "session.created") {
      if (event.parentId) {
        const owner = this.owners.get(event.parentId);
        if (owner) this.owners.set(event.sessionId, owner);
      }
      return;
    }
    let jobId = this.owners.get(event.sessionId);
    if (!jobId) {
      const resolved = await this.resolveOwner(event.sessionId);
      if (!resolved) return;
      jobId = resolved;
    }
    const job = this.findJob(jobId);
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;
    if (
      event.type === "session.failed" &&
      this.payload(job).sessionId === event.sessionId
    ) {
      this.store.updateJob(
        job.id,
        "failed",
        this.payload(job),
        `OpenCode 执行失败：${event.error || "未知错误"}`,
      );
      this.attention.delete(job.id);
      this.pushNotice(job.id, "failed", this.payload(job), "OpenCode 执行失败");
      this.emitState();
      this.maybeStopMonitor();
      return;
    }
    await this.reconcileJob(job);
  }

  private async resolveOwner(
    sessionId: string,
    depth = 0,
  ): Promise<string | null> {
    const known = this.owners.get(sessionId);
    if (known) return known;
    if (depth > 16 || !this.adapter) return null;
    const session = await this.adapter.getSession(sessionId);
    if (!session?.parentId) return null;
    const owner = await this.resolveOwner(session.parentId, depth + 1);
    if (owner) this.owners.set(sessionId, owner);
    return owner;
  }

  private ownedSessionIds(job: Job): string[] {
    const root = this.payload(job).sessionId;
    if (!root) return [];
    const owned = [root];
    for (const [sessionId, jobId] of this.owners)
      if (jobId === job.id && sessionId !== root) owned.push(sessionId);
    return owned;
  }

  async reconcileAll(): Promise<void> {
    for (const job of this.activeJobs()) await this.reconcileJob(job);
  }

  private reconcileJob(job: Job): Promise<void> {
    const running = this.reconciling.get(job.id);
    if (running) return running;
    const task = this.performReconcile(job)
      .catch(() => undefined)
      .finally(() => this.reconciling.delete(job.id));
    this.reconciling.set(job.id, task);
    return task;
  }

  private async performReconcile(job: Job) {
    if (!this.adapter) return;
    const payload = this.payload(job);
    if (!payload.sessionId) return;
    const adapter = this.adapter;
    let session;
    try {
      session = await adapter.getSession(payload.sessionId);
      await this.loadChildren(job, payload.sessionId);
    } catch (error) {
      // OpenCode temporarily unreachable: keep the job running.
      if (error instanceof OpenCodeError && error.code === "OPENCODE_UNREACHABLE")
        return;
      throw error;
    }
    if (!session) {
      this.store.updateJob(
        job.id,
        "failed",
        payload,
        "OpenCode Session 已不存在",
      );
      this.attention.delete(job.id);
      this.pushNotice(job.id, "failed", payload, "OpenCode Session 已不存在");
      this.emitState();
      this.maybeStopMonitor();
      return;
    }

    const owned = this.ownedSessionIds(job);
    const permissions = (await adapter.listPermissions()).filter((permission) =>
      owned.includes(permission.sessionId),
    );
    const questions = (
      await Promise.all(
        owned.map((sessionId) => adapter.listQuestions(sessionId)),
      )
    ).flat();

    const config = this.options.getConfig();
    if (permissions.length) {
      if (config.permissionMode === "auto-allow") {
        for (const permission of permissions) {
          const owner = this.owners.get(permission.sessionId);
          if (owner !== job.id) continue;
          try {
            await adapter.replyPermission({
              sessionId: permission.sessionId,
              permissionId: permission.id,
              response: "once",
            });
          } catch (error) {
            if (
              !(
                error instanceof OpenCodeError &&
                error.code === "PERMISSION_NOT_PENDING"
              )
            )
              throw error;
          }
        }
        this.attention.delete(job.id);
      } else {
        const permission = permissions[0];
        this.attention.set(job.id, {
          kind: "permission",
          id: permission.id,
          summary: permission.summary,
          canQuickAllow: this.owners.get(permission.sessionId) === job.id,
        });
      }
    } else if (questions.length) {
      this.attention.set(job.id, {
        kind: "question",
        id: questions[0].id,
        summary: "OpenCode 需要你的输入",
        canQuickAllow: false,
      });
    } else {
      this.attention.delete(job.id);
    }

    if (this.attention.has(job.id)) {
      this.emitState();
      return;
    }

    let status: string | undefined;
    try {
      status = (await adapter.getSessionStatuses()).get(payload.sessionId);
    } catch {
      status = undefined;
    }
    if (status === "busy" || status === "retry") {
      this.emitState();
      return;
    }

    const result = await this.completedResult(
      adapter,
      payload.sessionId,
      payload.promptMessageId,
    );
    if (result) {
      this.store.updateJob(job.id, "succeeded", {
        ...payload,
        resultText: result,
      });
      this.attention.delete(job.id);
      this.pushNotice(job.id, "completed", payload);
      this.emitState();
      this.maybeStopMonitor();
      return;
    }
    this.emitState();
  }

  private async loadChildren(job: Job, rootSessionId: string) {
    if (!this.adapter) return;
    const queue = [rootSessionId];
    const seen = new Set(queue);
    let depth = 0;
    while (queue.length && depth <= 16) {
      const next: string[] = [];
      for (const sessionId of queue) {
        const children = await this.adapter.getChildren(sessionId).catch(() => []);
        for (const child of children) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          this.owners.set(child.id, job.id);
          next.push(child.id);
        }
      }
      queue.length = 0;
      queue.push(...next);
      depth += 1;
    }
  }

  private async completedResult(
    adapter: OpenCodeAdapter,
    sessionId: string,
    promptMessageId?: string,
  ): Promise<string | null> {
    const messages = await adapter.getMessages(sessionId);
    if (!promptMessageId) return null;
    const promptIndex = messages.findIndex(
      (message) => message.id === promptMessageId,
    );
    if (promptIndex < 0) return null;
    const after = messages.slice(promptIndex + 1);
    const assistant = after.filter((message) => message.role === "assistant");
    const completed = assistant.filter(
      (message) => message.completed !== undefined,
    );
    if (!completed.length) return null;
    const final = completed[completed.length - 1];
    return final.text;
  }

  async allowPermission(jobId: string, permissionId: string): Promise<void> {
    const job = this.findJob(jobId);
    if (!job || job.type !== "agent-run")
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "任务不存在", 404);
    if (job.status !== "running")
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "任务已结束", 409);
    const adapter = this.requireAdapter();
    const permission = (await adapter.listPermissions()).find(
      (item) => item.id === permissionId,
    );
    if (!permission)
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "权限请求已失效", 409);
    const owner =
      this.owners.get(permission.sessionId) ??
      (await this.resolveOwner(permission.sessionId));
    if (owner !== job.id)
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "权限不属于该任务", 409);
    await adapter.replyPermission({
      sessionId: permission.sessionId,
      permissionId: permission.id,
      response: "once",
    });
    await this.reconcileJob(job);
  }

  async cancel(jobId: string): Promise<{ id: string; status: "cancelled" }> {
    const job = this.findJob(jobId);
    if (!job || job.type !== "agent-run")
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "任务不存在", 404);
    if (job.status !== "running" && job.status !== "queued")
      throw new Error("任务已结束，不能取消");
    const payload = this.payload(job);
    if (payload.sessionId && this.adapter) {
      try {
        await this.adapter.abortSession(payload.sessionId);
      } catch {
        /* the session may already be gone */
      }
    }
    this.store.updateJob(job.id, "cancelled", payload);
    this.attention.delete(job.id);
    this.emitState();
    this.maybeStopMonitor();
    return { id: job.id, status: "cancelled" };
  }

  async recover(): Promise<void> {
    for (const job of this.store.listJobs()) {
      if (job.type !== "agent-run") continue;
      const payload = this.payload(job);
      if (job.status === "queued" && !payload.sessionId) {
        this.store.updateJob(
          job.id,
          "failed",
          payload,
          "任务在创建 OpenCode Session 前中断，请重新发起。",
        );
        this.pushNotice(
          job.id,
          "failed",
          payload,
          "任务在创建 OpenCode Session 前中断，请重新发起。",
        );
        continue;
      }
      if (job.status === "running" && payload.sessionId)
        this.owners.set(payload.sessionId, job.id);
    }
    if (this.activeJobs().length) {
      this.emitState();
      if (this.adapter) {
        await this.ensureMonitor();
        await this.reconcileAll();
      }
    }
  }

  /** Used by tests to inject event presence. */
  markEventConnected(connected: boolean) {
    this.eventConnected = connected;
    this.emitState();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.stopMonitor();
    for (const timer of this.noticeTimers.values()) clearTimeout(timer);
    this.noticeTimers.clear();
    this.listeners.clear();
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
