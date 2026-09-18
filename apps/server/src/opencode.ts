import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { OpenCode } from "@opencode/client";

/**
 * OpenCodeAdapter is the single protocol boundary between the workbench and an
 * already-running OpenCode server. No other module may import
 * `@opencode/client` directly.
 *
 * The link is intentionally one-way for task execution:
 *   Workbench -> OpenCode (sessions, prompts, permissions, status)
 *   OpenCode -> scientific-workbench MCP -> Workbench API (research data)
 */

export type OpenCodeErrorCode =
  | "OPENCODE_UNREACHABLE"
  | "OPENCODE_AUTH_FAILED"
  | "INVALID_OPENCODE_URL"
  | "INVALID_INPUT"
  | "INVALID_AGENT_DIRECTORY"
  | "AGENT_DIRECTORY_OVERLAP"
  | "MODEL_UNAVAILABLE"
  | "VISION_MODEL_UNAVAILABLE"
  | "OPENCODE_SESSION_MISSING"
  | "PERMISSION_NOT_PENDING";

export class OpenCodeError extends Error {
  constructor(
    readonly code: OpenCodeErrorCode,
    message: string,
    readonly status = 0,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "OpenCodeError";
  }
}

export interface OpenCodeModelRef {
  providerId: string;
  modelId: string;
}

export interface OpenCodeConfig {
  baseUrl: string;
  username: string;
  executionDir: string;
  permissionMode: "ask" | "auto-allow";
  textModel?: OpenCodeModelRef;
  visionModel?: OpenCodeModelRef;
  credentialId?: string;
}

export interface ResolvedOpenCodeConfig extends OpenCodeConfig {
  password?: string;
}

export const DEFAULT_OPENCODE_USERNAME = "opencode";

export function defaultOpenCodeConfig(dataDir: string): OpenCodeConfig {
  const resolved = path.resolve(dataDir);
  return {
    baseUrl: "",
    username: DEFAULT_OPENCODE_USERNAME,
    executionDir: path.join(
      path.dirname(resolved),
      `${path.basename(resolved)}-Agent`,
    ),
    permissionMode: "ask",
  };
}

export interface OpenCodeHealth {
  ok: boolean;
  version?: string;
  directory?: string;
}

export interface OpenCodeModelOption {
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
  available: boolean;
  supportsImage: true | false | "unknown";
}

export interface OpenCodeMcpStatus {
  state: "connected" | "missing" | "error";
  detail?: string;
}

export type NormalizedSessionStatus = "busy" | "retry" | "idle" | "unknown";

export interface NormalizedSession {
  id: string;
  parentId?: string;
  title?: string;
}

export interface NormalizedMessage {
  id: string;
  role: "user" | "assistant" | "other";
  created: number;
  completed?: number;
  text: string;
}

export interface NormalizedPermission {
  id: string;
  sessionId: string;
  action: string;
  resources: string[];
  summary: string;
}

export interface NormalizedQuestion {
  id: string;
  sessionId: string;
  summary: string;
}

export type NormalizedOpenCodeEvent =
  | { type: "session.created"; sessionId: string; parentId?: string }
  | { type: "session.status"; sessionId: string; status: NormalizedSessionStatus }
  | { type: "session.idle"; sessionId: string }
  | { type: "session.succeeded"; sessionId: string }
  | { type: "session.failed"; sessionId: string; error: string }
  | { type: "session.interrupted"; sessionId: string }
  | { type: "session.retry"; sessionId: string }
  | { type: "permission.asked"; sessionId: string; permissionId: string }
  | { type: "permission.replied"; sessionId: string; permissionId: string }
  | { type: "question.asked"; sessionId: string; questionId: string }
  | { type: "question.replied"; sessionId: string; questionId: string }
  | { type: "other" };

export interface OpenCodeAdapter {
  health(): Promise<OpenCodeHealth>;
  listModels(): Promise<OpenCodeModelOption[]>;
  getMcpStatus(): Promise<OpenCodeMcpStatus>;
  createSession(input: {
    title: string;
    directory: string;
    model?: OpenCodeModelRef;
  }): Promise<{ id: string }>;
  submitPrompt(input: {
    sessionId: string;
    directory: string;
    prompt: string;
    model?: OpenCodeModelRef;
    messageId: string;
  }): Promise<{ promptMessageId: string }>;
  getSession(sessionId: string): Promise<NormalizedSession | null>;
  getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>>;
  getMessages(sessionId: string): Promise<NormalizedMessage[]>;
  getChildren(sessionId: string): Promise<NormalizedSession[]>;
  abortSession(sessionId: string): Promise<void>;
  listPermissions(sessionId?: string): Promise<NormalizedPermission[]>;
  replyPermission(input: {
    sessionId: string;
    permissionId: string;
    response: "once";
  }): Promise<void>;
  listQuestions(sessionId?: string): Promise<NormalizedQuestion[]>;
  subscribeEvents(
    handler: (event: NormalizedOpenCodeEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  buildSessionUrl(sessionId: string): string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** First version only accepts loopback HTTP(S) roots. */
export function validateOpenCodeBaseUrl(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value)
    throw new OpenCodeError("INVALID_OPENCODE_URL", "请填写 OpenCode Server 地址");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "OpenCode Server 地址无效，请填写完整 URL",
    );
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "OpenCode Server 地址只支持 http 或 https",
    );
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "第一版只允许连接本机 OpenCode Server",
    );
  if (url.username || url.password)
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "请不要在 URL 中内嵌用户名或密码",
    );
  if (url.search || url.hash)
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "OpenCode Server 地址不能包含查询或片段",
    );
  if (url.pathname && url.pathname !== "/")
    throw new OpenCodeError(
      "INVALID_OPENCODE_URL",
      "OpenCode Server 地址必须是根路径",
    );
  return `${url.protocol}//${url.host}`;
}

function realpathAllowingMissing(target: string): string {
  let current = path.resolve(target);
  const trailing: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    trailing.unshift(path.basename(current));
    current = parent;
  }
  const base = fs.realpathSync.native(current);
  return trailing.length ? path.join(base, ...trailing) : base;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Reject identical, nested or symlink-overlapping directories. */
export function assertSeparateDirectories(
  dataDir: string,
  executionDir: string,
): string {
  const raw = String(executionDir ?? "").trim();
  if (!raw)
    throw new OpenCodeError("INVALID_AGENT_DIRECTORY", "请填写 Agent 工作目录");
  const data = realpathAllowingMissing(dataDir);
  const execution = realpathAllowingMissing(raw);
  const dataName = path.resolve(dataDir);
  const executionName = path.resolve(raw);
  if (
    data === execution ||
    dataName === executionName ||
    isInside(data, execution) ||
    isInside(execution, data)
  )
    throw new OpenCodeError(
      "AGENT_DIRECTORY_OVERLAP",
      "Agent 工作目录必须与科研数据目录完全分离",
    );
  return executionName;
}

export function ensureExecutionDirectory(executionDir: string): string {
  fs.mkdirSync(executionDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(executionDir, 0o700);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
  return executionDir;
}

function credentialFile(dataDir: string, credentialId: string): string {
  if (!/^[a-f0-9-]+$/.test(credentialId)) throw new Error("凭据标识无效");
  return path.join(dataDir, "private", `opencode-${credentialId}.json`);
}

export function saveOpenCodeCredential(
  dataDir: string,
  password: string,
): string {
  fs.mkdirSync(path.join(dataDir, "private"), {
    recursive: true,
    mode: 0o700,
  });
  const credentialId = crypto.randomUUID();
  fs.writeFileSync(
    credentialFile(dataDir, credentialId),
    JSON.stringify({ password }),
    { flag: "wx", mode: 0o600 },
  );
  return credentialId;
}

export function readOpenCodeCredential(
  dataDir: string,
  credentialId?: string,
): string | undefined {
  if (!credentialId) return undefined;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(credentialFile(dataDir, credentialId), "utf8"),
    ) as { password?: string };
    return parsed.password;
  } catch {
    return undefined;
  }
}

export function hasOpenCodeCredential(
  dataDir: string,
  credentialId?: string,
): boolean {
  if (!credentialId) return false;
  return fs.existsSync(credentialFile(dataDir, credentialId));
}

export function deleteOpenCodeCredential(
  dataDir: string,
  credentialId?: string,
): void {
  if (!credentialId) return;
  try {
    fs.rmSync(credentialFile(dataDir, credentialId));
  } catch {
    /* already gone */
  }
}

export function resolveOpenCodeConfig(
  dataDir: string,
  stored: Partial<OpenCodeConfig> | undefined,
): ResolvedOpenCodeConfig {
  const base = defaultOpenCodeConfig(dataDir);
  const config: OpenCodeConfig = {
    ...base,
    ...stored,
    textModel: stored?.textModel ?? undefined,
    visionModel: stored?.visionModel ?? undefined,
  };
  return {
    ...config,
    password: readOpenCodeCredential(dataDir, config.credentialId),
  };
}

export function createOpenCodeClient(config: {
  baseUrl: string;
  username?: string;
  password?: string;
}): ReturnType<typeof OpenCode.make> {
  const headers: Record<string, string> = {};
  if (config.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.username || DEFAULT_OPENCODE_USERNAME}:${config.password}`,
    ).toString("base64")}`;
  }
  return OpenCode.make({
    baseUrl: config.baseUrl,
    headers,
  });
}

function isTaggedError(value: unknown, tag: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { _tag?: unknown })._tag === tag
  );
}

function isTransportError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "ClientError"
  );
}

function normalizeError(error: unknown): OpenCodeError {
  if (error instanceof OpenCodeError) return error;
  if (isTaggedError(error, "UnauthorizedError"))
    return new OpenCodeError(
      "OPENCODE_AUTH_FAILED",
      "OpenCode 认证失败，请检查用户名和密码",
      401,
    );
  if (isTransportError(error))
    return new OpenCodeError(
      "OPENCODE_UNREACHABLE",
      "无法连接 OpenCode Server",
      0,
      String((error as { message?: string }).message ?? ""),
    );
  return new OpenCodeError(
    "OPENCODE_UNREACHABLE",
    "OpenCode 请求失败",
    0,
    String((error as { message?: string }).message ?? error),
  );
}

function safeText(value: unknown, max = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/(authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=***")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function permissionSummary(permission: {
  action?: string;
  resources?: string[];
  message?: string;
}): string {
  const action = safeText(permission.action ?? "permission", 40);
  const resources = (permission.resources ?? [])
    .map((item) => safeText(item, 80))
    .filter(Boolean);
  const base = resources.length
    ? `${action}：${resources.join(", ")}`
    : permission.message
      ? `${action}：${safeText(permission.message, 120)}`
      : action;
  return safeText(base, 160);
}

function normalizeStatus(status: unknown): NormalizedSessionStatus {
  const type = (status as { type?: string } | undefined)?.type;
  if (type === "busy") return "busy";
  if (type === "retry") return "retry";
  if (type === "idle") return "idle";
  return "unknown";
}

function normalizeEvent(event: unknown): NormalizedOpenCodeEvent | null {
  const value = event as {
    type?: string;
    data?: Record<string, unknown>;
  };
  const data = value.data ?? {};
  const sessionId = String(data.sessionID ?? "");
  switch (value.type) {
    case "session.created":
      return {
        type: "session.created",
        sessionId,
        parentId: data.parentID ? String(data.parentID) : undefined,
      };
    case "session.status":
      return {
        type: "session.status",
        sessionId,
        status: normalizeStatus(data.status),
      };
    case "session.idle":
      return { type: "session.idle", sessionId };
    case "session.execution.succeeded":
      return { type: "session.succeeded", sessionId };
    case "session.execution.failed":
      return {
        type: "session.failed",
        sessionId,
        error: safeText((data.error as { message?: string })?.message ?? data.error),
      };
    case "session.execution.interrupted":
      return { type: "session.interrupted", sessionId };
    case "session.retry.scheduled":
      return { type: "session.retry", sessionId };
    case "permission.asked":
      return {
        type: "permission.asked",
        sessionId,
        permissionId: String(data.id ?? ""),
      };
    case "permission.replied":
      return {
        type: "permission.replied",
        sessionId,
        permissionId: String(data.requestID ?? ""),
      };
    case "form.created": {
      const form = data.form as { sessionID?: string; id?: string } | undefined;
      return {
        type: "question.asked",
        sessionId: String(form?.sessionID ?? ""),
        questionId: String(form?.id ?? ""),
      };
    }
    case "form.replied":
    case "form.cancelled":
      return {
        type: "question.replied",
        sessionId: String(data.sessionID ?? ""),
        questionId: String(data.id ?? ""),
      };
    default:
      return null;
  }
}

export class OpenCodeHttpAdapter implements OpenCodeAdapter {
  private readonly client: ReturnType<typeof OpenCode.make>;
  private readonly statuses = new Map<string, NormalizedSessionStatus>();

  constructor(private readonly config: ResolvedOpenCodeConfig) {
    this.client = createOpenCodeClient(config);
  }

  private directory(input?: string) {
    return { location: { directory: input ?? this.config.executionDir } };
  }

  async health(): Promise<OpenCodeHealth> {
    try {
      const info = await this.client.server.info();
      return { ok: true, version: info.version };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async listModels(): Promise<OpenCodeModelOption[]> {
    try {
      const result = await this.client.model.list(
        this.directory(this.config.executionDir),
      );
      return result.data.map((model) => {
        const input = model.capabilities?.input;
        const supportsImage: true | false | "unknown" = Array.isArray(input)
          ? input.includes("image")
          : "unknown";
        return {
          providerId: model.providerID,
          modelId: model.modelID ?? model.id,
          providerName: model.providerID,
          modelName: model.name,
          available: model.enabled,
          supportsImage,
        };
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async getMcpStatus(): Promise<OpenCodeMcpStatus> {
    try {
      const result = await this.client.mcp.list(
        this.directory(this.config.executionDir),
      );
      const server = result.data.find((item) =>
        /scientific[-_]?workbench|workbench/i.test(item.name),
      );
      if (!server) return { state: "missing" };
      const status = server.status as { status?: string; error?: string };
      if (status.status === "connected") return { state: "connected" };
      return {
        state: "error",
        detail:
          status.status === "failed" || status.status === "needs_auth"
            ? safeText(status.error ?? status.status)
            : safeText(status.status),
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async createSession(input: {
    title: string;
    directory: string;
    model?: OpenCodeModelRef;
  }): Promise<{ id: string }> {
    try {
      const session = await this.client.session.create({
        title: input.title,
        location: { directory: input.directory },
        ...(input.model
          ? {
              model: {
                id: input.model.modelId,
                providerID: input.model.providerId,
              },
            }
          : {}),
      });
      return { id: session.id };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async submitPrompt(input: {
    sessionId: string;
    directory: string;
    prompt: string;
    model?: OpenCodeModelRef;
    messageId: string;
  }): Promise<{ promptMessageId: string }> {
    try {
      if (input.model)
        await this.client.session.switchModel({
          sessionID: input.sessionId,
          model: {
            id: input.model.modelId,
            providerID: input.model.providerId,
          },
        });
      const inbox = await this.client.session.prompt({
        sessionID: input.sessionId,
        id: input.messageId,
        text: input.prompt,
      });
      return { promptMessageId: inbox.id };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    try {
      const session = await this.client.session.get({ sessionID: sessionId });
      return {
        id: session.id,
        parentId: session.parentID,
        title: session.title,
      };
    } catch (error) {
      if (isTaggedError(error, "SessionNotFoundError")) return null;
      throw normalizeError(error);
    }
  }

  async getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>> {
    try {
      const active = await this.client.session.active();
      const statuses = new Map(this.statuses);
      for (const sessionId of Object.keys(active))
        statuses.set(sessionId, "busy");
      return statuses;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    try {
      const response = await this.client.message.list({
        sessionID: sessionId,
        order: "asc",
      });
      return response.data.map((message) => {
        const value = message as {
          id: string;
          type: string;
          time?: { created?: number; completed?: number };
          text?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
        const text =
          value.type === "user"
            ? String(value.text ?? "")
            : (value.content ?? [])
                .filter((part) => part.type === "text")
                .map((part) => String(part.text ?? ""))
                .join("");
        return {
          id: value.id,
          role:
            value.type === "user"
              ? ("user" as const)
              : value.type === "assistant"
                ? ("assistant" as const)
                : ("other" as const),
          created: value.time?.created ?? 0,
          completed: value.time?.completed,
          text,
        };
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async getChildren(sessionId: string): Promise<NormalizedSession[]> {
    try {
      const response = await this.client.session.list({
        parentID: sessionId,
      });
      return response.data.map((session) => ({
        id: session.id,
        parentId: session.parentID,
        title: session.title,
      }));
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    try {
      await this.client.session.interrupt({ sessionID: sessionId });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async listPermissions(sessionId?: string): Promise<NormalizedPermission[]> {
    try {
      const map = (request: {
        id: string;
        sessionID: string;
        action: string;
        resources?: string[];
        message?: string;
      }): NormalizedPermission => ({
        id: request.id,
        sessionId: request.sessionID,
        action: request.action,
        resources: request.resources ?? [],
        summary: permissionSummary(request),
      });
      if (sessionId) {
        const result = await this.client.permission.list({ sessionID: sessionId });
        return result.map(map);
      }
      const result = await this.client.permission.request.list();
      return result.data.map(map);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async replyPermission(input: {
    sessionId: string;
    permissionId: string;
    response: "once";
  }): Promise<void> {
    try {
      await this.client.permission.reply({
        sessionID: input.sessionId,
        requestID: input.permissionId,
        decision: input.response,
      });
    } catch (error) {
      if (isTaggedError(error, "PermissionNotFoundError"))
        throw new OpenCodeError(
          "PERMISSION_NOT_PENDING",
          "权限请求已失效",
          409,
        );
      throw normalizeError(error);
    }
  }

  async listQuestions(sessionId?: string): Promise<NormalizedQuestion[]> {
    try {
      if (sessionId) {
        const forms = await this.client.session.form.list({
          sessionID: sessionId,
        });
        return forms.map((form) => ({
          id: form.id,
          sessionId: form.sessionID,
          summary: safeText(form.title),
        }));
      }
      const result = await this.client.form.list(
        this.directory(this.config.executionDir),
      );
      return result.data.map((form) => ({
        id: form.id,
        sessionId: form.sessionID,
        summary: safeText(form.title),
      }));
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async subscribeEvents(
    handler: (event: NormalizedOpenCodeEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const event of this.client.event.subscribe({ signal })) {
        const normalized = normalizeEvent(event);
        if (!normalized) continue;
        if (normalized.type === "session.status")
          this.statuses.set(normalized.sessionId, normalized.status);
        else if (normalized.type === "session.idle")
          this.statuses.set(normalized.sessionId, "idle");
        handler(normalized);
      }
    } catch (error) {
      if (signal.aborted) return;
      throw normalizeError(error);
    }
  }

  buildSessionUrl(sessionId: string): string {
    const serverKey = Buffer.from(this.config.baseUrl, "utf8").toString(
      "base64url",
    );
    return `${this.config.baseUrl}/server/${serverKey}/session/${encodeURIComponent(sessionId)}`;
  }
}
