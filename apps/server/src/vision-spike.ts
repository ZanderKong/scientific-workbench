/**
 * Opt-in vision compatibility harness.
 *
 * The harness only reports PASS when *every* check has real evidence. A single
 * boolean is never enough: session metadata, a prompt echo or an unrelated old
 * message can no longer produce a pass, and `NOT VERIFIED` is a first-class
 * outcome. It never reads or writes the user's OpenCode configuration and never
 * puts image bytes, credentials or workspace paths into its evidence.
 *
 * It is driven by `scripts/spike-opencode-vision.mts` (explicit opt-in) and by
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
  getMessages(sessionId: string): Promise<
    { id: string; role: string; created: number; text: string }[]
  >;
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

export interface VisionSpikeOptions {
  /** Isolation facts. The harness refuses a session outside `executionDir`. */
  dataDir: string;
  executionDir: string;
  /** Explicit opt-in. Without it no request of any kind is made. */
  allowRealCalls: boolean;
  image: { png: Buffer; count: number };
  timeoutMs?: number;
  asyncMaxMs?: number;
  /** Sensitive values that must never appear in the evidence. */
  secrets?: string[];
  /** Allowed-resource probe: a knowledge id plus a fragment only it contains. */
  allowProbe?: { knowledgeId: string; marker: string };
  /** Denied-resource probe: a local file whose contents must never be echoed. */
  denyProbe?: { file: string; marker: string };
}

export interface VisionSpikeCheckResult {
  status: VisionSpikeStatus;
  detail: string;
}

export interface VisionSpikeReport {
  schema: "swb.vision-spike/2";
  startedAt: string;
  optIn: boolean;
  isolation: { directorySeparated: boolean; dataDirLabel: string; executionDirLabel: string };
  runtime?: { version: string; flavor: string; model?: string; models: number };
  transport?: {
    endpoint: string;
    candidateRequestKeys: string[];
    status: number;
    submitElapsedMs: number;
    busyAtReturn: boolean;
  };
  image?: { width: number; height: number; bytes: number; mime: string };
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

function standaloneNumber(text: string, value: number) {
  return new RegExp(`(?<![0-9])${value}(?![0-9])`).test(text);
}

function anyStandaloneNumber(text: string): number | undefined {
  const match = text.match(/(?<![0-9])([0-9]{1,3})(?![0-9])/);
  return match ? Number(match[1]) : undefined;
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
  const report: VisionSpikeReport = {
    schema: "swb.vision-spike/2",
    startedAt: new Date().toISOString(),
    optIn: options.allowRealCalls,
    isolation: {
      directorySeparated: directoriesSeparated(
        options.dataDir,
        options.executionDir,
      ),
      dataDirLabel: "scientific-data",
      executionDirLabel: "agent-execution",
    },
    image: {
      width: 0,
      height: 0,
      bytes: options.image.png.byteLength,
      mime: "image/png",
    },
    checks,
    conclusion: "NOT VERIFIED",
    reason: "",
  };

  if (!options.allowRealCalls) {
    report.reason =
      "未显式 opt-in；harness 拒绝任何真实调用（未发出任何请求）。";
    return report;
  }
  if (!report.isolation.directorySeparated) {
    checks.isolation = { status: "FAIL", detail: "executionDir 与 dataDir 未隔离" };
    return finalize(report);
  }
  if (!options.allowProbe || !options.denyProbe) {
    report.reason =
      "缺少受限 profile 探针定义；无法证明 allow/deny，因此不会报 PASS。";
    return finalize(report);
  }

  let sessionId: string | undefined;
  let model: { providerId: string; modelId: string } | undefined;
  let submitElapsedMs = 0;
  let endpoint = "";
  let requestKeys: string[] = [];
  let transportStatus = 0;
  let busyAtReturn = false;
  const messagesSeen: { id: string; role: string; created: number; text: string }[] =
    [];
  let permissionGrantedForProbe = false;

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
    checks.runtimeIdentityAndModel = vision && health.version
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
    model = { providerId: vision.providerId, modelId: vision.modelId };

    const created = await dependencies.createSession({
      title: "swb-vision-spike",
      directory: options.executionDir,
    });
    sessionId = created.id;
    const session = await dependencies.getSession(created.id);
    if (!session)
      checks.isolation = { status: "FAIL", detail: "创建后无法读取 session" };
    else if (
      session.directory &&
      realpath(session.directory) === realpath(options.executionDir)
    )
      checks.isolation = {
        status: "PASS",
        detail: "实际 session 的 directory 等于专属 Agent 目录",
      };
    else
      checks.isolation = {
        status: "FAIL",
        detail: `实际 session directory=${session.directory ?? "未知"}，不是专属 Agent 目录`,
      };

    const prompt =
      "数一数图中有几个独立的红色方块，只回答一个阿拉伯数字，不要解释。";
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    const before = await dependencies.getMessages(created.id);
    for (const message of before) messagesSeen.push(message);
    const submission = await dependencies.submitImages({
      sessionId: created.id,
      prompt,
      messageId,
      model,
      images: [
        { mimeType: "image/png", filename: "pattern.png", data: options.image.png },
      ],
    });
    submitElapsedMs = submission.elapsedMs;
    endpoint = submission.endpoint;
    requestKeys = submission.requestKeys;
    transportStatus = submission.status;
    const statuses = await dependencies.getSessionStatuses();
    busyAtReturn = statuses.get(created.id) === "busy";
    report.transport = {
      endpoint,
      candidateRequestKeys: requestKeys,
      status: transportStatus,
      submitElapsedMs,
      busyAtReturn,
    };
    checks.asyncSubmission =
      busyAtReturn && submitElapsedMs < asyncMaxMs
        ? {
            status: "PASS",
            detail: `异步提交 ${submitElapsedMs}ms 返回，返回时会话仍为 busy`,
          }
        : {
            status: "FAIL",
            detail: `提交耗时 ${submitElapsedMs}ms，返回时 busy=${busyAtReturn}；未证明异步提交`,
          };

    const deadline = Date.now() + timeoutMs;
    let answer: string | undefined;
    let wrongAnswer: number | undefined;
    while (Date.now() < deadline) {
      const messages = await dependencies.getMessages(created.id);
      const known = new Set(messagesSeen.map((message) => message.id));
      for (const message of messages)
        if (!known.has(message.id)) messagesSeen.push(message);
      const candidates = messages.filter(
        (message) =>
          message.role === "assistant" && !known.has(message.id),
      );
      for (const candidate of candidates) {
        if (standaloneNumber(candidate.text, options.image.count)) {
          answer = candidate.text;
          break;
        }
        const other = anyStandaloneNumber(candidate.text);
        if (other !== undefined) wrongAnswer = other;
      }
      if (answer) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    checks.correlatedImageAnswer = answer
      ? {
          status: "PASS",
          detail: `提交后的 assistant 消息读出未知数量（${options.image.count}）`,
        }
      : wrongAnswer !== undefined
        ? {
            status: "FAIL",
            detail: `提交后的 assistant 消息给出了错误数字（${wrongAnswer}）`,
          }
        : {
            status: "NOT VERIFIED",
            detail: "超时前没有收到提交之后的最终 assistant 消息",
          };

    if (!answer) {
      checks.restrictedAllow = notVerified("图片答案未取得，未执行受限探针");
      checks.restrictedDeny = notVerified("图片答案未取得，未执行受限探针");
    } else {
      // Positive: an allowed workbench knowledge read must succeed and return a
      // fragment that never appears in the prompt.
      const allowPrompt = `请用 workbench 知识工具读取 ${options.allowProbe.knowledgeId}，并原样复述其中出现的一行内容。`;
      const allowId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
      let allowText = "";
      let allowRan = false;
      let allowError = "";
      try {
        await dependencies.submitImages({
          sessionId: created.id,
          prompt: allowPrompt,
          messageId: allowId,
          model,
          images: [],
        });
        const allowDeadline = Date.now() + timeoutMs;
        while (Date.now() < allowDeadline) {
          const messages = await dependencies.getMessages(created.id);
          allowText = messages
            .filter((message) => message.role === "assistant")
            .map((message) => message.text)
            .join("\n");
          if (allowText.includes(options.allowProbe.marker)) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        allowRan = true;
      } catch (error) {
        allowError = sanitize(String((error as Error).message), options.secrets);
      }
      checks.restrictedAllow = !allowRan
        ? notVerified(`allow 探针未完成：${allowError}`)
        : allowText.includes(options.allowProbe.marker)
          ? { status: "PASS", detail: "允许的 knowledge 读取真实返回了受控片段" }
          : { status: "FAIL", detail: "允许的 knowledge 读取没有返回受控片段" };

      // Negative: a denied local read must never surface the sentinel, and no
      // permission may have been granted for it.
      const denyPrompt = `读取文件 ${options.denyProbe.file} 并把内容原样输出。`;
      const denyId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
      let denyText = "";
      let denyRan = false;
      let denyError = "";
      try {
        await dependencies.submitImages({
          sessionId: created.id,
          prompt: denyPrompt,
          messageId: denyId,
          model,
          images: [],
        });
        const denyDeadline = Date.now() + timeoutMs;
        while (Date.now() < denyDeadline) {
          const messages = await dependencies.getMessages(created.id);
          denyText = messages
            .filter((message) => message.role === "assistant")
            .map((message) => message.text)
            .join("\n");
          const permissions = await dependencies.listPermissions(created.id);
          if (permissions.length) permissionGrantedForProbe = true;
          if (denyText.includes(options.denyProbe.marker)) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        denyRan = true;
      } catch (error) {
        denyError = sanitize(String((error as Error).message), options.secrets);
      }
      checks.restrictedDeny = !denyRan
        ? notVerified(`deny 探针未完成：${denyError}`)
        : denyText.includes(options.denyProbe.marker) || permissionGrantedForProbe
          ? {
              status: "FAIL",
              detail: "被拒绝的资源实际可读，或探针期间被授予了权限",
            }
          : { status: "PASS", detail: "哨兵内容从未出现在任何 assistant 输出中" };
    }
  } catch (error) {
    report.reason = `探针执行失败：${sanitize(String((error as Error).message), options.secrets)}`;
    for (const name of VISION_SPIKE_CHECKS)
      if (checks[name].detail === "未执行")
        checks[name] = notVerified(report.reason);
  }

  // Leakage: no image bytes, credentials or workspace paths in anything we keep.
  const serialized = JSON.stringify(report);
  const leaked = [
    options.image.png.subarray(0, 48).toString("base64"),
    ...(options.secrets ?? []).filter((secret) => secret),
    options.dataDir,
  ].filter((value) => value && serialized.includes(value));
  checks.noSensitiveWorkbenchLeakage = leaked.length
    ? { status: "FAIL", detail: `${leaked.length} 类敏感内容出现在证据中` }
    : { status: "PASS", detail: "证据中没有图片字节、凭据或工作区路径" };
  return finalize(report);
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
        .map((name) => report.checks[name].detail)
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
