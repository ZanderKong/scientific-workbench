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

const port = Number(process.env.WORKBENCH_PORT ?? 4317);
const host = process.env.WORKBENCH_HOST ?? "127.0.0.1";
const workspaceLocation = resolveWorkspaceLocation();
const store = new WorkbenchStore({ dataDir: workspaceLocation.dataDir });
const storage = new StorageService(store);
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
    ...(["POST", "PUT"].includes(operation.method) && required.length
      ? {
          body: {
            type: "object",
            properties: bodyProperties,
            required,
            additionalProperties: true,
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

app.get("/api/v1/health", async () => ({ ok: true, version: "0.1.0" }));
app.get("/api/v1/openapi.json", async () => openApiDocument());
app.post("/api/v1/workspace/rebuild", async () => store.rebuildIndex());
app.get("/api/v1/workspace/status", async () => store.status());
app.get("/api/v1/workspace/settings", async () => ({
  dataDir: store.dataDir,
  dataDirSource: workspaceLocation.source,
  server: { host, port },
  storage: storage.config(),
}));
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
        controller.signal.aborted ? "canceled" : "failed",
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
  const controller = taskControllers.get(job.id);
  if (!controller || job.status !== "running")
    return reply
      .code(409)
      .send({ code: "CONFLICT", error: "任务已结束，不能取消" });
  controller.abort();
  store.updateJob(job.id, "canceled", job.payload);
  return { id: job.id, status: "canceled" };
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

app.setErrorHandler((error: any, _request, reply) => {
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
  if (error.validation || error.code === "INVALID_INPUT")
    return reply
      .code(400)
      .send({ code: "INVALID_INPUT", error: error.message });
  app.log.error(error);
  reply.code(500).send({ error: error.message });
});

app.addHook("onClose", async () => {
  await storage.stopScheduler();
  await Promise.all(longTasks);
  store.close();
});
storage.startScheduler();
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
