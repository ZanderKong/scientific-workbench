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
  | "PERMISSION_NOT_PENDING"
  | "OPENCODE_CONFIG_IN_USE";

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
  /** The instance directory the runtime actually reports for this session. */
  directory?: string;
}

/**
 * Tool invocation evidence, when the runtime reports it. Every field is
 * optional: an absent value must degrade a caller to NOT VERIFIED, never to a
 * positive conclusion.
 */
export interface NormalizedToolCall {
  name: string;
  status?: string;
  output?: string;
  error?: string;
}

export interface NormalizedMessage {
  id: string;
  role: "user" | "assistant" | "other";
  created: number;
  completed?: number;
  /** Request correlation reported by the runtime, when it provides one. */
  parentId?: string;
  text: string;
  tools?: NormalizedToolCall[];
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
  | { type: "activity"; sessionId: string }
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

export function openCodeAuthHeaders(config: {
  username?: string;
  password?: string;
}): Record<string, string> {
  if (!config.password) return {};
  return {
    Authorization: `Basic ${Buffer.from(
      `${config.username || DEFAULT_OPENCODE_USERNAME}:${config.password}`,
    ).toString("base64")}`,
  };
}

export function createOpenCodeClient(config: {
  baseUrl: string;
  username?: string;
  password?: string;
}): ReturnType<typeof OpenCode.make> {
  return OpenCode.make({
    baseUrl: config.baseUrl,
    headers: openCodeAuthHeaders(config),
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

/**
 * Maps runtime tool parts to the optional evidence shape. Parts that do not
 * match the documented `type: "tool"` shape are ignored rather than guessed.
 */
function normalizeToolParts(parts: unknown): NormalizedToolCall[] | undefined {
  if (!Array.isArray(parts)) return undefined;
  const calls: NormalizedToolCall[] = [];
  for (const part of parts) {
    const value = part as {
      type?: unknown;
      tool?: unknown;
      name?: unknown;
      state?: { status?: unknown; output?: unknown; error?: unknown };
      status?: unknown;
    };
    if (value?.type !== "tool") continue;
    const name = String(value.tool ?? value.name ?? "").trim();
    if (!name) continue;
    const status = value.state?.status ?? value.status;
    const output = value.state?.output;
    const error = value.state?.error;
    calls.push({
      name,
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof output === "string" ? { output } : {}),
      ...(typeof error === "string" ? { error } : {}),
    });
  }
  return calls.length ? calls : undefined;
}

/** Reads the instance directory a runtime reports for one session, if any. */
function sessionDirectory(session: unknown): string | undefined {
  const value = session as
    | { directory?: unknown; location?: { directory?: unknown } }
    | undefined;
  const directory = value?.directory ?? value?.location?.directory;
  return typeof directory === "string" && directory ? directory : undefined;
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

/**
 * Legacy OpenCode V1 event stream uses `{ type, properties }`. The installed
 * server reports `session.status`, `message.updated`, `permission.updated`...
 */
function normalizeV1Event(event: unknown): NormalizedOpenCodeEvent | null {
  const value = event as {
    type?: string;
    properties?: Record<string, unknown>;
  };
  const properties = value.properties ?? {};
  const sessionId = String(properties.sessionID ?? "");
  switch (value.type) {
    case "session.status":
      return {
        type: "session.status",
        sessionId,
        status: normalizeStatus(properties.status ?? properties),
      };
    case "session.idle":
      return { type: "session.idle", sessionId };
    case "permission.updated":
    case "permission.asked":
      return {
        type: "permission.asked",
        sessionId,
        permissionId: String(properties.id ?? ""),
      };
    case "permission.replied":
      return {
        type: "permission.replied",
        sessionId,
        permissionId: String(properties.requestID ?? properties.id ?? ""),
      };
    case "question.asked":
    case "question.updated":
      return {
        type: "question.asked",
        sessionId,
        questionId: String(properties.id ?? properties.requestID ?? ""),
      };
    case "question.replied":
    case "question.rejected":
      return {
        type: "question.replied",
        sessionId,
        questionId: String(properties.id ?? properties.requestID ?? ""),
      };
    case "session.error":
      return {
        type: "session.failed",
        sessionId,
        error: safeText(
          (properties.error as { data?: { message?: string } })?.data?.message ??
            (properties.error as { message?: string })?.message ??
            properties.error,
        ),
      };
    case "message.updated":
    case "message.part.updated":
    case "message.removed":
    case "session.updated":
    case "session.diff":
      return { type: "activity", sessionId };
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
        directory: sessionDirectory(session),
      };
    } catch (error) {
      if (isTaggedError(error, "SessionNotFoundError")) return null;
      throw normalizeError(error);
    }
  }

  async getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>> {
    try {
      const active = await this.client.session.active();
      // V2 `active()` is an authoritative active-session snapshot, not a
      // delta. Rebuild from scratch so a session that finished is no longer
      // reported busy even if an idle event was missed.
      const statuses = new Map<string, NormalizedSessionStatus>();
      for (const sessionId of Object.keys(active))
        statuses.set(sessionId, "busy");
      this.statuses.clear();
      for (const [sessionId, status] of statuses)
        this.statuses.set(sessionId, status);
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
          parentId: (value as { parentID?: string }).parentID
            ? String((value as { parentID?: string }).parentID)
            : undefined,
          text,
          tools: normalizeToolParts((value as { content?: unknown[] }).content),
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

/**
 * Legacy OpenCode V1 transport. The installed server exposes `/global/health`,
 * `/config/providers`, `/session/*` and a truly asynchronous
 * `POST /session/:id/prompt_async`. It is selected automatically when the V2
 * `@opencode/client` contract is not present, and stays entirely inside the
 * adapter boundary so the workbench never sees version differences.
 */
export class LegacyOpenCodeAdapter implements OpenCodeAdapter {
  private readonly headers: Record<string, string>;
  private readonly statuses = new Map<string, NormalizedSessionStatus>();

  constructor(private readonly config: ResolvedOpenCodeConfig) {
    this.headers = {
      ...openCodeAuthHeaders(config),
      // Legacy V1 routes workspace/instance requests by header, not by a
      // Session body field. Every request (including the event stream) uses
      // this single header set.
      "x-opencode-directory": config.executionDir,
    };
  }

  private async request(
    method: string,
    endpoint: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers: {
          ...this.headers,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new OpenCodeError(
        "OPENCODE_UNREACHABLE",
        "无法连接 OpenCode Server",
        0,
        String((error as { message?: string }).message ?? error),
      );
    }
    if (response.status === 401)
      throw new OpenCodeError(
        "OPENCODE_AUTH_FAILED",
        "OpenCode 认证失败，请检查用户名和密码",
        401,
      );
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenCodeError(
        "OPENCODE_UNREACHABLE",
        `OpenCode 请求失败（${response.status}）`,
        response.status,
        safeText(isJson ? text : "", 200),
      );
    }
    if (isJson) return response.json();
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async health(): Promise<OpenCodeHealth> {
    const value = await this.request("GET", "/global/health");
    return { ok: Boolean(value?.healthy ?? true), version: value?.version };
  }

  async listModels(): Promise<OpenCodeModelOption[]> {
    const value = await this.request("GET", "/config/providers");
    const models: OpenCodeModelOption[] = [];
    for (const provider of value?.providers ?? []) {
      const definitions = provider?.models ?? {};
      const entries = Array.isArray(definitions)
        ? definitions
        : Object.values(definitions);
      for (const model of entries as any[]) {
        if (!model) continue;
        const attachment = model.capabilities?.attachment;
        models.push({
          providerId: String(model.providerID ?? provider.id),
          modelId: String(model.id),
          providerName: String(provider.name ?? provider.id),
          modelName: String(model.name ?? model.id),
          available: true,
          supportsImage:
            attachment === undefined
              ? "unknown"
              : attachment === true,
        });
      }
    }
    return models;
  }

  async getMcpStatus(): Promise<OpenCodeMcpStatus> {
    const value = await this.request("GET", "/mcp");
    const entries: [string, any][] = Object.entries(value ?? {});
    const server = entries.find(([name]) =>
      /scientific[-_]?workbench|workbench/i.test(name),
    );
    if (!server) return { state: "missing" };
    const status = String(server[1]?.status ?? "");
    if (status === "connected") return { state: "connected" };
    return {
      state: "error",
      detail: safeText(
        server[1]?.error ?? (status || "OpenCode 报告错误"),
      ),
    };
  }

  async createSession(input: {
    title: string;
    directory: string;
  }): Promise<{ id: string }> {
    // `directory` is intentionally not a Session body field in legacy V1; the
    // adapter's `x-opencode-directory` header routes the instance instead.
    const session = await this.request("POST", "/session", {
      title: input.title,
    });
    return { id: String(session.id) };
  }

  async submitPrompt(input: {
    sessionId: string;
    directory: string;
    prompt: string;
    model?: OpenCodeModelRef;
    messageId: string;
  }): Promise<{ promptMessageId: string }> {
    const messageId = input.messageId.startsWith("msg_")
      ? input.messageId
      : `msg_${input.messageId.replace(/-/g, "")}`;
    await this.request(
      "POST",
      `/session/${encodeURIComponent(input.sessionId)}/prompt_async`,
      {
        messageID: messageId,
        parts: [{ type: "text", text: input.prompt }],
        ...(input.model
          ? {
              model: {
                providerID: input.model.providerId,
                modelID: input.model.modelId,
              },
            }
          : {}),
      },
    );
    return { promptMessageId: messageId };
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    try {
      const session = await this.request(
        "GET",
        `/session/${encodeURIComponent(sessionId)}`,
      );
      return {
        id: String(session.id),
        parentId: session.parentID,
        title: session.title,
        directory: sessionDirectory(session),
      };
    } catch (error) {
      if (error instanceof OpenCodeError && error.status === 404) return null;
      throw error;
    }
  }

  async getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>> {
    const value = await this.request("GET", "/session/status");
    // `/session/status` lists only non-idle sessions. Treat it as the
    // authoritative reconciliation snapshot and drop stale entries instead of
    // merging them with the event cache, otherwise a finished session keeps
    // looking busy forever when its idle event is lost.
    const statuses = new Map<string, NormalizedSessionStatus>();
    for (const [sessionId, status] of Object.entries(value ?? {}))
      statuses.set(sessionId, normalizeStatus(status));
    this.statuses.clear();
    for (const [sessionId, status] of statuses)
      this.statuses.set(sessionId, status);
    return new Map(statuses);
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    const value = await this.request(
      "GET",
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
    const messages = (Array.isArray(value) ? value : value?.data ?? []).map(
      (entry: any) => {
        const info = entry?.info ?? entry;
        const parts = entry?.parts ?? [];
        return {
          id: String(info.id),
          role:
            info.role === "user"
              ? ("user" as const)
              : info.role === "assistant"
                ? ("assistant" as const)
                : ("other" as const),
          created: info.time?.created ?? 0,
          completed: info.time?.completed,
          parentId: info.parentID ? String(info.parentID) : undefined,
          text: (parts as any[])
            .filter((part) => part.type === "text")
            .map((part) => String(part.text ?? ""))
            .join(""),
          tools: normalizeToolParts(parts),
        };
      },
    );
    return messages.sort(
      (a: NormalizedMessage, b: NormalizedMessage) => a.created - b.created,
    );
  }

  async getChildren(sessionId: string): Promise<NormalizedSession[]> {
    const value = await this.request("GET", "/session");
    return (Array.isArray(value) ? value : value?.data ?? [])
      .filter((session: any) => session.parentID === sessionId)
      .map((session: any) => ({
        id: String(session.id),
        parentId: session.parentID,
        title: session.title,
      }));
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/abort`,
    );
  }

  async listPermissions(sessionId?: string): Promise<NormalizedPermission[]> {
    const value = await this.request("GET", "/permission");
    return (Array.isArray(value) ? value : value?.data ?? [])
      .filter(
        (permission: any) =>
          !sessionId || permission.sessionID === sessionId,
      )
      .map((permission: any) => ({
        id: String(permission.id),
        sessionId: String(permission.sessionID),
        action: String(permission.permission ?? permission.type ?? "permission"),
        resources: Array.isArray(permission.patterns)
          ? permission.patterns.map(String)
          : permission.pattern
            ? [String(permission.pattern)]
            : [],
        summary: permissionSummary({
          action: String(
            permission.title ?? permission.permission ?? permission.type ?? "",
          ),
          resources: Array.isArray(permission.patterns)
            ? permission.patterns.map(String)
            : permission.pattern
              ? [String(permission.pattern)]
              : [],
          message: permission.message,
        }),
      }));
  }

  async replyPermission(input: {
    sessionId: string;
    permissionId: string;
    response: "once";
  }): Promise<void> {
    try {
      await this.request(
        "POST",
        `/session/${encodeURIComponent(input.sessionId)}/permissions/${encodeURIComponent(input.permissionId)}`,
        { response: input.response },
      );
    } catch (error) {
      if (error instanceof OpenCodeError && error.status === 404)
        throw new OpenCodeError(
          "PERMISSION_NOT_PENDING",
          "权限请求已失效",
          409,
        );
      throw error;
    }
  }

  async listQuestions(sessionId?: string): Promise<NormalizedQuestion[]> {
    const value = await this.request("GET", "/question");
    return (Array.isArray(value) ? value : value?.data ?? [])
      .filter(
        (question: any) => !sessionId || question.sessionID === sessionId,
      )
      .map((question: any) => ({
        id: String(question.id),
        sessionId: String(question.sessionID),
        summary: safeText(
          question.title ?? question.header ?? "OpenCode 需要你的输入",
        ),
      }));
  }

  async subscribeEvents(
    handler: (event: NormalizedOpenCodeEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/event`, {
        method: "GET",
        headers: { ...this.headers, accept: "text/event-stream" },
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      throw normalizeError(error);
    }
    if (response.status === 401)
      throw new OpenCodeError(
        "OPENCODE_AUTH_FAILED",
        "OpenCode 认证失败，请检查用户名和密码",
        401,
      );
    if (!response.ok || !response.body)
      throw new OpenCodeError(
        "OPENCODE_UNREACHABLE",
        "OpenCode 事件流不可用",
        response.status,
      );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) {
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = null;
            }
            if (parsed) {
              const normalized = normalizeV1Event(parsed);
              if (normalized) {
                if (normalized.type === "session.status")
                  this.statuses.set(normalized.sessionId, normalized.status);
                else if (normalized.type === "session.idle")
                  this.statuses.set(normalized.sessionId, "idle");
                handler(normalized);
              }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      throw normalizeError(error);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  }

  buildSessionUrl(sessionId: string): string {
    const serverKey = Buffer.from(this.config.baseUrl, "utf8").toString(
      "base64url",
    );
    return `${this.config.baseUrl}/server/${serverKey}/session/${encodeURIComponent(sessionId)}`;
  }
}

export type OpenCodeFlavor = "v2" | "v1";

async function probeJson(
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
): Promise<any> {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** V2-first detection with a V1 fallback, both confined to the adapter. */
export async function detectOpenCodeFlavor(
  config: ResolvedOpenCodeConfig,
): Promise<OpenCodeFlavor> {
  const headers = openCodeAuthHeaders(config);
  const info = await probeJson(config.baseUrl, "/api/info", headers);
  if (info && typeof info.version === "string") return "v2";
  const health = await probeJson(config.baseUrl, "/global/health", headers);
  if (health && (health.healthy === true || typeof health.version === "string"))
    return "v1";
  throw new OpenCodeError(
    "OPENCODE_UNREACHABLE",
    "无法连接 OpenCode Server",
  );
}

/**
 * Wraps flavor detection. V2 servers use `@opencode/client`; the installed
 * legacy V1 server is served by the raw `/session/*` transport. Neither branch
 * leaks into AgentRunService or the UI.
 */
export class CompatOpenCodeAdapter implements OpenCodeAdapter {
  private resolved: OpenCodeAdapter | null = null;
  private resolving: Promise<OpenCodeAdapter> | null = null;

  constructor(private readonly config: ResolvedOpenCodeConfig) {}

  private resolve(): Promise<OpenCodeAdapter> {
    if (this.resolved) return Promise.resolve(this.resolved);
    if (!this.resolving)
      this.resolving = detectOpenCodeFlavor(this.config)
        .then((flavor) => {
          this.resolved =
            flavor === "v1"
              ? new LegacyOpenCodeAdapter(this.config)
              : new OpenCodeHttpAdapter(this.config);
          return this.resolved;
        })
        .catch((error) => {
          this.resolving = null;
          throw error;
        });
    return this.resolving;
  }

  async health(): Promise<OpenCodeHealth> {
    return (await this.resolve()).health();
  }
  async listModels(): Promise<OpenCodeModelOption[]> {
    return (await this.resolve()).listModels();
  }
  async getMcpStatus(): Promise<OpenCodeMcpStatus> {
    return (await this.resolve()).getMcpStatus();
  }
  async createSession(input: {
    title: string;
    directory: string;
    model?: OpenCodeModelRef;
  }): Promise<{ id: string }> {
    return (await this.resolve()).createSession(input);
  }
  async submitPrompt(input: {
    sessionId: string;
    directory: string;
    prompt: string;
    model?: OpenCodeModelRef;
    messageId: string;
  }): Promise<{ promptMessageId: string }> {
    return (await this.resolve()).submitPrompt(input);
  }
  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    return (await this.resolve()).getSession(sessionId);
  }
  async getSessionStatuses(): Promise<Map<string, NormalizedSessionStatus>> {
    return (await this.resolve()).getSessionStatuses();
  }
  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    return (await this.resolve()).getMessages(sessionId);
  }
  async getChildren(sessionId: string): Promise<NormalizedSession[]> {
    return (await this.resolve()).getChildren(sessionId);
  }
  async abortSession(sessionId: string): Promise<void> {
    return (await this.resolve()).abortSession(sessionId);
  }
  async listPermissions(sessionId?: string): Promise<NormalizedPermission[]> {
    return (await this.resolve()).listPermissions(sessionId);
  }
  async replyPermission(input: {
    sessionId: string;
    permissionId: string;
    response: "once";
  }): Promise<void> {
    return (await this.resolve()).replyPermission(input);
  }
  async listQuestions(sessionId?: string): Promise<NormalizedQuestion[]> {
    return (await this.resolve()).listQuestions(sessionId);
  }
  async subscribeEvents(
    handler: (event: NormalizedOpenCodeEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    return (await this.resolve()).subscribeEvents(handler, signal);
  }
  buildSessionUrl(sessionId: string): string {
    if (this.resolved) return this.resolved.buildSessionUrl(sessionId);
    const serverKey = Buffer.from(this.config.baseUrl, "utf8").toString(
      "base64url",
    );
    return `${this.config.baseUrl}/server/${serverKey}/session/${encodeURIComponent(sessionId)}`;
  }
}

export function createOpenCodeAdapter(
  config: ResolvedOpenCodeConfig,
): OpenCodeAdapter {
  return new CompatOpenCodeAdapter(config);
}

/**
 * EXPERIMENTAL image transport, used only by the opt-in vision spike harness.
 *
 * It deliberately is *not* part of `OpenCodeAdapter`, so no product code path
 * can reach it and no unverified flavor is enabled by importing it. It still
 * goes through the same authentication, directory routing and error handling as
 * every other request. The image part shape below is a documented candidate,
 * not a verified contract: the harness records whether a real runtime accepts
 * it, and nothing is promoted to production before that evidence exists.
 */
export interface OpenCodeImageInput {
  mimeType: string;
  filename: string;
  data: Uint8Array;
}

export interface ExperimentalImagePromptResult {
  promptMessageId: string;
  /** Sanitized description of the endpoint and body shape that was attempted. */
  candidate: string;
  endpoint: string;
  requestKeys: string[];
  status: number;
  elapsedMs: number;
}

export const EXPERIMENTAL_IMAGE_CANDIDATES: Record<string, string> = {
  v1: "/session/:id/prompt_async",
  v2: "/api/session/:id/prompt",
};

export async function submitExperimentalImagePrompt(
  config: ResolvedOpenCodeConfig,
  flavor: OpenCodeFlavor,
  input: {
    sessionId: string;
    prompt: string;
    messageId: string;
    model?: OpenCodeModelRef;
    images: OpenCodeImageInput[];
  },
): Promise<ExperimentalImagePromptResult> {
  const headers = {
    ...openCodeAuthHeaders(config),
    "x-opencode-directory": config.executionDir,
    "content-type": "application/json",
  };
  const parts = [
    { type: "text", text: input.prompt },
    ...input.images.map((image) => ({
      type: "file",
      mime: image.mimeType,
      filename: image.filename,
      url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
    })),
  ];
  const body = {
    messageID: input.messageId,
    parts,
    ...(input.model
      ? {
          model: {
            providerID: input.model.providerId,
            modelID: input.model.modelId,
          },
        }
      : {}),
  };
  const endpoint =
    flavor === "v2"
      ? `/api/session/${encodeURIComponent(input.sessionId)}/prompt`
      : `/session/${encodeURIComponent(input.sessionId)}/prompt_async`;
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new OpenCodeError(
      "OPENCODE_UNREACHABLE",
      "无法连接 OpenCode Server",
      0,
      safeText((error as { message?: string }).message ?? error),
    );
  }
  const elapsedMs = Date.now() - startedAt;
  if (response.status === 401)
    throw new OpenCodeError(
      "OPENCODE_AUTH_FAILED",
      "OpenCode 认证失败，请检查用户名和密码",
      401,
    );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenCodeError(
      "OPENCODE_UNREACHABLE",
      `OpenCode 图片请求失败（${response.status}）`,
      response.status,
      safeText(text, 200),
    );
  }
  await response.text().catch(() => "");
  return {
    promptMessageId: input.messageId,
    candidate: `${flavor}:file-part-data-url`,
    endpoint,
    requestKeys: Object.keys(body),
    status: response.status,
    elapsedMs,
  };
}
