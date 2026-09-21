/**
 * Opt-in vision compatibility harness.
 *
 * Every check must carry real evidence. A session-creation response, a prompt
 * echo, an unrelated message, a number inside a longer string, silence during a
 * denied probe or a clean report are all *not* evidence, and any of them alone
 * keeps the corresponding check at NOT VERIFIED instead of PASS. The harness
 * never reads or writes the user's OpenCode configuration and never puts image
 * bytes, credentials or workspace paths into its evidence.
 *
 * Driven by `scripts/spike-opencode-vision.mts` (explicit opt-in) and by
 * `vision-spike.test.ts` (fake contract + negative matrix).
 */
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";

export const VISION_SPIKE_CHECKS = [
  "isolation",
  "runtimeIdentityAndModel",
  "asyncSubmission",
  "correlatedImageAnswer",
  "restrictedAllow",
  "restrictedDeny",
  "noSensitiveWorkbenchLeakage",
] as const;

export type VisionSpikeCheck = (typeof VISION_SPIKE_CHECKS)[number];
export type VisionSpikeStatus = "PASS" | "FAIL" | "NOT VERIFIED";

/**
 * Capability scopes the denied probe set must cover. Uncovered scopes keep the
 * deny check at NOT VERIFIED: one file-read probe never stands for a whole
 * restricted profile.
 */
export const REQUIRED_DENY_CAPABILITIES = [
  "shell",
  "file-read",
  "file-write",
  "subagent",
  "unrelated-mcp",
  "network",
  "generic-scientific-write",
] as const;

export type DenyCapability = (typeof REQUIRED_DENY_CAPABILITIES)[number];

export interface VisionSpikeToolCall {
  name: string;
  status?: string;
  /** Bounded tool argument text, used only for target matching. */
  input?: string;
  output?: string;
  error?: string;
}

export interface VisionSpikeMessage {
  id: string;
  role: string;
  created: number;
  completed?: number;
  parentId?: string;
  text: string;
  tools?: VisionSpikeToolCall[];
}

export interface VisionSpikeDependencies {
  detectFlavor(): Promise<"v1" | "v2">;
  health(): Promise<{ ok: boolean; version?: string }>;
  listModels(): Promise<
    {
      providerId: string;
      modelId: string;
      supportsImage?: boolean | "unknown";
    }[]
  >;
  createSession(input: { title: string; directory: string }): Promise<{ id: string }>;
  getSession(
    sessionId: string,
  ): Promise<{ id: string; directory?: string } | null>;
  getSessionStatuses(): Promise<Map<string, string>>;
  getMessages(sessionId: string): Promise<VisionSpikeMessage[]>;
  listPermissions(
    sessionId?: string,
  ): Promise<{ id: string; sessionId: string; action: string }[]>;
  submitImages(input: {
    sessionId: string;
    prompt: string;
    messageId: string;
    model: { providerId: string; modelId: string };
    images: { mimeType: string; filename: string; data: Buffer }[];
  }): Promise<{ endpoint: string; requestKeys: string[]; status: number; elapsedMs: number }>;
}

export interface VisionSpikeImage {
  png: Buffer;
  /** The count the runtime must read from the pixels. */
  count: number;
}

export interface DenyProbe {
  capability: string;
  prompt: string;
  /** Content that must never surface when the operation is really denied. */
  sentinel: string;
  /**
   * What a credible refusal must refer to. When declared, the refusing call has
   * to be one of `tools` and/or mention `target`, so an unrelated refusal in the
   * same reply cannot stand for this capability.
   */
  expects?: { tools?: string[]; target?: string };
  /**
   * Reports whether the forbidden side effect actually happened (for example a
   * file that must not exist). A true result fails the probe.
   */
  sideEffect?: () => boolean | Promise<boolean>;
}

export interface AllowProbe {
  knowledgeId: string;
  /** Fragment that only the controlled allowed read can return. */
  marker: string;
  /**
   * Tool names this runtime must use for the allowed read. Empty means the
   * caller cannot declare them, so the check stays NOT VERIFIED rather than
   * guessing a name.
   */
  tools: string[];
}

export interface VisionSpikeOptions {
  /** Isolation facts. The harness refuses a session outside `executionDir`. */
  dataDir: string;
  executionDir: string;
  /** Explicit opt-in. Without it no request of any kind is made. */
  allowRealCalls: boolean;
  images: VisionSpikeImage[];
  timeoutMs?: number;
  asyncMaxMs?: number;
  /** Sensitive values that must never appear in the evidence. */
  secrets?: string[];
  allowProbe?: AllowProbe;
  denyProbes?: DenyProbe[];
  /**
   * Collects the Workbench-side artifacts (jobs, logs, notices) produced by
   * *this* run. Without it the leakage check can only speak for the harness
   * report itself.
   */
  artifactScan?: (run: {
    runId: string;
    sessionId?: string;
  }) => Promise<ArtifactEvidence>;
}

/** Artifact classes that must be covered before "no leakage" can be claimed. */
export const REQUIRED_ARTIFACT_SCOPES = ["job", "log", "notice"] as const;

export interface ArtifactItem {
  label: string;
  text: string;
  /** The collector could not read the whole artifact. */
  truncated?: boolean;
}

export interface ArtifactEvidence {
  /** Where the artifacts came from (for example a temp Job directory). */
  source: string;
  /** Must equal the run id the harness generated for this execution. */
  runId: string;
  /** When the artifacts were collected; must belong to this run. */
  collectedAt: string;
  /** Artifact classes actually covered by this collection. */
  scope: string[];
  items: ArtifactItem[];
}

export interface VisionSpikeCheckResult {
  status: VisionSpikeStatus;
  detail: string;
}

export interface VisionSpikeReport {
  schema: "swb.vision-spike/2";
  startedAt: string;
  /** Identity of this execution; artifact evidence must be filtered by it. */
  runId: string;
  optIn: boolean;
  isolation: {
    directorySeparated: boolean;
    dataDirLabel: string;
    executionDirLabel: string;
    sessionDirectoryMatches?: boolean;
  };
  runtime?: { version: string; flavor: string; model?: string; models: number };
  transport?: {
    endpoint: string;
    candidateRequestKeys: string[];
    status: number;
    submitElapsedMs: number;
    /** Supplementary: the status map may lag the runtime by a few ms. */
    busyAtReturn: boolean;
    /** Decisive: a finished reply already existed when submit returned. */
    replyExistedAtReturn: boolean;
  };
  image?: { width: number; height: number; bytes: number; mime: string };
  images?: { width: number; height: number; bytes: number; mime: string }[];
  correlation?: { mode: "parent"; imageIndex: number };
  artifacts?: {
    source: string;
    scanned: number;
    scope: string[];
    runId: string;
    collectedAt: string;
  };
  checks: Record<VisionSpikeCheck, VisionSpikeCheckResult>;
  conclusion: VisionSpikeStatus;
  reason: string;
}

function notVerified(detail: string): VisionSpikeCheckResult {
  return { status: "NOT VERIFIED", detail };
}

export function directoriesSeparated(dataDir: string, executionDir: string) {
  const data = path.resolve(dataDir);
  const execution = path.resolve(executionDir);
  return (
    data !== execution &&
    !execution.startsWith(data + path.sep) &&
    !data.startsWith(execution + path.sep)
  );
}

function realpath(value: string) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/**
 * High-contrast count fixture: `count` separated red squares on white, so the
 * shapes can be counted independently. The answer exists only in the pixels.
 */
export async function makeCountImage(count: number) {
  const cell = 64;
  const gap = 48;
  const height = 128;
  const width = count * cell + (count + 1) * gap;
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let index = 0; index < count; index++) {
    const x0 = gap + index * (cell + gap);
    const y0 = (height - cell) / 2;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const offset = ((y0 + y) * width + x0 + x) * 3;
        pixels[offset] = 200;
        pixels[offset + 1] = 24;
        pixels[offset + 2] = 24;
      }
  }
  const png = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
  return { png, width, height };
}

/** Counts 4-connected non-white regions; used to prove the fixture is countable. */
export function countRedRegions(
  pixels: Buffer,
  width: number,
  height: number,
): number {
  const isRed = (x: number, y: number) => {
    const offset = (y * width + x) * 3;
    return pixels[offset] < 250 && pixels[offset + 1] < 128;
  };
  const seen = new Uint8Array(width * height);
  let regions = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (seen[y * width + x] || !isRed(x, y)) continue;
      regions++;
      const stack = [[x, y]];
      seen[y * width + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (seen[ny * width + nx] || !isRed(nx, ny)) continue;
          seen[ny * width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
    }
  return regions;
}

/**
 * Decodes a PNG fixture and counts its shapes. Lives in the server module so
 * the root CLI never has to resolve a server-only dependency.
 */
export async function countRegionsInPng(png: Uint8Array): Promise<number> {
  const raw = await sharp(Buffer.from(png))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return countRedRegions(raw.data, raw.info.width, raw.info.height);
}

/**
 * A complete answer is exactly one integer (an optional trailing full stop is
 * tolerated). Numbers embedded in prose are not an answer.
 */
export function parseIntegerAnswer(text: string): number | undefined {
  const trimmed = text.replace(/\*\*/g, "").trim();
  const match = trimmed.match(/^([0-9]{1,3})[.。]?$/);
  return match ? Number(match[1]) : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CorrelationResult {
  message?: VisionSpikeMessage;
  mode?: "parent";
  detail: string;
}

/**
 * Finds the finished assistant reply that belongs to one submitted request.
 *
 * Correlation is only accepted from the request field the runtime actually
 * reports (`parentId === the prompt message id`). There is deliberately no
 * positional, timestamp or order-based fallback: guessing would let an
 * unrelated reply answer the question, so an absent field means NOT VERIFIED.
 * Uncompleted fragments, user echoes, older history and other requests never
 * satisfy this, and a message that later becomes final is re-evaluated every
 * poll instead of being skipped by id.
 */
async function correlatedReply(
  dependencies: VisionSpikeDependencies,
  sessionId: string,
  promptMessageId: string,
  consumed: Set<string>,
  timeoutMs: number,
): Promise<CorrelationResult> {
  const deadline = Date.now() + timeoutMs;
  let sawPrompt = false;
  let sawUnfinished = false;
  let sawUncorrelated = false;
  let sawMissingCorrelationField = false;
  while (Date.now() < deadline) {
    const messages = await dependencies.getMessages(sessionId);
    sawPrompt ||= messages.some((message) => message.id === promptMessageId);
    const correlated = messages.filter(
      (message) =>
        message.role === "assistant" &&
        message.parentId === promptMessageId &&
        message.completed !== undefined &&
        !consumed.has(message.id),
    );
    if (correlated.length)
      return {
        message: correlated[0],
        mode: "parent",
        detail: "按 runtime 报告的请求关联字段匹配且已完成",
      };
    sawUnfinished ||= messages.some(
      (message) =>
        message.role === "assistant" &&
        message.parentId === promptMessageId &&
        message.completed === undefined &&
        message.text.trim(),
    );
    sawUncorrelated ||= messages.some(
      (message) =>
        message.role === "assistant" &&
        message.parentId !== undefined &&
        message.parentId !== promptMessageId &&
        message.completed !== undefined,
    );
    sawMissingCorrelationField ||= messages.some(
      (message) =>
        message.role === "assistant" &&
        message.parentId === undefined &&
        message.completed !== undefined,
    );
    await sleep(50);
  }
  return {
    detail: !sawPrompt
      ? "session 中没有本次提交的请求消息，缺少请求关联证据"
      : sawUnfinished
        ? "只看到未完成的回复片段，没有收到请求关联的最终回复"
        : sawMissingCorrelationField
          ? "runtime 未提供请求关联字段；按顺序或时间猜测不被采信"
          : sawUncorrelated
            ? "只看到其他请求的回复，本请求没有可关联的最终回复"
            : "没有收到本次请求对应的最终 assistant 回复",
  };
}

function combine(
  results: VisionSpikeStatus[],
  passDetail: string,
  pendingDetail: string,
): VisionSpikeCheckResult {
  if (results.includes("FAIL"))
    return { status: "FAIL", detail: results.length ? "存在明确失败" : "失败" };
  if (results.length && results.every((status) => status === "PASS"))
    return { status: "PASS", detail: passDetail };
  return notVerified(pendingDetail);
}

/** A policy refusal, as opposed to an ordinary tool failure. */
const POLICY_REFUSAL =
  /permission denied|not allowed|not permitted|forbidden|blocked by policy|denied by policy|policy|unauthorized|拒绝执行|无权限|不允许|被禁止/i;
/** Failures that are explicitly not policy refusals. */
const INCIDENTAL_FAILURE =
  /not found|no such file|does not exist|unknown tool|tool not found|unrecognized|enoent|econnrefused|connection|timeout|timed out|rate ?limit|unsupported/i;

type RefusalClass = "policy" | "incidental" | "none";

/**
 * Classifies a tool call result. A generic `error`/`failed` status, a missing
 * file, an unknown tool or a connection problem is not evidence that a policy
 * refused the operation, and a model that merely says it cannot read something
 * produces no call at all.
 */
function refusalClass(call: VisionSpikeToolCall): RefusalClass {
  const status = String(call.status ?? "").toLowerCase();
  const evidence = `${call.error ?? ""} ${call.output ?? ""} ${call.input ?? ""}`;
  if (status === "denied" || status === "rejected") return "policy";
  if (INCIDENTAL_FAILURE.test(evidence) && !POLICY_REFUSAL.test(evidence))
    return "incidental";
  if (POLICY_REFUSAL.test(evidence)) return "policy";
  return "none";
}

/** True only for a successful call with an explicit success status. */
function isSuccessfulCall(call: VisionSpikeToolCall): boolean {
  return /^(completed|success|succeeded)$/i.test(String(call.status ?? ""));
}

function callMatches(
  call: VisionSpikeToolCall,
  expects?: { tools?: string[]; target?: string },
): boolean {
  if (!expects) return true;
  if (expects.tools?.length && !expects.tools.includes(call.name)) return false;
  if (expects.target) {
    const haystack = `${call.input ?? ""} ${call.output ?? ""} ${call.error ?? ""}`;
    if (!haystack.includes(expects.target)) return false;
  }
  return true;
}

export async function runVisionSpike(
  options: VisionSpikeOptions,
  dependencies: VisionSpikeDependencies,
): Promise<VisionSpikeReport> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const asyncMaxMs = options.asyncMaxMs ?? 3_000;
  const checks = Object.fromEntries(
    VISION_SPIKE_CHECKS.map((name) => [name, notVerified("未执行")]),
  ) as Record<VisionSpikeCheck, VisionSpikeCheckResult>;
  const runId = crypto.randomUUID();
  const startedMs = Date.now();
  const report: VisionSpikeReport = {
    schema: "swb.vision-spike/2",
    startedAt: new Date(startedMs).toISOString(),
    runId,
    optIn: options.allowRealCalls,
    isolation: {
      directorySeparated: directoriesSeparated(
        options.dataDir,
        options.executionDir,
      ),
      dataDirLabel: "scientific-data",
      executionDirLabel: "agent-execution",
    },
    images: options.images.map((image) => ({
      width: 0,
      height: 0,
      bytes: image.png.byteLength,
      mime: "image/png",
    })),
    image: {
      width: 0,
      height: 0,
      bytes: options.images[0]?.png.byteLength ?? 0,
      mime: "image/png",
    },
    checks,
    conclusion: "NOT VERIFIED",
    reason: "",
  };

  if (!options.allowRealCalls) {
    report.reason =
      "未显式 opt-in；harness 拒绝任何真实调用（未发出任何请求）。";
    return finalize(report);
  }
  if (!report.isolation.directorySeparated) {
    checks.isolation = { status: "FAIL", detail: "executionDir 与 dataDir 未隔离" };
    return finalize(report);
  }
  if (!options.images.length) {
    report.reason = "没有提供验证图片；不会继续。";
    return finalize(report);
  }

  const consumed = new Set<string>();
  const imageChecks: VisionSpikeStatus[] = [];
  const asyncChecks: VisionSpikeStatus[] = [];
  const imageDetails: string[] = [];
  let sessionId: string | undefined;

  try {
    const flavor = await dependencies.detectFlavor();
    const health = await dependencies.health();
    const models = await dependencies.listModels();
    const vision = models.find((item) => item.supportsImage === true);
    report.runtime = {
      version: health.version ?? "unknown",
      flavor,
      model: vision ? `${vision.providerId}/${vision.modelId}` : undefined,
      models: models.length,
    };
    checks.runtimeIdentityAndModel =
      vision && health.version
        ? {
            status: "PASS",
            detail: `flavor=${flavor} version=${health.version} model=${vision.providerId}/${vision.modelId}`,
          }
        : {
            status: "FAIL",
            detail: vision
              ? "运行环境未报告版本，无法确认身份"
              : "运行环境没有声明图片能力的模型，未尝试未证实的 transport",
          };
    if (!vision || !health.version) return finalize(report);
    const model = { providerId: vision.providerId, modelId: vision.modelId };

    const created = await dependencies.createSession({
      title: "swb-vision-spike",
      directory: options.executionDir,
    });
    sessionId = created.id;
    const session = await dependencies.getSession(created.id);
    const sessionDirectoryMatches =
      !!session?.directory &&
      realpath(session.directory) === realpath(options.executionDir);
    report.isolation.sessionDirectoryMatches = sessionDirectoryMatches;
    if (!session)
      checks.isolation = { status: "FAIL", detail: "创建后无法读取 session" };
    else if (sessionDirectoryMatches)
      checks.isolation = {
        status: "PASS",
        detail: "实际 session 的 directory 等于专属 Agent 目录",
      };
    else
      checks.isolation = {
        status: "FAIL",
        detail: `实际 session directory=${session.directory ?? "未知"}，不是专属 Agent 目录`,
      };
    if (checks.isolation.status !== "PASS") {
      // Isolation failure stops the run: nothing else may be submitted while the
      // session is not provably inside the dedicated directory.
      for (const name of [
        "asyncSubmission",
        "correlatedImageAnswer",
        "restrictedAllow",
        "restrictedDeny",
      ] as const)
        checks[name] = notVerified("隔离检查失败，已停止后续提交");
      report.reason = "隔离检查未通过，未执行任何图片或权限提交。";
      return finalize(report);
    }

    const prompt =
      "数一数图中有几个独立的红色方块，只回答一个阿拉伯数字，不要解释。";
    for (const [index, image] of options.images.entries()) {
      const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
      const submission = await dependencies.submitImages({
        sessionId: created.id,
        prompt,
        messageId,
        model,
        images: [{ mimeType: "image/png", filename: `pattern.png`, data: image.png }],
      });
      // The decisive evidence that the request was submitted asynchronously is
      // that the finished reply did not exist yet when submit returned. The
      // runtime status map is recorded as supplementary evidence only, because
      // it can lag a genuinely asynchronous runtime by a few milliseconds.
      const atReturn = await dependencies.getMessages(created.id);
      const replyExistedAtReturn = atReturn.some(
        (message) =>
          message.role === "assistant" &&
          message.parentId === messageId &&
          message.completed !== undefined,
      );
      const statuses = await dependencies.getSessionStatuses();
      const busyAtReturn = statuses.get(created.id) === "busy";
      if (index === 0)
        report.transport = {
          endpoint: submission.endpoint,
          candidateRequestKeys: submission.requestKeys,
          status: submission.status,
          submitElapsedMs: submission.elapsedMs,
          busyAtReturn,
          replyExistedAtReturn,
        };
      asyncChecks.push(
        !replyExistedAtReturn && submission.elapsedMs < asyncMaxMs
          ? "PASS"
          : "FAIL",
      );
      if (replyExistedAtReturn || submission.elapsedMs >= asyncMaxMs) {
        imageDetails.push(
          `图片 ${index + 1}：提交 ${submission.elapsedMs}ms 返回，返回时已有最终回复=${replyExistedAtReturn}，busy=${busyAtReturn}`,
        );
        continue;
      }
      const correlated = await correlatedReply(
        dependencies,
        created.id,
        messageId,
        consumed,
        timeoutMs,
      );
      if (!correlated.message) {
        imageChecks.push("NOT VERIFIED");
        imageDetails.push(`图片 ${index + 1}：${correlated.detail}`);
        continue;
      }
      consumed.add(correlated.message.id);
      report.correlation ??= { mode: "parent", imageIndex: index };
      const answer = parseIntegerAnswer(correlated.message.text);
      if (answer === undefined) {
        imageChecks.push("FAIL");
        imageDetails.push(`图片 ${index + 1}：最终回复不是单个整数`);
      } else if (answer === image.count) {
        imageChecks.push("PASS");
        imageDetails.push(
          `图片 ${index + 1}：请求关联的已完成回复读出 ${image.count}`,
        );
      } else {
        imageChecks.push("FAIL");
        imageDetails.push(
          `图片 ${index + 1}：请求关联的已完成回复答案错误（${answer}）`,
        );
      }
    }
    checks.asyncSubmission = combine(
      asyncChecks,
      "每次图片提交都在阈值内返回，且返回时尚不存在最终回复",
      "存在未能证明为异步的提交",
    );
    checks.correlatedImageAnswer = combine(
      imageChecks,
      imageDetails.join("；"),
      imageDetails.join("；") || "没有取得请求关联的最终回复",
    );
    if (checks.correlatedImageAnswer.status === "FAIL")
      checks.correlatedImageAnswer.detail = imageDetails.join("；");

    await runRestrictedChecks(
      options,
      dependencies,
      checks,
      created.id,
      model,
      consumed,
      timeoutMs,
    );
  } catch (error) {
    report.reason = `探针执行失败：${sanitize(String((error as Error).message), options.secrets)}`;
    for (const name of VISION_SPIKE_CHECKS)
      if (checks[name].detail === "未执行")
        checks[name] = notVerified(report.reason);
  }

  checks.noSensitiveWorkbenchLeakage = await checkLeakage(
    options,
    report,
    runId,
    startedMs,
    sessionId,
  );
  return finalize(report);
}

async function runRestrictedChecks(
  options: VisionSpikeOptions,
  dependencies: VisionSpikeDependencies,
  checks: Record<VisionSpikeCheck, VisionSpikeCheckResult>,
  sessionId: string,
  model: { providerId: string; modelId: string },
  consumed: Set<string>,
  timeoutMs: number,
) {
  const allow = options.allowProbe;
  if (!allow) {
    checks.restrictedAllow = notVerified("未提供 allow 探针定义");
  } else if (!allow.tools.length) {
    checks.restrictedAllow = notVerified(
      "调用方未声明允许工具名单，无法证明调用的是允许的工具",
    );
  } else {
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    await dependencies.submitImages({
      sessionId,
      prompt: `请用 workbench 知识工具读取 ${allow.knowledgeId}，并复述其中出现的一行内容。`,
      messageId,
      model,
      images: [],
    });
    const correlated = await correlatedReply(
      dependencies,
      sessionId,
      messageId,
      consumed,
      timeoutMs,
    );
    if (!correlated.message) {
      checks.restrictedAllow = notVerified(
        `allow：${correlated.detail}；模型自述或历史消息不作为证据`,
      );
    } else {
      consumed.add(correlated.message.id);
      const calls = correlated.message.tools ?? [];
      const disallowed = calls.filter(
        (call) => !allow.tools.includes(call.name),
      );
      const allowed = calls.find((call) => allow.tools.includes(call.name));
      if (!calls.length)
        checks.restrictedAllow = notVerified(
          "allow：runtime 未提供工具调用证据，无法证明允许的读取实际发生",
        );
      else if (!allowed)
        checks.restrictedAllow = {
          status: "FAIL",
          detail: "allow：本次回复没有调用声明的允许工具",
        };
      else if (refusalClass(allowed) === "policy")
        checks.restrictedAllow = {
          status: "FAIL",
          detail: "allow：允许的读取调用被拒绝",
        };
      else if (!isSuccessfulCall(allowed))
        // A missing status is not a success: it must not default to PASS.
        checks.restrictedAllow = notVerified(
          "allow：允许的读取调用没有明确的成功状态，不能默认为成功",
        );
      else if (!allowed.output || !allowed.output.includes(allow.marker))
        checks.restrictedAllow = notVerified(
          "allow：调用成功但没有可核对的返回内容，无法确认与受控读取一致",
        );
      else if (
        disallowed.some(
          (call) => isSuccessfulCall(call) || refusalClass(call) === "none",
        )
      )
        checks.restrictedAllow = {
          status: "FAIL",
          detail: "allow：探针期间执行了声明之外的工具调用",
        };
      else
        checks.restrictedAllow = {
          status: "PASS",
          detail: "请求关联的调用成功，返回内容与受控读取一致",
        };
    }
  }

  const probes = options.denyProbes ?? [];
  const missing = REQUIRED_DENY_CAPABILITIES.filter(
    (capability) =>
      !probes.some((probe) => probe.capability === capability),
  );
  const leaked: string[] = [];
  const unproven: string[] = [];
  let pendingPermissionSeen = false;
  for (const probe of probes) {
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    await dependencies.submitImages({
      sessionId,
      prompt: probe.prompt,
      messageId,
      model,
      images: [],
    });
    const correlated = await correlatedReply(
      dependencies,
      sessionId,
      messageId,
      consumed,
      timeoutMs,
    );
    const permissions = await dependencies.listPermissions(sessionId);
    if (permissions.length) pendingPermissionSeen = true;
    if (!correlated.message) {
      unproven.push(`${probe.capability}：${correlated.detail}`);
      continue;
    }
    consumed.add(correlated.message.id);
    const calls = correlated.message.tools ?? [];
    const sentinelVisible =
      correlated.message.text.includes(probe.sentinel) ||
      calls.some(
        (call) =>
          (call.output ?? "").includes(probe.sentinel) ||
          (call.error ?? "").includes(probe.sentinel),
      );
    if (sentinelVisible) {
      leaked.push(probe.capability);
      continue;
    }
    if (probe.sideEffect && (await probe.sideEffect())) {
      leaked.push(`${probe.capability}（副作用）`);
      continue;
    }
    // Only a policy refusal that really refers to this capability counts. An
    // incidental tool error, a missing file or an unknown tool is not evidence.
    const policyRefusals = calls.filter(
      (call) => refusalClass(call) === "policy" && callMatches(call, probe.expects),
    );
    if (policyRefusals.length) continue;
    const incidental = calls.filter(
      (call) => refusalClass(call) === "incidental",
    );
    unproven.push(
      incidental.length
        ? `${probe.capability}：只有普通工具错误（非策略拒绝）`
        : calls.length
          ? `${probe.capability}：调用存在但没有匹配该能力的策略拒绝证据`
          : `${probe.capability}：没有可观察的调用或拒绝证据`,
    );
  }
  if (leaked.length)
    checks.restrictedDeny = {
      status: "FAIL",
      detail: `被拒绝的操作实际可读或有副作用：${leaked.join("、")}`,
    };
  else if (missing.length || unproven.length || pendingPermissionSeen)
    // A pending permission means the runtime asked instead of refusing, so it
    // neither grants nor denies: it cannot support a PASS.
    checks.restrictedDeny = notVerified(
      [
        missing.length ? `未覆盖的范围：${missing.join("、")}` : "",
        unproven.length ? `缺少拒绝证据：${unproven.join("；")}` : "",
        pendingPermissionSeen
          ? "探针期间出现待处理权限：不等于已授予，也不等于已拒绝"
          : "",
      ]
        .filter(Boolean)
        .join("；"),
    );
  else
    checks.restrictedDeny = {
      status: "PASS",
      detail: `每个必需范围都有本次请求关联的策略拒绝证据（共 ${probes.length} 项）`,
    };
}

async function checkLeakage(
  options: VisionSpikeOptions,
  report: VisionSpikeReport,
  runId: string,
  startedMs: number,
  sessionId?: string,
): Promise<VisionSpikeCheckResult> {
  const secrets = (options.secrets ?? []).filter(Boolean);
  const imagePrefixes = options.images.map((image) =>
    image.png.subarray(0, 48).toString("base64"),
  );
  // 1. The report itself is always checked, and that is all this half proves.
  const reportLeaks = collectLeakCategories(
    JSON.stringify(report),
    secrets,
    imagePrefixes,
    options.dataDir,
  );
  if (reportLeaks.length)
    return {
      status: "FAIL",
      detail: `harness 报告未脱敏（${reportLeaks.join("、")}）`,
    };
  // 2. Workbench artifacts can only be judged when this run's artifacts were
  //    actually collected, with a provable association and coverage.
  if (!options.artifactScan)
    return notVerified(
      `只检查了 harness 报告自身；未采集本次 run（${runId}）的 Workbench Job／日志产物，无法声称无泄漏`,
    );
  let evidence: ArtifactEvidence;
  try {
    evidence = await options.artifactScan({ runId, sessionId });
  } catch (error) {
    return notVerified(
      `产物采集失败：${sanitize(String((error as Error).message), secrets)}`,
    );
  }
  if (evidence.runId !== runId)
    return notVerified(
      "产物证据不属于本次 run，无法证明覆盖了本轮产物",
    );
  const collectedAt = Date.parse(evidence.collectedAt);
  if (
    !Number.isFinite(collectedAt) ||
    collectedAt < startedMs - 5 * 60_000 ||
    collectedAt > Date.now() + 60_000
  )
    return notVerified("产物采集时间不属于本次 run，无法排除陈旧文件");
  const missingScopes = REQUIRED_ARTIFACT_SCOPES.filter(
    (scope) => !evidence.scope.includes(scope),
  );
  if (missingScopes.length)
    return notVerified(
      `产物覆盖范围不足，缺少：${missingScopes.join("、")}`,
    );
  if (!evidence.items.length)
    return notVerified("采集到 0 个产物，无法声称无泄漏");
  const truncated = evidence.items.filter((item) => item.truncated);
  if (truncated.length)
    return notVerified(
      `存在未完整读取的产物（${truncated.length} 个），覆盖范围不足`,
    );
  report.artifacts = {
    source: sanitize(evidence.source, secrets),
    scanned: evidence.items.length,
    scope: [...evidence.scope],
    runId,
    collectedAt: evidence.collectedAt,
  };
  const leaks: string[] = [];
  for (const item of evidence.items) {
    const categories = collectLeakCategories(
      item.text,
      secrets,
      imagePrefixes,
      options.dataDir,
    );
    // Only categories and a label are reported, never the sensitive text.
    for (const category of categories)
      leaks.push(`${sanitize(item.label, secrets)}/${category}`);
  }
  if (leaks.length)
    return { status: "FAIL", detail: `产物中发现泄漏类别：${leaks.join("、")}` };
  return {
    status: "PASS",
    detail: `报告与本次 run 的 ${evidence.items.length} 个产物（覆盖 ${evidence.scope.join("/")}）均未发现图片字节、凭据或工作区路径`,
  };
}

function collectLeakCategories(
  text: string,
  secrets: string[],
  imagePrefixes: string[],
  dataDir: string,
): string[] {
  const categories: string[] = [];
  if (secrets.some((secret) => text.includes(secret))) categories.push("凭据");
  if (imagePrefixes.some((prefix) => prefix && text.includes(prefix)))
    categories.push("图片字节");
  if (dataDir && text.includes(dataDir)) categories.push("工作区路径");
  if (/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{64,}/i.test(text))
    categories.push("内联图片载荷");
  return categories;
}

function finalize(report: VisionSpikeReport): VisionSpikeReport {
  const statuses = VISION_SPIKE_CHECKS.map((name) => report.checks[name].status);
  if (statuses.includes("FAIL")) {
    report.conclusion = "FAIL";
    report.reason =
      report.reason ||
      VISION_SPIKE_CHECKS.filter(
        (name) => report.checks[name].status === "FAIL",
      )
        .map((name) => report.checks[name].detail)
        .join("；");
  } else if (statuses.every((status) => status === "PASS")) {
    report.conclusion = "PASS";
    report.reason = "全部检查均有真实证据。";
  } else {
    report.conclusion = "NOT VERIFIED";
    report.reason =
      report.reason ||
      VISION_SPIKE_CHECKS.filter(
        (name) => report.checks[name].status !== "PASS",
      )
        .map((name) => `${name}: ${report.checks[name].detail}`)
        .join("；");
  }
  return report;
}

/** Removes credentials, image payloads and workspace paths from any text. */
export function sanitize(value: string, secrets: string[] = []): string {
  let text = String(value ?? "");
  for (const secret of secrets)
    if (secret) text = text.split(secret).join("***");
  text = text.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi, "data:image/***");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}
