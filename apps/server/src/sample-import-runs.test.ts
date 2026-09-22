/**
 * Lifecycle acceptance for the AI record import. Everything here runs against
 * the real Store, the real B1 commit path and the real HTTP authorization
 * layer; only the OpenCode transport and the model submission are replaced, so
 * no test can pass purely because a mock agrees with itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import type { SampleImportDraft, SampleImportConfirm } from "@workbench/core";
import { WorkbenchStore } from "./store";
import { AgentRunService } from "./agent-runs";
import { LocalAuthorization, installAuthorization } from "./auth";
import {
  defaultOpenCodeConfig,
  type NormalizedMessage,
  type NormalizedOpenCodeEvent,
  type NormalizedPermission,
  type NormalizedQuestion,
  type NormalizedSession,
  type NormalizedSessionStatus,
  type OpenCodeAdapter,
  type OpenCodeHealth,
  type OpenCodeMcpStatus,
  type OpenCodeModelOption,
  type ResolvedOpenCodeConfig,
} from "./opencode";
import { realImageFixtures } from "./test-images";
import { SampleImportRunService, type StartImportInput } from "./sample-import-runs";

/** Transport double. Unused members throw so a test cannot silently rely on them. */
class FakeImportAdapter implements OpenCodeAdapter {
  sessions = new Map<string, NormalizedSession>();
  messages = new Map<string, NormalizedMessage[]>();
  questions: NormalizedQuestion[] = [];
  permissions: NormalizedPermission[] = [];
  statuses = new Map<string, NormalizedSessionStatus>();
  aborted: string[] = [];
  createCalls = 0;
  failCreate = false;
  /** Fails the session list, i.e. the runtime cannot answer ownership queries. */
  failList = false;
  onCreateSession?: (session: NormalizedSession) => void;
  private sequence = 0;

  private unused(name: string): never {
    throw new Error(`unexpected transport call: ${name}`);
  }
  async health(): Promise<OpenCodeHealth> {
    return { ok: true, version: "1.18.31" };
  }
  async listModels(): Promise<OpenCodeModelOption[]> {
    return [];
  }
  async getMcpStatus(): Promise<OpenCodeMcpStatus> {
    return { state: "connected" };
  }
  async createSession(input: {
    title: string;
    directory: string;
  }): Promise<{ id: string }> {
    this.createCalls += 1;
    if (this.failCreate) throw new Error("socket hang up");
    const session: NormalizedSession = {
      id: `ses_${++this.sequence}`,
      title: input.title,
      directory: input.directory,
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    this.onCreateSession?.(session);
    return { id: session.id };
  }
  async submitPrompt(): Promise<{ promptMessageId: string }> {
    this.unused("submitPrompt");
  }
  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }
  async listSessions(): Promise<NormalizedSession[]> {
    if (this.failList) throw new Error("runtime unavailable");
    return [...this.sessions.values()];
  }
  async getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>> {
    return new Map(this.statuses);
  }
  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }
  async getChildren(): Promise<NormalizedSession[]> {
    return [];
  }
  async abortSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) throw new Error("session missing");
    this.aborted.push(sessionId);
  }
  async listPermissions(sessionId?: string): Promise<NormalizedPermission[]> {
    return this.permissions.filter((item) => !sessionId || item.sessionId === sessionId);
  }
  async replyPermission(): Promise<void> {
    this.unused("replyPermission");
  }
  async listQuestions(sessionId?: string): Promise<NormalizedQuestion[]> {
    return this.questions.filter((item) => !sessionId || item.sessionId === sessionId);
  }
  async subscribeEvents(
    _handler: (event: NormalizedOpenCodeEvent) => void,
    _signal: AbortSignal,
  ): Promise<void> {
    this.unused("subscribeEvents");
  }
  buildSessionUrl(sessionId: string): string {
    return `http://127.0.0.1:4199/session/${sessionId}`;
  }
}

interface Harness {
  root: string;
  store: WorkbenchStore;
  auth: LocalAuthorization;
  notices: AgentRunService;
  fake: FakeImportAdapter;
  submits: { sessionId: string; messageId: string }[];
  service: SampleImportRunService;
  endpoint: { baseUrl: string; username?: string; password?: string };
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanups.splice(0)) await action();
});

function harness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-run-"));
  fs.mkdirSync(path.join(root, "private"), { recursive: true, mode: 0o700 });
  const store = new WorkbenchStore({ dataDir: root });
  const auth = new LocalAuthorization(root);
  const notices = new AgentRunService({
    store,
    getConfig: () => defaultOpenCodeConfig(root),
  });
  const fake = new FakeImportAdapter();
  const endpoint = { baseUrl: "http://127.0.0.1:4199" };
  const submits: { sessionId: string; messageId: string }[] = [];
  const service = new SampleImportRunService({
    store,
    notices,
    endpoint: () => endpoint,
    capability: () => undefined,
    authorize: (importId, attemptId) => auth.createImport(importId, attemptId),
    revoke: (id) => auth.revoke(id),
    apiBaseUrl: () => "http://127.0.0.1:1/api/v1",
    adapter: () => fake,
    readiness: async () => ({
      ready: true,
      reasonCode: "READY",
      detail: "专属运行时、模型与受限 profile 均可用",
      model: "deepseek/deepseek-v4-flash-vision-exp",
    }),
    submit: async (_config, _flavor, input) => {
      submits.push({ sessionId: input.sessionId, messageId: input.messageId });
      return {
        promptMessageId: input.messageId,
        candidate: "v1",
        endpoint: input.sessionId,
        requestKeys: ["messageID", "parts", "model"],
        status: 204,
        elapsedMs: 1,
      };
    },
    // No timer-driven polling in unit tests: every reconcile is explicit.
    pollMs: 3_600_000,
  });
  cleanups.push(async () => {
    await service.shutdown().catch(() => undefined);
    await notices.shutdown();
    try {
      store.close();
    } catch {
      // A test may already have closed the store to prove shutdown is inert.
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-import-agent`, { recursive: true, force: true });
  });
  return { root, store, auth, notices, fake, submits, service, endpoint };
}

async function prepare(h: Harness, name = "record.png"): Promise<SampleImportConfirm> {
  const image = h.store.saveAttachment(
    realImageFixtures().PNG,
    name,
    "image/png",
  );
  return h.store.prepareSampleImport({
    importId: crypto.randomUUID(),
    attachmentIds: [image.id],
  });
}

function draftFor(confirm: SampleImportConfirm): SampleImportDraft {
  return {
    schemaVersion: 1,
    samples: [
      {
        key: "s1",
        title: "模拟观察",
        body: "- 观察到红色方块。",
        sourceMappings: [
          {
            attachmentId: confirm.source[0].attachmentId,
            page: 1,
            componentId: confirm.source[0].componentId,
            positions: "整页",
            transcription: "红色方块",
          },
        ],
        references: [],
      },
    ],
    objectIntents: [],
    ambiguities: [],
  };
}

/** A real B1 commit through the Store, exactly as the scoped MCP call would. */
function commitThroughB1(h: Harness, confirm: SampleImportConfirm) {
  return h.store.commitSampleImport(confirm.importId, {
    ...draftEnvelope(h, confirm),
  });
}
function draftEnvelope(h: Harness, confirm: SampleImportConfirm) {
  h.store.saveSampleImportDraft(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
    expectedDraftVersion: 0,
    draft: draftFor(confirm),
  });
  const record = h.store.getSampleImport(confirm.importId);
  if (!("draftVersion" in record)) throw new Error("expected an uncommitted draft");
  return {
    attemptId: confirm.attempt.id,
    expectedVersion: record.recordVersion,
    draftVersion: record.draftVersion!,
    draftHash: record.draftHash!,
    sourceDataVersion: h.store.getData(confirm.sourceDataId).version,
    commitFingerprint: record.commitFingerprint!,
  };
}

function importJobs(h: Harness) {
  return h.store.listJobs().filter((job) => job.type === "sample-import");
}

/** The managed agent directory sits beside the workspace, realpath-normalised. */
function agentDir(h: Harness) {
  return path.join(fs.realpathSync(path.dirname(h.root)), `${path.basename(h.root)}-import-agent`);
}

function privateInput(h: Harness, attemptId: string) {
  const file = path.join(h.root, "private", "import-runs", `${attemptId}.json`);
  if (!fs.existsSync(file)) return undefined;
  return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> };
}

it("replays an identical start to one Job and rejects a changed identity or version", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const input: StartImportInput = {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
    note: "第一页两行，第二页三行",
  };
  const [first, second] = await Promise.all([
    h.service.start(confirm.importId, input),
    h.service.start(confirm.importId, { ...input }),
  ]);
  expect(first.jobId).toBe(second.jobId);
  expect(importJobs(h)).toHaveLength(1);
  await expect(
    h.service.start(confirm.importId, { ...input, expectedVersion: confirm.recordVersion + 1 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    h.service.start(confirm.importId, { attemptId: crypto.randomUUID(), expectedVersion: confirm.recordVersion }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await h.service.flush();
  // One job, one session, one durable send.
  expect(h.fake.createCalls).toBe(1);
  expect(h.submits).toHaveLength(1);
  expect(importJobs(h)).toHaveLength(1);
});

it("withdraws eligibility before aborting when the restricted task asks for extra permission", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.flush();
  // The model saved a draft, then asked for a permission it must never get.
  const envelope = draftEnvelope(h, confirm);
  h.fake.permissions.push({
    id: "perm-1",
    sessionId: String(h.store.listJobs().find((job) => job.id === jobId)?.payload.sessionId),
    action: "bash",
    resources: ["*"],
    summary: "允许执行命令",
  });
  await h.service.reconcileJob(jobId);
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("failed");
  expect(h.service.scopeState(confirm.importId, confirm.attempt.id)).toBe("revoked");
  expect(h.store.getSampleImport(confirm.importId).attempt.status).toBe("revoked");
  // A fresh commit request that arrives after the failure creates nothing.
  expect(() => h.store.commitSampleImport(confirm.importId, envelope)).toThrow();
  expect(h.store.listSamples()).toHaveLength(0);
  expect(h.fake.aborted).toHaveLength(1);
});

it("keeps a committed import as success whichever order cancel and commit arrive in", async () => {
  for (const order of ["commit-then-cancel", "cancel-then-commit"] as const) {
    const h = harness();
    const confirm = await prepare(h);
    const { jobId } = await h.service.start(confirm.importId, {
      attemptId: confirm.attempt.id,
      expectedVersion: confirm.recordVersion,
    });
    await h.service.flush();
    // A complete, valid commit request prepared while the attempt is active.
    const envelope = draftEnvelope(h, confirm);
    if (order === "commit-then-cancel") {
      h.store.commitSampleImport(confirm.importId, envelope);
      expect((await h.service.cancel(jobId)).status).toBe("succeeded");
      expect(h.store.listSamples()).toHaveLength(1);
      const notice = h.service.snapshot().notices.find((item) => item.id === jobId);
      expect(notice).toMatchObject({ kind: "completed", action: "refresh-samples" });
      // Replaying the same submission cannot duplicate, and a different one is
      // refused outright.
      h.store.commitSampleImport(confirm.importId, envelope);
      expect(h.store.listSamples()).toHaveLength(1);
      expect(() =>
        h.store.commitSampleImport(confirm.importId, { ...envelope, draftHash: "0".repeat(64) }),
      ).toThrow();
      expect(h.store.listSamples()).toHaveLength(1);
    } else {
      expect((await h.service.cancel(jobId)).status).toBe("cancelled");
      expect(h.store.getSampleImport(confirm.importId).attempt.status).toBe("revoked");
      expect(() => h.store.commitSampleImport(confirm.importId, envelope)).toThrow();
      expect(h.store.listSamples()).toHaveLength(0);
      // The later commit never happened, so the job stays cancelled and retryable.
      expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("cancelled");
    }
  }
});

it("resolves two identical retries to one new attempt and never lets the old one revoke it", async () => {
  const h = harness();
  const confirm = await prepare(h);
  h.fake.onCreateSession = (session) => {
    h.fake.permissions.push({
      id: "perm-1",
      sessionId: session.id,
      action: "write",
      resources: ["*"],
      summary: "允许写入",
    });
  };
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
    note: "第三行是重复测量",
  });
  await h.service.flush();
  const failed = h.store.getSampleImport(confirm.importId);
  expect(failed.attempt.status).toBe("revoked");
  h.fake.permissions = [];
  // Stop re-injecting the permission for the retried session.
  h.fake.onCreateSession = undefined;
  const [first, second] = await Promise.all([h.service.retry(jobId), h.service.retry(jobId)]);
  expect(first.jobId).toBe(second.jobId);
  expect(first.attemptId).toBe(second.attemptId);
  expect(first.attemptId).not.toBe(confirm.attempt.id);
  await h.service.flush();
  const current = h.store.getSampleImport(confirm.importId);
  expect(current.attempt.id).toBe(first.attemptId);
  expect(current.attempt.status).toBe("active");
  expect(h.service.scopeState(confirm.importId, first.attemptId)).toBe("active");
  // The user's instruction survives the retry instead of being dropped.
  const restored = privateInput(h, first.attemptId);
  expect(restored?.value.note).toBe("第三行是重复测量");
  expect(privateInput(h, confirm.attempt.id)).toBeUndefined();
  expect(importJobs(h)).toHaveLength(2);
  // Late events for the superseded attempt cannot change the new one.
  await h.service.reconcileJob(jobId).catch(() => undefined);
  await h.service.cancel(jobId);
  expect(h.store.getSampleImport(confirm.importId).attempt.id).toBe(first.attemptId);
  expect(h.store.getSampleImport(confirm.importId).attempt.status).toBe("active");
  expect(h.store.listJobs().find((job) => job.id === first.jobId)?.status).not.toBe("cancelled");
});

it("never writes success or failure for a superseded attempt after a restart", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.flush();
  // Force a newer attempt while the original job is still active.
  const newer = h.store.retrySampleImport(confirm.importId, {
    expectedVersion: h.store.getSampleImport(confirm.importId).recordVersion,
  });
  await h.service.reconcileJob(jobId);
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("cancelled");
  expect(h.store.getSampleImport(confirm.importId).attempt.id).toBe(newer.attempt.id);
  expect(h.store.getSampleImport(confirm.importId).attempt.status).toBe("active");
  expect(h.store.listSamples()).toHaveLength(0);
});

it("reconciles an interrupted dispatch without ever re-sending a prompt", async () => {
  const h = harness();
  // (a) interrupted before the session existed.
  const pendingConfirm = await prepare(h, "a.png");
  const pending = h.store.createJob("sample-import", payloadFor(h, pendingConfirm, "pending"));
  // (b) interrupted after createSession, before the response was readable.
  const orphanConfirm = await prepare(h, "b.png");
  const orphan = h.store.createJob("sample-import", payloadFor(h, orphanConfirm, "creating-session"));
  h.fake.sessions.set("ses_orphan", {
    id: "ses_orphan",
    title: `Scientific Workbench import ${orphan.id}`,
    directory: "unused",
  });
  // (c) interrupted after creating the session but before any send.
  const createdConfirm = await prepare(h, "c.png");
  const created = h.store.createJob("sample-import", payloadFor(h, createdConfirm, "session-created"));
  // (d) interrupted after the durable send: must resume listening, not resend.
  const sentConfirm = await prepare(h, "d.png");
  const sent = h.store.createJob("sample-import", {
    ...payloadFor(h, sentConfirm, "dispatching"),
    sessionId: "ses_sent",
    promptMessageId: "msg_sent",
  });
  h.fake.sessions.set("ses_sent", { id: "ses_sent", title: "sent", directory: "unused" });
  h.fake.messages.set("ses_sent", [
    { id: "msg_sent", role: "user", created: 1, text: "prompt" },
  ]);
  h.fake.statuses.set("ses_sent", "busy");

  const restart = new SampleImportRunService({
    store: h.store,
    notices: h.notices,
    endpoint: () => h.endpoint,
    capability: () => undefined,
    authorize: (importId, attemptId) => h.auth.createImport(importId, attemptId),
    revoke: (id) => h.auth.revoke(id),
    apiBaseUrl: () => "http://127.0.0.1:1/api/v1",
    adapter: () => h.fake,
    pollMs: 3_600_000,
  });
  cleanups.push(async () => restart.shutdown());
  const before = h.submits.length;
  const createsBefore = h.fake.createCalls;
  await restart.recover();
  await restart.flush();

  const status = (id: string) => h.store.listJobs().find((job) => job.id === id)?.status;
  expect(status(pending.id)).toBe("failed");
  expect(status(orphan.id)).toBe("failed");
  expect(status(created.id)).toBe("failed");
  // The orphan session was found by correlation and closed.
  expect(h.fake.aborted).toContain("ses_orphan");
  // The already-sent job keeps observing: no resend, still active.
  expect(status(sent.id)).toBe("running");
  expect(h.submits.length).toBe(before);
  // Recovery creates no session and sends no prompt of its own.
  expect(h.fake.createCalls).toBe(createsBefore);
  expect(h.store.listSamples()).toHaveLength(0);
  // Nothing left an active execution window behind.
  for (const item of [pendingConfirm, orphanConfirm, createdConfirm])
    expect(h.service.scopeState(item.importId, item.attempt.id)).toBe("revoked");
  expect(h.service.scopeState(sentConfirm.importId, sentConfirm.attempt.id)).toBe("active");
});

it("keeps observing instead of failing when the runtime cannot confirm ownership", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const job = h.store.createJob("sample-import", payloadFor(h, confirm, "creating-session"));
  h.fake.failList = true;
  await h.service.recover();
  await h.service.flush();
  const current = h.store.listJobs().find((item) => item.id === job.id);
  expect(current?.status).toBe("running");
  expect(current?.payload.phase).toBe("uncertain");
  expect(h.store.listSamples()).toHaveLength(0);
});

it("treats an absent non-idle snapshot as idle only with a completed correlated reply", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const job = h.store.createJob("sample-import", {
    ...payloadFor(h, confirm, "running"),
    sessionId: "ses_idle",
    promptMessageId: "msg_idle",
  });
  h.fake.sessions.set("ses_idle", { id: "ses_idle", title: "idle", directory: "unused" });
  // V1 lists only non-idle sessions, so idle means "absent from the snapshot".
  h.fake.messages.set("ses_idle", [
    { id: "msg_idle", role: "user", created: 1, text: "prompt" },
    { id: "asst_1", role: "assistant", created: 2, completed: 3, parentId: "msg_idle", text: "done", tools: [] },
  ]);
  await h.service.reconcileJob(job.id);
  const failed = h.store.listJobs().find((item) => item.id === job.id);
  expect(failed?.status).toBe("failed");
  expect(h.store.getSampleImport(confirm.importId).attempt.status).toBe("revoked");
  // A completed intermediate tool step is not an ending.
  const h2 = harness();
  const confirm2 = await prepare(h2);
  const job2 = h2.store.createJob("sample-import", {
    ...payloadFor(h2, confirm2, "running"),
    sessionId: "ses_tool",
    promptMessageId: "msg_tool",
  });
  h2.fake.sessions.set("ses_tool", { id: "ses_tool", title: "tool", directory: "unused" });
  h2.fake.messages.set("ses_tool", [
    { id: "msg_tool", role: "user", created: 1, text: "prompt" },
    {
      id: "asst_t",
      role: "assistant",
      created: 2,
      completed: 3,
      parentId: "msg_tool",
      text: "",
      tools: [{ name: "scientific-workbench_sample_import_commit", status: "completed" }],
    },
  ]);
  await h2.service.reconcileJob(job2.id);
  expect(h2.store.listJobs().find((item) => item.id === job2.id)?.status).toBe("running");
  expect(h2.service.scopeState(confirm2.importId, confirm2.attempt.id)).toBe("active");
});

it("keeps a receipt as success even when the runtime fails afterwards", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.flush();
  commitThroughB1(h, confirm);
  await h.service.reconcileJob(jobId);
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("succeeded");
  const samplesAfterCommit = h.store.listSamples().length;
  // Everything the runtime touches now fails.
  h.fake.failCreate = true;
  h.fake.failList = true;
  h.fake.permissions.push({ id: "p", sessionId: "ses_1", action: "bash", resources: [], summary: "" });
  h.fake.questions.push({ id: "q", sessionId: "ses_1", summary: "stale" });
  await h.service.reconcileJob(jobId);
  await h.service.recover();
  await h.service.flush();
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("succeeded");
  expect(h.store.listSamples()).toHaveLength(samplesAfterCommit);
  expect(h.store.listSamples()).toHaveLength(1);
});

it("surfaces a lost createSession response, closes the orphan and sends nothing", async () => {
  const h = harness();
  const confirm = await prepare(h);
  // The runtime creates the session but the response never reaches us.
  const originalCreate = h.fake.createSession.bind(h.fake);
  h.fake.createSession = async (input) => {
    await originalCreate(input);
    throw new Error("socket hang up");
  };
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.flush();
  expect(h.submits).toHaveLength(0);
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).toBe("failed");
  expect(h.fake.aborted).toHaveLength(1);
  expect(h.service.scopeState(confirm.importId, confirm.attempt.id)).toBe("revoked");
  expect(h.store.listSamples()).toHaveLength(0);
});

it("keeps a lost send response observable and never resends it", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const submitsBefore = h.submits.length;
  const service = new SampleImportRunService({
    store: h.store,
    notices: h.notices,
    endpoint: () => h.endpoint,
    capability: () => undefined,
    authorize: (importId, attemptId) => h.auth.createImport(importId, attemptId),
    revoke: (id) => h.auth.revoke(id),
    apiBaseUrl: () => "http://127.0.0.1:1/api/v1",
    adapter: () => h.fake,
    pollMs: 3_600_000,
    readiness: async () => ({
      ready: true,
      reasonCode: "READY",
      detail: "专属运行时、模型与受限 profile 均可用",
      model: "deepseek/deepseek-v4-flash-vision-ext",
    }),
    submit: async () => {
      throw new Error("gateway timeout");
    },
  });
  cleanups.push(async () => service.shutdown());
  const { jobId } = await service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await service.flush();
  const job = h.store.listJobs().find((item) => item.id === jobId);
  expect(job?.status).toBe("running");
  expect(job?.payload.phase).toBe("uncertain");
  expect(job?.payload.promptMessageId).toBeTruthy();
  // The session exists and gains a correlated reply: no second send happens.
  const sessionId = String(job?.payload.sessionId);
  h.fake.messages.set(sessionId, [
    { id: String(job?.payload.promptMessageId), role: "user", created: 1, text: "prompt" },
    { id: "asst_x", role: "assistant", created: 2, completed: 3, parentId: String(job?.payload.promptMessageId), text: "no commit", tools: [] },
  ]);
  await service.reconcileJob(jobId);
  expect(h.submits.length).toBe(submitsBefore);
  expect(h.store.listJobs().find((item) => item.id === jobId)?.status).toBe("failed");
  expect(h.service.scopeState(confirm.importId, confirm.attempt.id)).toBe("revoked");
});

it("stores only the transient private input and removes it once the import succeeds", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
    note: "只记录普通观察",
  });
  await h.service.flush();
  const stored = privateInput(h, confirm.attempt.id);
  expect(stored).toBeDefined();
  expect(fs.statSync(stored!.file).mode & 0o777).toBe(0o600);
  expect(Object.keys(stored!.value).sort()).toEqual([
    "attemptId",
    "endpoint",
    "importId",
    "note",
    "token",
    "tokenId",
  ]);
  expect(stored!.value.note).toBe("只记录普通观察");
  const raw = fs.readFileSync(stored!.file, "utf8");
  for (const forbidden of ["请读取 skill-sample-from-record", "红色方块", "transcription", "base64"])
    expect(raw).not.toContain(forbidden);
  commitThroughB1(h, confirm);
  await h.service.reconcileJob(jobId);
  expect(privateInput(h, confirm.attempt.id)).toBeUndefined();
  // Cancellation keeps the note so a retry can restore it.
  const other = harness();
  const confirm2 = await prepare(other);
  const started = await other.service.start(confirm2.importId, {
    attemptId: confirm2.attempt.id,
    expectedVersion: confirm2.recordVersion,
    note: "第二页是重复测量",
  });
  await other.service.flush();
  await other.service.cancel(started.jobId);
  expect(privateInput(other, confirm2.attempt.id)?.value.note).toBe("第二页是重复测量");
});

it("scopes the HTTP token to its own import and revokes it on retirement", async () => {
  const h = harness();
  const first = await prepare(h);
  const second = await prepare(h);
  const app = Fastify();
  installAuthorization(app, h.auth, 4317, (importId, attemptId) =>
    h.service.scopeState(importId, attemptId),
  );
  app.get("/api/v1/samples", async () => []);
  app.get("/api/v1/knowledge", async () => ({}));
  app.get("/api/v1/sample-imports/:id", async () => ({}));
  app.put("/api/v1/sample-imports/:id/draft", async () => ({}));
  app.post("/api/v1/sample-imports/:id/commit", async () => ({}));
  cleanups.push(async () => app.close());
  // Mint the scoped token exactly as the product does: through the private
  // per-attempt binding the managed runtime also reads.
  expect((await h.service.readiness(first.importId)).ready).toBe(true);
  const bound = privateInput(h, first.attempt.id)!.value as { tokenId: string; token: string };
  const headers = {
    host: "127.0.0.1:4317",
    authorization: `Bearer ${bound.token}`,
  };
  const own = `/api/v1/sample-imports/${first.importId}`;
  const foreign = `/api/v1/sample-imports/${second.importId}`;
  expect((await app.inject({ url: own, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: "PUT", url: `${own}/draft`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `${own}/commit`, headers })).statusCode).toBe(200);
  // A different import, and anything outside the import scope, is denied.
  expect((await app.inject({ url: foreign, headers })).statusCode).toBe(403);
  expect((await app.inject({ method: "PUT", url: `${foreign}/draft`, headers })).statusCode).toBe(403);
  expect((await app.inject({ url: "/api/v1/samples", headers })).statusCode).toBe(403);
  expect((await app.inject({ url: "/api/v1/knowledge", headers })).statusCode).toBe(200);
  expect(h.service.scopeState(first.importId, second.attempt.id)).toBe("revoked");
  // Revoked eligibility (or a retired token) closes the window completely.
  h.store.cancelSampleImport(first.importId, {
    attemptId: first.attempt.id,
    expectedVersion: h.store.getSampleImport(first.importId).recordVersion,
  });
  expect((await app.inject({ url: own, headers })).statusCode).toBe(403);
  h.auth.revoke(bound.tokenId);
  expect((await app.inject({ url: own, headers })).statusCode).toBe(401);
});

it("denies the scoped window as soon as the runtime binding drifts", async () => {
  const h = harness();
  const confirm = await prepare(h);
  const { jobId } = await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.flush();
  expect(h.service.scopeState(confirm.importId, confirm.attempt.id)).toBe("active");
  // The generated profile is the binding evidence: editing it revokes the token.
  const profile = path.join(
    agentDir(h),
    confirm.importId,
    confirm.attempt.id,
    "execution",
    "opencode.jsonc",
  );
  expect(fs.existsSync(profile)).toBe(true);
  fs.writeFileSync(profile, "{}\n", { mode: 0o600 });
  expect(h.service.scopeState(confirm.importId, confirm.attempt.id)).toBe("revoked");
  // A changed endpoint is drift too: the private binding no longer resolves.
  const drifted = new SampleImportRunService({
    store: h.store,
    notices: h.notices,
    endpoint: () => ({ baseUrl: "http://127.0.0.1:4999" }),
    capability: () => undefined,
    authorize: (importId, attemptId) => h.auth.createImport(importId, attemptId),
    revoke: (id) => h.auth.revoke(id),
    apiBaseUrl: () => "http://127.0.0.1:1/api/v1",
    adapter: () => h.fake,
    pollMs: 3_600_000,
  });
  cleanups.push(async () => drifted.shutdown());
  expect(drifted.scopeState(confirm.importId, confirm.attempt.id)).toBe("revoked");
  expect(h.store.listJobs().find((job) => job.id === jobId)?.status).not.toBe("succeeded");
});

it("stops touching the Store after shutdown and drains in-flight work", async () => {
  const h = harness();
  const confirm = await prepare(h);
  await h.service.start(confirm.importId, {
    attemptId: confirm.attempt.id,
    expectedVersion: confirm.recordVersion,
  });
  await h.service.shutdown();
  await h.service.flush();
  h.store.close();
  await expect(h.service.reconcileAll()).resolves.toBeUndefined();
  await expect(h.service.recover()).resolves.toBeUndefined();
  await expect(h.service.flush()).resolves.toBeUndefined();
});

/** Minimal durable payload, as `start` would have written it. */
function payloadFor(h: Harness, confirm: SampleImportConfirm, phase: string) {
  return {
    name: "实验记录导入",
    runtime: "opencode",
    mode: "vision",
    importId: confirm.importId,
    attemptId: confirm.attempt.id,
    requestHash: crypto.randomUUID(),
    endpoint: h.endpoint.baseUrl,
    phase,
    startedAt: new Date().toISOString(),
  };
}
