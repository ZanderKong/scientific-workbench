import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import unzipper from "unzipper";
import type { AddressInfo } from "node:net";
import { operations } from "@workbench/core";
import { WorkbenchStore } from "./store";
import { createCompleteBackup } from "./backup";
import {
  LegacyOpenCodeAdapter,
  OpenCodeHttpAdapter,
  OpenCodeError,
  assertSeparateDirectories,
  createOpenCodeAdapter,
  defaultOpenCodeConfig,
  deleteOpenCodeCredential,
  detectOpenCodeFlavor,
  ensureExecutionDirectory,
  hasOpenCodeCredential,
  readOpenCodeCredential,
  resolveOpenCodeConfig,
  saveOpenCodeCredential,
  validateOpenCodeBaseUrl,
} from "./opencode";

interface FakeOptions {
  password?: string;
  sessions?: Map<string, any>;
  permissions?: any[];
  forms?: any[];
  messages?: Map<string, any[]>;
  models?: any[];
  mcp?: any[];
}

class FakeOpenCode {
  server!: http.Server;
  baseUrl = "";
  headers: http.IncomingHttpHeaders[] = [];
  requests: { method: string; path: string }[] = [];
  sessions = new Map<string, any>();
  permissions: any[] = [];
  forms: any[] = [];
  messages = new Map<string, any[]>();
  events: any[] = [];
  streams = new Set<http.ServerResponse>();
  models = [
    {
      id: "anthropic/claude",
      modelID: "claude",
      providerID: "anthropic",
      name: "Claude",
      enabled: true,
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    },
    {
      id: "openai/gpt",
      modelID: "gpt",
      providerID: "openai",
      name: "GPT",
      enabled: false,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
    },
  ];
  mcp = [
    { name: "scientific-workbench", status: { status: "connected" } },
    { name: "other", status: { status: "failed", error: "boom" } },
  ];
  password?: string;

  async start(options: FakeOptions = {}) {
    this.password = options.password;
    this.server = http.createServer((request, response) =>
      this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this;
  }

  async stop() {
    for (const stream of this.streams) stream.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  emit(event: unknown) {
    this.events.push(event);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of this.streams) stream.write(payload);
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    this.requests.push({ method: request.method ?? "", path: url.pathname });
    this.headers.push(request.headers);
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
    if (this.password) {
      const expected = `Basic ${Buffer.from(
        `opencode:${this.password}`,
      ).toString("base64")}`;
      if (request.headers.authorization !== expected)
        return send(401, { _tag: "UnauthorizedError", message: "unauthorized" });
    }
    const method = request.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    if (method === "GET" && url.pathname === "/api/info")
      return send(200, {
        version: "1.18.31",
        pid: 1,
        urls: [this.baseUrl],
        paths: { tmp: "/tmp" },
      });
    if (method === "GET" && url.pathname === "/api/model")
      return send(200, {
        location: { directory: "/agent" },
        data: this.models,
      });
    if (method === "GET" && url.pathname === "/api/mcp")
      return send(200, {
        location: { directory: "/agent" },
        data: this.mcp,
      });
    if (method === "GET" && url.pathname === "/api/session/active") {
      const data: Record<string, unknown> = {};
      for (const session of this.sessions.values())
        if (session.active) data[session.id] = { type: "running" };
      return send(200, { data });
    }
    if (method === "POST" && url.pathname === "/api/session") {
      readBody(request).then((body) => {
        const id = `session-${this.sessions.size + 1}`;
        const session = {
          id,
          title: body.title,
          parentID: undefined,
          location: { directory: body.location?.directory ?? "/agent" },
          active: false,
        };
        this.sessions.set(id, session);
        send(200, { data: session });
      });
      return;
    }
    if (parts[1] === "session" && parts[2] && parts[3] === "prompt") {
      readBody(request).then((body) => {
        const session = this.sessions.get(parts[2]);
        if (!session) return send(404, { _tag: "SessionNotFoundError" });
        session.active = true;
        const inbox = {
          id: body.id ?? `user-${Date.now()}`,
          sessionID: parts[2],
          time: { created: Date.now() },
          type: "user",
          payload: { text: body.text },
          delivery: "queue",
        };
        const list = this.messages.get(parts[2]) ?? [];
        list.push({
          id: inbox.id,
          type: "user",
          text: body.text,
          time: { created: inbox.time.created },
        });
        this.messages.set(parts[2], list);
        send(200, { data: inbox });
      });
      return;
    }
    if (parts[1] === "session" && parts[2] && parts[3] === "interrupt") {
      const session = this.sessions.get(parts[2]);
      if (session) {
        session.active = false;
        session.interrupted = true;
      }
      return send(200, { interrupted: true });
    }
    if (
      parts[1] === "session" &&
      parts[2] &&
      parts[3] === "message" &&
      method === "GET"
    ) {
      const list = this.messages.get(parts[2]);
      if (!list) return send(404, { _tag: "SessionNotFoundError" });
      return send(200, { data: list, cursor: { next: null } });
    }
    if (
      parts[1] === "session" &&
      parts[2] &&
      parts[3] === "permission" &&
      method === "GET"
    )
      return send(200, {
        data: this.permissions.filter((p) => p.sessionID === parts[2]),
      });
    if (
      parts[1] === "session" &&
      parts[2] &&
      parts[3] === "permission" &&
      parts[4] &&
      parts[5] === "reply"
    ) {
      readBody(request).then((body) => {
        const index = this.permissions.findIndex((p) => p.id === parts[4]);
        if (index < 0) return send(404, { _tag: "PermissionNotFoundError" });
        const [removed] = this.permissions.splice(index, 1);
        this.emit({
          type: "permission.replied",
          data: {
            sessionID: parts[2],
            requestID: removed.id,
            reply: body.decision,
          },
        });
        send(204);
      });
      return;
    }
    if (
      parts[1] === "session" &&
      parts[2] &&
      parts[3] === "form" &&
      method === "GET"
    )
      return send(200, {
        data: this.forms.filter((f) => f.sessionID === parts[2]),
      });
    if (method === "GET" && url.pathname === "/api/permission/request")
      return send(200, {
        location: { directory: "/agent" },
        data: this.permissions,
      });
    if (method === "GET" && url.pathname === "/api/event") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "server.connected" })}\n\n`);
      this.streams.add(response);
      request.on("close", () => this.streams.delete(response));
      return;
    }
    if (parts[1] === "session" && parts[2] && method === "GET") {
      const session = this.sessions.get(parts[2]);
      return session
        ? send(200, { data: session })
        : send(404, { _tag: "SessionNotFoundError", message: "not found" });
    }
    return send(404, { _tag: "NotFound", message: url.pathname });
  }
}

function readBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
  });
}

let fake: FakeOpenCode;
let dataDir: string;

beforeEach(async () => {
  fake = await new FakeOpenCode().start();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-opencode-"));
});
afterEach(async () => {
  await fake.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function adapter(overrides: Record<string, unknown> = {}) {
  return new OpenCodeHttpAdapter({
    ...defaultOpenCodeConfig(path.join(dataDir, "ScientificWorkbench")),
    baseUrl: fake.baseUrl,
    executionDir: path.join(dataDir, "ScientificWorkbench-Agent"),
    ...overrides,
  });
}

describe("OpenCode adapter", () => {
  it("only accepts loopback http(s) URLs and strips trailing slashes", () => {
    expect(validateOpenCodeBaseUrl("http://127.0.0.1:49374/")).toBe(
      "http://127.0.0.1:49374",
    );
    expect(validateOpenCodeBaseUrl("http://localhost:4096")).toBe(
      "http://localhost:4096",
    );
    for (const bad of [
      "",
      "ftp://127.0.0.1:1",
      "http://192.168.1.5:4096",
      "http://example.com",
      "http://user:pass@127.0.0.1:4096",
      "http://127.0.0.1:4096/?a=1",
      "http://127.0.0.1:4096/path",
    ])
      expect(() => validateOpenCodeBaseUrl(bad)).toThrow(OpenCodeError);
  });

  it("rejects overlapping data and execution directories", () => {
    const data = path.join(dataDir, "ScientificWorkbench");
    fs.mkdirSync(data, { recursive: true });
    expect(() => assertSeparateDirectories(data, data)).toThrow(
      /完全分离/,
    );
    expect(() =>
      assertSeparateDirectories(data, path.join(data, "agent")),
    ).toThrow(/完全分离/);
    expect(() =>
      assertSeparateDirectories(data, path.dirname(data)),
    ).toThrow(/完全分离/);
    const sibling = path.join(dataDir, "ScientificWorkbench-Agent");
    expect(assertSeparateDirectories(data, sibling)).toBe(sibling);
  });

  it("stores credentials at 0600 and resolves them", () => {
    const id = saveOpenCodeCredential(dataDir, "s3cret");
    const file = path.join(dataDir, "private", `opencode-${id}.json`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(hasOpenCodeCredential(dataDir, id)).toBe(true);
    expect(readOpenCodeCredential(dataDir, id)).toBe("s3cret");
    const resolved = resolveOpenCodeConfig(dataDir, {
      credentialId: id,
    });
    expect(resolved.password).toBe("s3cret");
    deleteOpenCodeCredential(dataDir, id);
    expect(hasOpenCodeCredential(dataDir, id)).toBe(false);
  });

  it("reports health, models, mcp and sends Basic auth on every request", async () => {
    await fake.stop();
    fake = await new FakeOpenCode().start({ password: "pw" });
    const client = adapter({ password: "pw" });
    expect(await client.health()).toMatchObject({ ok: true });
    const models = await client.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      providerId: "anthropic",
      modelId: "claude",
      supportsImage: true,
      available: true,
    });
    expect(models[1].supportsImage).toBe(false);
    expect(await client.getMcpStatus()).toEqual({ state: "connected" });
    expect(
      fake.headers.every(
        (headers) =>
          headers.authorization ===
          `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
      ),
    ).toBe(true);
  });

  it("creates a session, submits a prompt and keeps the prompt message id", async () => {
    const client = adapter();
    const { id } = await client.createSession({
      title: "分析 Sample S-031",
      directory: path.join(dataDir, "agent"),
    });
    expect(id).toBeTruthy();
    const { promptMessageId } = await client.submitPrompt({
      sessionId: id,
      directory: path.join(dataDir, "agent"),
      prompt: "请分析",
      messageId: "11111111-1111-4111-8111-111111111111",
    });
    expect(promptMessageId).toBe("11111111-1111-4111-8111-111111111111");
    const messages = await client.getMessages(id);
    expect(messages[0]).toMatchObject({ role: "user", text: "请分析" });
    await client.abortSession(id);
    expect(fake.sessions.get(id).interrupted).toBe(true);
  });

  it("does not keep stale busy sessions in the V2 active snapshot", async () => {
    const client = adapter();
    const { id } = await client.createSession({
      title: "状态",
      directory: path.join(dataDir, "agent"),
    });
    fake.sessions.get(id).active = true;
    let statuses = await client.getSessionStatuses();
    expect(statuses.get(id)).toBe("busy");
    // Missing from the authoritative active snapshot: no stale busy.
    fake.sessions.get(id).active = false;
    statuses = await client.getSessionStatuses();
    expect(statuses.has(id)).toBe(false);
  });

  it("lists and replies permissions with once, and lists questions", async () => {
    const client = adapter();
    const { id } = await client.createSession({ title: "t", directory: "/a" });
    fake.permissions.push({
      id: "perm-1",
      sessionID: id,
      action: "shell",
      resources: ["python analyse.py"],
    });
    fake.forms.push({ id: "form-1", sessionID: id, title: "选择参数" });
    const permissions = await client.listPermissions(id);
    expect(permissions[0]).toMatchObject({
      id: "perm-1",
      action: "shell",
      summary: "shell：python analyse.py",
    });
    await client.replyPermission({
      sessionId: id,
      permissionId: "perm-1",
      response: "once",
    });
    expect(fake.permissions).toHaveLength(0);
    const questions = await client.listQuestions(id);
    expect(questions[0]).toMatchObject({ id: "form-1", summary: "选择参数" });
  });

  it("subscribes to live events and normalizes them", async () => {
    const client = adapter();
    const received: unknown[] = [];
    const controller = new AbortController();
    const subscription = client.subscribeEvents(
      (event) => received.push(event),
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    fake.emit({
      type: "session.status",
      data: { sessionID: "session-1", status: { type: "busy" } },
    });
    fake.emit({
      type: "permission.asked",
      data: {
        id: "perm-1",
        sessionID: "session-1",
        action: "edit",
        resources: ["/a"],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await subscription;
    expect(received).toEqual([
      { type: "session.status", sessionId: "session-1", status: "busy" },
      {
        type: "permission.asked",
        sessionId: "session-1",
        permissionId: "perm-1",
      },
    ]);
  });

  it("builds a server-scoped session deep link without secrets", async () => {
    const client = adapter();
    const url = client.buildSessionUrl("session-abc");
    expect(url.startsWith(`${fake.baseUrl}/server/`)).toBe(true);
    expect(url.endsWith("/session/session-abc")).toBe(true);
    expect(url).not.toContain("pw");
    expect(() => new URL(url)).not.toThrow();
  });

  it("reports unreachable and auth failures with normalized codes", async () => {
    const offline = new OpenCodeHttpAdapter({
      ...defaultOpenCodeConfig(path.join(dataDir, "ws")),
      baseUrl: "http://127.0.0.1:1",
      executionDir: path.join(dataDir, "agent"),
    });
    await expect(offline.health()).rejects.toMatchObject({
      code: "OPENCODE_UNREACHABLE",
    });
    await fake.stop();
    fake = await new FakeOpenCode().start({ password: "right" });
    const wrong = adapter({ password: "wrong" });
    await expect(wrong.health()).rejects.toMatchObject({
      code: "OPENCODE_AUTH_FAILED",
    });
  });

  it("creates the execution directory with owner-only mode", () => {
    const target = path.join(dataDir, "agent-dir");
    ensureExecutionDirectory(target);
    expect(fs.statSync(target).mode & 0o777).toBe(0o700);
  });

  it("never exposes the agent runtime through the shared MCP operations", () => {
    const paths = operations.map((operation) => operation.path.toLowerCase());
    expect(paths.some((value) => /agent|opencode/.test(value))).toBe(false);
    const names = operations.map((operation) => operation.name ?? "");
    expect(names.some((value) => /agent|opencode/i.test(value))).toBe(false);
  });

  it("excludes the OpenCode credential from complete backups", async () => {
    const store = new WorkbenchStore({ dataDir });
    try {
      const credentialId = saveOpenCodeCredential(dataDir, "backup-secret");
      store.saveSetting("opencode", {
        baseUrl: "http://127.0.0.1:49374",
        username: "opencode",
        executionDir: path.join(path.dirname(dataDir), "agent"),
        permissionMode: "ask",
        credentialId,
      });
      const backup = await createCompleteBackup(
        store,
        async () => {
          throw new Error("no remote attachments expected");
        },
      );
      const archive = await unzipper.Open.file(backup.file);
      const names = archive.files.map((entry) => entry.path);
      expect(names.some((name) => name.startsWith("private/"))).toBe(false);
      expect(names.some((name) => name.includes("opencode-"))).toBe(false);
      const settingsEntry = archive.files.find(
        (entry) => entry.path === "registry/settings.json",
      );
      const content = await settingsEntry!.buffer();
      expect(content.toString("utf8")).not.toContain("backup-secret");
    } finally {
      store.close();
    }
  });
});

class FakeV1 {
  server!: http.Server;
  baseUrl = "";
  sessions = new Map<string, any>();
  messages = new Map<string, any[]>();
  permissions: any[] = [];
  questions: any[] = [];
  replies: { sessionID: string; requestID: string; response: string }[] = [];
  asyncPromptCalls = 0;
  syncPromptCalls = 0;
  providers = [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        claude: {
          id: "claude",
          providerID: "anthropic",
          name: "Claude",
          capabilities: { attachment: true },
        },
        gpt: {
          id: "gpt",
          providerID: "anthropic",
          name: "GPT",
          capabilities: { attachment: false },
        },
        unknown: {
          id: "unknown",
          providerID: "anthropic",
          name: "Unknown",
        },
      },
    },
  ];
  mcp: Record<string, any> = {
    "scientific-workbench": { status: "connected" },
  };
  requestDirectories: { path: string; directory?: string }[] = [];
  serverCwd = "/tmp/opencode-server-cwd";
  active = new Set<string>();
  private sequence = 0;

  async start() {
    this.server = http.createServer((request, response) =>
      this.handle(request, response),
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

  private handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    const directory = request.headers["x-opencode-directory"] as
      | string
      | undefined;
    this.requestDirectories.push({ path: url.pathname, directory });
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
      return send(200, { healthy: true, version: "1.18.31" });
    if (method === "GET" && url.pathname === "/config/providers")
      return send(200, { providers: this.providers, default: {} });
    if (method === "GET" && url.pathname === "/mcp") return send(200, this.mcp);
    if (method === "GET" && url.pathname === "/event") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      request.on("close", () => response.end());
      return;
    }
    if (method === "GET" && url.pathname === "/permission")
      return send(200, this.permissions);
    if (method === "GET" && url.pathname === "/question")
      return send(200, this.questions);
    if (method === "GET" && url.pathname === "/session/status") {
      const data: Record<string, unknown> = {};
      for (const id of this.active) data[id] = { type: "busy" };
      return send(200, data);
    }
    if (method === "POST" && url.pathname === "/session") {
      readBody(request).then((body) => {
        const id = `ses_v1_${++this.sequence}`;
        // `body.directory` is deliberately ignored: legacy routing is header-only.
        this.sessions.set(id, {
          id,
          title: body.title,
          directory: directory ?? this.serverCwd,
        });
        this.messages.set(id, []);
        send(200, { ...this.sessions.get(id), bodyDirectory: body.directory });
      });
      return;
    }
    if (
      method === "POST" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "prompt_async"
    ) {
      this.asyncPromptCalls += 1;
      readBody(request).then((body) => {
        this.active.add(parts[1]);
        const list = this.messages.get(parts[1]) ?? [];
        list.push({
          info: {
            id: body.messageID,
            role: "user",
            sessionID: parts[1],
            time: { created: 1 },
          },
          parts: body.parts,
        });
        this.messages.set(parts[1], list);
        send(204);
      });
      return;
    }
    if (
      method === "POST" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "message"
    ) {
      this.syncPromptCalls += 1;
      return send(500, { error: "SYNC_PROMPT_NOT_ALLOWED_IN_TEST" });
    }
    if (
      method === "POST" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "permissions" &&
      parts[3]
    ) {
      readBody(request).then((body) => {
        const index = this.permissions.findIndex((p) => p.id === parts[3]);
        if (index < 0) return send(404, { name: "NotFoundError" });
        this.permissions.splice(index, 1);
        this.replies.push({
          sessionID: parts[1],
          requestID: parts[3],
          response: body.response,
        });
        send(204);
      });
      return;
    }
    if (
      method === "POST" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "abort"
    ) {
      this.active.delete(parts[1]);
      return send(204);
    }
    if (
      method === "GET" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "message"
    )
      return send(200, this.messages.get(parts[1]) ?? []);
    if (
      method === "GET" &&
      parts[0] === "session" &&
      parts[1] &&
      parts.length === 2
    )
      return this.sessions.has(parts[1])
        ? send(200, this.sessions.get(parts[1]))
        : send(404, { name: "NotFoundError" });
    return send(404, { name: "NotFoundError" });
  }
}

function v1Adapter(fake: FakeV1) {
  return new LegacyOpenCodeAdapter({
    ...defaultOpenCodeConfig(path.join(dataDir, "ws")),
    baseUrl: fake.baseUrl,
    executionDir: path.join(dataDir, "agent"),
  });
}

describe("Legacy OpenCode V1 adapter", () => {
  it("detects the legacy flavor and reports health, models and MCP", async () => {
    const v1 = await new FakeV1().start();
    try {
      const config = {
        ...defaultOpenCodeConfig(path.join(dataDir, "ws")),
        baseUrl: v1.baseUrl,
        executionDir: path.join(dataDir, "agent"),
      };
      expect(await detectOpenCodeFlavor(config)).toBe("v1");
      const adapter = v1Adapter(v1);
      expect(await adapter.health()).toMatchObject({
        ok: true,
        version: "1.18.31",
      });
      const models = await adapter.listModels();
      expect(models).toHaveLength(3);
      expect(
        models.find((model) => model.modelId === "claude")?.supportsImage,
      ).toBe(true);
      expect(
        models.find((model) => model.modelId === "gpt")?.supportsImage,
      ).toBe(false);
      expect(
        models.find((model) => model.modelId === "unknown")?.supportsImage,
      ).toBe("unknown");
      expect(await adapter.getMcpStatus()).toEqual({ state: "connected" });
    } finally {
      await v1.stop();
    }
  });

  it("submits prompts through prompt_async and never the blocking endpoint", async () => {
    const v1 = await new FakeV1().start();
    try {
      const adapter = v1Adapter(v1);
      const { id } = await adapter.createSession({
        title: "异步任务",
        directory: path.join(dataDir, "agent"),
      });
      const { promptMessageId } = await adapter.submitPrompt({
        sessionId: id,
        directory: path.join(dataDir, "agent"),
        prompt: "请分析",
        messageId: "11111111-1111-4111-8111-111111111111",
      });
      expect(promptMessageId.startsWith("msg_")).toBe(true);
      expect(v1.asyncPromptCalls).toBe(1);
      expect(v1.syncPromptCalls).toBe(0);
      const messages = await adapter.getMessages(id);
      expect(messages[0]).toMatchObject({
        id: promptMessageId,
        role: "user",
        text: "请分析",
      });
    } finally {
      await v1.stop();
    }
  });

  it("routes instance requests to executionDir and ignores a body directory", async () => {
    const v1 = await new FakeV1().start();
    try {
      const executionDir = path.join(dataDir, "agent");
      const adapter = v1Adapter(v1);
      const { id } = await adapter.createSession({
        title: "路由任务",
        directory: executionDir,
      });
      // Legacy routing is header-only; the session records the header value and
      // never the (unsupported) body directory.
      expect(v1.sessions.get(id).directory).toBe(executionDir);
      expect(v1.sessions.get(id).directory).not.toBe(v1.serverCwd);
      expect(v1.sessions.get(id).bodyDirectory).toBeUndefined();

      await adapter.getSessionStatuses();
      await adapter.getMcpStatus();
      const controller = new AbortController();
      const subscription = adapter.subscribeEvents(() => {}, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.abort();
      await subscription;

      for (const endpoint of ["/session", "/session/status", "/mcp", "/event"]) {
        const entry = v1.requestDirectories.find(
          (request) => request.path === endpoint,
        );
        expect(entry, `missing request for ${endpoint}`).toBeTruthy();
        expect(entry?.directory, `${endpoint} directory`).toBe(executionDir);
      }
    } finally {
      await v1.stop();
    }
  });

  it("treats /session/status as an authoritative snapshot without stale busy", async () => {
    const v1 = await new FakeV1().start();
    try {
      const adapter = v1Adapter(v1);
      const { id } = await adapter.createSession({
        title: "状态任务",
        directory: path.join(dataDir, "agent"),
      });
      v1.active.add(id);
      const busy = await adapter.getSessionStatuses();
      expect(busy.get(id)).toBe("busy");
      // Idle event lost: the session leaves the status snapshot and must not
      // linger as busy from the cached merge.
      v1.active.delete(id);
      const idle = await adapter.getSessionStatuses();
      expect(idle.has(id)).toBe(false);
    } finally {
      await v1.stop();
    }
  });

  it("sorts messages, replies permissions with once and lists questions", async () => {
    const v1 = await new FakeV1().start();
    try {
      const adapter = v1Adapter(v1);
      const { id } = await adapter.createSession({
        title: "t",
        directory: path.join(dataDir, "agent"),
      });
      v1.messages.set(id, [
        {
          info: {
            id: "msg_b",
            role: "assistant",
            sessionID: id,
            time: { created: 2, completed: 3 },
          },
          parts: [{ type: "text", text: "done" }],
        },
        {
          info: {
            id: "msg_a",
            role: "user",
            sessionID: id,
            time: { created: 1 },
          },
          parts: [{ type: "text", text: "hi" }],
        },
      ]);
      const messages = await adapter.getMessages(id);
      expect(messages.map((message) => message.id)).toEqual(["msg_a", "msg_b"]);
      expect(messages[1].completed).toBe(3);
      v1.permissions.push({
        id: "perm-1",
        sessionID: id,
        permission: "shell",
        patterns: ["python analyse.py"],
        title: "shell",
      });
      const permissions = await adapter.listPermissions(id);
      expect(permissions[0]).toMatchObject({
        id: "perm-1",
        summary: "shell：python analyse.py",
      });
      await adapter.replyPermission({
        sessionId: id,
        permissionId: "perm-1",
        response: "once",
      });
      expect(v1.replies).toEqual([
        { sessionID: id, requestID: "perm-1", response: "once" },
      ]);
      expect(v1.permissions).toHaveLength(0);
      v1.questions.push({ id: "q-1", sessionID: id, title: "选择参数" });
      expect(await adapter.listQuestions(id)).toEqual([
        { id: "q-1", sessionId: id, summary: "选择参数" },
      ]);
    } finally {
      await v1.stop();
    }
  });

  it("builds the server-scoped deep link for the legacy server", async () => {
    const v1 = await new FakeV1().start();
    try {
      const url = v1Adapter(v1).buildSessionUrl("ses_v1_1");
      expect(url.startsWith(`${v1.baseUrl}/server/`)).toBe(true);
      expect(url.endsWith("/session/ses_v1_1")).toBe(true);
    } finally {
      await v1.stop();
    }
  });

  it("selects the legacy transport through the compatibility factory", async () => {
    const v1 = await new FakeV1().start();
    try {
      const adapter = createOpenCodeAdapter({
        ...defaultOpenCodeConfig(path.join(dataDir, "ws")),
        baseUrl: v1.baseUrl,
        executionDir: path.join(dataDir, "agent"),
      });
      expect(await adapter.health()).toMatchObject({ version: "1.18.31" });
    } finally {
      await v1.stop();
    }
  });
});
