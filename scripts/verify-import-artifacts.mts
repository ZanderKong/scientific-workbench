/** Dedicated S2 evidence producer. One explicitly opted-in model submission.
 * Runs the real Workbench HTTP server in a child, captures its actual stdout,
 * Store Job and TerminalNotice events. Does not expose a product API.
 */
import fs from "node:fs";
import { importReplyEnded } from "../apps/server/src/import-observation.ts";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readPrivateCredentials,
  buildDenyProbes,
} from "./spike-opencode-vision.mts";
import {
  ImportAgentRuntime,
  repositoryRoot,
  observeEffectiveImportPolicy,
  profileHashOf,
} from "../apps/server/src/sample-import-agent.ts";
import {
  createOpenCodeAdapter,
  submitExperimentalImagePrompt,
  openCodeAuthHeaders,
  detectOpenCodeFlavor,
} from "../apps/server/src/opencode.ts";
import {
  makeCountImage,
  runVisionSpike,
  type ArtifactEvidence,
} from "../apps/server/src/vision-spike.ts";

import {
  getKnowledge,
  knowledgeBundleHash,
} from "../apps/server/src/knowledge.ts";

async function child() {
  const root = process.env.SWB_ACCEPTANCE_ROOT!;
  const credentials = readPrivateCredentials();
  let calls = 0;
  const limit = Number(process.env.SWB_ACCEPTANCE_REQUEST_LIMIT ?? "1");
  if (!Number.isInteger(limit) || limit < 0 || limit > 17)
    throw new Error("无效请求预算");
  const recordCall = () => {
    if (calls >= limit) throw new Error("本次调用预算已用尽");
    calls++;
    fs.writeFileSync(
      path.join(root, "calls.json"),
      JSON.stringify({ calls, limit }),
      { mode: 0o600 },
    );
    process.send?.({ progress: { calls, limit } });
  };
  const { app, store, agentRuns } = await import("../apps/server/src/main.ts");
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let runtime: ImportAgentRuntime | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const { png } = await makeCountImage(crypto.randomInt(3, 9));
    const attachment = store.saveAttachment(png, "record.png", "image/png");
    const prepared = await store.prepareSampleImport({
      importId: crypto.randomUUID(),
      attachmentIds: [attachment.id],
    });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("没有独立端口");
    runtime = new ImportAgentRuntime({
      dataDir: store.dataDir,
      repoRoot: repositoryRoot(),
      workbenchBaseUrl: `http://127.0.0.1:${address.port}/api/v1`,
      workbenchToken: process.env.WORKBENCH_API_TOKEN!,
      model: "deepseek/deepseek-v4-flash-vision-exp",
      importId: prepared.importId,
      attemptId: prepared.attempt.id,
      endpoint: {
        baseUrl: process.env.SWB_SPIKE_OPENCODE_URL!,
        ...credentials,
      },
    });
    await runtime.ensure();
    const config = runtime.config();
    const adapter = createOpenCodeAdapter(config);
    const health = await adapter.health();
    if (health.version !== "1.18.31") throw new Error("运行时版本变化");
    const phase = process.env.SWB_ACCEPTANCE_PHASE ?? "import";
    const effective = await observeEffectiveImportPolicy(
      config,
      runtime.status().configPath,
    );
    if (phase === "preflight") {
      const headers = {
        ...openCodeAuthHeaders(config),
        "x-opencode-directory": config.executionDir,
      };
      const rawTools = await (
        await fetch(
          `${config.baseUrl}/experimental/tool?provider=deepseek&model=deepseek-v4-flash-vision-exp`,
          { headers },
        )
      ).json();
      process.send?.({
        preflight: {
          version: health.version,
          effectivePolicyVerified: Boolean(effective),
          policyHash: runtime.policyHash(),
          tools: Array.isArray(rawTools)
            ? rawTools.map((item) => item.id)
            : "unavailable",
        },
      });
      return;
    }
    if (phase === "profile") {
      const sentinel = `sentinel-${crypto.randomUUID()}`;
      const probeDir = path.join(root, "probes");
      fs.mkdirSync(probeDir, { mode: 0o700 });
      fs.writeFileSync(path.join(probeDir, "deny-read.txt"), sentinel, {
        mode: 0o600,
      });
      let networkCalls = 0;
      const controlled = http.createServer((_req, res) => {
        networkCalls++;
        res.end(sentinel);
      });
      await new Promise<void>((resolve) =>
        controlled.listen(0, "127.0.0.1", resolve),
      );
      const networkUrl = `http://127.0.0.1:${(controlled.address() as net.AddressInfo).port}/probe`;
      let profileSession: string | undefined;
      try {
        const countA = crypto.randomInt(3, 6);
        const countB = crypto.randomInt(6, 9);
        const images = await Promise.all(
          [countA, countB].map(async (count) => ({
            png: (await makeCountImage(count)).png,
            count,
          })),
        );
        const probes = buildDenyProbes(probeDir, sentinel, undefined, {
          networkUrl,
          scientificWriteOccurred: () => store.listSamples().length > 0,
          subagentCreated: async () =>
            Boolean(
              profileSession &&
              (await adapter.getChildren(profileSession)).length,
            ),
        });
        const network = probes.find((probe) => probe.capability === "network")!;
        network.sideEffect = () => networkCalls > 0;
        const text = fs.readFileSync(runtime.status().configPath, "utf8");
        const report = await runVisionSpike(
          {
            dataDir: store.dataDir,
            executionDir: config.executionDir,
            allowRealCalls: true,
            model: "deepseek/deepseek-v4-flash-vision-exp",
            images,
            secrets: [
              credentials.password ?? "",
              process.env.WORKBENCH_API_TOKEN!,
              sentinel,
            ],
            allowProbe: {
              knowledgeId: "protocol-common",
              marker: getKnowledge("protocol-common")
                .content.split("\n")
                .find((line) => line.length > 12)!,
              tools: ["scientific-workbench_knowledge_read"],
            },
            denyProfile: {
              text,
              profileHash: profileHashOf(text),
              importScopeTools: [
                "knowledge_index",
                "knowledge_read",
                "object_search",
                "property_search",
                "sample_import_get",
                "sample_import_save_draft",
                "sample_import_commit",
              ],
            },
            denyProbes: probes,
          },
          {
            detectFlavor: () => detectOpenCodeFlavor(config),
            health: () => adapter.health(),
            listModels: () => adapter.listModels(),
            createSession: async (input) => {
              const session = await adapter.createSession(input);
              profileSession = session.id;
              return session;
            },
            getSession: (id) => adapter.getSession(id),
            getSessionStatuses: () => adapter.getSessionStatuses(),
            getMessages: (id) => adapter.getMessages(id),
            listPermissions: (id) => adapter.listPermissions(id),
            getEffectiveProfile: async () =>
              (await observeEffectiveImportPolicy(
                config,
                runtime!.status().configPath,
              ))
                ? {
                    profileHash: profileHashOf(text),
                    executionDir: config.executionDir,
                  }
                : undefined,
            submitImages: (input) => {
              recordCall();
              return submitExperimentalImagePrompt(config, "v1", input);
            },
          },
        );
        const proof = {
          ...report,
          flavor: "v1",
          version: health.version,
          model: "deepseek/deepseek-v4-flash-vision-exp",
          policyHash: runtime.policyHash(),
          bundleHash: knowledgeBundleHash,
          evidence: report.runId,
          calls,
        };
        fs.writeFileSync(
          path.join(root, "profile-evidence.json"),
          JSON.stringify(proof, null, 2),
          { mode: 0o600 },
        );
        process.send?.({
          profile: {
            checks: report.checks,
            conclusion: report.conclusion,
            calls,
            policyHash: runtime.policyHash(),
          },
        });
      } finally {
        if (profileSession)
          await adapter.abortSession(profileSession).catch(() => undefined);
        await new Promise<void>((resolve) => controlled.close(() => resolve()));
      }
      return;
    }
    const proofFile = process.env.SWB_S2_PROFILE_EVIDENCE;
    if (!proofFile) throw new Error("缺少六项真实前置证据");
    const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
    if (
      proof.policyHash !== runtime.policyHash() ||
      proof.flavor !== "v1" ||
      proof.version !== "1.18.31" ||
      proof.model !== "deepseek/deepseek-v4-flash-vision-exp" ||
      !proof.evidence ||
      [
        "isolation",
        "runtimeIdentityAndModel",
        "asyncSubmission",
        "correlatedImageAnswer",
        "restrictedAllow",
        "restrictedDeny",
      ].some((key) => proof.checks?.[key]?.status !== "PASS")
    )
      throw new Error("六项前置证据不匹配当前策略");
    const job = store.createJob("sample-import", {
      name: "实验记录导入验收",
      runtime: "opencode",
      mode: "vision",
      importId: prepared.importId,
      attemptId: prepared.attempt.id,
      runId,
    });
    const session = await adapter.createSession({
      title: "Isolated import artifact acceptance",
      directory: config.executionDir,
    });
    const observedSession = await adapter.getSession(session.id);
    if (observedSession?.directory !== config.executionDir)
      throw new Error("session 目录隔离未通过");
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    const payload = {
      ...job.payload,
      sessionId: session.id,
      promptMessageId: messageId,
    };
    store.updateJob(job.id, "running", payload);
    const items: ArtifactEvidence["items"] = [];
    unsubscribe = agentRuns.subscribe((state) => {
      const notice = state.notices.find((item) => item.id === job.id);
      if (notice)
        items.push({
          label: "terminal-notice",
          scope: "notice",
          text: JSON.stringify(notice),
          runId,
          jobId: job.id,
          sessionId: session.id,
          observedAt: new Date().toISOString(),
        });
    });
    app.log.info(
      { runId, jobId: job.id, sessionId: session.id },
      "import verification dispatch",
    );
    const prompt = `这是非敏感模拟显微图记录。请读取 skill-sample-from-record 和其依赖协议，然后读取当前导入 ${prepared.importId}。只创建一个样品，正文用普通观察记录图中红色方块的实际数量，不创建对象或属性。不确定则 Question，禁止猜测。来源映射使用服务端提供的来源身份。保存 draft，重新读取最新版本与 fingerprint 后请求 sample_import_commit。不要把完整 draft 或 OCR 放进最终回复。`;
    // Exactly one submission: errors/timeouts are reconciled, never resent.
    recordCall();
    await submitExperimentalImagePrompt(config, "v1", {
      sessionId: session.id,
      messageId,
      prompt,
      model: {
        providerId: "deepseek",
        modelId: "deepseek-v4-flash-vision-exp",
      },
      images: [{ filename: "record.png", mimeType: "image/png", data: png }],
    });
    const until = Date.now() + 180_000;
    let committed = false;
    while (Date.now() < until) {
      if (agentRuns.publishImportReceipt(job.id)) {
        committed = true;
        break;
      }
      const questions = await adapter.listQuestions(session.id);
      if (questions.length) break;
      const messages = await adapter.getMessages(session.id);
      if (
        importReplyEnded(
          messages,
          messageId,
          (await adapter.getSessionStatuses()).get(session.id),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    committed = agentRuns.publishImportReceipt(job.id) || committed;
    const actualJob = store.listJobs().find((item) => item.id === job.id)!;
    items.push({
      label: "store-job",
      scope: "job",
      text: JSON.stringify(actualJob),
      runId,
      jobId: job.id,
      sessionId: session.id,
      observedAt: new Date().toISOString(),
    });
    app.log.info(
      { runId, jobId: job.id, sessionId: session.id, committed },
      "import verification captured",
    );
    process.send?.({
      runId,
      startedAt,
      sessionId: session.id,
      jobId: job.id,
      items,
      committed,
      sourceDataId: prepared.sourceDataId,
    });
    if (!committed)
      await adapter.abortSession(session.id).catch(() => undefined);
  } finally {
    unsubscribe?.();
    if (runtime?.status().baseUrl) {
      const config = runtime.config();
      await fetch(`${config.baseUrl}/instance/dispose`, {
        method: "POST",
        headers: {
          ...openCodeAuthHeaders(config),
          "x-opencode-directory": config.executionDir,
        },
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }
    await runtime?.stop();
    await app.close();
  }
}

async function main() {
  if (process.env.SWB_IMPORT_ARTIFACT_OPT_IN !== "1") {
    console.log(
      JSON.stringify({
        status: "NOT VERIFIED",
        reason: "未授权本次真实导入；零模型请求",
      }),
    );
    return;
  }
  if (!process.env.SWB_SPIKE_OPENCODE_URL || !process.env.SWB_SPIKE_ENV_FILE)
    throw new Error("缺少隔离端点或私密凭据路径");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "swb-artifact-acceptance-"),
  );
  fs.chmodSync(root, 0o700);
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const output = path.join(root, "server.log");
  const stream = fs.createWriteStream(output, { mode: 0o600 });
  const processChild = fork(fileURLToPath(import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    silent: true,
    env: {
      ...process.env,
      SWB_ACCEPTANCE_CHILD: "1",
      SWB_ACCEPTANCE_ROOT: root,
      WORKBENCH_DATA_DIR: path.join(root, "workspace"),
      WORKBENCH_PORT: String(port),
      WORKBENCH_HOST: "127.0.0.1",
      WORKBENCH_API_TOKEN: crypto.randomUUID(),
      NODE_ENV: "test",
    },
  });
  let captured:
    | {
        runId: string;
        startedAt: string;
        sessionId: string;
        jobId: string;
        items: ArtifactEvidence["items"];
        committed: boolean;
      }
    | undefined;
  let phaseReported = false;
  let bytes = 0;
  let truncated = false;
  let observedAt = "";
  for (const pipe of [processChild.stdout, processChild.stderr])
    pipe?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      observedAt = new Date().toISOString();
      if (bytes <= 8 * 1024 * 1024) stream.write(chunk);
      else truncated = true;
    });
  processChild.on("message", (value) => {
    if (
      typeof value === "object" &&
      value &&
      ("progress" in value || "preflight" in value || "profile" in value)
    ) {
      if ("preflight" in value || "profile" in value) phaseReported = true;
      console.log(JSON.stringify({ ...value, evidenceDirectory: root }));
    } else captured = value as typeof captured;
  });
  const timer = setTimeout(() => processChild.kill("SIGTERM"), 900_000);
  const exitCode = await new Promise<number | null>((resolve) =>
    processChild.on("exit", resolve),
  );
  clearTimeout(timer);
  await new Promise<void>((resolve) => stream.end(resolve));
  if (phaseReported && exitCode === 0) return;
  if (!captured || exitCode !== 0) {
    console.log(
      JSON.stringify({
        status: "NOT VERIFIED",
        reason: "真实接线未完整结束",
        evidenceDirectory: root,
      }),
    );
    return;
  }
  fs.writeFileSync(
    path.join(root, "capture.json"),
    JSON.stringify({
      runId: captured.runId,
      startedAt: captured.startedAt,
      sessionId: captured.sessionId,
      jobId: captured.jobId,
      committed: captured.committed,
    }),
    { mode: 0o600 },
  );
  const evidence: ArtifactEvidence = {
    source: "real-workbench-child",
    runId: captured.runId,
    collectedAt: new Date().toISOString(),
    scope: ["job", "log", "notice"],
    items: [
      ...captured.items,
      {
        label: "server-stdout-stderr",
        scope: "log",
        runId: captured.runId,
        sessionId: captured.sessionId,
        jobId: captured.jobId,
        observedAt,
        text: fs.readFileSync(output, "utf8"),
        truncated,
      },
    ],
  };
  fs.writeFileSync(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "NOT VERIFIED",
      reason: "已采集真实产物；仍须运行最小化检查和内容核对",
      committed: captured.committed,
      runId: captured.runId,
      startedAt: captured.startedAt,
      evidenceDirectory: root,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  (process.env.SWB_ACCEPTANCE_CHILD === "1" ? child() : main()).catch(() => {
    // Never echo runtime errors which may contain tool inputs or credentials.
    console.error(
      JSON.stringify({
        status: "NOT VERIFIED",
        reason: "验收执行失败；检查私密证据目录",
      }),
    );
    process.exitCode = 1;
  });
}
