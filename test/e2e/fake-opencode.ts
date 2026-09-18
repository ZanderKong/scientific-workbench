import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Fake OpenCode V1 HTTP server for Playwright. It mirrors the installed
 * server's real contract (`/session`, `/global/health`, `/config/providers`,
 * `/mcp`, `/permission`, `/question`, `/event`) and exposes the asynchronous
 * `POST /session/:id/prompt_async`. A blocking `POST /session/:id/message` is
 * implemented as a fail-fast guard so the workbench can never silently regress
 * to a synchronous prompt. It never calls a real provider or model.
 */
export class FakeOpenCode {
  server!: http.Server;
  baseUrl = "";
  sessions = new Map<string, any>();
  messages = new Map<string, any[]>();
  permissions: any[] = [];
  questions: any[] = [];
  replies: {
    sessionID: string;
    requestID: string;
    response: string;
  }[] = [];
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
      },
    },
    {
      id: "openai",
      name: "OpenAI",
      models: {
        gpt: {
          id: "gpt",
          providerID: "openai",
          name: "GPT",
          capabilities: { attachment: false },
        },
      },
    },
  ];
  mcp: Record<string, any> = {
    "scientific-workbench": { status: "connected" },
  };
  asyncPromptCalls = 0;
  syncPromptCalls = 0;
  requestDirectories: { path: string; directory?: string }[] = [];
  serverCwd = "/tmp/opencode-server-cwd";
  private streams = new Set<http.ServerResponse>();
  private sequence = 0;
  private active = new Set<string>();

  async start(port = 0) {
    this.server = http.createServer((request, response) =>
      this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server.listen(port, "127.0.0.1", resolve),
    );
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    for (const stream of this.streams) stream.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  streamCount() {
    return this.streams.size;
  }

  createSession(title: string, parentID?: string, directory?: string) {
    const id = `ses_fake_${++this.sequence}`;
    this.sessions.set(id, {
      id,
      title,
      parentID,
      directory: directory ?? this.serverCwd,
    });
    this.messages.set(id, []);
    return id;
  }

  directoryFor(title: string) {
    for (const session of this.sessions.values())
      if (session.title === title) return session.directory;
    return undefined;
  }

  sessionDirectory(sessionId: string) {
    return this.sessions.get(sessionId)?.directory;
  }

  sessionIdForTitle(title: string) {
    for (const session of this.sessions.values())
      if (session.title === title) return session.id;
    return undefined;
  }

  busy(sessionId: string) {
    return this.active.has(sessionId);
  }

  addAssistant(sessionId: string, text: string) {
    const list = this.messages.get(sessionId) ?? [];
    list.push({
      info: {
        id: `msg_assistant_${++this.sequence}`,
        role: "assistant",
        sessionID: sessionId,
        time: { created: Date.now(), completed: Date.now() },
      },
      parts: [{ type: "text", text }],
    });
    this.messages.set(sessionId, list);
    this.active.delete(sessionId);
  }

  emit(event: unknown) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of this.streams) stream.write(payload);
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
    if (method === "GET" && url.pathname === "/mcp")
      return send(200, this.mcp);
    if (method === "GET" && url.pathname === "/permission")
      return send(200, this.permissions);
    if (method === "GET" && url.pathname === "/question")
      return send(200, this.questions);
    if (method === "GET" && url.pathname === "/session/status") {
      const data: Record<string, unknown> = {};
      for (const id of this.active) data[id] = { type: "busy" };
      return send(200, data);
    }
    if (method === "GET" && url.pathname === "/session")
      return send(200, [...this.sessions.values()]);
    if (method === "POST" && url.pathname === "/session") {
      readBody(request).then((body) => {
        // `body.directory` is intentionally ignored: legacy routing uses the
        // x-opencode-directory header only.
        const id = this.createSession(body.title ?? "", undefined, directory);
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
        const sessionId = parts[1];
        if (!this.sessions.has(sessionId))
          return send(404, { name: "NotFoundError", data: {} });
        this.active.add(sessionId);
        const messageId = String(body.messageID ?? `msg_${++this.sequence}`);
        const list = this.messages.get(sessionId) ?? [];
        list.push({
          info: {
            id: messageId,
            role: "user",
            sessionID: sessionId,
            time: { created: Date.now() },
          },
          parts: body.parts ?? [{ type: "text", text: "" }],
        });
        this.messages.set(sessionId, list);
        this.emit({
          type: "session.status",
          properties: { sessionID: sessionId, status: { type: "busy" } },
        });
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
      // Blocking prompt path that the workbench must never use.
      this.syncPromptCalls += 1;
      return send(500, {
        name: "SyncPromptNotAllowed",
        error: "SYNC_PROMPT_NOT_ALLOWED_IN_TEST",
      });
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
      method === "POST" &&
      parts[0] === "session" &&
      parts[1] &&
      parts[2] === "permissions" &&
      parts[3]
    ) {
      readBody(request).then((body) => {
        const index = this.permissions.findIndex((p) => p.id === parts[3]);
        if (index < 0)
          return send(404, { name: "NotFoundError", data: {} });
        const [permission] = this.permissions.splice(index, 1);
        this.replies.push({
          sessionID: parts[1],
          requestID: permission.id,
          response: body.response,
        });
        send(204);
      });
      return;
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
    ) {
      const session = this.sessions.get(parts[1]);
      return session
        ? send(200, session)
        : send(404, { name: "NotFoundError", data: {} });
    }
    if (method === "GET" && url.pathname === "/event") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      this.streams.add(response);
      request.on("close", () => this.streams.delete(response));
      return;
    }
    return send(404, { name: "NotFoundError", data: { path: url.pathname } });
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
