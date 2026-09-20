/**
 * Vision compatibility spike harness.
 *
 * Real model calls are opt-in only (`SWB_VISION_SPIKE=1`). The harness creates
 * isolated temp directories and an independent port, checks that the agent
 * execution directory is separate from the scientific data directory, and
 * records only de-sensitized request shapes. It never reads or writes the
 * user's global OpenCode configuration and never prints secrets.
 *
 * An isolated real endpoint must be provided through SWB_SPIKE_OPENCODE_URL
 * (plus optional SWB_SPIKE_OPENCODE_USERNAME / SWB_SPIKE_OPENCODE_PASSWORD).
 * Without it the result is NOT VERIFIED, never a fabricated pass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import {
  createOpenCodeAdapter,
  detectOpenCodeFlavor,
  type OpenCodeModelOption,
  type ResolvedOpenCodeConfig,
} from "../apps/server/src/opencode";

interface Evidence {
  schema: "swb.vision-spike/1";
  startedAt: string;
  optIn: boolean;
  isolation: {
    dataDir: string;
    executionDir: string;
    directorySeparated: boolean;
    port: number;
  };
  runtime?: {
    version: string;
    flavor: string;
    models: number;
    visionModel?: string;
    supportsImage?: true | false | "unknown";
  };
  image?: {
    width: number;
    height: number;
    bytes: number;
    mime: string;
    answerInPixelsOnly: boolean;
  };
  transport?: {
    candidate: string;
    requestKeys: string[];
    status: number;
    elapsedMs: number;
  };
  vision?: { matched: boolean; answerLength: number };
  conclusion: "PASS" | "FAIL" | "NOT VERIFIED";
  reason: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** Renders `count` red squares on white; the answer exists only in pixels. */
function makeCountImage(count: number) {
  const cell = 64;
  const width = (count + 1) * cell;
  const height = cell * 2;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      const row = y > cell / 2 && y < cell * 1.5;
      const column = Math.floor((x - cell / 2) / cell);
      const red = row && x > cell / 2 && x < width - cell / 2 && column < count;
      png.data[index] = red ? 220 : 255;
      png.data[index + 1] = red ? 30 : 255;
      png.data[index + 2] = red ? 30 : 255;
      png.data[index + 3] = 255;
    }
  return { data: PNG.sync.write(png), width, height };
}

function emit(evidence: Evidence) {
  console.error(JSON.stringify(evidence, null, 2));
}

async function main() {
  const optIn = process.env.SWB_VISION_SPIKE === "1";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-vision-spike-"));
  const dataDir = path.join(root, "scientific-data");
  const executionDir = path.join(root, "agent-execution");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(executionDir, { recursive: true });
  const port = await freePort();
  const evidence: Evidence = {
    schema: "swb.vision-spike/1",
    startedAt: new Date().toISOString(),
    optIn,
    isolation: {
      dataDir,
      executionDir,
      directorySeparated:
        path.resolve(executionDir) !== path.resolve(dataDir) &&
        !path.resolve(executionDir).startsWith(path.resolve(dataDir) + path.sep) &&
        !path.resolve(dataDir).startsWith(path.resolve(executionDir) + path.sep),
      port,
    },
    conclusion: "NOT VERIFIED",
    reason: "",
  };
  try {
    if (!optIn) {
      evidence.reason =
        "未设置 SWB_VISION_SPIKE=1；harness 拒绝真实调用（opt-in 保护生效）。";
      emit(evidence);
      process.exitCode = 1;
      return;
    }
    if (!evidence.isolation.directorySeparated) {
      evidence.conclusion = "FAIL";
      evidence.reason = "executionDir 与 scientific dataDir 未隔离，拒绝运行。";
      emit(evidence);
      process.exitCode = 1;
      return;
    }
    const count = 3 + crypto.randomInt(0, 6);
    const image = makeCountImage(count);
    evidence.image = {
      width: image.width,
      height: image.height,
      bytes: image.data.byteLength,
      mime: "image/png",
      answerInPixelsOnly: true,
    };
    const baseUrl = process.env.SWB_SPIKE_OPENCODE_URL;
    if (!baseUrl) {
      evidence.reason =
        "未提供隔离的真实 OpenCode 端点（SWB_SPIKE_OPENCODE_URL）。为不读取/修改用户全局配置，真实 vision/profile 记为 NOT VERIFIED；普通 V1 文本 runtime 不受影响。";
      emit(evidence);
      return;
    }
    const config: ResolvedOpenCodeConfig = {
      baseUrl,
      username: process.env.SWB_SPIKE_OPENCODE_USERNAME || "opencode",
      executionDir,
      permissionMode: "ask",
      password: process.env.SWB_SPIKE_OPENCODE_PASSWORD,
    };
    const flavor = await detectOpenCodeFlavor(config);
    const adapter = createOpenCodeAdapter(config);
    const health = await adapter.health();
    const models: OpenCodeModelOption[] = await adapter.listModels();
    const vision = models.find((model) => model.supportsImage === true);
    evidence.runtime = {
      version: health.version ?? "unknown",
      flavor,
      models: models.length,
      visionModel: vision
        ? `${vision.providerId}/${vision.modelId}`
        : undefined,
      supportsImage: vision?.supportsImage,
    };
    if (!vision) {
      evidence.reason =
        "已连接运行环境，但没有声明图片能力的模型；未尝试未证实的 transport。";
      emit(evidence);
      return;
    }
    // Experimental candidate only; the adapter is not changed unless a real
    // pixel answer is read back, so no unverified flavor is enabled.
    const promptText =
      "回答图片中红色方块的数量，只输出一个阿拉伯数字，不要解释。";
    const candidates: { name: string; body: unknown }[] = [
      {
        name: "v1-parts-file",
        body: {
          model: { providerID: vision.providerId, modelID: vision.modelId },
          parts: [
            { type: "text", text: promptText },
            {
              type: "file",
              mime: "image/png",
              filename: "pattern.png",
              data: image.data.toString("base64"),
            },
          ],
        },
      },
    ];
    for (const candidate of candidates) {
      const before = Date.now();
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(candidate.body),
        });
        evidence.transport = {
          candidate: candidate.name,
          requestKeys: Object.keys(candidate.body as object),
          status: response.status,
          elapsedMs: Date.now() - before,
        };
        if (!response.ok) {
          evidence.reason = `候选 transport 返回 ${response.status}；未取得像素答案。`;
          continue;
        }
        const text = await response.text();
        const matched = new RegExp(`\\b${count}\\b`).test(text);
        evidence.vision = { matched, answerLength: text.length };
        evidence.conclusion = matched ? "PASS" : "NOT VERIFIED";
        evidence.reason = matched
          ? `模型从像素读出未知数量（${count}）。`
          : "请求成功但没有读出图片中的未知内容，未记 PASS。";
        break;
      } catch (error) {
        evidence.transport = {
          candidate: candidate.name,
          requestKeys: Object.keys(candidate.body as object),
          status: -1,
          elapsedMs: Date.now() - before,
        };
        evidence.reason = `候选 transport 失败：${(error as Error).message}`;
      }
    }
    emit(evidence);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
