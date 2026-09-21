import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { openApiDocument, operations } from "@workbench/core";
import { WorkbenchStore } from "./store";
import { LocalAuthorization, installAuthorization } from "./auth";
import { StorageService } from "./storage";
import {
  resolveWorkspaceLocation,
  selectWorkspaceForNextStart,
} from "./workspace-location";
import {
  OpenCodeError,
  assertSeparateDirectories,
  createOpenCodeAdapter,
  deleteOpenCodeCredential,
  hasOpenCodeCredential,
  resolveOpenCodeConfig,
  saveOpenCodeCredential,
  validateOpenCodeBaseUrl,
  type OpenCodeAdapter,
  type OpenCodeConfig,
  type OpenCodeModelRef,
  type ResolvedOpenCodeConfig,
} from "./opencode";
import { AgentRunService } from "./agent-runs";
import {
  getKnowledge,
  knowledgeBundleHash,
  knowledgeVersion,
  listKnowledge,
  KnowledgeNotFoundError,
} from "./knowledge";

const port = Number(process.env.WORKBENCH_PORT ?? 4317);
const host = process.env.WORKBENCH_HOST ?? "127.0.0.1";
const workspaceLocation = resolveWorkspaceLocation();
const store = new WorkbenchStore({ dataDir: workspaceLocation.dataDir });
const storage = new StorageService(store);

function readOpenCodeConfig(): ResolvedOpenCodeConfig {
  return resolveOpenCodeConfig(
    store.dataDir,
    store.setting<Partial<OpenCodeConfig>>("opencode", {}),
  );
}
function buildOpenCodeAdapter(): OpenCodeAdapter | null {
  const config = readOpenCodeConfig();
  if (!config.baseUrl) return null;
  try {
    const baseUrl = validateOpenCodeBaseUrl(config.baseUrl);
    return createOpenCodeAdapter({ ...config, baseUrl });
  } catch {
    return null;
  }
}
const agentRuns = new AgentRunService({
  store,
  getConfig: () => readOpenCodeConfig(),
  getDataDir: () => store.dataDir,
  healthyPollMs: Number(process.env.WORKBENCH_AGENT_POLL_MS ?? 15_000),
  unhealthyPollMs: Number(
    process.env.WORKBENCH_AGENT_UNHEALTHY_POLL_MS ?? 5_000,
  ),
});
agentRuns.setAdapter(buildOpenCodeAdapter());
function idempotent<T>(
  req: {
    headers: Record<string, unknown>;
    method: string;
    url: string;
    body?: unknown;
  },
  action: () => T,
) {
  const key = req.headers["idempotency-key"];
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(req.body ?? {})))
    .digest("hex");
  return store.idempotent(
    typeof key === "string" ? `${req.method}:${req.url}:${key}` : undefined,
    fingerprint,
    action,
  );
}

const app = Fastify({
  ajv: { customOptions: { removeAdditional: false } },
  logger:
    process.env.NODE_ENV === "production"
      ? false
      : {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        },
});

const authorization = new LocalAuthorization(
  store.dataDir,
  process.env.WORKBENCH_API_TOKEN,
);
installAuthorization(app, authorization, port);

app.addHook("onRequest", async (request, reply) => {
  if (!store.recoveryRequired()) return;
  const pathname = request.url.split("?")[0];
  if (!pathname.startsWith("/api/v1/")) return;
  if (
    pathname === "/api/v1/health" ||
    pathname.startsWith("/api/v1/knowledge") ||
    pathname.startsWith("/api/v1/auth/")
  )
    return;
  if (
    !/^\/api\/v1\/(samples|documents|data|analyses|claims|objects|properties|attachments|search|workspace|sample-imports|backups|jobs)(\/|$)/.test(
      pathname,
    )
  )
    return;
  return reply.code(503).send({
    code: "RECOVERY_REQUIRED",
    error: "工作区写入需要恢复，请重新启动服务后再读取",
  });
});
app.addHook("onRoute", (route) => {
  const operation = operations.find(
    (operation) =>
      "/api/v1" + operation.path === route.url &&
      operation.method === route.method,
  );
  if (!operation) return;
  const params = [...operation.path.matchAll(/:([A-Za-z]+)/g)].map(
    (match) => match[1],
  );
  const bodyProperties = Object.fromEntries(
    Object.entries(operation.input.properties).filter(
      ([key]) =>
        !params.includes(key) &&
        !operation.query?.includes(key) &&
        key !== "idempotencyKey",
    ),
  );
  const required =
    operation.input.required?.filter((key) => key in bodyProperties) || [];
  route.schema = {
    ...route.schema,
    ...(params.length
      ? {
          params: {
            type: "object",
            properties: Object.fromEntries(
              params.map((key) => [key, { type: "string", minLength: 1 }]),
            ),
            required: params,
          },
        }
      : {}),
    ...(operation.query?.length
      ? {
          querystring: {
            type: "object",
            properties: Object.fromEntries(
              operation.query.map((key) => [
                key,
                operation.input.properties[key],
              ]),
            ),
            additionalProperties: true,
          },
        }
      : {}),
    ...(["POST", "PUT"].includes(operation.method) &&
    Object.keys(bodyProperties).length
      ? {
          body: {
            type: "object",
            properties: bodyProperties,
            required,
            additionalProperties:
              operation.input.additionalProperties === false ? false : true,
          },
        }
      : {}),
  };
});
app.addHook("onSend", async (request, _reply, payload) => {
  const query = request.query as { limit?: number; offset?: number };
  if (
    !query ||
    (query.limit === undefined && query.offset === undefined) ||
    typeof payload !== "string"
  )
    return payload;
  const value: unknown = JSON.parse(payload);
  if (!Array.isArray(value)) return payload;
  const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50))),
    offset = Math.max(0, Number(query.offset ?? 0));
  return JSON.stringify({
    items: value.slice(offset, offset + limit),
    total: value.length,
    offset,
    limit,
  });
});

await app.register(cors, {
  origin: [
    `http://${host}:${port}`,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ],
  credentials: true,
});
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
});
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);
if (fs.existsSync(webDist))
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });

app.get("/api/v1/health", async () => ({
  ok: !store.recoveryRequired(),
  degraded: store.recoveryRequired(),
  version: "0.1.0",
}));
app.get("/api/v1/openapi.json", async () => openApiDocument());
app.post("/api/v1/workspace/rebuild", async () => store.rebuildIndex());
app.get("/api/v1/workspace/status", async () => store.status());
app.get("/api/v1/workspace/settings", async () => ({
  dataDir: store.dataDir,
  dataDirSource: workspaceLocation.source,
  server: { host, port },
  storage: storage.config(),
}));
app.get("/api/v1/knowledge", async () => ({
  version: knowledgeVersion,
  bundleHash: knowledgeBundleHash,
  content: listKnowledge(),
}));
app.get("/api/v1/knowledge/:id", async (req: any, reply) => {
  try {
    return getKnowledge(req.params.id);
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError)
      return reply.code(404).send({ code: "NOT_FOUND", error: error.message });
    throw error;
  }
});
app.get("/api/v1/storage/s3", async () => storage.config());
app.put("/api/v1/storage/s3", async (req: any) => {
  const c = storage.configure(req.body ?? {});
  storage.startScheduler();
  return c;
});
app.post("/api/v1/storage/s3/test", async () => storage.testConnection());
app.post("/api/v1/storage/s3/scan", async () => storage.scanDue());

app.get("/api/v1/samples", async () =>
  store.listSamples().map((s: any) => ({
    id: s.id,
    code: s.code,
    title: s.title,
    createdAt: s.created_at,
    contentVersion: s.document.head.contentVersion,
    extractionStatus: s.document.head.extractionStatus,
    document: { head: s.document.head },
    properties: s.properties,
  })),
);
app.post("/api/v1/samples", async (req) =>
  idempotent(req, () => store.createSample((req.body ?? {}) as any)),
);
app.get("/api/v1/samples/:id", async (req: any) => {
  if (req.query?.latest === "true") store.ensureLatest(req.params.id);
  return store.getSample(req.params.id);
});
app.post("/api/v1/samples/:id/copy", async (req: any) =>
  idempotent(req, () => store.copySample(req.params.id, req.body?.code)),
);
app.put("/api/v1/samples/:id", async (req: any) =>
  store.updateSample(req.params.id, req.body),
);
app.post("/api/v1/samples/batch", async (req: any) =>
  req.body.templateId
    ? store.batchFromTemplate(
        req.body.templateId,
        req.body.expectedVersion,
        req.body.rows,
      )
    : store.batchSamples(req.body.sourceIds || [], req.body.copies ?? 1),
);

// Prepare has its own business idempotency (importId + source fingerprint), so
// it deliberately does not go through the generic response cache: that cache
// would keep a full transient draft in jobs/idempotency.json.
app.post("/api/v1/sample-imports", async (req: any) =>
  store.prepareSampleImport(req.body),
);
app.get("/api/v1/sample-imports/:id", async (req: any) =>
  store.getSampleImport(req.params.id),
);
app.put("/api/v1/sample-imports/:id/draft", async (req: any) =>
  store.saveSampleImportDraft(req.params.id, req.body),
);
app.post("/api/v1/sample-imports/:id/commit", async (req: any) =>
  store.commitSampleImport(req.params.id, req.body),
);
app.post("/api/v1/sample-imports/:id/cancel", async (req: any) =>
  store.cancelSampleImport(req.params.id, req.body ?? {}),
);
app.post("/api/v1/sample-imports/:id/retry", async (req: any) =>
  store.retrySampleImport(req.params.id, req.body),
);

app.get("/api/v1/documents/:id", async (req: any) => {
  if (req.query?.latest === "true") store.ensureLatest(req.params.id);
  const doc = store.readDocument(req.params.id);
  return {
    id: req.params.id,
    head: doc.head,
    body: doc.body,
    filePath: doc.filePath,
  };
});
app.put("/api/v1/documents/:id", async (req: any, reply) => {
  try {
    return store.saveDocument(
      req.params.id,
      String(req.body?.body ?? ""),
      req.body?.expectedVersion,
      req.body?.bindings,
    );
  } catch (error: any) {
    if (error.code === "CONFLICT")
      return reply
        .code(409)
        .send({ error: error.message, currentVersion: error.currentVersion });
    if (error.code === "EXTERNAL_CHANGE")
      return reply
        .code(409)
        .send({ error: error.message, reloadRequired: true });
    throw error;
  }
});
app.post("/api/v1/documents/:id/finalize", async (req: any, reply) => {
  try {
    return store.finalizeDocument(req.params.id);
  } catch (error: any) {
    if (error.code === "DATA_CONFLICT")
      return reply.code(409).send({
        error: error.message,
        code: error.code,
        dataId: error.dataId,
        currentVersion: error.currentVersion,
      });
    return reply.code(422).send({ error: error.message });
  }
});
app.post("/api/v1/documents/:id/reload", async (req: any) => {
  return store.reloadDocument(req.params.id);
});
app.post(
  "/api/v1/documents/:id/blocks/:blockId/resolve-data",
  async (req: any) =>
    store.resolveDataIdentity(req.params.id, req.params.blockId, req.body),
);
app.post(
  "/api/v1/documents/:id/blocks/:blockId/bind-data",
  async (req: any) =>
    store.bindDataBlock(
      req.params.id,
      req.params.blockId,
      req.body.dataId,
      req.body.expectedVersion,
      req.body.expectedDataVersion,
    ),
);
app.post("/api/v1/documents/:id/data/:dataId/load-latest", async (req: any) =>
  store.resolveDataMirror(
    req.params.id,
    req.params.dataId,
    req.body.expectedVersion,
  ),
);
app.get("/api/v1/documents/:id/snapshots", async (req: any) =>
  store.listSnapshots(req.params.id),
);
for (const [plural, type] of [
  ["data", "data"],
  ["analyses", "analysis"],
  ["claims", "claim"],
] as const) {
  app.post(`/api/v1/${plural}/:id/reload`, async (req: any) =>
    store.reloadEntity(type, req.params.id, req.body.expectedVersion),
  );
  app.post(`/api/v1/${plural}/:id/finalize`, async (req: any) =>
    store.finalizeEntity(type, req.params.id, req.body?.expectedVersion),
  );
}

app.get("/api/v1/objects", async (req: any) =>
  store.searchObjects(String(req.query?.q ?? "")),
);
app.post("/api/v1/objects", async (req: any) =>
  idempotent(req, () => store.createObject(req.body)),
);
app.put("/api/v1/objects/:id", async (req: any) =>
  store.updateObject(req.params.id, req.body),
);
app.post("/api/v1/objects/:id/merge", async (req: any) =>
  store.mergeObjects(
    req.params.id,
    req.body.targetId,
    req.body.expectedVersion,
    req.body.targetVersion,
  ),
);
app.post("/api/v1/objects/:id/deprecate", async (req: any) =>
  store.deprecateObject(req.params.id),
);
app.delete("/api/v1/objects/:id", async (req: any, reply) => {
  try {
    return store.deleteObject(req.params.id, Number(req.query.expectedVersion));
  } catch (error: any) {
    return reply.code(409).send({ error: error.message });
  }
});
app.get("/api/v1/properties", async (req: any) =>
  store.searchProperties(String(req.query?.q ?? "")),
);
app.post("/api/v1/properties", async (req: any) =>
  idempotent(req, () => store.createProperty(req.body)),
);
app.put("/api/v1/properties/:id", async (req: any) =>
  store.updateProperty(req.params.id, req.body),
);

app.get("/api/v1/data", async () => store.listData());
app.post("/api/v1/data", async (req: any) =>
  idempotent(req, () => store.createData(req.body)),
);
app.get("/api/v1/data/:id", async (req: any) => {
  store.assertEntityCurrent("data", req.params.id);
  for (const sample of store.listSamples())
    if (
      Object.values(sample.document.head.blocks).some(
        (binding) => binding.dataId === req.params.id,
      )
    )
      store.ensureLatest(sample.id);
  return store.getData(req.params.id);
});
app.put("/api/v1/data/:id", async (req: any, reply) => {
  try {
    return store.updateData(req.params.id, req.body);
  } catch (error: any) {
    if (error.code === "CONFLICT")
      return reply
        .code(409)
        .send({ error: error.message, currentVersion: error.currentVersion });
    throw error;
  }
});
app.put("/api/v1/data/:id/about", async (req: any, reply) => {
  try {
    return store.updateDataAbout(
      req.params.id,
      req.body.sampleIds ?? [],
      req.body.expectedVersion,
    );
  } catch (error: any) {
    if (error.code === "CONFLICT")
      return reply
        .code(409)
        .send({ error: error.message, currentVersion: error.currentVersion });
    throw error;
  }
});
app.put("/api/v1/data/:id/components", async (req: any, reply) => {
  try {
    return store.updateDataComponents(
      req.params.id,
      req.body.componentIds ?? [],
      req.body.expectedVersion,
    );
  } catch (error: any) {
    if (error.code === "CONFLICT")
      return reply
        .code(409)
        .send({ error: error.message, currentVersion: error.currentVersion });
    throw error;
  }
});

app.get("/api/v1/analyses", async () => store.listAnalyses());
app.post("/api/v1/analyses", async (req: any) =>
  idempotent(req, () => store.createAnalysis(req.body)),
);
app.get("/api/v1/analyses/:id", async (req: any) =>
  store.getAnalysis(req.params.id),
);
app.put("/api/v1/analyses/:id", async (req: any) =>
  store.updateAnalysis(req.params.id, req.body),
);
app.get("/api/v1/analyses/:id/export", async (req: any) =>
  store.exportContext("analysis", req.params.id),
);

app.get("/api/v1/claims", async () => store.listClaims());
app.post("/api/v1/claims", async (req: any) =>
  idempotent(req, () => store.createClaim(req.body)),
);
app.get("/api/v1/claims/:id", async (req: any) =>
  store.getClaim(req.params.id),
);
app.put("/api/v1/claims/:id", async (req: any) =>
  store.updateClaim(req.params.id, req.body.text, req.body.expectedVersion),
);
app.post("/api/v1/claims/:id/evidence", async (req: any) =>
  idempotent(req, () =>
    store.supplementClaimEvidence(req.params.id, req.body?.expectedVersion),
  ),
);

app.post("/api/v1/attachments", async (req: any, reply) => {
  const { contentBase64, originalName, mimeType } = req.body ?? {};
  if (!contentBase64 || !originalName)
    return reply
      .code(400)
      .send({ error: "需要 contentBase64 和 originalName" });
  return store.saveAttachment(
    Buffer.from(contentBase64, "base64"),
    originalName,
    mimeType ?? "application/octet-stream",
  );
});
app.post("/api/v1/attachments/stream", async (req: any, reply) => {
  const part = await req.file();
  if (!part) return reply.code(400).send({ error: "需要 multipart 文件字段" });
  const temp = path.join(
    store.dataDir,
    "jobs",
    `upload-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(temp);
    part.file.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    part.file.on("error", reject);
  });
  return store.saveAttachmentFile(temp, part.filename, part.mimetype);
});
app.get("/api/v1/attachments/orphans", async () =>
  store.attachmentCleanupPreview(),
);
app.post("/api/v1/attachments/cleanup", async (req: any) =>
  storage.cleanupAttachments(req.body.ids),
);
app.get("/api/v1/attachments/:id", async (req: any) =>
  store.getAttachment(req.params.id),
);
app.get("/api/v1/attachments/:id/text", async (req: any, reply) => {
  const attachment = store.getAttachment(req.params.id);
  if (!/^(text\/|application\/(json|xml|csv))/.test(attachment.mimeType))
    return reply.code(415).send({ error: "该附件不是文本类型" });
  const lease = await storage.acquireAttachment(attachment);
  const offset = Number(req.query.offset ?? 0),
    length = Number(req.query.length ?? 16384);
  const handle = await fs.promises.open(lease.path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return {
      id: attachment.id,
      offset,
      nextOffset: offset + bytesRead,
      totalBytes: attachment.sizeBytes,
      encoding: "utf-8",
      text: buffer.subarray(0, bytesRead).toString("utf8"),
    };
  } finally {
    await handle.close();
    lease.release();
  }
});
app.get("/api/v1/attachments/:id/content", async (req: any, reply) => {
  const a = store.getAttachment(req.params.id);
  const lease = await storage.acquireAttachment(a);
  reply.raw.once("close", lease.release);
  reply
    .type(a.mimeType)
    .header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(a.originalName)}`,
    );
  return reply.send(fs.createReadStream(lease.path));
});
app.post("/api/v1/jobs/:id/retry", async (req: any) =>
  storage.retryJob(req.params.id),
);
app.get("/api/v1/jobs", async () => store.listJobs());
app.get("/api/v1/search", async (req: any) => {
  const q = `%${String(req.query?.q ?? "")}%`;
  return {
    samples: store.db
      .prepare(
        "SELECT id,code,title FROM samples WHERE code LIKE ? OR title LIKE ? LIMIT 50",
      )
      .all(q, q),
    data: store.db
      .prepare(
        "SELECT id,name,description FROM data_records WHERE name LIKE ? OR description LIKE ? OR body LIKE ? LIMIT 50",
      )
      .all(q, q, q),
    objects: store.db
      .prepare(
        "SELECT id,canonical_name,role,lifecycle FROM objects WHERE canonical_name LIKE ? LIMIT 50",
      )
      .all(q),
    properties: store.db
      .prepare(
        "SELECT id,canonical_name FROM properties WHERE canonical_name LIKE ? LIMIT 50",
      )
      .all(q),
  };
});
const longTasks = new Set<Promise<void>>();
const taskControllers = new Map<string, AbortController>();
app.post("/api/v1/backups", async (req: any, reply) => {
  const target = req.body?.target ?? "local";
  if (!["local", "s3"].includes(target))
    return reply
      .code(400)
      .send({ code: "INVALID_TARGET", error: "备份目标无效" });
  const job = store.createJob("backup", { target });
  const controller = new AbortController();
  taskControllers.set(job.id, controller);
  store.updateJob(job.id, "running", { target });
  const task = storage
    .createBackup(target, controller.signal)
    .then((result) => {
      if (!controller.signal.aborted)
        store.updateJob(job.id, "succeeded", { target, result });
    })
    .catch((error) => {
      store.updateJob(
        job.id,
        controller.signal.aborted ? "cancelled" : "failed",
        { target },
        controller.signal.aborted ? undefined : String(error),
      );
    })
    .finally(() => {
      taskControllers.delete(job.id);
      longTasks.delete(task);
    });
  longTasks.add(task);
  return reply.code(202).send({ jobId: job.id, status: "running" });
});
app.get("/api/v1/jobs/:id", async (req: any, reply) => {
  const job = store.listJobs().find((job) => job.id === req.params.id);
  return (
    job || reply.code(404).send({ code: "NOT_FOUND", error: "任务不存在" })
  );
});
app.post("/api/v1/jobs/:id/cancel", async (req: any, reply) => {
  const job = store.listJobs().find((item) => item.id === req.params.id);
  if (!job)
    return reply.code(404).send({ code: "NOT_FOUND", error: "任务不存在" });
  if (job.type === "agent-run") {
    if (job.status !== "running" && job.status !== "queued")
      return reply
        .code(409)
        .send({ code: "CONFLICT", error: "任务已结束，不能取消" });
    return agentRuns.cancel(job.id);
  }
  const controller = taskControllers.get(job.id);
  if (!controller || job.status !== "running")
    return reply
      .code(409)
      .send({ code: "CONFLICT", error: "任务已结束，不能取消" });
  controller.abort();
  store.updateJob(job.id, "cancelled", job.payload);
  return { id: job.id, status: "cancelled" };
});
app.get("/api/v1/backups/:jobId/download", async (req: any, reply) => {
  const job = store
    .listJobs()
    .find(
      (job) =>
        job.id === req.params.jobId &&
        job.type === "backup" &&
        job.status === "succeeded",
    );
  const file = job?.payload?.result?.file;
  if (
    typeof file !== "string" ||
    !file.startsWith(path.join(store.dataDir, "backups") + path.sep)
  )
    return reply.code(404).send({ error: "完整备份尚不可用" });
  return reply
    .type("application/zip")
    .header(
      "Content-Disposition",
      `attachment; filename="${path.basename(file)}"`,
    )
    .send(fs.createReadStream(file));
});
app.post("/api/v1/backups/restore", async (req: any, reply) => {
  try {
    const restored = await storage.restoreBackup(
      String(req.body?.zipPath ?? ""),
      String(req.body?.targetDir ?? ""),
    );
    const selection = selectWorkspaceForNextStart(restored.targetDir);
    return {
      ...restored,
      selectedForNextStart: selection.selected,
      restartRequired: true,
      ...("reason" in selection ? { selectionReason: selection.reason } : {}),
    };
  } catch (error: any) {
    return reply.code(422).send({ error: error.message });
  }
});

function normalizeModelRef(input: unknown): OpenCodeModelRef {
  const value = input as { providerId?: unknown; modelId?: unknown };
  const providerId = String(value?.providerId ?? "").trim();
  const modelId = String(value?.modelId ?? "").trim();
  if (!providerId || !modelId)
    throw new OpenCodeError("MODEL_UNAVAILABLE", "模型配置无效", 400);
  return { providerId, modelId };
}

function hasActiveAgentRun() {
  return store
    .listJobs()
    .some(
      (job) =>
        job.type === "agent-run" &&
        (job.status === "queued" || job.status === "running"),
    );
}

function publicOpenCodeConfig(config: OpenCodeConfig) {
  return {
    baseUrl: config.baseUrl,
    username: config.username,
    executionDir: config.executionDir,
    permissionMode: config.permissionMode,
    textModel: config.textModel ?? null,
    visionModel: config.visionModel ?? null,
    hasPassword: hasOpenCodeCredential(store.dataDir, config.credentialId),
    connectionLocked: hasActiveAgentRun(),
  };
}

async function openCodeStatus() {
  const config = readOpenCodeConfig();
  if (!config.baseUrl)
    return { connected: false, mcp: { state: "missing" as const } };
  const adapter = buildOpenCodeAdapter();
  if (!adapter)
    return {
      connected: false,
      error: "OpenCode Server 地址无效",
      mcp: { state: "missing" as const },
    };
  try {
    const health = await adapter.health();
    const mcp = await adapter.getMcpStatus();
    return { connected: true, version: health.version, mcp };
  } catch (error) {
    const message =
      error instanceof OpenCodeError
        ? error.message
        : "无法连接 OpenCode Server";
    return {
      connected: false,
      error: message,
      mcp: { state: "missing" as const },
    };
  }
}

app.get("/api/v1/integrations/opencode", async () => ({
  config: publicOpenCodeConfig(readOpenCodeConfig()),
  status: await openCodeStatus(),
}));
app.put("/api/v1/integrations/opencode", async (req: any) => {
  const body = req.body ?? {};
  const existing = readOpenCodeConfig();
  const rawBaseUrl = String(body.baseUrl ?? "").trim();
  const baseUrl = rawBaseUrl ? validateOpenCodeBaseUrl(rawBaseUrl) : "";
  const executionDir = assertSeparateDirectories(
    store.dataDir,
    String(body.executionDir ?? existing.executionDir),
  );
  const permissionMode = body.permissionMode ?? existing.permissionMode;
  if (!["ask", "auto-allow"].includes(permissionMode))
    throw new OpenCodeError("INVALID_INPUT", "权限模式无效", 400);
  const username = String(body.username ?? (existing.username || "opencode"));
  const password = typeof body.password === "string" ? body.password : "";
  if (hasActiveAgentRun()) {
    const identityChanged =
      baseUrl !== existing.baseUrl ||
      username !== existing.username ||
      password.length > 0 ||
      executionDir !== existing.executionDir;
    if (identityChanged)
      throw new OpenCodeError(
        "OPENCODE_CONFIG_IN_USE",
        "当前仍有 OpenCode 任务运行，请等待任务结束或取消任务后再修改连接设置。",
        409,
      );
  }
  const next: OpenCodeConfig = {
    baseUrl,
    username,
    executionDir,
    permissionMode,
  };
  if (body.textModel === null) next.textModel = undefined;
  else if (body.textModel) next.textModel = normalizeModelRef(body.textModel);
  else if (existing.textModel) next.textModel = existing.textModel;
  if (body.visionModel === null) next.visionModel = undefined;
  else if (body.visionModel)
    next.visionModel = normalizeModelRef(body.visionModel);
  else if (existing.visionModel) next.visionModel = existing.visionModel;

  const previousCredential = existing.credentialId;
  let newCredential: string | undefined;
  if (password) {
    newCredential = saveOpenCodeCredential(store.dataDir, password);
    next.credentialId = newCredential;
  } else if (previousCredential) {
    next.credentialId = previousCredential;
  }
  try {
    store.saveSetting("opencode", next);
  } catch (error) {
    if (newCredential)
      deleteOpenCodeCredential(store.dataDir, newCredential);
    throw error;
  }
  if (
    newCredential &&
    previousCredential &&
    previousCredential !== newCredential
  )
    deleteOpenCodeCredential(store.dataDir, previousCredential);
  agentRuns.setAdapter(buildOpenCodeAdapter());
  return {
    config: publicOpenCodeConfig(readOpenCodeConfig()),
    status: await openCodeStatus(),
  };
});
app.post("/api/v1/integrations/opencode/test", async (req: any, reply) => {
  const body = req.body ?? {};
  const existing = readOpenCodeConfig();
  let baseUrl = existing.baseUrl;
  try {
    if (body.baseUrl) baseUrl = validateOpenCodeBaseUrl(String(body.baseUrl));
  } catch (error) {
    const normalized = error as OpenCodeError;
    return reply
      .code(400)
      .send({ code: normalized.code, error: normalized.message });
  }
  if (!baseUrl)
    return reply.code(400).send({
      code: "INVALID_OPENCODE_URL",
      error: "请先填写 OpenCode Server 地址",
    });
  const adapter = createOpenCodeAdapter({
    ...existing,
    baseUrl,
    username: String(body.username ?? (existing.username || "opencode")),
    password:
      typeof body.password === "string" && body.password
        ? body.password
        : existing.password,
  });
  try {
    const health = await adapter.health();
    const models = await adapter.listModels();
    const mcp = await adapter.getMcpStatus();
    return {
      connected: true,
      version: health.version,
      modelCount: models.length,
      mcp,
    };
  } catch (error) {
    const normalized =
      error instanceof OpenCodeError
        ? error
        : new OpenCodeError(
            "OPENCODE_UNREACHABLE",
            "无法连接 OpenCode Server",
          );
    return reply
      .code(normalized.code === "OPENCODE_AUTH_FAILED" ? 401 : 503)
      .send({ code: normalized.code, error: normalized.message });
  }
});
app.get("/api/v1/integrations/opencode/models", async (_req, reply) => {
  const adapter = buildOpenCodeAdapter();
  if (!adapter)
    return reply
      .code(503)
      .send({ code: "OPENCODE_UNREACHABLE", error: "OpenCode 尚未配置" });
  try {
    return { models: await adapter.listModels() };
  } catch (error) {
    const normalized =
      error instanceof OpenCodeError
        ? error
        : new OpenCodeError("OPENCODE_UNREACHABLE", "无法连接 OpenCode Server");
    return reply
      .code(503)
      .send({ code: normalized.code, error: normalized.message });
  }
});

app.post("/api/v1/agent-runs", async (req: any, reply) => {
  try {
    const view = await agentRuns.createRun(req.body ?? {});
    return reply.code(202).send(view);
  } catch (error) {
    if (error instanceof OpenCodeError)
      return reply
        .code(error.status || 503)
        .send({ code: error.code, error: error.message });
    return reply
      .code(400)
      .send({ code: "INVALID_INPUT", error: String((error as any)?.message ?? error) });
  }
});
app.get("/api/v1/agent-runs/state", async () => agentRuns.snapshot());
app.get("/api/v1/agent-runs/events", async (req: any, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (state: unknown) => {
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);
  };
  send(agentRuns.snapshot());
  const unsubscribe = agentRuns.subscribe(send);
  const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
  heartbeat.unref?.();
  req.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return reply;
});
app.get("/api/v1/agent-runs/:id/link", async (req: any, reply) => {
  const url = agentRuns.sessionUrl(req.params.id);
  if (!url)
    return reply.code(404).send({
      code: "OPENCODE_SESSION_MISSING",
      error: "该任务还没有 OpenCode Session",
    });
  return { url };
});
app.post(
  "/api/v1/agent-runs/:id/permission/allow",
  async (req: any, reply) => {
    const permissionId = String(req.body?.permissionId ?? "").trim();
    if (!permissionId)
      return reply
        .code(400)
        .send({ code: "INVALID_INPUT", error: "需要 permissionId" });
    try {
      await agentRuns.allowPermission(req.params.id, permissionId);
      return { ok: true };
    } catch (error) {
      const normalized =
        error instanceof OpenCodeError
          ? error
          : new OpenCodeError(
              "PERMISSION_NOT_PENDING",
              "权限请求已失效",
              409,
            );
      return reply
        .code(normalized.status || 409)
        .send({ code: normalized.code, error: normalized.message });
    }
  },
);
app.post("/api/v1/agent-runs/:id/dismiss", async (req: any) => ({
  ok: agentRuns.dismiss(req.params.id),
}));

app.setErrorHandler((error: any, _request, reply) => {
  if (error instanceof OpenCodeError)
    return reply
      .code(error.status || 503)
      .send({ code: error.code, error: error.message });
  if (
    error.code === "CONFLICT" ||
    error.code === "DATA_CONFLICT" ||
    error.code === "EXTERNAL_CHANGE"
  )
    return reply.code(409).send({
      error: error.message,
      code: error.code,
      currentVersion: error.currentVersion,
      dataId: error.dataId,
    });
  if (error.code === "NOT_FOUND")
    return reply.code(404).send({ code: "NOT_FOUND", error: error.message });
  if (error.validation || error.code === "INVALID_INPUT")
    return reply
      .code(400)
      .send({ code: "INVALID_INPUT", error: error.message });
  app.log.error(error);
  reply.code(500).send({ error: error.message });
});

app.addHook("onClose", async () => {
  await agentRuns.shutdown();
  await storage.stopScheduler();
  await Promise.all(longTasks);
  store.close();
});
storage.startScheduler();
try {
  await agentRuns.recover();
} catch (error) {
  app.log.error(error);
}
for (const pending of store.db
  .prepare(
    "SELECT id FROM documents WHERE extraction_status IN ('pending','error')",
  )
  .all() as any[]) {
  try {
    store.finalizeDocument(pending.id);
  } catch {
    /* leave error state for explicit retry */
  }
}
try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
