/**
 * Vision spike harness contract tests. These run against a fake runtime only:
 * they prove the harness can no longer report PASS without complete evidence.
 * Passing them never claims real Vision compatibility.
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
  runVisionSpike,
  sanitize,
  type VisionSpikeDependencies,
  type VisionSpikeOptions,
} from "./vision-spike";

type Mode =
  | "ideal"
  | "metadata-only-numbers"
  | "no-prompt-route"
  | "echo-only"
  | "stale-answer"
  | "sync-only"
  | "blocking"
  | "wrong-answer"
  | "other-session"
  | "leak-denied"
  | "permission-on-deny"
  | "wrong-directory"
  | "no-version"
  | "no-vision-model";

class FakeRuntime {
  server!: http.Server;
  baseUrl = "";
  mode: Mode = "ideal";
  sessions = new Map<string, any>();
  messages = new Map<string, any[]>();
  active = new Set<string>();
  permissions: any[] = [];
  paths: string[] = [];
  bodyKeys: string[][] = [];
  directories: (string | undefined)[] = [];
  authorizations: (string | undefined)[] = [];
  asyncPromptCalls = 0;
  syncPromptCalls = 0;
  requestCount = 0;
  allowMarker = "";
  denyMarker = "";
  /** Text seeded before any prompt, used by the "unrelated history" mode. */
  staleAnswer = "";
  serverCwd = "/tmp/opencode-server-cwd";
  private sequence = 0;

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

  private produce(sessionId: string, text: string) {
    const list = this.messages.get(sessionId) ?? [];
    list.push({
      info: {
        id: `msg_a_${++this.sequence}`,
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [{ type: "text", text }],
    });
    this.messages.set(sessionId, list);
  }

  private sendJson(
    response: http.ServerResponse,
    status: number,
    body?: unknown,
  ) {
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
    if (
      url.pathname.startsWith("/session") ||
      url.pathname.startsWith("/api/session")
    )
      if (!String(request.headers.authorization ?? "").startsWith("Basic "))
        return this.sendJson(response, 401, { error: "UNAUTHORIZED" });
    if (method === "POST" && url.pathname.startsWith("/api/session/"))
      return this.sendJson(response, 204);
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
        this.mode === "no-version"
          ? { healthy: true }
          : { healthy: true, version: "1.18.31" },
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
                ...(this.mode === "no-vision-model"
                  ? {}
                  : { capabilities: { attachment: true } }),
              },
            },
          },
        ],
      });
    if (method === "GET" && url.pathname === "/mcp") return send(200, {});
    if (method === "GET" && url.pathname === "/permission")
      return send(200, this.permissions);
    if (method === "GET" && url.pathname === "/session/status") {
      const data: Record<string, unknown> = {};
      for (const id of this.active) data[id] = { type: "busy" };
      return send(200, data);
    }
    if (method === "POST" && url.pathname === "/session") {
      const body = await readBody(request);
      const id = `ses_v1_${++this.sequence}`;
      this.sessions.set(id, {
        id,
        title: body.title,
        directory:
          this.mode === "wrong-directory"
            ? this.serverCwd
            : ((request.headers["x-opencode-directory"] as string) ??
              this.serverCwd),
      });
      this.messages.set(id, []);
      if (this.mode === "metadata-only-numbers")
        return send(200, {
          ...this.sessions.get(id),
          numbers: [3, 4, 5, 6, 7, 8],
        });
      if (this.mode === "stale-answer") this.produce(id, this.staleAnswer);
      return send(200, this.sessions.get(id));
    }
    if (
      method === "POST" &&
      segments[0] === "session" &&
      segments[2] === "prompt_async"
    ) {
      const sessionId = segments[1];
      if (
        this.mode === "no-prompt-route" ||
        this.mode === "metadata-only-numbers"
      )
        return send(404, { name: "NotFoundError" });
      if (this.mode === "sync-only")
        return send(500, { error: "SYNC_ONLY_RUNTIME" });
      this.asyncPromptCalls++;
      const body = await readBody(request);
      this.bodyKeys.push(Object.keys(body ?? {}));
      const parts = (body.parts ?? []) as any[];
      const text = String(parts.find((part) => part.type === "text")?.text ?? "");
      const image = parts.find((part) => part.type === "file");
      const list = this.messages.get(sessionId) ?? [];
      list.push({
        info: {
          id: body.messageID,
          role: "user",
          time: { created: Date.now() },
        },
        parts: body.parts,
      });
      this.messages.set(sessionId, list);
      let answer: number | undefined;
      if (image) {
        const decoded = Buffer.from(String(image.url).split(",")[1] ?? "", "base64");
        const raw = await sharp(decoded)
          .raw()
          .toBuffer({ resolveWithObject: true });
        answer = countRedRegions(raw.data, raw.info.width, raw.info.height);
      }
      const reply = image
        ? `${this.mode === "wrong-answer" ? (answer ?? 0) + 1 : answer}`
        : text.includes("读取文件")
          ? this.mode === "leak-denied"
            ? `文件内容是 ${this.denyMarker}`
            : "我没有权限读取该文件。"
          : this.allowMarker;
      if (this.mode === "blocking") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        this.produce(sessionId, reply);
        this.active.delete(sessionId);
        return send(204);
      }
      this.active.add(sessionId);
      if (this.mode === "echo-only" || this.mode === "stale-answer")
        return send(204);
      setTimeout(() => {
        this.produce(this.mode === "other-session" ? "ses_elsewhere" : sessionId, reply);
        this.active.delete(sessionId);
      }, 20);
      if (this.mode === "permission-on-deny" && text.includes("读取文件"))
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
    return send(404, { name: "NotFoundError" });
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
function tempRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/** The fixture count is fixed so an "old message" can carry the right answer. */
const staleAnswerCount = 5;
const staleAnswerText = `图中共有 ${staleAnswerCount} 个红色方块。`;

const fake = { current: undefined as FakeRuntime | undefined };
afterEach(async () => {
  await fake.current?.stop();
  fake.current = undefined;
});

interface Fixture {
  runtime: FakeRuntime;
  config: ResolvedOpenCodeConfig;
  deps: VisionSpikeDependencies;
  options: VisionSpikeOptions;
  executionDir: string;
  dataDir: string;
  denyFile: string;
  denyMarker: string;
}

async function fixture(mode: Mode = "ideal"): Promise<Fixture> {
  const staleAnswer = staleAnswerText;
  const runtime = await new FakeRuntime().start();
  runtime.mode = mode;
  fake.current = runtime;
  const dataDir = path.join(tempRoot("swb-spike-"), "scientific-data");
  const executionDir = path.join(tempRoot("swb-spike-"), "agent-execution");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(executionDir, { recursive: true });
  const denyDir = tempRoot("swb-spike-deny-");
  const denyFile = path.join(denyDir, "sentinel.txt");
  const denyMarker = `DENY-${crypto.randomUUID()}`;
  if (mode !== "leak-denied") fs.writeFileSync(denyFile, denyMarker);
  runtime.allowMarker = "《来源附件与实验记录协议》第 3 节";
  runtime.denyMarker = denyMarker;
  const config: ResolvedOpenCodeConfig = {
    baseUrl: runtime.baseUrl,
    username: "opencode",
    password: "spike-password",
    executionDir,
    permissionMode: "ask",
  };
  const adapter = new LegacyOpenCodeAdapter(config);
  runtime.staleAnswer = staleAnswer;
  const deps: VisionSpikeDependencies = {
    detectFlavor: () => detectOpenCodeFlavor(config),
    health: () => adapter.health(),
    listModels: () => adapter.listModels(),
    createSession: (input) => adapter.createSession(input),
    getSession: async (id) => {
      const session = await adapter.getSession(id);
      return session ? { id: session.id, directory: session.directory } : null;
    },
    getSessionStatuses: async () => {
      const statuses = await adapter.getSessionStatuses();
      return new Map([...statuses.entries()]);
    },
    getMessages: async (id) => {
      const messages = await adapter.getMessages(id);
      return messages.map((message) => ({
        id: message.id,
        role: message.role,
        created: message.created,
        text: message.text,
      }));
    },
    listPermissions: async (id) => {
      const permissions = await adapter.listPermissions(id);
      return permissions.map((permission) => ({
        id: permission.id,
        sessionId: permission.sessionId,
        action: permission.action,
      }));
    },
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
  const image = await makeCountImage(staleAnswerCount);
  const options: VisionSpikeOptions = {
    dataDir,
    executionDir,
    allowRealCalls: true,
    image: { png: image.png, count: 0 },
    timeoutMs: 1_200,
    asyncMaxMs: 250,
    secrets: ["spike-password"],
    allowProbe: { knowledgeId: "protocol-common", marker: runtime.allowMarker },
    denyProbe: { file: denyFile, marker: denyMarker },
  };
  // The harness must never learn the answer from anywhere but the pixels.
  const regions = await decodeRegions(image.png);
  options.image.count = regions;
  return {
    runtime,
    config,
    deps,
    options,
    executionDir,
    dataDir,
    denyFile,
    denyMarker,
  };
}

async function decodeRegions(png: Buffer) {
  const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return countRedRegions(raw.data, raw.info.width, raw.info.height);
}

describe("vision spike fixture", () => {
  it("draws independently countable shapes and never leaks the answer into text", async () => {
    const image = await makeCountImage(5);
    expect(await decodeRegions(image.png)).toBe(5);
    const raw = await sharp(image.png).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info.width).toBeGreaterThan(0);
    // The answer exists only in pixels: no digits in the file name, the buffer
    // and the encoded bytes carry no readable count.
    expect(image.png.toString("latin1")).not.toContain("5");
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
    expect(report.conclusion, JSON.stringify(report)).toBe("PASS");
    for (const check of Object.values(report.checks))
      expect(check.status).toBe("PASS");
    expect(report.transport?.endpoint).toContain("/prompt_async");
    expect(report.transport?.busyAtReturn).toBe(true);
    expect(runtime.asyncPromptCalls).toBe(3);
    expect(runtime.syncPromptCalls).toBe(0);
    // Authentication is present on every request, and every instance request is
    // routed to the dedicated agent directory.
    expect(runtime.authorizations.every((value) => value?.startsWith("Basic "))).toBe(true);
    const instanceRequests = runtime.paths.filter((value) =>
      value.startsWith("/session"),
    );
    expect(instanceRequests.length).toBeGreaterThan(0);
    for (const [index, value] of runtime.paths.entries())
      if (value.startsWith("/session"))
        expect(runtime.directories[index]).toBe(executionDir);
  });

  it("never passes on session metadata that contains every candidate number", async () => {
    const { runtime, deps, options } = await fixture("metadata-only-numbers");
    const report = await runVisionSpike(options, deps);
    expect(report.conclusion).not.toBe("PASS");
    expect(report.checks.correlatedImageAnswer.status).not.toBe("PASS");
    expect(runtime.asyncPromptCalls).toBe(0);
    expect(runtime.requestCount).toBeGreaterThan(0);
  });

  it("never passes when the prompt route does not exist", async () => {
    const { deps, options } = await fixture("no-prompt-route");
    const report = await runVisionSpike(options, deps);
    expect(report.conclusion).not.toBe("PASS");
  });

  it("never passes on a prompt echo that repeats the right number", async () => {
    const { deps, options } = await fixture("echo-only");
    const report = await runVisionSpike(options, deps);
    expect(report.conclusion).not.toBe("PASS");
    expect(report.checks.correlatedImageAnswer.status).toBe("NOT VERIFIED");
  });

  it("never passes on an unrelated earlier assistant message", async () => {
    const { deps, options } = await fixture("stale-answer");
    const report = await runVisionSpike(options, deps);
    expect(report.conclusion).not.toBe("PASS");
    expect(report.checks.correlatedImageAnswer.status).not.toBe("PASS");
  });

  it("fails the async check when the submission blocks until the answer", async () => {
    const { deps, options } = await fixture("blocking");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.asyncSubmission.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("fails when the answer is produced by another session", async () => {
    const { deps, options } = await fixture("other-session");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).not.toBe("PASS");
    expect(report.conclusion).not.toBe("PASS");
  });

  it("fails on a wrong pixel answer instead of degrading to unverified", async () => {
    const { deps, options } = await fixture("wrong-answer");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.correlatedImageAnswer.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("reports FAIL when the runtime cannot be identified", async () => {
    for (const mode of ["no-version", "no-vision-model"] as const) {
      const { deps, options } = await fixture(mode);
      const report = await runVisionSpike(options, deps);
      expect(report.checks.runtimeIdentityAndModel.status).toBe("FAIL");
      expect(report.conclusion).toBe("FAIL");
    }
  });

  it("fails isolation when the runtime reports a different instance directory", async () => {
    const { deps, options } = await fixture("wrong-directory");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.isolation.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("fails when the denied sentinel is actually readable", async () => {
    const { deps, options } = await fixture("leak-denied");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.restrictedDeny.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("fails when a permission is granted during the deny probe", async () => {
    const { deps, options } = await fixture("permission-on-deny");
    const report = await runVisionSpike(options, deps);
    expect(report.checks.restrictedDeny.status).toBe("FAIL");
    expect(report.conclusion).toBe("FAIL");
  });

  it("keeps payloads, credentials and workspace paths out of the evidence", async () => {
    const { deps, options, dataDir } = await fixture();
    const report = await runVisionSpike(options, deps);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(
      options.image.png.subarray(0, 48).toString("base64"),
    );
    expect(serialized).not.toContain("spike-password");
    expect(serialized).not.toContain(dataDir);
    expect(report.checks.noSensitiveWorkbenchLeakage.status).toBe("PASS");
    expect(sanitize("data:image/png;base64,AAAA", [])).not.toContain("AAAA");
    expect(sanitize("password=spike-password", ["spike-password"])).not.toContain(
      "spike-password",
    );
  });

  it("reports NOT VERIFIED for missing probe definitions instead of guessing", async () => {
    const { deps, options } = await fixture();
    const report = await runVisionSpike(
      { ...options, allowProbe: undefined, denyProbe: undefined },
      deps,
    );
    expect(report.conclusion).toBe("NOT VERIFIED");
  });
});

describe("experimental image transport contract", () => {
  it("uses the flavour-specific endpoint instead of always calling V1", async () => {
    const { runtime, config } = await fixture();
    expect(await detectOpenCodeFlavor(config)).toBe("v1");
    const result = await submitExperimentalImagePrompt(config, "v2", {
      sessionId: "ses_test",
      prompt: "ping",
      messageId: "msg_test",
      images: [],
    });
    expect(result.endpoint).toBe("/api/session/ses_test/prompt");
    expect(runtime.paths).toContain("/api/session/ses_test/prompt");
    expect(runtime.paths).not.toContain("/session/ses_test/prompt_async");
    expect(runtime.directories.at(-1)).toBe(config.executionDir);
    expect(result.requestKeys).toContain("parts");
  });

  it("fails closed with an authentication error instead of leaking secrets", async () => {
    const { runtime, config } = await fixture();
    const result = await submitExperimentalImagePrompt(config, "v1", {
      sessionId: "ses_test",
      prompt: "ping",
      messageId: "msg_test",
      images: [],
    });
    expect(result.status).toBe(204);
    expect(runtime.authorizations.at(-1)).toMatch(/^Basic /);
    // Without credentials the request must fail closed rather than succeed.
    const withoutCredentials = { ...config, password: undefined };
    await expect(
      submitExperimentalImagePrompt(withoutCredentials, "v1", {
        sessionId: "ses_test",
        prompt: "ping",
        messageId: "msg_test",
        images: [],
      }),
    ).rejects.toMatchObject({ code: "OPENCODE_AUTH_FAILED" });
    expect(runtime.authorizations.at(-1)).toBeUndefined();
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
  });
});
