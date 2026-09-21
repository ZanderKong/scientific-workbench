/**
 * Vision compatibility spike CLI.
 *
 * Real model calls are opt-in only (`SWB_VISION_SPIKE=1`). Without the opt-in
 * flag nothing is requested at all. An isolated real endpoint must be provided
 * through SWB_SPIKE_OPENCODE_URL (plus optional
 * SWB_SPIKE_OPENCODE_USERNAME / SWB_SPIKE_OPENCODE_PASSWORD). Without it the
 * result is NOT VERIFIED, never a fabricated pass.
 *
 * The executable logic lives in `apps/server/src/vision-spike.ts` so tests can
 * import it; this file only sets up isolation, opt-in and reporting. Importing
 * it never performs a request.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  detectOpenCodeFlavor,
  ensureExecutionDirectory,
  createOpenCodeAdapter,
  OpenCodeError,
  submitExperimentalImagePrompt,
  validateOpenCodeBaseUrl,
  type ResolvedOpenCodeConfig,
} from "../apps/server/src/opencode";
import { getKnowledge } from "../apps/server/src/knowledge";
import {
  makeCountImage,
  runVisionSpike,
  sanitize,
  type VisionSpikeDependencies,
  type VisionSpikeOptions,
} from "../apps/server/src/vision-spike";

const ALLOW_KNOWLEDGE_ID = "protocol-common";

async function main() {
  const optIn = process.env.SWB_VISION_SPIKE === "1";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-vision-spike-"));
  const dataDir = path.join(root, "scientific-data");
  const executionDir = path.join(root, "agent-execution");
  const denyDir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-vision-deny-"));
  const denyFile = path.join(denyDir, "sentinel.txt");
  const denyMarker = `DENY-${crypto.randomUUID()}`;
  try {
    if (!optIn) {
      console.error(
        JSON.stringify(
          {
            schema: "swb.vision-spike/2",
            optIn: false,
            conclusion: "NOT VERIFIED",
            reason:
              "未设置 SWB_VISION_SPIKE=1；harness 拒绝任何真实调用（未发出任何请求）。",
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(executionDir, { recursive: true });
    fs.writeFileSync(denyFile, denyMarker);

    const baseUrl = process.env.SWB_SPIKE_OPENCODE_URL;
    const image = await makeCountImage(3 + crypto.randomInt(0, 6));
    const knowledge = getKnowledge(ALLOW_KNOWLEDGE_ID);
    const marker = knowledge.content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 12);
    if (!baseUrl) {
      console.error(
        JSON.stringify(
          {
            schema: "swb.vision-spike/2",
            optIn: true,
            isolation: { directorySeparated: true },
            image: {
              width: image.width,
              height: image.height,
              bytes: image.png.byteLength,
              mime: "image/png",
            },
            checks: {},
            conclusion: "NOT VERIFIED",
            reason:
              "未提供隔离的真实 OpenCode 端点（SWB_SPIKE_OPENCODE_URL）。为不读取或修改用户全局配置，真实 vision/profile 记为 NOT VERIFIED；未发出任何真实调用。",
          },
          null,
          2,
        ),
      );
      return;
    }
    const config: ResolvedOpenCodeConfig = {
      baseUrl: validateOpenCodeBaseUrl(baseUrl),
      username: process.env.SWB_SPIKE_OPENCODE_USERNAME || "opencode",
      password: process.env.SWB_SPIKE_OPENCODE_PASSWORD,
      executionDir: ensureExecutionDirectory(executionDir),
      permissionMode: "ask",
    };
    const adapter = createOpenCodeAdapter(config);
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
    const options: VisionSpikeOptions = {
      dataDir,
      executionDir: config.executionDir,
      allowRealCalls: true,
      image: { png: image.png, count: 0 },
      secrets: [config.password ?? "", denyMarker],
      allowProbe: {
        knowledgeId: ALLOW_KNOWLEDGE_ID,
        marker: marker ?? "",
      },
      denyProbe: { file: denyFile, marker: denyMarker },
    };
    // The answer is derived from the pixels the runtime received, never from
    // the harness: only the image is passed in, the expected count is compared
    // against a shape the runtime had to read itself.
    const counted = await countFromPixels(image.png);
    options.image.count = counted;
    const report = await runVisionSpike(options, deps);
    console.error(JSON.stringify(report, null, 2));
    if (report.conclusion === "FAIL") process.exitCode = 1;
  } catch (error) {
    const detail =
      error instanceof OpenCodeError
        ? `${error.code}: ${sanitize(error.message, [process.env.SWB_SPIKE_OPENCODE_PASSWORD ?? ""])}`
        : sanitize(String((error as Error).message));
    console.error(
      JSON.stringify(
        {
          schema: "swb.vision-spike/2",
          optIn: true,
          conclusion: "FAIL",
          reason: `harness 执行失败：${detail}`,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(denyDir, { recursive: true, force: true });
  }
}

async function countFromPixels(png: Buffer) {
  const { data, info } = await (
    await import("sharp")
  )
    .default(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { countRedRegions } = await import("../apps/server/src/vision-spike");
  return countRedRegions(data, info.width, info.height);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  main().catch((error) => {
    console.error(
      JSON.stringify({
        schema: "swb.vision-spike/2",
        conclusion: "FAIL",
        reason: sanitize(String(error?.message ?? error)),
      }),
    );
    process.exit(1);
  });

export { main };
