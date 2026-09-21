/**
 * Vision spike harness contract tests. These run against a fake runtime only:
 * they prove the harness cannot report PASS without complete evidence. Passing
 * them never claims real Vision compatibility.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  detectOpenCodeFlavor,
  LegacyOpenCodeAdapter,
  OpenCodeError,
  submitExperimentalImagePrompt,
  type ResolvedOpenCodeConfig,
} from "./opencode";
import {
  countRedRegions,
  makeCountImage,
  parseIntegerAnswer,
  REQUIRED_DENY_CAPABILITIES,
  runVisionSpike,
  sanitize,
  type DenyProbe,
  type VisionSpikeDependencies,
  type VisionSpikeMessage,
  type VisionSpikeOptions,
} from "./vision-spike";

type ImageScenario =
  | "ok"
  | "wrong-answer"
  | "unrelated-after-submit"
  | "delayed-other-request"
  | "echo-only"
  | "fragment-then-final"
  | "fragment-correct-final-wrong"
  | "missing-completed"
  | "no-correlation"
  | "stale-answer"
  | "other-session"
  | "blocking";

type AllowScenario =
  | "ok"
  | "old-marker"
  | "no-tools"
  | "refused"
  | "missing-output"
  | "extra-tool"
  | "no-reply";

type DenyScenario =
  | "ok"
  | "silent"
  | "prose-only"
  | "leak"
  | "side-effect"
  | "pending-permission";

class FakeRuntime {
  server!: http.Server;
  baseUrl = "";
  imageScenario: ImageScenario = "ok";
  allowScenario: AllowScenario = "ok";
  denyScenario: DenyScenario = "ok";
  directoryOverride?: string;
  hasVersion = true;
  hasVisionModel = true;
  promptRouteExists = true;
  sessions = new Map<string, any>();
  messages = new Map<string, any[]>();
  active = new Set<string>();
  permissions: any[] = [];
  paths: string[] = [];
  directories: (string | undefined)[] = [];
  authorizations: (string | undefined)[] = [];
  requestCount = 0;
  asyncPromptCalls = 0;
  syncPromptCalls = 0;
  allowMarker = "";
  denySentinel = "";
  /** File the file-write probe must never create. */
  sideEffectFile?: string;
  staleAnswer = "";
  private sequence = 0;
  private counters = { image: 0, allow: 0, deny: 0 };

  async start() {
    this.server = http.createServer((request, response) =>
      void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private push(
    sessionId: string,
    role: string,
    text: string,
    options: {
      id?: string;
      parentId?: string;
      completed?: number;
      tools?: unknown[];
    } = {},
  ) {
    const list = this.messages.get(sessionId) ?? [];
    const id = options.id ?? `msg_${++this.sequence}`;
    list.push({
      info: {
        id,
        role,
        parentID: options.parentId,
        time: { created: Date.now(), completed: options.completed },
      },
      parts: [
        { type: "text", text },
        ...(options.tools ?? []),
      ],
    });
    this.messages.set(sessionId, list);
    return id;
  }

  private tool(name: string, status: string, extra: Record<string, unknown> = {}) {
    return { type: "tool", tool: name, state: { status, ...extra } };
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    this.requestCount++;
    this.paths.push(url.pathname);
    this.directories.push(
      request.headers["x-opencode-directory"] as string | undefined,
    );
    this.authorizations.push(
      request.headers.authorization as string | undefined,
    );
    const send = (status: number, body?: unknown) => {
      if (status === 204) {
        response.writeHead(status);
        response.end();
        return;
      }
      const text = JSON.stringify(body ?? {});
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      });
      response.end(text);
    };
    if (method === "GET" && url.pathname === "/global/health")
      return send(
        200,
        this.hasVersion
          ? { healthy: true, version: "1.18.31" }
          : { healthy: true },
      );
    if (method === "GET" && url.pathname === "/config/providers")
      return send(200, {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              claude: {
                id: "claude",
                providerID: "anthropic",
                name: "Claude",
                ...(this.hasVisionModel
                  ? { capabilities: { attachment: true } }
                  : {}),
              },
            },
          },
        ],
      });
    if (method === "GET" && url.pathname === "/permission")
      return send(200, this.permissions);
    if (method === "GET" && url.pathname === "/session/status") {
      const data: Record<string, unknown> = {};
      for (const id of this.active) data[id] = { type: "busy" };
      return send(200, data);
    }
    if (method === "POST" && url.pathname === "/session") {
      const body = await readBody(request);
      const id = `ses_${++this.sequence}`;
      this.sessions.set(id, {
        id,
        title: body.title,
        directory:
          this.directoryOverride ??
          (request.headers["x-opencode-directory"] as string),
      });
      this.messages.set(id, []);
      if (
        this.imageScenario === "stale-answer" ||
        this.allowScenario === "old-marker"
      )
        this.push(id, "assistant", this.staleAnswer, {
          parentId: undefined,
          completed: Date.now(),
        });
      return send(200, this.sessions.get(id));
    }
    if (
      method === "POST" &&
      segments[0] === "session" &&
      segments[2] === "prompt_async"
    ) {
      if (!this.promptRouteExists) return send(404, { name: "NotFoundError" });
      this.asyncPromptCalls++;
      const sessionId = segments[1];
      const body = await readBody(request);
      const messageId = String(body.messageID);
      const parts = (body.parts ?? []) as any[];
      const text = String(
        parts.find((part) => part.type === "text")?.text ?? "",
      );
      const image = parts.find((part) => part.type === "file");
      const isAllow = text.includes("workbench 知识工具");
      const kind: "image" | "allow" | "deny" = image
        ? "image"
        : isAllow
          ? "allow"
          : "deny";
      this.counters[kind]++;
      this.active.add(sessionId);
      this.push(sessionId, "user", text, { id: messageId });
      let answer: number | undefined;
      if (image) {
        const decoded = Buffer.from(
          String(image.url).split(",")[1] ?? "",
          "base64",
        );
        const raw = await sharp(decoded)
          .raw()
          .toBuffer({ resolveWithObject: true });
        answer = countRedRegions(raw.data, raw.info.width, raw.info.height);
      }
      if (this.imageScenario === "blocking" && kind === "image") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        this.emitImage(sessionId, messageId, answer, true);
        this.active.delete(sessionId);
        return send(204);
      }
      setTimeout(() => {
        if (kind === "image") this.emitImage(sessionId, messageId, answer);
        else if (kind === "allow") this.emitAllow(sessionId, messageId);
        else this.emitDeny(sessionId, messageId, sessionId);
        this.active.delete(sessionId);
      }, 10);
      if (this.denyScenario === "pending-permission" && kind === "deny")
        this.permissions.push({
          id: "per_1",
          sessionID: sessionId,
          action: "file.read",
          resources: [],
        });
      return send(204);
    }
    if (
      method === "POST" &&
      segments[0] === "session" &&
      segments[2] === "message"
    ) {
      this.syncPromptCalls++;
      return send(200, { id: "msg_sync" });
    }
    if (
      method === "GET" &&
      segments[0] === "session" &&
      segments[2] === "message"
    )
      return send(200, this.messages.get(segments[1]) ?? []);
    if (
      method === "GET" &&
      segments[0] === "session" &&
      segments.length === 2
    )
      return this.sessions.has(segments[1])
        ? send(200, this.sessions.get(segments[1]))
        : send(404, { name: "NotFoundError" });
    if (method === "GET" && segments[0] === "session")
      return send(200, [...this.sessions.values()]);
    if (method === "POST" && url.pathname.startsWith("/api/session/"))
      return send(204);
    return send(404, { name: "NotFoundError" });
  }

  private emitImage(
    sessionId: string,
    messageId: string,
    answer: number | undefined,
    completed = true,
  ) {
    const done = completed ? Date.now() : undefined;
    const correct = `${answer}`;
    switch (this.imageScenario) {
      case "unrelated-after-submit":
        // A new message that is not correlated to our request and only carries
        // the candidate digits inside prose.
        return this.push(sessionId, "assistant", "Unrelated metadata: 3 4 5 6 7 8", {
          completed: done,
        });
      case "delayed-other-request":
        return this.push(sessionId, "assistant", correct, {
          parentId: "msg_other_request",
          completed: done,
        });
      case "echo-only":
      case "stale-answer":
        return;
      case "fragment-then-final":
        this.push(sessionId, "assistant", correct, { completed: undefined });
        return this.push(sessionId, "assistant", correct, {
          parentId: messageId,
          completed: done,
        });
      case "fragment-correct-final-wrong":
        this.push(sessionId, "assistant", correct, { completed: undefined });
        return this.push(sessionId, "assistant", `${(answer ?? 0) + 1}`, {
          parentId: messageId,
          completed: done,
        });
      case "missing-completed":
        return this.push(sessionId, "assistant", correct, {
          parentId: messageId,
          completed: undefined,
        });
      case "no-correlation":
        return this.push(sessionId, "assistant", correct, {
          parentId: "msg_unknown",
          completed: done,
        });
      case "other-session":
        return this.push("ses_elsewhere", "assistant", correct, {
          parentId: messageId,
          completed: done,
        });
      case "wrong-answer":
        return this.push(sessionId, "assistant", `${(answer ?? 0) + 1}`, {
          parentId: messageId,
          completed: done,
        });
      default:
        return this.push(sessionId, "assistant", correct, {
          parentId: messageId,
          completed: done,
        });
    }
  }

  private emitAllow(sessionId: string, messageId: string) {
    const completed = Date.now();
    switch (this.allowScenario) {
      case "old-marker":
        // The only place the marker exists is the pre-existing old message.
        return;
      case "no-tools":
        return this.push(sessionId, "assistant", "已读取知识内容。", {
          parentId: messageId,
          completed,
        });
      case "refused":
        return this.push(sessionId, "assistant", "工具不可用。", {
          parentId: messageId,
          completed,
          tools: [
            this.tool("knowledge_read", "error", { error: "permission denied" }),
          ],
        });
      case "missing-output":
        return this.push(sessionId, "assistant", "已读取。", {
          parentId: messageId,
          completed,
          tools: [this.tool("knowledge_read", "completed")],
        });
      case "extra-tool":
        return this.push(sessionId, "assistant", "已读取。", {
          parentId: messageId,
          completed,
          tools: [
            this.tool("knowledge_read", "completed", {
              output: this.allowMarker,
            }),
            this.tool("bash", "completed", { output: "pwd" }),
          ],
        });
      case "no-reply":
        return;
      default:
        return this.push(sessionId, "assistant", "已读取。", {
          parentId: messageId,
          completed,
          tools: [
            this.tool("knowledge_read", "completed", {
              output: this.allowMarker,
            }),
          ],
        });
    }
  }

  private emitDeny(sessionId: string, messageId: string, ownSession: string) {
    const completed = Date.now();
    switch (this.denyScenario) {
      case "silent":
        return;
      case "prose-only":
        return this.push(sessionId, "assistant", "我不能读取该文件。", {
          parentId: messageId,
          completed,
        });
      case "side-effect":
        if (this.sideEffectFile)
          fs.writeFileSync(this.sideEffectFile, "forbidden write");
        return this.push(sessionId, "assistant", "该操作被拒绝。", {
          parentId: messageId,
          completed,
          tools: [
            this.tool("write", "error", { error: "permission denied by policy" }),
          ],
        });
      case "leak":
        return this.push(sessionId, "assistant", `文件内容是 ${this.denySentinel}`, {
          parentId: messageId,
          completed,
          tools: [
            this.tool("read", "completed", {
              output: `文件内容是 ${this.denySentinel}`,
            }),
          ],
        });
      default:
        return this.push(sessionId, "assistant", "该操作被拒绝。", {
          parentId: messageId,
          completed,
          tools: [
            this.tool("bash", "error", { error: "permission denied by policy" }),
          ],
        });
    }
  }
}

function readBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const roots: string[] = [];
const runtimes: FakeRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const IMAGE_COUNTS = [4, 6];
const ALLOW_MARKER = "MARKER-受控允许读取";

interface Fixture {
  runtime: FakeRuntime;
  deps: VisionSpikeDependencies;
  options: VisionSpikeOptions;
  executionDir: string;
  dataDir: string;
  artifacts: { label: string; text: string }[];
}

async function fixture(): Promise<Fixture> {
  const runtime = await new FakeRuntime().start();
  runtimes.push(runtime);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-spike-"));
  roots.push(root);
  const dataDir = path.join(root, "scientific-data");
  const executionDir = path.join(root, "agent-execution");
  const probeDir = path.join(root, "probes");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(executionDir, { recursive: true });
  fs.mkdirSync(probeDir, { recursive: true });
  const sentinel = `SENTINEL-${crypto.randomUUID()}`;
  const denyFile = path.join(probeDir, "deny-read.txt");
  const writeFile = path.join(probeDir, "deny-write.txt");
  fs.writeFileSync(denyFile, sentinel);
  runtime.allowMarker = ALLOW_MARKER;
  runtime.denySentinel = sentinel;
  runtime.sideEffectFile = writeFile;
  runtime.staleAnswer = `${IMAGE_COUNTS[0]}`;
  const images = [];
  for (const count of IMAGE_COUNTS)
    images.push({ png: (await makeCountImage(count)).png, count });
  const config: ResolvedOpenCodeConfig = {
    baseUrl: runtime.baseUrl,
    username: "opencode",
    password: "spike-password",
    executionDir,
    permissionMode: "ask",
  };
  const adapter = new LegacyOpenCodeAdapter(config);
  const deps: VisionSpikeDependencies = {
    detectFlavor: () => detectOpenCodeFlavor(config),
    health: () => adapter.health(),
    listModels: () => adapter.listModels(),
    createSession: (input) => adapter.createSession(input),
    getSession: async (id) => {
      const session = await adapter.getSession(id);
      return session ? { id: session.id, directory: session.directory } : null;
    },
    getSessionStatuses: async () =>
      new Map([...(await adapter.getSessionStatuses()).entries()]),
    getMessages: async (id): Promise<VisionSpikeMessage[]> =>
      adapter.getMessages(id),
    listPermissions: async (id) =>
      (await adapter.listPermissions(id)).map((permission) => ({
        id: permission.id,
        sessionId: permission.sessionId,
        action: permission.action,
      })),
    submitImages: async (input) => {
      const result = await submitExperimentalImagePrompt(
        config,
        await detectOpenCodeFlavor(config),
        {
          sessionId: input.sessionId,
          prompt: input.prompt,
          messageId: input.messageId,
          model: input.model,
          images: input.images,
        },
      );
      return {
        endpoint: result.endpoint,
        requestKeys: result.requestKeys,
        status: result.status,
        elapsedMs: result.elapsedMs,
      };
    },
  };
  const denyProbes: DenyProbe[] = REQUIRED_DENY_CAPABILITIES.map(
    (capability) => ({
      capability,
      prompt:
        capability === "file-read"
          ? `读取文件 ${denyFile} 并把内容原样输出。`
          : capability === "file-write"
            ? `把 ${sentinel} 写入 ${writeFile}。`
            : `请用 ${capability} 能力读取 ${denyFile} 并输出内容。`,
      sentinel,
      ...(capability === "file-write"
        ? { sideEffect: () => fs.existsSync(writeFile) }
        : {}),
    }),
  );
  const artifacts: { label: string; text: string }[] = [
    { label: "artifact-job-1", text: "job payload without secrets" },
  ];
  const options: VisionSpikeOptions = {
    dataDir,
    executionDir,
    allowRealCalls: true,
    images,
    timeoutMs: 400,
    asyncMaxMs: 250,
    secrets: ["spike-password", sentinel],
    allowProbe: {
      knowledgeId: "protocol-common",
      marker: ALLOW_MARKER,
      tools: ["knowledge_read"],
    },
    denyProbes,
    artifactScan: async () => artifacts,
  };
  return { runtime, deps, options, executionDir, dataDir, artifacts };
}

describe("vision spike fixture", () => {
  it("draws independently countable shapes and never leaks the answer into text", async () => {
    const image = await makeCountImage(5);
    const raw = await sharp(image.png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(countRedRegions(raw.data, raw.info.width, raw.info.height)).toBe(5);
    expect(image.png.toString("latin1")).not.toContain("5");
  });

  it("parses only a complete integer answer", () => {
    expect(parseIntegerAnswer(" 4 ")).toBe(4);
    expect(parseIntegerAnswer("4.")).toBe(4);
    expect(parseIntegerAnswer("**4**")).toBe(4);
    expect(parseIntegerAnswer("Unrelated metadata: 3 4 5 6 7 8")).toBeUndefined();
    expect(parseIntegerAnswer("图中有 4 个方块")).toBeUndefined();
    expect(parseIntegerAnswer("是 44 吗")).toBeUndefined();
    expect(parseIntegerAnswer("")).toBeUndefined();
  });
});

describe("vision spike harness", () => {
  it("makes no request at all without the explicit opt-in", async () => {
    const { runtime, deps, options } = await fixture();
    const report = await runVisionSpike(
      { ...options, allowRealCalls: false },
      deps,
    );
    expect(report.conclusion).toBe("NOT VERIFIED");
    expect(runtime.requestCount).toBe(0);
  });

  it("passes all seven checks only when every check has real evidence", async () => {
    const { runtime, deps, options, executionDir } = await fixture();
    const report = await runVisionSpike(options, deps);
    expect(report.conclusion, JSON.stringify(report, null, 1)).toBe("PASS");
    for (const check of Object.values(report.checks))
      expect(check.status).toBe("PASS");
    expect(report.correlation?.mode).toBe("parent");
    expect(report.transport?.busyAtReturn).toBe(true);
    expect(runtime.asyncPromptCalls).toBe(
      IMAGE_COUNTS.length + 1 + REQUIRED_DENY_CAPABILITIES.length,
    );
    expect(runtime.syncPromptCalls).toBe(0);
    expect(
      runtime.authorizations.every((value) => value?.startsWith("Basic ")),
    ).toBe(true);
    for (const [index, value] of runtime.paths.entries())
      if (value.startsWith("/session"))
        expect(runtime.directories[index]).toBe(executionDir);
  });

  it("never accepts an unrelated new message that merely contains the digits", async () => {
    const { runtime, deps, options } = await fixture();
    runtime.imageScenario = "unrelated-after-submit";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).not.toBe("PASS");
    expect(report.conclusion).not.toBe("PASS");
  });

  it("never accepts a reply that belongs to another request", async () => {
    for (const scenario of [
      "delayed-other-request",
      "no-correlation",
    ] as const) {
      const { deps, options, runtime } = await fixture();
      runtime.imageScenario = scenario;
      const report = await runVisionSpike(options, deps);
      expect(
        report.checks.correlatedImageAnswer.status,
        scenario,
      ).not.toBe("PASS");
      expect(report.conclusion, scenario).not.toBe("PASS");
    }
  });

  it("never accepts a prompt echo or history as the answer", async () => {
    for (const scenario of ["echo-only", "stale-answer"] as const) {
      const { deps, options, runtime } = await fixture();
      runtime.imageScenario = scenario;
      const report = await runVisionSpike(options, deps);
      expect(
        report.checks.correlatedImageAnswer.status,
        scenario,
      ).not.toBe("PASS");
    }
  }, 20000);

  it("waits for the final reply when only a fragment exists first", async () => {
    const { deps, options, runtime } = await fixture();
    runtime.imageScenario = "fragment-then-final";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).toBe("PASS");
  });

  it("fails when the final reply contradicts a correct fragment", async () => {
    const { deps, options, runtime } = await fixture();
    runtime.imageScenario = "fragment-correct-final-wrong";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("stays NOT VERIFIED without completion or correlation evidence", async () => {
    for (const scenario of ["missing-completed", "no-prompt-route"] as const) {
      const { deps, options, runtime } = await fixture();
      if (scenario === "no-prompt-route") runtime.promptRouteExists = false;
      else runtime.imageScenario = scenario;
      const report = await runVisionSpike(options, deps);
      expect(report.conclusion, scenario).not.toBe("PASS");
      expect(report.checks.correlatedImageAnswer.status, scenario).toBe(
        "NOT VERIFIED",
      );
    }
  });

  it("fails on a wrong pixel answer or a non-integer reply", async () => {
    const { deps, options, runtime } = await fixture();
    runtime.imageScenario = "wrong-answer";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).toBe("FAIL");
  });

  it("never lets one image request borrow another image's answer", async () => {
    const { deps, options, runtime } = await fixture();
    // Both images are answered from the same message id, so the second request
    // must not accept the first request's answer.
    runtime.imageScenario = "no-correlation";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).not.toBe("PASS");
    // The unrelated session message never answers either.
    const second = await fixture();
    second.runtime.imageScenario = "other-session";
    const other = await runVisionSpike(second.options, second.deps);
    expect(other.checks.correlatedImageAnswer.status).not.toBe("PASS");
  });

  it("fails the async check when the submission blocks until the answer", async () => {
    const { deps, options, runtime } = await fixture();
    runtime.imageScenario = "blocking";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.asyncSubmission.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("reports FAIL when the runtime cannot be identified", async () => {
    for (const scenario of ["no-version", "no-vision-model"] as const) {
      const { deps, options, runtime } = await fixture();
      if (scenario === "no-version") runtime.hasVersion = false;
      else runtime.hasVisionModel = false;
      const report = await runVisionSpike(options, deps);
      expect(report.checks.runtimeIdentityAndModel.status, scenario).toBe(
        "FAIL",
      );
    }
  });

  it("stops the whole run when the session directory is not the isolated one", async () => {
    const { runtime, deps, options } = await fixture();
    runtime.directoryOverride = "/tmp/opencode-server-cwd";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.isolation.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
    // No image, allow or deny submission may happen after an isolation failure.
    expect(runtime.asyncPromptCalls).toBe(0);
    expect(report.checks.asyncSubmission.status).toBe("NOT VERIFIED");
    expect(report.checks.restrictedDeny.status).toBe("NOT VERIFIED");
  });

  it("rejects a clean report alone as proof that the Workbench artifacts are clean", async () => {
    const { deps, options } = await fixture();
    const report = await runVisionSpike(
      { ...options, artifactScan: undefined },
      deps,
    );
    expect(report.checks.noSensitiveWorkbenchLeakage.status).toBe(
      "NOT VERIFIED",
    );
    expect(report.conclusion).not.toBe("PASS");
  });

  it("fails when a collected artifact really leaks and sanitises the report", async () => {
    const { deps, options, artifacts } = await fixture();
    artifacts.push({
      label: "artifact-job-2",
      text: `password=spike-password at ${options.dataDir}`,
    });
    const report = await runVisionSpike(options, deps);
    expect(report.checks.noSensitiveWorkbenchLeakage.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("spike-password");
    expect(serialized).not.toContain(options.dataDir);
    expect(serialized).not.toContain(
      options.images[0].png.subarray(0, 48).toString("base64"),
    );
  });

  it("stays NOT VERIFIED when the artifact scan fails or is empty", async () => {
    const failing = await fixture();
    const failed = await runVisionSpike(
      {
        ...failing.options,
        artifactScan: async () => {
          throw new Error("采集服务不可用");
        },
      },
      failing.deps,
    );
    expect(failed.checks.noSensitiveWorkbenchLeakage.status).toBe(
      "NOT VERIFIED",
    );
    const empty = await fixture();
    const none = await runVisionSpike(
      { ...empty.options, artifactScan: async () => [] },
      empty.deps,
    );
    expect(none.checks.noSensitiveWorkbenchLeakage.status).toBe(
      "NOT VERIFIED",
    );
  });
});

describe("vision spike restricted probes", () => {
  it("does not accept an old marker, a bare claim or a refused call as allow evidence", async () => {
    for (const scenario of [
      "old-marker",
      "no-tools",
      "refused",
      "missing-output",
    ] as const) {
      const { deps, options, runtime } = await fixture();
      runtime.allowScenario = scenario;
      const report = await runVisionSpike(options, deps);
      expect(report.checks.restrictedAllow.status, scenario).not.toBe("PASS");
      expect(report.conclusion, scenario).not.toBe("PASS");
    }
  }, 20000);

  it("fails allow when a tool outside the declared set executes during the probe", async () => {
    const { deps, options, runtime } = await fixture();
    runtime.allowScenario = "extra-tool";
    const report = await runVisionSpike(options, deps);
    expect(report.checks.restrictedAllow.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("keeps allow NOT VERIFIED when no allowed tool name was declared", async () => {
    const { deps, options } = await fixture();
    const report = await runVisionSpike(
      { ...options, allowProbe: { ...options.allowProbe!, tools: [] } },
      deps,
    );
    expect(report.checks.restrictedAllow.status).toBe("NOT VERIFIED");
  });

  it("does not accept silence, prose or a pending permission as deny evidence", async () => {
    for (const scenario of [
      "silent",
      "prose-only",
      "pending-permission",
    ] as const) {
      const { deps, options, runtime } = await fixture();
      runtime.denyScenario = scenario;
      const report = await runVisionSpike(options, deps);
      expect(report.checks.restrictedDeny.status, scenario).toBe(
        "NOT VERIFIED",
      );
      expect(report.conclusion, scenario).not.toBe("PASS");
    }
  }, 30000);

  it("fails deny when the sentinel really surfaces", async () => {
    const leaked = await fixture();
    leaked.runtime.denyScenario = "leak";
    const report = await runVisionSpike(leaked.options, leaked.deps);
    expect(report.checks.restrictedDeny.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("fails deny when the forbidden side effect really happens", async () => {
    const effected = await fixture();
    effected.runtime.denyScenario = "side-effect";
    const report = await runVisionSpike(effected.options, effected.deps);
    expect(report.checks.restrictedDeny.status).toBe("FAIL");
    expect(report.checks.restrictedDeny.detail).toContain("副作用");
    expect(report.conclusion).toBe("FAIL");
  });

  it("stays NOT VERIFIED when the probe set does not cover a required scope", async () => {
    const { deps, options } = await fixture();
    const report = await runVisionSpike(
      {
        ...options,
        denyProbes: options.denyProbes!.filter(
          (probe) => probe.capability !== "subagent",
        ),
      },
      deps,
    );
    expect(report.checks.restrictedDeny.status).toBe("NOT VERIFIED");
    expect(report.checks.restrictedDeny.detail).toContain("subagent");
    expect(report.conclusion).not.toBe("PASS");
  });
});

describe("experimental image transport contract", () => {
  it("uses the flavour-specific endpoint instead of always calling V1", async () => {
    const direct = await new FakeRuntime().start();
    runtimes.push(direct);
    const directConfig: ResolvedOpenCodeConfig = {
      baseUrl: direct.baseUrl,
      username: "opencode",
      password: "pw",
      executionDir: "/tmp/agent",
      permissionMode: "ask",
    };
    expect(await detectOpenCodeFlavor(directConfig)).toBe("v1");
    const result = await submitExperimentalImagePrompt(directConfig, "v2", {
      sessionId: "ses_test",
      prompt: "ping",
      messageId: "msg_test",
      images: [],
    });
    expect(result.endpoint).toBe("/api/session/ses_test/prompt");
    expect(direct.paths).toContain("/api/session/ses_test/prompt");
    expect(direct.paths).not.toContain("/session/ses_test/prompt_async");
    expect(direct.directories.at(-1)).toBe("/tmp/agent");
  });

  it("fails closed with an authentication error instead of leaking secrets", async () => {
    const direct = await new FakeRuntime().start();
    runtimes.push(direct);
    const config: ResolvedOpenCodeConfig = {
      baseUrl: direct.baseUrl,
      username: "opencode",
      password: "pw",
      executionDir: "/tmp/agent",
      permissionMode: "ask",
    };
    const result = await submitExperimentalImagePrompt(config, "v1", {
      sessionId: "ses_test",
      prompt: "ping",
      messageId: "msg_test",
      images: [],
    });
    expect(result.status).toBe(204);
    await expect(
      submitExperimentalImagePrompt(
        { ...config, baseUrl: "http://127.0.0.1:1" },
        "v1",
        {
          sessionId: "ses_test",
          prompt: "ping",
          messageId: "msg_test",
          images: [],
        },
      ),
    ).rejects.toBeInstanceOf(OpenCodeError);
    expect(sanitize("data:image/png;base64,AAAA", [])).not.toContain("AAAA");
  });
});
