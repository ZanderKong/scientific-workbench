import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkbenchStore } from "./store";
import { AgentRunService, type AgentRunPayload } from "./agent-runs";
import {
  OpenCodeError,
  type NormalizedMessage,
  type NormalizedOpenCodeEvent,
  type NormalizedPermission,
  type NormalizedQuestion,
  type NormalizedSession,
  type OpenCodeAdapter,
  type OpenCodeConfig,
  type OpenCodeHealth,
  type OpenCodeMcpStatus,
  type OpenCodeModelOption,
} from "./opencode";

interface FakeSession {
  id: string;
  parentId?: string;
  title?: string;
}

class FakeAdapter implements OpenCodeAdapter {
  healthResult: OpenCodeHealth = { ok: true, version: "test" };
  statuses = new Map<string, "busy" | "retry" | "idle" | "unknown">();
  sessions = new Map<string, FakeSession>();
  messages = new Map<string, NormalizedMessage[]>();
  permissions: NormalizedPermission[] = [];
  questions: NormalizedQuestion[] = [];
  children = new Map<string, string[]>();
  replies: { sessionId: string; permissionId: string; response: string }[] = [];
  aborted: string[] = [];
  prompts: { sessionId: string; messageId: string; prompt: string }[] = [];
  unreachable = false;
  handler: ((event: NormalizedOpenCodeEvent) => void) | null = null;
  models: OpenCodeModelOption[] = [
    {
      providerId: "anthropic",
      modelId: "claude",
      providerName: "anthropic",
      modelName: "Claude",
      available: true,
      supportsImage: true,
    },
  ];
  private sequence = 0;

  async health(): Promise<OpenCodeHealth> {
    if (this.unreachable)
      throw new OpenCodeError("OPENCODE_UNREACHABLE", "无法连接 OpenCode Server");
    return this.healthResult;
  }
  async listModels(): Promise<OpenCodeModelOption[]> {
    return this.models;
  }
  async getMcpStatus(): Promise<OpenCodeMcpStatus> {
    return { state: "connected" };
  }
  async createSession(input: { title: string; directory: string }) {
    const id = `session-${++this.sequence}`;
    this.sessions.set(id, { id, title: input.title });
    this.messages.set(id, []);
    return { id };
  }
  async submitPrompt(input: {
    sessionId: string;
    messageId: string;
    prompt: string;
  }) {
    this.prompts.push({
      sessionId: input.sessionId,
      messageId: input.messageId,
      prompt: input.prompt,
    });
    const list = this.messages.get(input.sessionId) ?? [];
    list.push({
      id: input.messageId,
      role: "user",
      created: 1,
      text: input.prompt,
    });
    this.messages.set(input.sessionId, list);
    this.statuses.set(input.sessionId, "busy");
    return { promptMessageId: input.messageId };
  }
  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    if (this.unreachable)
      throw new OpenCodeError("OPENCODE_UNREACHABLE", "无法连接 OpenCode Server");
    return this.sessions.get(sessionId) ?? null;
  }
  async getSessionStatuses() {
    return new Map(this.statuses);
  }
  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }
  async getChildren(sessionId: string): Promise<NormalizedSession[]> {
    return (this.children.get(sessionId) ?? []).map((id) => ({ id, parentId: sessionId }));
  }
  async abortSession(sessionId: string) {
    this.aborted.push(sessionId);
  }
  async listPermissions(sessionId?: string) {
    return sessionId
      ? this.permissions.filter((item) => item.sessionId === sessionId)
      : this.permissions;
  }
  async replyPermission(input: {
    sessionId: string;
    permissionId: string;
    response: "once";
  }) {
    const index = this.permissions.findIndex(
      (item) => item.id === input.permissionId,
    );
    if (index < 0)
      throw new OpenCodeError("PERMISSION_NOT_PENDING", "权限请求已失效", 409);
    this.permissions.splice(index, 1);
    this.replies.push(input);
  }
  async listQuestions(sessionId?: string) {
    return sessionId
      ? this.questions.filter((item) => item.sessionId === sessionId)
      : this.questions;
  }
  async subscribeEvents(
    handler: (event: NormalizedOpenCodeEvent) => void,
    signal: AbortSignal,
  ) {
    this.handler = handler;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (signal.aborted) return done();
      signal.addEventListener("abort", done, { once: true });
    });
  }
  buildSessionUrl(sessionId: string) {
    return `http://127.0.0.1:1/server/key/session/${sessionId}`;
  }
  emit(event: NormalizedOpenCodeEvent) {
    this.handler?.(event);
  }
  complete(sessionId: string, text: string) {
    const list = this.messages.get(sessionId) ?? [];
    list.push({
      id: `assistant-${++this.sequence}`,
      role: "assistant",
      created: 2,
      completed: 3,
      text,
    });
    this.messages.set(sessionId, list);
    this.statuses.set(sessionId, "idle");
  }
}

let root: string;
let dataDir: string;
let store: WorkbenchStore;
let adapter: FakeAdapter;
let config: OpenCodeConfig;
let service: AgentRunService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-agent-runs-"));
  dataDir = path.join(root, "ScientificWorkbench");
  fs.mkdirSync(dataDir, { recursive: true });
  store = new WorkbenchStore({ dataDir });
  adapter = new FakeAdapter();
  config = {
    baseUrl: "http://127.0.0.1:1",
    username: "opencode",
    executionDir: path.join(root, "ScientificWorkbench-Agent"),
    permissionMode: "ask",
  };
  service = new AgentRunService({
    store,
    getConfig: () => config,
    getDataDir: () => dataDir,
    healthyPollMs: 50,
    unhealthyPollMs: 20,
    completionNoticeTtlMs: 1000,
  });
  service.setAdapter(adapter);
});

afterEach(async () => {
  await service.shutdown();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function createRun(name = "分析 Sample S-031") {
  const view = await service.createRun({ name, prompt: "请分析" });
  return view;
}

async function currentJob(id: string) {
  return store.listJobs().find((job) => job.id === id)!;
}

describe("AgentRunService", () => {
  it("completes a run and extracts only the final assistant text", async () => {
    const view = await createRun();
    expect(view.uiState).toBe("running");
    const sessionId = adapter.prompts[0].sessionId;
    await service.reconcileAll();
    expect((await currentJob(view.id)).status).toBe("running");

    adapter.complete(sessionId, "最终结论：样品稳定");
    await service.reconcileAll();
    const job = await currentJob(view.id);
    expect(job.status).toBe("succeeded");
    expect((job.payload as AgentRunPayload).resultText).toBe(
      "最终结论：样品稳定",
    );
    expect(service.snapshot().notices[0]).toMatchObject({ kind: "completed" });
  });

  it("keeps a retry status running instead of failing", async () => {
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.statuses.set(sessionId, "retry");
    await service.reconcileAll();
    expect((await currentJob(view.id)).status).toBe("running");
    expect(service.snapshot().runs[0].uiState).toBe("running");
  });

  it("turns a pending permission into attention and replies once on allow", async () => {
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.permissions.push({
      id: "perm-1",
      sessionId,
      action: "shell",
      resources: ["python analyse.py"],
      summary: "shell：python analyse.py",
    });
    await service.reconcileAll();
    const run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.uiState).toBe("attention");
    expect(run.attention).toMatchObject({
      kind: "permission",
      id: "perm-1",
      canQuickAllow: true,
    });

    await service.allowPermission(view.id, "perm-1");
    expect(adapter.replies).toEqual([
      { sessionId, permissionId: "perm-1", response: "once" },
    ]);
    const after = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(after.uiState).toBe("running");
  });

  it("auto-allow replies once without ever sending always", async () => {
    config = { ...config, permissionMode: "auto-allow" };
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.permissions.push({
      id: "perm-2",
      sessionId,
      action: "edit",
      resources: ["/tmp/a"],
      summary: "edit：/tmp/a",
    });
    await service.reconcileAll();
    expect(adapter.replies.every((reply) => reply.response === "once")).toBe(true);
    expect(adapter.replies.some((reply) => reply.response === "always")).toBe(
      false,
    );
    const run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.uiState).not.toBe("attention");
  });

  it("never approves sessions that do not belong to a workbench job", async () => {
    const view = await createRun();
    adapter.permissions.push({
      id: "perm-foreign",
      sessionId: "user-manual-session",
      action: "shell",
      resources: ["rm -rf /"],
      summary: "shell：rm -rf /",
    });
    await expect(
      service.allowPermission(view.id, "perm-foreign"),
    ).rejects.toMatchObject({ code: "PERMISSION_NOT_PENDING" });
    expect(adapter.replies).toHaveLength(0);
  });

  it("attributes child session permissions to the root job", async () => {
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.sessions.set("child-1", { id: "child-1", parentId: sessionId });
    adapter.children.set(sessionId, ["child-1"]);
    adapter.permissions.push({
      id: "perm-child",
      sessionId: "child-1",
      action: "shell",
      resources: ["ls"],
      summary: "shell：ls",
    });
    await service.reconcileAll();
    const run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.attention?.id).toBe("perm-child");
    await service.allowPermission(view.id, "perm-child");
    expect(adapter.replies[0]).toMatchObject({
      sessionId: "child-1",
      response: "once",
    });
  });

  it("shows a question as attention and never auto-answers it", async () => {
    config = { ...config, permissionMode: "auto-allow" };
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.questions.push({
      id: "form-1",
      sessionId,
      summary: "OpenCode 需要你的输入",
    });
    await service.reconcileAll();
    const run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.attention).toMatchObject({ kind: "question", id: "form-1" });
  });

  it("recovers missed permission and question events through reconciliation", async () => {
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    adapter.permissions.push({
      id: "perm-lost",
      sessionId,
      action: "shell",
      resources: ["pwd"],
      summary: "shell：pwd",
    });
    // No event delivered; the poll/reconcile path must restore it.
    await service.reconcileAll();
    let run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.attention?.id).toBe("perm-lost");
    adapter.permissions = [];
    adapter.questions.push({
      id: "form-lost",
      sessionId,
      summary: "OpenCode 需要你的输入",
    });
    await service.reconcileAll();
    run = service.snapshot().runs.find((item) => item.id === view.id)!;
    expect(run.attention?.kind).toBe("question");
  });

  it("keeps running when OpenCode is temporarily unreachable", async () => {
    const view = await createRun();
    adapter.unreachable = true;
    await service.reconcileAll();
    expect((await currentJob(view.id)).status).toBe("running");
  });

  it("fails only when the session is really missing", async () => {
    const view = await createRun();
    adapter.sessions.delete(adapter.prompts[0].sessionId);
    await service.reconcileAll();
    const job = await currentJob(view.id);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("OpenCode Session 已不存在");
  });

  it("cancels through an abort and never deletes the session", async () => {
    const view = await createRun();
    const sessionId = adapter.prompts[0].sessionId;
    const result = await service.cancel(view.id);
    expect(result.status).toBe("cancelled");
    expect(adapter.aborted).toContain(sessionId);
    expect(adapter.sessions.has(sessionId)).toBe(true);
    const snapshot = service.snapshot();
    expect(snapshot.runs.some((item) => item.id === view.id)).toBe(false);
  });

  it("recovers running jobs and fails queued jobs without replaying prompts", async () => {
    const running = store.createJob("agent-run", {
      name: "恢复中的任务",
      runtime: "opencode",
      mode: "text",
      directory: config.executionDir,
      sessionId: "session-existing",
      promptMessageId: "prompt-1",
    });
    store.updateJob(running.id, "running", {
      ...(running.payload as object),
      sessionId: "session-existing",
      promptMessageId: "prompt-1",
    });
    adapter.sessions.set("session-existing", {
      id: "session-existing",
      title: "恢复中的任务",
    });
    adapter.statuses.set("session-existing", "busy");
    const queued = store.createJob("agent-run", {
      name: "未创建 Session",
      runtime: "opencode",
      mode: "text",
      directory: config.executionDir,
    });

    const recovered = new AgentRunService({
      store,
      getConfig: () => config,
      getDataDir: () => dataDir,
    });
    recovered.setAdapter(adapter);
    await recovered.recover();

    expect((await currentJob(running.id)).status).toBe("running");
    expect((await currentJob(queued.id)).status).toBe("failed");
    expect(adapter.prompts).toHaveLength(0);
    await recovered.shutdown();
  });

  it("excludes prompts and secrets from the persisted job payload", async () => {
    const view = await createRun("机密任务");
    const job = await currentJob(view.id);
    const serialized = JSON.stringify(job.payload);
    expect(serialized).not.toContain("请分析");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("Authorization");
  });

  it("dismisses a failed notice but keeps the job history", async () => {
    const view = await createRun();
    adapter.sessions.delete(adapter.prompts[0].sessionId);
    await service.reconcileAll();
    expect(service.snapshot().notices[0]).toMatchObject({ kind: "failed" });
    service.dismiss(view.id);
    expect(service.snapshot().notices).toHaveLength(0);
    expect((await currentJob(view.id)).status).toBe("failed");
  });

  it("reports event connectivity for degraded polling", () => {
    expect(service.snapshot().eventConnected).toBe(false);
    service.markEventConnected(true);
    expect(service.snapshot().eventConnected).toBe(true);
  });
});
