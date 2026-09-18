import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal Fake OpenCode V2 HTTP server for Playwright.
 * It implements the `@opencode/client` HTTP contract only; it never calls a
 * real provider or model.
 */
export class FakeOpenCode {
  server!: http.Server;
  baseUrl = "";
  sessions = new Map<string, any>();
  permissions: any[] = [];
  questions: any[] = [];
  messages = new Map<string, any[]>();
  active = new Set<string>();
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
      enabled: true,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
    },
  ];
  mcp = [{ name: "scientific-workbench", status: { status: "connected" } }];
  replies: { sessionID: string; requestID: string; decision: string }[] = [];
  private streams = new Set<http.ServerResponse>();
  private sequence = 0;

  streamCount() {
    return this.streams.size;
  }

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
    for (const stream of this.streams) stream.end();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  nextSession(title: string, parentId?: string) {
    const id = `session-${++this.sequence}`;
    this.sessions.set(id, { id, title, parentID: parentId });
    this.messages.set(id, []);
    return id;
  }

  addAssistant(sessionId: string, text: string) {
    const list = this.messages.get(sessionId) ?? [];
    list.push({
      id: `assistant-${++this.sequence}`,
      type: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      content: [{ type: "text", text }],
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
      for (const id of this.active) data[id] = { type: "running" };
      return send(200, { data });
    }
    if (method === "POST" && url.pathname === "/api/session") {
      readBody(request).then((body) => {
        const id = this.nextSession(body.title ?? "");
        this.emit({
          type: "session.created",
          data: { sessionID: id, title: body.title },
        });
        send(200, { data: { id, title: body.title } });
      });
      return;
    }
    if (parts[1] === "session" && parts[2] && parts[3] === "prompt") {
      readBody(request).then((body) => {
        if (!this.sessions.has(parts[2]))
          return send(404, { _tag: "SessionNotFoundError" });
        this.active.add(parts[2]);
        const id = body.id ?? `user-${++this.sequence}`;
        const list = this.messages.get(parts[2]) ?? [];
        list.push({
          id,
          type: "user",
          text: body.text,
          time: { created: Date.now() },
        });
        this.messages.set(parts[2], list);
        this.emit({
          type: "session.status",
          data: { sessionID: parts[2], status: { type: "busy" } },
        });
        send(200, {
          data: {
            id,
            sessionID: parts[2],
            time: { created: Date.now() },
            type: "user",
            payload: { text: body.text },
            delivery: "queue",
          },
        });
      });
      return;
    }
    if (parts[1] === "session" && parts[2] && parts[3] === "interrupt") {
      this.active.delete(parts[2]);
      return send(200, { interrupted: true });
    }
    if (
      parts[1] === "session" &&
      parts[2] &&
      parts[3] === "message" &&
      method === "GET"
    )
      return send(200, {
        data: this.messages.get(parts[2]) ?? [],
        cursor: { next: null },
      });
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
        this.permissions.splice(index, 1);
        this.replies.push({
          sessionID: parts[2],
          requestID: parts[4],
          decision: body.decision,
        });
        this.emit({
          type: "permission.replied",
          data: {
            sessionID: parts[2],
            requestID: parts[4],
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
        data: this.questions
          .filter((q) => q.sessionID === parts[2])
          .map((q) => ({ id: q.id, sessionID: q.sessionID, title: q.title, fields: [] })),
      });
    if (method === "GET" && url.pathname === "/api/permission/request")
      return send(200, {
        location: { directory: "/agent" },
        data: this.permissions,
      });
    if (method === "GET" && url.pathname === "/api/event") {
      response.writeHead(200, { "content-type": "text/event-stream" });
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
