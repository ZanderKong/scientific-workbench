import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import {
  dataMirrorHash,
  mapDataBlocks,
  replaceDataMirror,
} from "./data-mirror";
import { sampleTemplate } from "./sample-template";
import { bodyAttachments } from "./body-attachments";
import { legacyComponents, validateComponents } from "./data-components";
import { EntityFileGuard } from "./entity-file-guard";
import { FileRepository } from "./file-repository";
import { collectContext } from "./context";
import {
  parseBody,
  parseDocument,
  serializeDocument,
  createHead,
  ensureBlockIds,
  sha256,
  uuid,
  resolveReference,
  normalizeAnalysisLayout,
  blockLines,
} from "@workbench/core";
import { fileLinks } from "@workbench/core/attachments";
import type {
  AnalysisRecord,
  AnalysisLayout,
  Attachment,
  ClaimEvidence,
  ClaimRecord,
  ContextManifest,
  DataRecord,
  DataComponent,
  DocumentFile,
  DocumentHead,
  Job,
  PropertyDefinition,
  ResearchObject,
  ReferenceOccurrence,
  Snapshot,
  Lifecycle,
  RemoteAttachmentLocation,
} from "@workbench/core";
export interface StoreOptions {
  dataDir?: string;
}
interface SampleIndexRow {
  id: string;
  code: string;
  title: string;
  document_id: string;
  created_at: string;
  updated_at: string;
}
interface SampleProjection {
  id: string;
  sample_id: string;
  document_id: string;
  block_id: string;
  object_id: string;
  property_id: string;
  value_text: string;
  source_line: number;
  source_column: number;
  object_name: string;
  property_name: string;
}
const dirs = [
  "samples",
  "data",
  "analyses",
  "claims",
  "registry",
  "attachments",
  "history",
  "evidence",
  "index",
  "jobs",
  "private",
  "cache",
];
function now() {
  return new Date().toISOString();
}
function json(value: unknown) {
  return JSON.stringify(value ?? null);
}
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
export class WorkbenchStore {
  readonly dataDir: string;
  readonly db: Database.Database;
  private readonly files: FileRepository;
  private commitDepth = 0;
  private writtenDocuments = new Set<string>();
  constructor(options: StoreOptions = {}) {
    this.dataDir =
      options.dataDir ??
      process.env.WORKBENCH_DATA_DIR ??
      path.join(os.homedir(), "ScientificWorkbench");
    for (const dir of dirs)
      fs.mkdirSync(path.join(this.dataDir, dir), { recursive: true });
    this.files = new FileRepository(this.dataDir);
    const workspaceFile = path.join(this.dataDir, "registry", "workspace.json");
    if (
      !fs.existsSync(workspaceFile) &&
      ["samples", "data", "analyses", "claims"].some((dir) =>
        fs
          .readdirSync(path.join(this.dataDir, dir))
          .some((name) => name.endsWith(".md")),
      )
    ) {
      this.files.close();
      throw new Error("旧格式工作区需要转换到新目录，禁止原地迁移");
    }
    this.db = new Database(
      path.join(this.dataDir, "index", "workbench.sqlite"),
    );
    try {
      this.db.pragma("journal_mode = WAL");
      this.migrate();
      this.entityFiles = new EntityFileGuard(this.db, this.files, this.dataDir);
      const recovered = this.files.recover();
      if (fs.existsSync(workspaceFile)) this.rebuildIndex();
      else
        this.commit(
          () =>
            this.atomicWrite(
              workspaceFile,
              json({ schema: "swb.workspace/2", id: uuid(), createdAt: now() }),
            ),
          "initialize",
        );
      this.files.acknowledgeRecovery(recovered);
    } catch (error) {
      this.db.close();
      this.files.close();
      throw error;
    }
  }
  private entityFiles!: EntityFileGuard;
  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, file_path TEXT NOT NULL, content_version INTEGER NOT NULL, body_hash TEXT NOT NULL, extraction_status TEXT NOT NULL, extraction_error TEXT, projection_version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, role TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active', redirect_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS object_aliases (object_id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY(object_id, alias));
      CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL UNIQUE, dimension TEXT, recommended_unit TEXT, usage_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT);
      CREATE TABLE IF NOT EXISTS property_aliases (property_id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY(property_id, alias));
      CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, document_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS property_values (id TEXT PRIMARY KEY, sample_id TEXT NOT NULL, document_id TEXT NOT NULL, block_id TEXT NOT NULL, object_id TEXT NOT NULL, property_id TEXT NOT NULL, value_text TEXT NOT NULL, source_line INTEGER NOT NULL, source_column INTEGER NOT NULL, UNIQUE(document_id, block_id, object_id, property_id, value_text));
      CREATE TABLE IF NOT EXISTS data_records (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, about_sample_ids TEXT NOT NULL DEFAULT '[]', source_document_id TEXT, source_block_id TEXT, component_ids TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '', body_hash TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, local_path TEXT NOT NULL, created_at TEXT NOT NULL, remote_key TEXT, remote_only INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', item_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, host_type TEXT NOT NULL, host_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claim_evidence (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL, body_hash TEXT NOT NULL, content TEXT NOT NULL, attachment_ids TEXT NOT NULL DEFAULT '[]', captured_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(entity_id, body_hash));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    for (const table of ["analyses", "claims", "objects", "properties"]) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (!columns.some((column) => column.name === "version"))
        this.db.exec(
          `ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
        );
    }
    const claimColumns = this.db.prepare("PRAGMA table_info(claims)").all() as {
      name: string;
    }[];
    if (
      !claimColumns.some((column) => column.name === "legacy_evidence_warning")
    )
      this.db.exec(
        "ALTER TABLE claims ADD COLUMN legacy_evidence_warning TEXT",
      );
    const objectColumns = this.db
      .prepare("PRAGMA table_info(objects)")
      .all() as { name: string }[];
    if (!objectColumns.some((column) => column.name === "identity_text"))
      this.db.exec(
        "ALTER TABLE objects ADD COLUMN identity_text TEXT NOT NULL DEFAULT ''",
      );
    if (
      !objectColumns.some(
        (column) => column.name === "recommended_property_ids",
      )
    )
      this.db.exec(
        "ALTER TABLE objects ADD COLUMN recommended_property_ids TEXT NOT NULL DEFAULT '[]'",
      );
    const dataColumns = this.db
      .prepare("PRAGMA table_info(data_records)")
      .all() as { name: string }[];
    if (!dataColumns.some((column) => column.name === "components_json"))
      this.db.exec("ALTER TABLE data_records ADD COLUMN components_json TEXT");
    const analysisColumns = this.db
      .prepare("PRAGMA table_info(analyses)")
      .all() as { name: string }[];
    for (const [name, fallback] of [
      ["layout_json", "{}"],
      ["attachment_ids", "[]"],
    ]) {
      if (!analysisColumns.some((column) => column.name === name))
        this.db.exec(
          `ALTER TABLE analyses ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${fallback}'`,
        );
    }
    const attachmentColumns = this.db
      .prepare("PRAGMA table_info(attachments)")
      .all() as { name: string }[];
    if (!attachmentColumns.some((column) => column.name === "remote_location"))
      this.db.exec("ALTER TABLE attachments ADD COLUMN remote_location TEXT");
    const documentColumns = this.db
      .prepare("PRAGMA table_info(documents)")
      .all() as { name: string }[];
    if (!documentColumns.some((column) => column.name === "file_hash"))
      this.db.exec(
        "ALTER TABLE documents ADD COLUMN file_hash TEXT NOT NULL DEFAULT ''",
      );
    const evidenceColumns = this.db
      .prepare("PRAGMA table_info(claim_evidence)")
      .all() as { name: string }[];
    if (!evidenceColumns.some((column) => column.name === "manifest_json"))
      this.db.exec("ALTER TABLE claim_evidence ADD COLUMN manifest_json TEXT");
    if (!evidenceColumns.some((column) => column.name === "documents_json"))
      this.db.exec("ALTER TABLE claim_evidence ADD COLUMN documents_json TEXT");
  }
  close() {
    this.db.close();
    this.files.close();
  }
  private commit<T>(operation: () => T, name: string): T {
    if (this.commitDepth) {
      const result = operation();
      this.persistRegistry(name);
      return result;
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.commitDepth++;
    this.writtenDocuments.clear();
    try {
      return this.files.commit(
        () => {
          const result = operation();
          this.persistRegistry(name);
          for (const relative of this.writtenDocuments)
            this.db
              .prepare("UPDATE documents SET file_hash=? WHERE file_path=?")
              .run(
                sha256(this.files.read(relative)),
                path.join(this.dataDir, relative),
              );
          return result;
        },
        () => this.db.exec("COMMIT"),
        () => {
          if (this.db.inTransaction) this.db.exec("ROLLBACK");
        },
      );
    } finally {
      this.commitDepth--;
    }
  }
  private persistRegistry(operation: string) {
    const write = (file: string, records: unknown) =>
      this.atomicWrite(
        path.join(this.dataDir, file),
        json({ schema: "swb.registry/2", records }),
      );
    if (/Object|mergeObjects|createSample|copySample/.test(operation))
      write("registry/objects.json", this.searchObjects());
    if (/Property|finalizeDocument/.test(operation))
      write("registry/properties.json", this.searchProperties());
    if (/Attachment/.test(operation)) {
      const ids = this.db.prepare("SELECT id FROM attachments").all() as {
        id: string;
      }[];
      write(
        "attachments/manifest.json",
        ids.map(({ id }) => {
          const attachment = this.getAttachment(id);
          return {
            ...attachment,
            localPath: path.relative(this.dataDir, attachment.localPath),
          };
        }),
      );
    }
    if (/Job/.test(operation)) write("jobs/tasks.json", this.listJobs());
  }
  status() {
    return {
      dataDir: this.dataDir,
      db: path.join(this.dataDir, "index", "workbench.sqlite"),
      counts: {
        samples: this.db.prepare("SELECT count(*) n FROM samples").get() as any,
        data: this.db
          .prepare("SELECT count(*) n FROM data_records")
          .get() as any,
        objects: this.db.prepare("SELECT count(*) n FROM objects").get() as any,
      },
      pending: this.db
        .prepare(
          "SELECT count(*) n FROM documents WHERE extraction_status IN ('pending','error')",
        )
        .get() as any,
    };
  }
  private entityDir(entityType: string) {
    return path.join(
      this.dataDir,
      entityType === "sample"
        ? "samples"
        : entityType === "data"
          ? "data"
          : entityType === "analysis"
            ? "analyses"
            : "claims",
    );
  }
  private entityFile(entityType: "data" | "analysis" | "claim", id: string) {
    return path.join(this.entityDir(entityType), `${id}.md`);
  }
  private writeEntityFile(
    entityType: "data" | "analysis" | "claim",
    id: string,
    body: string,
    head?: Partial<DocumentHead>,
  ) {
    const entityPath = this.entityFile(entityType, id);
    this.entityFiles.check(id, entityPath);
    const docHead = {
      ...createHead(entityType, id, body),
      ...head,
      bodyHash: sha256(body),
      updatedAt: now(),
    } as DocumentHead;
    if (entityType === "data") {
      const { body: _body, ...data } = this.getData(id);
      docHead.data = data;
    }
    if (entityType === "analysis") {
      const { body: _body, ...analysis } = this.getAnalysis(id);
      docHead.analysis = analysis;
    }
    if (entityType === "claim") {
      const { text: _text, evidence, ...claim } = this.getClaim(id);
      docHead.claim = {
        ...claim,
        evidenceIds: evidence.map((item) => item.id),
      };
      for (const item of evidence)
        this.atomicWrite(
          path.join(this.dataDir, "evidence", id, `${item.id}.json`),
          json(item),
        );
    }
    const serialized = serializeDocument({ head: docHead, body });
    this.atomicWrite(entityPath, serialized);
    this.entityFiles.accept(id, serialized);
  }
  private readDocRow(id: string) {
    return this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as any;
  }
  readDocument(id: string): DocumentFile & {
    filePath: string;
  } {
    const row = this.readDocRow(id);
    if (!row) throw new Error("文档不存在");
    const raw = this.files.read(path.relative(this.dataDir, row.file_path));
    const doc = parseDocument(raw);
    return { ...doc, filePath: row.file_path };
  }
  ensureLatest(id: string) {
    const row = this.readDocRow(id);
    let staleMirror = false;
    if (row) {
      const raw = this.files.read(path.relative(this.dataDir, row.file_path));
      if (row.file_hash && sha256(raw) !== row.file_hash)
        throw Object.assign(
          new Error("磁盘文件已变化，请明确重新加载后再读取最新结构"),
          { code: "EXTERNAL_CHANGE" },
        );
      const doc = parseDocument(raw);
      staleMirror = Object.values(doc.head.blocks).some(
        (binding) =>
          binding.dataId &&
          binding.baseVersion !== this.getData(binding.dataId).version,
      );
    }
    if (
      row &&
      (row.extraction_status === "pending" ||
        row.extraction_status === "error" ||
        staleMirror)
    ) {
      const result = this.finalizeDocument(id);
      if (result.status === "stale")
        throw new Error("文档需要重新加载，不能返回旧结构为最新");
      return result;
    }
    return { status: row?.extraction_status ?? "missing" };
  }
  private atomicWrite(filePath: string, content: string) {
    const relative = path.relative(this.dataDir, filePath);
    this.files.write(relative, content);
    if (relative.startsWith("samples/")) {
      this.writtenDocuments.add(relative);
      this.db
        .prepare("UPDATE documents SET file_hash=? WHERE file_path=?")
        .run(sha256(content), filePath);
    }
  }
  createSample(
    input: {
      code?: string;
      title?: string;
      body?: string;
    } = {},
  ) {
    return this.commit(() => {
      const dateParts = new Intl.DateTimeFormat("en-CA", {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const date = ["year", "month", "day"]
        .map((type) => dateParts.find((part) => part.type === type)!.value)
        .join("");
      const numbering = this.files.has("registry/numbers.json")
        ? (JSON.parse(this.files.read("registry/numbers.json")) as {
            schema: string;
            lastByDate: Record<string, number>;
          })
        : { schema: "swb.numbering/2", lastByDate: {} };
      let count = (numbering.lastByDate[date] || 0) + 1;
      while (
        this.db
          .prepare("SELECT 1 FROM samples WHERE code=?")
          .get(`S${date}-${String(count).padStart(2, "0")}`)
      )
        count++;
      const code = input.code ?? `S${date}-${String(count).padStart(2, "0")}`;
      if (this.db.prepare("SELECT 1 FROM samples WHERE code=?").get(code))
        throw new Error("样品编号已存在");
      if (!input.code) {
        numbering.lastByDate[date] = count;
        this.atomicWrite(
          path.join(this.dataDir, "registry/numbers.json"),
          json(numbering),
        );
      }
      const id = uuid();
      const body = ensureBlockIds(input.body?.trim() || "- ");
      const head = createHead("sample", id, body);
      head.code = code;
      head.sample = { title: input.title ?? code, createdAt: now() };
      const filePath = path.join(this.entityDir("sample"), `${id}.md`);
      const doc = { head, body };
      this.atomicWrite(filePath, serializeDocument(doc));
      const t = now();
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO samples(id,code,title,document_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          )
          .run(id, code, input.title ?? code, id, t, t);
        this.db
          .prepare(
            "INSERT INTO objects(id,canonical_name,role,created_at,updated_at) VALUES(?,?,?,?,?)",
          )
          .run(id, code, "sample", t, t);
        this.db
          .prepare(
            "INSERT INTO documents(id,entity_type,file_path,content_version,body_hash,extraction_status,projection_version,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(id, "sample", filePath, 1, sha256(body), "pending", 0, t);
      });
      tx();
      return this.getSample(id);
    }, "createSample");
  }
  listSamples() {
    return this.db
      .prepare("SELECT id FROM samples ORDER BY created_at DESC")
      .all()
      .map((s: any) => this.getSample(s.id));
  }
  updateSample(
    id: string,
    input: { code?: string; title?: string; expectedVersion: number },
  ) {
    return this.commit(() => {
      const sample = this.getSample(id),
        document = this.readDocument(id);
      if (input.expectedVersion !== document.head.contentVersion)
        throw Object.assign(new Error("样品版本冲突"), {
          code: "CONFLICT",
          currentVersion: document.head.contentVersion,
        });
      const code = input.code?.trim() || sample.code,
        title = input.title ?? sample.title;
      this.saveDocument(id, document.body, input.expectedVersion);
      this.db
        .prepare("UPDATE samples SET code=?,title=?,updated_at=? WHERE id=?")
        .run(code, title, now(), id);
      this.updateObject(id, { canonicalName: code });
      const latest = this.readDocument(id);
      latest.head.code = code;
      latest.head.sample = { title, createdAt: sample.created_at };
      this.atomicWrite(latest.filePath, serializeDocument(latest));
      return this.getSample(id);
    }, "updateSample");
  }
  batchSamples(ids: string[], copies: number) {
    if (!Number.isInteger(copies) || copies < 1 || copies > 100)
      throw new Error("批量数量须为 1 至 100");
    return this.commit(
      () =>
        Array.from({ length: copies }, () =>
          ids.length
            ? ids.map((id) => this.copySample(id))
            : [this.createSample()],
        ).flat(),
      "batchSamples",
    );
  }
  batchFromTemplate(
    id: string,
    expectedVersion: number,
    rows: { code?: string; values: Record<string, string> }[],
  ) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100)
      throw new Error("批量行数须为 1 至 100");
    return this.commit(() => {
      this.ensureLatest(id);
      const source = this.getSample(id);
      if (source.document.head.contentVersion !== expectedVersion)
        throw Object.assign(new Error("模板已经更新，请重新加载后创建"), {
          code: "CONFLICT",
        });
      const parsed = parseBody(id, source.document.body).records.flatMap(
        (record) => record.properties,
      );
      const known = new Set(parsed.map((property) => property.id));
      for (const row of rows)
        for (const [key, value] of Object.entries(row.values)) {
          if (
            !known.has(key) ||
            typeof value !== "string" ||
            /[|｜\r\n]/.test(value)
          )
            throw new Error("属性修改无效，请检查模板和输入格式");
        }
      return rows.map((row) => {
        const lines = source.document.body.split(/\r?\n/);
        for (const property of [...parsed].sort(
          (a, b) => b.sourceColumn - a.sourceColumn,
        )) {
          if (!(property.id in row.values)) continue;
          const lineIndex = property.sourceLine - 1,
            line = lines[lineIndex];
          const prefix = line.match(/^\s*-\s+/)?.[0].length || 0;
          const start = prefix + property.sourceColumn;
          const next = line.slice(start).search(/[|｜]/);
          const end = next < 0 ? line.length : start + next;
          const segment = line.slice(start, end),
            colon = segment.search(/[:：]/);
          lines[lineIndex] =
            line.slice(0, start) +
            segment.slice(0, colon + 1) +
            row.values[property.id].trim() +
            line.slice(end);
        }
        return this.copySample(id, row.code || undefined, lines.join("\n"));
      });
    }, "batchSamples");
  }
  getSample(id: string) {
    const s = this.db.prepare("SELECT * FROM samples WHERE id=?").get(id) as
      SampleIndexRow | undefined;
    if (!s) throw new Error("样品不存在");
    const document = this.readDocument(s.document_id);
    return {
      ...s,
      createdAt: s.created_at,
      contentVersion: document.head.contentVersion,
      extractionStatus: document.head.extractionStatus,
      document,
      properties: this.db
        .prepare(
          "SELECT pv.*,o.canonical_name object_name,p.canonical_name property_name FROM property_values pv JOIN objects o ON o.id=pv.object_id JOIN properties p ON p.id=pv.property_id WHERE pv.sample_id=? ORDER BY pv.source_line",
        )
        .all(id) as SampleProjection[],
    };
  }
  saveDocument(
    id: string,
    body: string,
    expectedVersion?: number,
    bindings?: ReferenceOccurrence[],
  ) {
    return this.commit(() => {
      const row = this.readDocRow(id);
      if (!row) throw new Error("文档不存在");
      if (
        expectedVersion !== undefined &&
        Number(row.content_version) !== Number(expectedVersion)
      ) {
        const e: any = new Error("文档版本冲突");
        e.code = "CONFLICT";
        e.currentVersion = row.content_version;
        throw e;
      }
      const raw = this.files.read(path.relative(this.dataDir, row.file_path));
      const diskDoc = parseDocument(raw);
      if (
        sha256(diskDoc.body) !== row.body_hash ||
        (row.file_hash && sha256(raw) !== row.file_hash)
      ) {
        const e: any = new Error("磁盘文件已被外部修改，请先重新加载");
        e.code = "EXTERNAL_CHANGE";
        throw e;
      }
      const existing = this.readDocument(id);
      const normalized = ensureBlockIds(body);
      const hash = sha256(normalized);
      const head = {
        ...existing.head,
        ...(bindings ? { references: bindings } : {}),
        contentVersion: row.content_version + 1,
        bodyHash: hash,
        extractionStatus: "pending",
        projectionVersion: existing.head.projectionVersion ?? 0,
        updatedAt: now(),
      } as DocumentHead;
      this.atomicWrite(
        row.file_path,
        serializeDocument({ head, body: normalized }),
      );
      this.db
        .prepare(
          "UPDATE documents SET content_version=?,body_hash=?,extraction_status='pending',extraction_error=NULL,updated_at=? WHERE id=?",
        )
        .run(head.contentVersion, hash, now(), id);
      return {
        id,
        contentVersion: head.contentVersion,
        bodyHash: hash,
        extractionStatus: "pending" as const,
      };
    }, "saveDocument");
  }
  reloadDocument(id: string) {
    return this.commit(() => {
      const row = this.readDocRow(id);
      if (!row) throw new Error("文档不存在");
      const doc = this.readDocument(id);
      if (doc.head.id !== id || doc.head.entityType !== row.entity_type)
        throw new Error("文件身份冲突，请修复稳定 ID 后重新加载");
      const body = ensureBlockIds(doc.body);
      const head: DocumentHead = {
        ...doc.head,
        contentVersion: Number(row.content_version) + 1,
        bodyHash: sha256(body),
        extractionStatus: "pending",
        updatedAt: now(),
      };
      this.atomicWrite(row.file_path, serializeDocument({ head, body }));
      this.db
        .prepare(
          "UPDATE documents SET content_version=?,body_hash=?,extraction_status='pending',extraction_error=NULL,updated_at=? WHERE id=?",
        )
        .run(head.contentVersion, head.bodyHash, head.updatedAt, id);
      return { head, body };
    }, "reloadDocument");
  }
  saveSnapshot(entityType: string, entityId: string, body: string) {
    return this.commit(() => {
      const hash = sha256(body);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO snapshots(id,entity_type,entity_id,body_hash,body,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(uuid(), entityType, entityId, hash, body, now());
      const snapshot = this.db
        .prepare("SELECT * FROM snapshots WHERE entity_id=? AND body_hash=?")
        .get(entityId, hash) as { id: string };
      this.atomicWrite(
        path.join(this.dataDir, "history", entityId, `${snapshot.id}.json`),
        json(snapshot),
      );
    }, "saveSnapshot");
  }
  listSnapshots(entityId: string) {
    return this.db
      .prepare(
        "SELECT * FROM snapshots WHERE entity_id=? ORDER BY created_at DESC",
      )
      .all(entityId) as {
      id: string;
      entity_id: string;
      entity_type: string;
      body_hash: string;
      body: string;
      created_at: string;
    }[];
  }
  assertEntityCurrent(type: "data" | "analysis" | "claim", id: string) {
    this.entityFiles.check(id, this.entityFile(type, id));
  }
  finalizeEntity(
    type: "data" | "analysis" | "claim",
    id: string,
    expectedVersion?: number,
  ) {
    return this.commit(() => {
      const entity =
        type === "data"
          ? this.getData(id)
          : type === "analysis"
            ? this.getAnalysis(id)
            : this.getClaim(id);
      if (expectedVersion !== undefined && expectedVersion !== entity.version)
        throw Object.assign(new Error("完成编辑时版本已变化，请加载最新内容"), {
          code: "CONFLICT",
          currentVersion: entity.version,
        });
      this.assertEntityCurrent(type, id);
      const body = "text" in entity ? entity.text : entity.body;
      this.saveSnapshot(
        type,
        id,
        body.replace(/^\s*<!-- swb:block id="[^"]+" -->\r?\n/gm, ""),
      );
      return { status: "ready", contentVersion: entity.version };
    }, "finalizeEntity");
  }
  finalizeDocument(id: string) {
    return this.commit(() => {
      const row = this.readDocRow(id);
      if (!row) throw new Error("文档不存在");
      const doc = this.readDocument(id);
      let parsed = parseBody(id, doc.body);
      if (row.body_hash !== parsed.bodyHash) {
        this.db
          .prepare(
            "UPDATE documents SET extraction_status='pending' WHERE id=?",
          )
          .run(id);
        return { status: "stale", parsed };
      }
      doc.head.blocks ??= {};
      // A normal text editor may rewrite the YAML head while retaining the
      // hidden block markers. The original Data file still carries the exact
      // source document and source block, so that pair can restore identity
      // without guessing by title or body text.
      const sourceData = this.listData().filter(
        (data) => data.sourceDocumentId === id && data.sourceBlockId,
      );
      for (const dataItem of parsed.records.flatMap(
        (record) => record.dataItems || [],
      )) {
        if (doc.head.blocks[dataItem.blockId]?.dataId) continue;
        const matches = sourceData.filter(
          (data) => data.sourceBlockId === dataItem.blockId,
        );
        if (matches.length !== 1) continue;
        const current = matches[0];
        const dataIds = blockLines(current.body).map((block) => block.id);
        const mirrorIds = blockLines(dataItem.body).map((block) => block.id);
        const dataBlockIds = Object.fromEntries(
          dataIds
            .slice(0, mirrorIds.length)
            .map((dataBlockId, index) => [dataBlockId, mirrorIds[index]]),
        );
        doc.head.blocks[dataItem.blockId] = {
          kind: "data",
          dataId: current.id,
          baseVersion: current.version,
          baseHash: dataMirrorHash(current.body),
          baseName: current.name,
          dataBlockIds,
        };
      }
      let refreshed = false;
      for (const dataItem of parsed.records.flatMap(
        (record) => record.dataItems || [],
      )) {
        const binding = doc.head.blocks[dataItem.blockId];
        if (!binding?.dataId) continue;
        const current = this.getData(binding.dataId);
        const currentHash = dataMirrorHash(current.body),
          mirrorHash = dataMirrorHash(dataItem.body);
        if (
          binding.baseVersion === undefined ||
          binding.baseHash === undefined
        ) {
          if (mirrorHash !== currentHash || dataItem.name !== current.name) {
            const error = Object.assign(
              new Error("旧 Data 引用缺少同步基线，请重新关联；未覆盖现有数据"),
              { code: "DATA_CONFLICT", dataId: current.id },
            );
            throw error;
          }
          Object.assign(binding, {
            baseVersion: current.version,
            baseHash: currentHash,
            baseName: current.name,
          });
        }
        const localChanged =
          mirrorHash !== binding.baseHash || dataItem.name !== binding.baseName;
        const remoteChanged = current.version !== binding.baseVersion;
        if (
          localChanged &&
          remoteChanged &&
          (mirrorHash !== currentHash || dataItem.name !== current.name)
        )
          throw Object.assign(
            new Error("Data 两个入口均有修改，请复制草稿并加载最新内容"),
            {
              code: "DATA_CONFLICT",
              dataId: current.id,
              currentVersion: current.version,
            },
          );
        if (!localChanged && remoteChanged) {
          if (currentHash !== mirrorHash || dataItem.name !== current.name) {
            const mapping = (binding.dataBlockIds ??= {});
            doc.body = replaceDataMirror(
              doc.body,
              dataItem.blockId,
              current.name,
              mapDataBlocks(current.body, mapping, "toMirror"),
            );
            refreshed = true;
          }
          Object.assign(binding, {
            baseVersion: current.version,
            baseHash: currentHash,
            baseName: current.name,
          });
        }
      }
      if (refreshed) {
        doc.head.contentVersion = Number(row.content_version) + 1;
        parsed = parseBody(id, doc.body);
      }
      // Materialize only still-valid, explicitly selected creation intents.
      // This shares the document's durable transaction, so retries keep identity.
      for (const record of parsed.records) {
        for (const reference of record.references) {
          const intent = doc.head.references?.find(
            (binding) =>
              binding.status === "create-intent" &&
              binding.blockId === reference.blockId &&
              binding.start === reference.start &&
              binding.end === reference.end &&
              binding.rawText === reference.rawText,
          );
          if (!intent) continue;
          if (
            !intent.intentId ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              intent.intentId,
            ) ||
            !["material", "equipment", "process"].includes(intent.role)
          ) {
            parsed.warnings.push(
              `「${intent.rawText}」的创建意图无效，请重新选择类别。`,
            );
            continue;
          }
          const created = this.createObject(
            {
              canonicalName: intent.rawText,
              role: intent.role,
            },
            intent.intentId,
          );
          intent.objectId = created.id;
          intent.status = "bound";
          delete intent.intentId;
        }
      }
      const objects = this.searchObjects();
      for (const record of parsed.records)
        record.references = record.references.map((reference) => ({
          ...resolveReference(reference, doc.head.references || [], objects),
          operationId: record.blockId,
        }));
      const sample = this.db
        .prepare("SELECT id FROM samples WHERE document_id=?")
        .get(id) as any;
      const tx = this.db.transaction(() => {
        this.db
          .prepare("DELETE FROM property_values WHERE document_id=?")
          .run(id);
        const extracted: any[] = [];
        for (const record of parsed.records)
          for (const p of record.properties) {
            const reference = record.references.find(
              (reference) =>
                reference.blockId === p.blockId &&
                reference.rawText === p.objectId &&
                reference.status === "bound",
            );
            const object = reference?.objectId
              ? objects.find((object) => object.id === reference.objectId)
              : undefined;
            if (!object) {
              parsed.warnings.push(
                `未绑定对象「${p.objectId}」，已保留原文；请选择已有对象或明确创建类别。`,
              );
              continue;
            }
            let prop = this.db
              .prepare("SELECT * FROM properties WHERE canonical_name=?")
              .get(p.propertyName) as any;
            if (!prop) {
              const propId = uuid();
              this.db
                .prepare(
                  "INSERT INTO properties(id,canonical_name) VALUES(?,?)",
                )
                .run(propId, p.propertyName);
              prop = { id: propId };
            }
            const valueId = p.id;
            this.db
              .prepare(
                "INSERT OR IGNORE INTO property_values(id,sample_id,document_id,block_id,object_id,property_id,value_text,source_line,source_column) VALUES(?,?,?,?,?,?,?,?,?)",
              )
              .run(
                valueId,
                sample?.id ?? "",
                id,
                p.blockId,
                object.id,
                prop.id,
                p.valueText,
                p.sourceLine,
                p.sourceColumn,
              );
            this.db
              .prepare(
                "UPDATE properties SET usage_count=(SELECT count(*) FROM property_values WHERE property_id=properties.id),last_used_at=? WHERE id=?",
              )
              .run(now(), prop.id);
            extracted.push({
              id: valueId,
              objectId: object.id,
              propertyId: prop.id,
              valueText: p.valueText,
              blockId: p.blockId,
              sourceLine: p.sourceLine,
              sourceColumn: p.sourceColumn,
            });
          }
        const headBlocks: DocumentHead["blocks"] = {
          ...(doc.head.blocks ?? {}),
        };
        const parsedDataIds = new Set(
          parsed.records.flatMap((record) =>
            (record.dataItems || []).map((item) => item.blockId),
          ),
        );
        const orphanDataIds = [
          ...new Set(
            Object.entries(headBlocks).flatMap(([blockId, binding]) =>
              binding.dataId && !parsedDataIds.has(blockId)
                ? [binding.dataId]
                : [],
            ),
          ),
        ];
        for (const record of parsed.records)
          for (const dataItem of record.dataItems ??
            (record.data ? [{ ...record.data, body: "" }] : [])) {
            const binding = headBlocks[dataItem.blockId];
            const candidates =
              binding?.kind === "data-unresolved"
                ? binding.candidateDataIds || []
                : orphanDataIds;
            if (
              !binding?.dataId &&
              binding?.kind !== "new-data-intent" &&
              (candidates.length || binding?.kind === "data-unresolved")
            ) {
              headBlocks[dataItem.blockId] = {
                kind: "data-unresolved",
                candidateDataIds: candidates,
              };
              parsed.warnings.push(
                `数据「${dataItem.name}」的区块身份无法确认；请选择已有 Data 或明确新建，未重复创建数据。`,
              );
              continue;
            }
            const prior = headBlocks[dataItem.blockId]?.dataId;
            const dataId = prior ?? uuid();
            if (prior) {
              const current = this.getData(prior);
              if (
                dataMirrorHash(current.body) !==
                  dataMirrorHash(dataItem.body) ||
                current.name !== dataItem.name
              ) {
                const mapping = (headBlocks[dataItem.blockId].dataBlockIds ??=
                  {});
                this.updateData(prior, {
                  name: dataItem.name,
                  body: mapDataBlocks(dataItem.body, mapping, "toData"),
                  expectedVersion: current.version,
                });
              }
            } else
              this.db
                .prepare(
                  "INSERT INTO data_records(id,name,description,about_sample_ids,source_document_id,source_block_id,body,body_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                )
                .run(
                  dataId,
                  dataItem.name,
                  "",
                  json(sample?.id ? [sample.id] : []),
                  id,
                  dataItem.blockId,
                  dataItem.body,
                  sha256(dataItem.body),
                  now(),
                );
            this.syncBodyAttachments(dataId, parsed.warnings);
            this.writeEntityFile("data", dataId, this.getData(dataId).body, {
              contentVersion: prior ? this.getData(dataId).version : 1,
            });
            const current = this.getData(dataId);
            const mapping =
              headBlocks[dataItem.blockId]?.dataBlockIds ||
              Object.fromEntries(
                [...current.body.matchAll(/swb:block id="([^"]+)"/g)].map(
                  (match) => [match[1], match[1]],
                ),
              );
            headBlocks[dataItem.blockId] = {
              kind: "data",
              dataId,
              baseVersion: current.version,
              baseHash: dataMirrorHash(current.body),
              baseName: current.name,
              dataBlockIds: mapping,
            };
          }
        const liveDataBlocks = new Set(
          parsed.records.flatMap((record) =>
            (record.dataItems || []).map((item) => item.blockId),
          ),
        );
        for (const [blockId, binding] of Object.entries(headBlocks))
          if (
            ["data", "data-unresolved", "new-data-intent"].includes(
              binding.kind,
            ) &&
            !liveDataBlocks.has(blockId)
          )
            delete headBlocks[blockId];
        const head = {
          ...doc.head,
          blocks: headBlocks,
          references: parsed.records.flatMap((record) => record.references),
          usages: parsed.records.flatMap((record) =>
            [
              ...new Set(
                record.references.flatMap((reference) =>
                  reference.objectId ? [reference.objectId] : [],
                ),
              ),
            ].map((objectId) => ({ operationId: record.blockId, objectId })),
          ),
          bodyHash: parsed.bodyHash,
          extractionStatus: "ready",
          extractionError: undefined,
          projectionVersion: Number(row.projection_version) + 1,
          extracted,
          updatedAt: now(),
        } as DocumentHead;
        this.atomicWrite(
          row.file_path,
          serializeDocument({ head, body: doc.body }),
        );
        this.db
          .prepare(
            "UPDATE documents SET extraction_status='ready',extraction_error=NULL,projection_version=?,updated_at=?,content_version=?,body_hash=? WHERE id=?",
          )
          .run(
            head.projectionVersion,
            now(),
            head.contentVersion,
            head.bodyHash,
            id,
          );
      });
      try {
        tx();
        this.saveSnapshot(
          row.entity_type,
          id,
          doc.body.replace(/^\s*<!-- swb:block id="[^"]+" -->\r?\n/gm, ""),
        );
      } catch (error) {
        this.db
          .prepare(
            "UPDATE documents SET extraction_status='error',extraction_error=?,updated_at=? WHERE id=?",
          )
          .run(String(error), now(), id);
        throw error;
      }
      return {
        status: "ready",
        parsed,
        contentVersion: doc.head.contentVersion,
        head: this.readDocument(id).head,
        ...(refreshed ? { body: doc.body } : {}),
      };
    }, "finalizeDocument");
  }
  searchObjects(query = ""): ResearchObject[] {
    const q = query.toLowerCase();
    const rows = this.db
      .prepare("SELECT * FROM objects ORDER BY lifecycle,canonical_name")
      .all() as any[];
    const aliases = new Map<string, string[]>();
    for (const row of this.db
      .prepare("SELECT object_id,alias FROM object_aliases ORDER BY alias")
      .all() as { object_id: string; alias: string }[]) {
      const values = aliases.get(row.object_id) ?? [];
      values.push(row.alias);
      aliases.set(row.object_id, values);
    }
    return rows
      .filter(
        (r) =>
          !q ||
          r.canonical_name.toLowerCase().includes(q) ||
          (aliases.get(r.id) ?? []).some((alias) =>
            alias.toLowerCase().includes(q),
          ),
      )
      .map((r) => ({
        id: r.id,
        canonicalName: r.canonical_name,
        version: r.version,
        role: r.role,
        lifecycle: r.lifecycle,
        redirectTo: r.redirect_to,
        identityText: r.identity_text,
        recommendedPropertyIds: parseJson<string[]>(
          r.recommended_property_ids,
          [],
        ),
        aliases: aliases.get(r.id) ?? [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
  }
  createObject(
    input: {
      canonicalName: string;
      role: string;
      aliases?: string[];
      identityText?: string;
      recommendedPropertyIds?: string[];
    },
    id = uuid(),
  ) {
    return this.commit(() => {
      const existing = this.searchObjects().find((object) => object.id === id);
      if (existing) {
        if (
          existing.canonicalName !== input.canonicalName.trim() ||
          existing.role !== input.role
        )
          throw Object.assign(
            new Error("创建意图身份与已有对象不一致，请重新选择对象"),
            { code: "CONFLICT" },
          );
        return existing;
      }
      const t = now();
      if (
        !input.canonicalName.trim() ||
        ["数据", "论点"].includes(input.canonicalName.trim()) ||
        /[\[\]【】［］]/.test(input.canonicalName)
      )
        throw new Error("对象名称为空、包含方括号或使用了保留标记");
      if (
        !["sample", "material", "equipment", "process", "other"].includes(
          input.role,
        )
      )
        throw new Error("请明确选择对象类别");
      this.db
        .prepare(
          "INSERT INTO objects(id,canonical_name,role,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .run(id, input.canonicalName.trim(), input.role, t, t);
      this.saveObjectMetadata(
        id,
        input.identityText ?? "",
        input.recommendedPropertyIds ?? [],
      );
      for (const alias of input.aliases ?? [])
        this.db
          .prepare(
            "INSERT OR IGNORE INTO object_aliases(object_id,alias) VALUES(?,?)",
          )
          .run(id, alias);
      return this.searchObjects(input.canonicalName).find(
        (object) => object.id === id,
      )!;
    }, "createObject");
  }
  updateObject(
    id: string,
    input: {
      canonicalName?: string;
      role?: string;
      lifecycle?: Lifecycle;
      alias?: string;
      aliases?: string[];
      identityText?: string;
      recommendedPropertyIds?: string[];
      expectedVersion?: number;
    },
  ) {
    return this.commit(() => {
      const current = this.db
        .prepare("SELECT * FROM objects WHERE id=?")
        .get(id) as any;
      if (!current) throw new Error("对象不存在");
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      )
        throw Object.assign(new Error("对象版本冲突"), {
          code: "CONFLICT",
          currentVersion: current.version,
        });
      if (current.lifecycle === "merged")
        throw new Error("已合并对象不可修改，请编辑目标对象");
      const canonicalName =
        input.canonicalName?.trim() ?? current.canonical_name;
      if (
        !canonicalName ||
        ["数据", "论点"].includes(canonicalName) ||
        /[\[\]【】［］]/.test(canonicalName)
      )
        throw new Error("对象名称为空、包含方括号或使用了保留标记");
      if (
        input.role &&
        !["material", "equipment", "process", "sample", "other"].includes(
          input.role,
        )
      )
        throw new Error("对象类别无效");
      if (
        input.lifecycle &&
        !["active", "deprecated"].includes(input.lifecycle)
      )
        throw new Error("生命周期无效");
      this.saveObjectMetadata(
        id,
        input.identityText ?? current.identity_text,
        input.recommendedPropertyIds ??
          parseJson<string[]>(current.recommended_property_ids, []),
      );
      this.db
        .prepare(
          "UPDATE objects SET canonical_name=?,role=?,lifecycle=?,updated_at=?,version=version+1 WHERE id=?",
        )
        .run(
          canonicalName,
          input.role ?? current.role,
          input.lifecycle ?? current.lifecycle,
          now(),
          id,
        );
      if (input.aliases) {
        this.db.prepare("DELETE FROM object_aliases WHERE object_id=?").run(id);
        for (const alias of input.aliases)
          if (alias.trim())
            this.db
              .prepare(
                "INSERT OR IGNORE INTO object_aliases(object_id,alias) VALUES(?,?)",
              )
              .run(id, alias.trim());
      }
      if (input.alias)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO object_aliases(object_id,alias) VALUES(?,?)",
          )
          .run(id, input.alias);
      return this.searchObjects(
        input.canonicalName ?? current.canonical_name,
      ).find((object) => object.id === id)!;
    }, "updateObject");
  }
  private saveObjectMetadata(
    id: string,
    identity: string,
    recommendations: string[],
  ) {
    if (
      typeof identity !== "string" ||
      !Array.isArray(recommendations) ||
      recommendations.some(
        (propertyId) =>
          typeof propertyId !== "string" ||
          !this.db
            .prepare("SELECT 1 FROM properties WHERE id=?")
            .get(propertyId),
      )
    )
      throw Object.assign(
        new Error("标识信息或推荐属性无效，请选择已有全局属性"),
        { code: "INVALID_INPUT" },
      );
    this.db
      .prepare(
        "UPDATE objects SET identity_text=?,recommended_property_ids=? WHERE id=?",
      )
      .run(identity.trim(), json([...new Set(recommendations)]), id);
  }
  mergeObjects(
    sourceId: string,
    targetId: string,
    expectedVersion: number,
    targetVersion: number,
  ) {
    return this.commit(() => {
      if (sourceId === targetId) throw new Error("不能合并自身");
      const target = this.db
        .prepare("SELECT * FROM objects WHERE id=?")
        .get(targetId) as any;
      const source = this.db
        .prepare("SELECT * FROM objects WHERE id=?")
        .get(sourceId) as any;
      if (!source || !target) throw new Error("对象不存在");
      if (
        source.version !== expectedVersion ||
        target.version !== targetVersion
      )
        throw Object.assign(new Error("对象版本已变化，请重新加载后再合并"), {
          code: "CONFLICT",
          currentVersion: source.version,
          targetVersion: target.version,
        });
      if (source.lifecycle === "merged" || target.lifecycle !== "active")
        throw new Error("只能将未合并对象合并到启用中的对象");
      if (source.role !== target.role)
        throw new Error("不同类别的对象不能合并");
      const tx = this.db.transaction(() => {
        this.db
          .prepare("UPDATE property_values SET object_id=? WHERE object_id=?")
          .run(targetId, sourceId);
        const aliases = this.db
          .prepare("SELECT alias FROM object_aliases WHERE object_id=?")
          .all(sourceId) as any[];
        for (const alias of aliases)
          this.db
            .prepare(
              "INSERT OR IGNORE INTO object_aliases(object_id,alias) VALUES(?,?)",
            )
            .run(targetId, alias.alias);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO object_aliases(object_id,alias) VALUES(?,?)",
          )
          .run(targetId, source.canonical_name);
        this.db
          .prepare("DELETE FROM object_aliases WHERE object_id=?")
          .run(sourceId);
        this.db
          .prepare(
            "UPDATE objects SET lifecycle='merged',redirect_to=?,updated_at=?,version=version+1 WHERE id=?",
          )
          .run(targetId, now(), sourceId);
        this.db
          .prepare(
            "UPDATE objects SET version=version+1,updated_at=? WHERE id=?",
          )
          .run(now(), targetId);
        const documents = this.db
          .prepare(
            "SELECT id,file_path,file_hash FROM documents WHERE entity_type='sample'",
          )
          .all() as { id: string; file_path: string; file_hash: string }[];
        for (const document of documents) {
          const currentRaw = this.files.read(
            path.relative(this.dataDir, document.file_path),
          );
          if (document.file_hash && sha256(currentRaw) !== document.file_hash)
            throw Object.assign(
              new Error("磁盘文件已被外部修改，请先重新加载"),
              { code: "EXTERNAL_CHANGE" },
            );
          const file = this.readDocument(document.id);
          const references = file.head.references || [];
          const extracted = file.head.extracted || [];
          const usages = file.head.usages || [];
          const changed =
            references.some((item) => item.objectId === sourceId) ||
            extracted.some((item) => item.objectId === sourceId) ||
            usages.some((item) => item.objectId === sourceId);
          if (!changed) continue;
          file.head.references = references.map((item) =>
            item.objectId === sourceId ? { ...item, objectId: targetId } : item,
          );
          file.head.extracted = extracted.map((item) =>
            item.objectId === sourceId ? { ...item, objectId: targetId } : item,
          );
          file.head.usages = usages.map((item) =>
            item.objectId === sourceId ? { ...item, objectId: targetId } : item,
          );
          file.head.projectionVersion += 1;
          file.head.updatedAt = now();
          this.atomicWrite(
            document.file_path,
            serializeDocument({ head: file.head, body: file.body }),
          );
          this.db
            .prepare(
              "UPDATE documents SET projection_version=?,updated_at=? WHERE id=?",
            )
            .run(file.head.projectionVersion, file.head.updatedAt, document.id);
        }
      });
      tx();
      return this.searchObjects(target.canonical_name)[0];
    }, "mergeObjects");
  }
  deprecateObject(id: string) {
    return this.commit(() => {
      return this.updateObject(id, { lifecycle: "deprecated" });
    }, "deprecateObject");
  }
  deleteObject(id: string, expectedVersion: number) {
    return this.commit(() => {
      const object = this.searchObjects().find((item) => item.id === id);
      if (!object) throw new Error("对象不存在");
      if (object.version !== expectedVersion)
        throw Object.assign(new Error("对象版本已变化，请重新加载后再删除"), {
          code: "CONFLICT",
          currentVersion: object.version,
        });
      const references = (
        this.db
          .prepare("SELECT count(*) n FROM property_values WHERE object_id=?")
          .get(id) as any
      ).n as number;
      const textualReferences = (
        this.db
          .prepare("SELECT id FROM documents WHERE entity_type='sample'")
          .all() as { id: string }[]
      ).some(({ id: documentId }) => {
        const head = this.readDocument(documentId).head;
        return (
          head.references?.some((item) => item.objectId === id) ||
          head.usages?.some((item) => item.objectId === id) ||
          head.extracted?.some((item) => item.objectId === id)
        );
      });
      if (references || textualReferences)
        throw new Error("对象仍有引用，不能永久删除");
      this.db.prepare("DELETE FROM object_aliases WHERE object_id=?").run(id);
      this.db.prepare("DELETE FROM objects WHERE id=?").run(id);
      return { deleted: true };
    }, "deleteObject");
  }
  searchProperties(query = ""): PropertyDefinition[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM properties ORDER BY usage_count DESC,last_used_at DESC",
      )
      .all() as any[];
    const aliases = new Map<string, string[]>();
    for (const row of this.db
      .prepare("SELECT property_id,alias FROM property_aliases ORDER BY alias")
      .all() as { property_id: string; alias: string }[]) {
      const values = aliases.get(row.property_id) ?? [];
      values.push(row.alias);
      aliases.set(row.property_id, values);
    }
    const q = query.toLowerCase();
    return rows
      .filter(
        (r) =>
          !q ||
          r.canonical_name.toLowerCase().includes(q) ||
          (aliases.get(r.id) ?? []).some((alias) =>
            alias.toLowerCase().includes(q),
          ),
      )
      .map((r) => ({
        id: r.id,
        canonicalName: r.canonical_name,
        version: r.version,
        dimension: r.dimension ?? undefined,
        recommendedUnit: r.recommended_unit ?? undefined,
        usageCount: r.usage_count,
        lastUsedAt: r.last_used_at ?? undefined,
        aliases: aliases.get(r.id) ?? [],
      }));
  }
  createProperty(input: {
    canonicalName: string;
    dimension?: string;
    recommendedUnit?: string;
    aliases?: string[];
  }) {
    return this.commit(() => {
      const id = uuid();
      this.db
        .prepare(
          "INSERT INTO properties(id,canonical_name,dimension,recommended_unit) VALUES(?,?,?,?)",
        )
        .run(
          id,
          input.canonicalName.trim(),
          input.dimension ?? null,
          input.recommendedUnit ?? null,
        );
      for (const alias of input.aliases ?? [])
        this.db
          .prepare(
            "INSERT OR IGNORE INTO property_aliases(property_id,alias) VALUES(?,?)",
          )
          .run(id, alias);
      return this.searchProperties(input.canonicalName)[0];
    }, "createProperty");
  }
  updateProperty(
    id: string,
    input: {
      canonicalName?: string;
      dimension?: string;
      recommendedUnit?: string;
      alias?: string;
      aliases?: string[];
      expectedVersion?: number;
    },
  ) {
    return this.commit(() => {
      const p = this.db
        .prepare("SELECT * FROM properties WHERE id=?")
        .get(id) as any;
      if (!p) throw new Error("属性不存在");
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== p.version
      )
        throw Object.assign(new Error("属性版本冲突"), {
          code: "CONFLICT",
          currentVersion: p.version,
        });
      this.db
        .prepare(
          "UPDATE properties SET canonical_name=?,dimension=?,recommended_unit=?,version=version+1 WHERE id=?",
        )
        .run(
          input.canonicalName ?? p.canonical_name,
          input.dimension ?? p.dimension,
          input.recommendedUnit ?? p.recommended_unit,
          id,
        );
      if (input.aliases) {
        this.db
          .prepare("DELETE FROM property_aliases WHERE property_id=?")
          .run(id);
        for (const alias of input.aliases)
          if (alias.trim())
            this.db
              .prepare(
                "INSERT OR IGNORE INTO property_aliases(property_id,alias) VALUES(?,?)",
              )
              .run(id, alias.trim());
      }
      if (input.alias)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO property_aliases(property_id,alias) VALUES(?,?)",
          )
          .run(id, input.alias);
      return this.searchProperties(input.canonicalName ?? p.canonical_name)[0];
    }, "updateProperty");
  }
  createData(input: {
    name: string;
    description?: string;
    aboutSampleIds?: string[];
    sourceDocumentId?: string;
    sourceBlockId?: string;
    body?: string;
    componentIds?: string[];
    components?: DataComponent[];
  }) {
    return this.commit(() => {
      const id = uuid();
      const t = now();
      const body = input.body ?? "";
      const about = [...new Set(input.aboutSampleIds ?? [])];
      for (const sampleId of about) {
        if (
          !this.db.prepare("SELECT 1 FROM samples WHERE id=?").get(sampleId)
        ) {
          throw Object.assign(new Error("About 样品不存在"), {
            code: "INVALID_INPUT",
          });
        }
      }
      const metadata = validateComponents(
        input.components ??
          legacyComponents(input.componentIds ?? [], (fileId) =>
            this.getAttachment(fileId),
          ),
        [],
        (fileId) => this.getAttachment(fileId),
      );
      const componentIds = [
        ...new Set(
          metadata.flatMap((component) =>
            component.attachmentId ? [component.attachmentId] : [],
          ),
        ),
      ];
      if (
        input.components &&
        input.componentIds &&
        json([...new Set(input.componentIds)].sort()) !==
          json([...componentIds].sort())
      ) {
        throw Object.assign(new Error("组件清单与附件引用不一致"), {
          code: "INVALID_INPUT",
        });
      }
      this.db
        .prepare(
          "INSERT INTO data_records(id,name,description,about_sample_ids,source_document_id,source_block_id,component_ids,components_json,body,body_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.name,
          input.description ?? "",
          json(about),
          input.sourceDocumentId ?? null,
          input.sourceBlockId ?? null,
          json(componentIds),
          json(metadata),
          body,
          sha256(body),
          t,
        );
      this.syncBodyAttachments(id);
      this.writeEntityFile("data", id, body);
      return this.getData(id);
    }, "createData");
  }
  private syncBodyAttachments(id: string, warnings: string[] = []) {
    const data = this.getData(id);
    const components = validateComponents(
      bodyAttachments(
        id,
        data.body,
        data.components,
        (fileId) => this.getAttachment(fileId),
        warnings,
      ),
      data.components,
      (fileId) => this.getAttachment(fileId),
    );
    this.db
      .prepare(
        "UPDATE data_records SET components_json=?,component_ids=? WHERE id=?",
      )
      .run(
        json(components),
        json([
          ...new Set(
            components.flatMap((component) =>
              component.attachmentId ? [component.attachmentId] : [],
            ),
          ),
        ]),
        id,
      );
  }
  getData(id: string): DataRecord & {
    body: string;
  } {
    const r = this.db
      .prepare("SELECT * FROM data_records WHERE id=?")
      .get(id) as any;
    if (!r) throw new Error("Data 不存在");
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      aboutSampleIds: parseJson(r.about_sample_ids, []),
      sourceDocumentId: r.source_document_id ?? undefined,
      sourceBlockId: r.source_block_id ?? undefined,
      componentIds: parseJson(r.component_ids, []),
      components: r.components_json
        ? JSON.parse(r.components_json)
        : legacyComponents(parseJson(r.component_ids, []), (id) =>
            this.getAttachment(id),
          ),
      updatedAt: r.updated_at,
      body: r.body,
    };
  }
  listData() {
    return (
      this.db
        .prepare("SELECT id FROM data_records ORDER BY updated_at DESC")
        .all() as any[]
    ).map((r) => this.getData(r.id));
  }
  updateData(
    id: string,
    input: {
      name?: string;
      description?: string;
      body?: string;
      expectedVersion?: number;
      aboutSampleIds?: string[];
      componentIds?: string[];
      components?: DataComponent[];
    },
  ) {
    return this.commit(() => {
      const current = this.getData(id);
      if (
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        const e: any = new Error("Data 版本冲突");
        e.code = "CONFLICT";
        e.currentVersion = current.version;
        throw e;
      }
      const body = input.body ?? current.body;
      const about = [
        ...new Set(input.aboutSampleIds ?? current.aboutSampleIds),
      ];
      const metadata = validateComponents(
        input.components ??
          (input.componentIds
            ? [
                ...current.components.filter(
                  (component) =>
                    component.kind === "text" ||
                    input.componentIds!.includes(component.attachmentId!),
                ),
                ...legacyComponents(
                  input.componentIds.filter(
                    (fileId) =>
                      !current.components.some(
                        (component) => component.attachmentId === fileId,
                      ),
                  ),
                  (fileId) => this.getAttachment(fileId),
                ),
              ]
            : current.components),
        current.components,
        (fileId) => this.getAttachment(fileId),
      );
      const components = [
        ...new Set(
          metadata.flatMap((component) =>
            component.attachmentId ? [component.attachmentId] : [],
          ),
        ),
      ];
      if (
        input.components &&
        input.componentIds &&
        json([...new Set(input.componentIds)].sort()) !==
          json([...components].sort())
      )
        throw Object.assign(new Error("组件清单与附件引用不一致"), {
          code: "INVALID_INPUT",
        });
      for (const sampleId of about)
        if (!this.db.prepare("SELECT 1 FROM samples WHERE id=?").get(sampleId))
          throw new Error("About 样品不存在");
      for (const attachmentId of components) this.getAttachment(attachmentId);
      const nextVersion = current.version + 1;
      this.db
        .prepare(
          "UPDATE data_records SET name=?,description=?,body=?,body_hash=?,version=?,updated_at=?,about_sample_ids=?,component_ids=? WHERE id=?",
        )
        .run(
          input.name ?? current.name,
          input.description ?? current.description,
          body,
          sha256(body),
          nextVersion,
          now(),
          json(about),
          json(components),
          id,
        );
      this.db
        .prepare("UPDATE data_records SET components_json=? WHERE id=?")
        .run(json(metadata), id);
      if (input.body !== undefined) this.syncBodyAttachments(id);
      this.writeEntityFile("data", id, body, { contentVersion: nextVersion });
      const next = this.getData(id);
      return next;
    }, "updateData");
  }
  private syncDataNameToSource(
    documentId: string,
    blockId: string,
    name: string,
  ) {
    const row = this.readDocRow(documentId);
    if (!row) return;
    const doc = this.readDocument(documentId);
    const lines = doc.body.split(/\r?\n/);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`id="${blockId}"`)) {
        inBlock = true;
        continue;
      }
      if (inBlock && /^\s*-\s+/.test(lines[i])) {
        lines[i] = lines[i].replace(/^\s*-\s+[\[【［]数据[\]】］].*$/, (m) =>
          m.replace(/([\[【［]数据[\]】］]).*$/, `$1 ${name}`),
        );
        break;
      }
    }
    const body = lines.join("\n");
    this.saveDocument(documentId, body, row.content_version);
  }
  updateDataAbout(id: string, sampleIds: string[], expectedVersion?: number) {
    return this.updateData(id, { aboutSampleIds: sampleIds, expectedVersion });
  }
  updateDataComponents(
    id: string,
    componentIds: string[],
    expectedVersion?: number,
  ) {
    return this.updateData(id, { componentIds, expectedVersion });
  }
  getAttachment(id: string) {
    const a = this.db
      .prepare("SELECT * FROM attachments WHERE id=?")
      .get(id) as any;
    if (!a) throw new Error("附件不存在");
    return {
      id: a.id,
      sha256: a.sha256,
      originalName: a.original_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      localPath: a.local_path,
      createdAt: a.created_at,
      remoteKey: a.remote_key ?? undefined,
      remoteLocation: parseJson<RemoteAttachmentLocation | undefined>(
        a.remote_location,
        undefined,
      ),
      remoteOnly: Boolean(a.remote_only),
    };
  }
  listAttachments() {
    return (
      this.db
        .prepare("SELECT id FROM attachments ORDER BY created_at DESC")
        .all() as { id: string }[]
    ).map(({ id }) => this.getAttachment(id));
  }
  attachmentReferences(id: string) {
    const references: { type: string; id: string; name: string }[] = [];
    for (const data of this.listData()) {
      if (data.components.some((component) => component.attachmentId === id)) {
        references.push({ type: "data", id: data.id, name: data.name });
      }
    }
    for (const analysis of this.listAnalyses()) {
      if (analysis.attachmentIds.includes(id)) {
        references.push({
          type: "analysis",
          id: analysis.id,
          name: analysis.title,
        });
      }
    }
    for (const claim of this.listClaims()) {
      if (
        claim.evidence.some((evidence) => evidence.attachmentIds.includes(id))
      ) {
        references.push({
          type: "claim-evidence",
          id: claim.id,
          name: claim.text,
        });
      }
    }
    for (const sample of this.listSamples()) {
      if (fileLinks(sample.document.body).some((link) => link.id === id)) {
        references.push({
          type: "sample-body",
          id: sample.id,
          name: sample.code,
        });
      }
    }
    return references;
  }
  attachmentCleanupPreview() {
    return this.listAttachments().map((attachment) => {
      const references = this.attachmentReferences(attachment.id);
      return {
        ...attachment,
        references,
        eligible: references.length === 0,
      };
    });
  }
  deleteUnreferencedAttachment(id: string) {
    return this.commit(() => {
      const attachment = this.getAttachment(id);
      const references = this.attachmentReferences(id);
      if (references.length) {
        throw Object.assign(new Error("附件仍被正文、Data、分析或证据引用"), {
          code: "CONFLICT",
          references,
        });
      }
      const attachmentsRoot = path.join(this.dataDir, "attachments") + path.sep;
      const localPath = path.resolve(attachment.localPath);
      if (!localPath.startsWith(attachmentsRoot)) {
        throw new Error("附件登记路径越界，拒绝清理");
      }
      fs.rmSync(localPath, { force: true });
      fs.rmSync(path.join(this.dataDir, "cache", attachment.sha256), {
        force: true,
      });
      this.db.prepare("DELETE FROM attachments WHERE id=?").run(id);
      return { id, deleted: true };
    }, "deleteAttachment");
  }
  createAnalysis(input: {
    title: string;
    question?: string;
    body?: string;
    itemIds?: string[];
    layout?: AnalysisLayout;
    attachmentIds?: string[];
  }) {
    return this.commit(() => {
      const id = uuid(),
        t = now();
      const body = input.body ?? "";
      const layout = normalizeAnalysisLayout(input.layout);
      const attachmentIds = [...new Set(input.attachmentIds ?? [])];
      attachmentIds.forEach((fileId) => this.getAttachment(fileId));
      this.db
        .prepare(
          "INSERT INTO analyses(id,title,question,body,item_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.title,
          input.question ?? "",
          body,
          json(input.itemIds ?? []),
          t,
          t,
        );
      this.db
        .prepare(
          "UPDATE analyses SET layout_json=?,attachment_ids=? WHERE id=?",
        )
        .run(json(layout), json(attachmentIds), id);
      this.writeEntityFile("analysis", id, body);
      return this.getAnalysis(id);
    }, "createAnalysis");
  }
  updateAnalysis(
    id: string,
    input: {
      title?: string;
      question?: string;
      body?: string;
      itemIds?: string[];
      layout?: AnalysisLayout;
      attachmentIds?: string[];
      expectedVersion?: number;
    },
  ) {
    return this.commit(() => {
      const a = this.getAnalysis(id);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== a.version
      )
        throw Object.assign(new Error("分析版本冲突"), {
          code: "CONFLICT",
          currentVersion: a.version,
        });
      const body = input.body ?? a.body;
      const layout = normalizeAnalysisLayout(input.layout ?? a.layout);
      const attachmentIds = [
        ...new Set(input.attachmentIds ?? a.attachmentIds),
      ];
      attachmentIds.forEach((fileId) => this.getAttachment(fileId));
      this.db
        .prepare(
          "UPDATE analyses SET title=?,question=?,body=?,item_ids=?,updated_at=?,version=version+1 WHERE id=?",
        )
        .run(
          input.title ?? a.title,
          input.question ?? a.question,
          body,
          json(input.itemIds ?? a.itemIds),
          now(),
          id,
        );
      this.db
        .prepare(
          "UPDATE analyses SET layout_json=?,attachment_ids=? WHERE id=?",
        )
        .run(json(layout), json(attachmentIds), id);
      this.writeEntityFile("analysis", id, body, {
        contentVersion: a.version + 1,
      });
      return this.getAnalysis(id);
    }, "updateAnalysis");
  }
  getAnalysis(id: string): AnalysisRecord {
    const r = this.db
      .prepare("SELECT * FROM analyses WHERE id=?")
      .get(id) as any;
    if (!r) throw new Error("分析不存在");
    return {
      id: r.id,
      title: r.title,
      version: r.version,
      question: r.question,
      body: r.body,
      itemIds: parseJson(r.item_ids, []),
      layout: normalizeAnalysisLayout(
        r.layout_json === "{}"
          ? undefined
          : parseJson<AnalysisLayout>(r.layout_json, normalizeAnalysisLayout()),
      ),
      attachmentIds: parseJson(r.attachment_ids, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  reloadEntity(
    entityType: "data" | "analysis" | "claim",
    id: string,
    expectedVersion: number,
  ) {
    return this.commit(() => {
      const current =
        entityType === "data"
          ? this.getData(id)
          : entityType === "analysis"
            ? this.getAnalysis(id)
            : this.getClaim(id);
      if (current.version !== expectedVersion)
        throw Object.assign(
          new Error("重新加载版本冲突，请先加载应用最新内容"),
          { code: "CONFLICT", currentVersion: current.version },
        );
      const entityPath = this.entityFile(entityType, id);
      const raw = this.files.read(path.relative(this.dataDir, entityPath));
      const document = parseDocument(raw);
      if (
        document.head.id !== id ||
        document.head.entityType !== entityType ||
        document.head.schema !== `swb.${entityType}/2`
      )
        throw Object.assign(
          new Error("文件身份或格式改变，不能重新加载到当前实体"),
          { code: "INVALID_INPUT" },
        );
      this.entityFiles.accept(id, raw);
      if (entityType === "data") {
        const metadata = document.head.data,
          prior = this.getData(id);
        if (
          !metadata ||
          metadata.id !== id ||
          metadata.sourceDocumentId !== prior.sourceDocumentId ||
          metadata.sourceBlockId !== prior.sourceBlockId
        )
          throw new Error("Data 原始来源身份不能通过正文重新加载改变");
        return this.updateData(id, {
          name: metadata.name,
          description: metadata.description,
          aboutSampleIds: metadata.aboutSampleIds,
          componentIds: metadata.componentIds,
          components: metadata.components,
          body: document.body,
          expectedVersion,
        });
      }
      if (entityType === "analysis") {
        const metadata = document.head.analysis;
        if (!metadata || metadata.id !== id)
          throw new Error("分析元数据身份无效");
        return this.updateAnalysis(id, {
          title: metadata.title,
          question: metadata.question,
          itemIds: metadata.itemIds,
          layout: metadata.layout,
          attachmentIds: metadata.attachmentIds,
          body: document.body,
          expectedVersion,
        });
      }
      const metadata = document.head.claim,
        prior = this.getClaim(id);
      if (
        !metadata ||
        metadata.id !== id ||
        metadata.hostId !== prior.hostId ||
        metadata.hostType !== prior.hostType ||
        json(metadata.evidenceIds) !==
          json(prior.evidence.map((item) => item.id))
      )
        throw new Error("论点 host 与固定证据不能通过正文重新加载改变");
      return this.updateClaim(id, document.body, expectedVersion);
    }, "reloadEntity");
  }
  listAnalyses() {
    return (
      this.db
        .prepare("SELECT * FROM analyses ORDER BY updated_at DESC")
        .all() as any[]
    ).map((r) => this.getAnalysis(r.id));
  }
  copySample(id: string, code?: string, templateBody?: string) {
    return this.commit(() => {
      this.ensureLatest(id);
      const source = this.getSample(id);
      const { body, ids } = sampleTemplate(
        templateBody ?? source.document.body,
      );
      const copy = this.createSample({ code, title: source.title, body });
      const copied = this.readDocument(copy.id);
      copied.head.references = (source.document.head.references || []).flatMap(
        (reference: ReferenceOccurrence) => {
          const blockId = ids.get(reference.blockId);
          return blockId
            ? [
                {
                  ...reference,
                  blockId,
                  operationId: reference.operationId
                    ? ids.get(reference.operationId)
                    : undefined,
                },
              ]
            : [];
        },
      );
      this.atomicWrite(copied.filePath, serializeDocument(copied));
      this.finalizeDocument(copy.id);
      return this.getSample(copy.id);
    }, "copySample");
  }
  resolveDataIdentity(
    id: string,
    blockId: string,
    input: { expectedVersion: number; dataId?: string; createNew?: boolean },
  ) {
    return this.commit(() => {
      const document = this.readDocument(id);
      if (document.head.contentVersion !== input.expectedVersion)
        throw Object.assign(new Error("样品版本冲突"), {
          code: "CONFLICT",
          currentVersion: document.head.contentVersion,
        });
      if (
        !parseBody(id, document.body).records.some((record) =>
          record.dataItems?.some((item) => item.blockId === blockId),
        )
      )
        throw new Error("Data 区块已被修改或移除，请重新解析正文");
      if (document.head.blocks[blockId]?.kind !== "data-unresolved")
        throw new Error("此区块没有待关联的数据身份");
      if (Boolean(input.dataId) === Boolean(input.createNew))
        throw Object.assign(new Error("请选择关联 Data 或明确新建其中一种"), {
          code: "INVALID_INPUT",
        });
      let body = document.body;
      let binding: DocumentHead["blocks"][string] = { kind: "new-data-intent" };
      if (input.dataId) {
        const data = this.getData(input.dataId);
        this.assertEntityCurrent("data", data.id);
        const mapping: Record<string, string> = {};
        body = replaceDataMirror(
          body,
          blockId,
          data.name,
          mapDataBlocks(data.body, mapping, "toMirror"),
        );
        binding = {
          kind: "data",
          dataId: data.id,
          baseVersion: data.version,
          baseHash: dataMirrorHash(data.body),
          baseName: data.name,
          dataBlockIds: mapping,
        };
      }
      this.saveDocument(id, body, input.expectedVersion);
      const saved = this.readDocument(id);
      saved.head.blocks[blockId] = binding;
      this.atomicWrite(saved.filePath, serializeDocument(saved));
      return { head: saved.head, body: saved.body };
    }, "resolveDataIdentity");
  }
  resolveDataMirror(id: string, dataId: string, expectedVersion: number) {
    return this.commit(() => {
      const doc = this.readDocument(id),
        data = this.getData(dataId);
      const matches = Object.entries(doc.head.blocks).filter(
        ([, binding]) => binding.dataId === dataId,
      );
      if (!matches.length) throw new Error("此文档没有对应 Data 引用");
      let body = doc.body;
      for (const [blockId, binding] of matches)
        body = replaceDataMirror(
          body,
          blockId,
          data.name,
          mapDataBlocks(data.body, (binding.dataBlockIds ??= {}), "toMirror"),
        );
      this.saveDocument(id, body, expectedVersion);
      const latest = this.readDocument(id);
      for (const [blockId, binding] of matches)
        latest.head.blocks[blockId] = {
          kind: "data",
          dataId,
          baseVersion: data.version,
          baseHash: dataMirrorHash(data.body),
          baseName: data.name,
          dataBlockIds: binding.dataBlockIds,
        };
      this.atomicWrite(latest.filePath, serializeDocument(latest));
      return latest;
    }, "resolveDataMirror");
  }
  exportContext(hostType: "data" | "analysis", hostId: string) {
    return collectContext(this, hostType, hostId);
  }
  private evidenceFor(hostType: "data" | "analysis", hostId: string) {
    const bundle = this.exportContext(hostType, hostId);
    return {
      version: bundle.manifest.host.version,
      content: bundle.context,
      attachmentIds: bundle.manifest.attachments.map((file) => file.id),
      manifest: bundle.manifest,
      documents: bundle.documents,
    };
  }
  createClaim(input: {
    hostType: "data" | "analysis";
    hostId: string;
    text: string;
  }) {
    return this.commit(() => {
      const id = uuid(),
        t = now(),
        e = this.evidenceFor(input.hostType, input.hostId);
      this.db
        .prepare(
          "INSERT INTO claims(id,host_type,host_id,text,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, input.hostType, input.hostId, input.text, t, t);
      this.db
        .prepare(
          "INSERT INTO claim_evidence(id,claim_id,entity_type,entity_id,version,body_hash,content,attachment_ids,captured_at,manifest_json,documents_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          uuid(),
          id,
          input.hostType,
          input.hostId,
          e.version,
          sha256(e.content),
          e.content,
          json(e.attachmentIds),
          t,
          json(e.manifest),
          json(e.documents),
        );
      this.writeEntityFile("claim", id, input.text, { contentVersion: 1 });
      return this.getClaim(id);
    }, "createClaim");
  }
  getClaim(id: string): ClaimRecord {
    const c = this.db.prepare("SELECT * FROM claims WHERE id=?").get(id) as any;
    if (!c) throw new Error("论点不存在");
    const evidence = this.db
      .prepare(
        "SELECT * FROM claim_evidence WHERE claim_id=? ORDER BY captured_at",
      )
      .all(id)
      .map((e: any): ClaimEvidence => ({
        id: e.id,
        entityType: e.entity_type,
        entityId: e.entity_id,
        version: e.version,
        bodyHash: e.body_hash,
        content: e.content,
        attachmentIds: parseJson(e.attachment_ids, []),
        capturedAt: e.captured_at,
        documents: parseJson<Record<string, string> | undefined>(
          e.documents_json,
          undefined,
        ),
        manifest: parseJson<ContextManifest | undefined>(
          e.manifest_json,
          undefined,
        ),
      }));
    return {
      id: c.id,
      version: c.version,
      hostType: c.host_type,
      hostId: c.host_id,
      text: c.text,
      legacyEvidenceWarning: c.legacy_evidence_warning ?? undefined,
      evidence,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }
  updateClaim(id: string, text: string, expectedVersion?: number) {
    return this.commit(() => {
      if (!this.db.prepare("SELECT 1 FROM claims WHERE id=?").get(id))
        throw new Error("论点不存在");
      const current = this.getClaim(id);
      if (expectedVersion !== undefined && expectedVersion !== current.version)
        throw Object.assign(new Error("论点版本冲突"), {
          code: "CONFLICT",
          currentVersion: current.version,
        });
      this.db
        .prepare(
          "UPDATE claims SET text=?,updated_at=?,version=version+1 WHERE id=?",
        )
        .run(text, now(), id);
      this.writeEntityFile("claim", id, text, {
        contentVersion: current.version + 1,
      });
      return this.getClaim(id);
    }, "updateClaim");
  }
  supplementClaimEvidence(id: string, expectedVersion?: number) {
    return this.commit(() => {
      const c = this.db
        .prepare("SELECT * FROM claims WHERE id=?")
        .get(id) as any;
      if (!c) throw new Error("论点不存在");
      if (expectedVersion !== undefined && expectedVersion !== c.version)
        throw Object.assign(new Error("论点版本冲突"), {
          code: "CONFLICT",
          currentVersion: c.version,
        });
      const e = this.evidenceFor(c.host_type, c.host_id);
      this.db
        .prepare(
          "INSERT INTO claim_evidence(id,claim_id,entity_type,entity_id,version,body_hash,content,attachment_ids,captured_at,manifest_json,documents_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          uuid(),
          id,
          c.host_type,
          c.host_id,
          e.version,
          sha256(e.content),
          e.content,
          json(e.attachmentIds),
          now(),
          json(e.manifest),
          json(e.documents),
        );
      this.db
        .prepare("UPDATE claims SET version=version+1,updated_at=? WHERE id=?")
        .run(now(), id);
      this.writeEntityFile("claim", id, c.text, {
        contentVersion: c.version + 1,
      });
      return this.getClaim(id);
    }, "supplementClaimEvidence");
  }
  listClaims() {
    return (
      this.db
        .prepare("SELECT id FROM claims ORDER BY updated_at DESC")
        .all() as any[]
    ).map((r) => this.getClaim(r.id));
  }
  saveAttachment(buffer: Uint8Array, originalName: string, mimeType: string) {
    return this.commit(() => {
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const existing = this.db
        .prepare("SELECT * FROM attachments WHERE sha256=?")
        .get(hash) as any;
      if (existing) return this.getAttachment(existing.id);
      const id = uuid();
      const filePath = path.join(
        this.dataDir,
        "attachments",
        `${hash}-${originalName.replace(/[^\w.\-\u4e00-\u9fff]/g, "_")}`,
      );
      fs.writeFileSync(filePath, buffer);
      const t = now();
      this.db
        .prepare(
          "INSERT INTO attachments(id,sha256,original_name,mime_type,size_bytes,local_path,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, hash, originalName, mimeType, buffer.byteLength, filePath, t);
      return {
        id,
        sha256: hash,
        originalName,
        mimeType,
        sizeBytes: buffer.byteLength,
        localPath: filePath,
        createdAt: t,
      };
    }, "saveAttachment");
  }
  saveAttachmentFile(
    sourcePath: string,
    originalName: string,
    mimeType: string,
  ) {
    return this.commit(() => {
      const hash = crypto.createHash("sha256");
      const stat = fs.statSync(sourcePath);
      const fd = fs.openSync(sourcePath, "r");
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let bytes = 0;
      try {
        let read = 0;
        do {
          read = fs.readSync(fd, buffer, 0, buffer.length, bytes);
          if (read) hash.update(buffer.subarray(0, read));
          bytes += read;
        } while (read);
      } finally {
        fs.closeSync(fd);
      }
      const digest = hash.digest("hex");
      const existing = this.db
        .prepare("SELECT * FROM attachments WHERE sha256=?")
        .get(digest) as any;
      if (existing) {
        fs.unlinkSync(sourcePath);
        return this.getAttachment(existing.id);
      }
      const id = uuid();
      const filePath = path.join(
        this.dataDir,
        "attachments",
        `${digest}-${originalName.replace(/[^\w.\-\u4e00-\u9fff]/g, "_")}`,
      );
      fs.renameSync(sourcePath, filePath);
      const t = now();
      this.db
        .prepare(
          "INSERT INTO attachments(id,sha256,original_name,mime_type,size_bytes,local_path,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, digest, originalName, mimeType, stat.size, filePath, t);
      return {
        id,
        sha256: digest,
        originalName,
        mimeType,
        sizeBytes: stat.size,
        localPath: filePath,
        createdAt: t,
      };
    }, "saveAttachmentFile");
  }
  idempotent<T>(
    key: string | undefined,
    fingerprint: string,
    action: () => T,
  ): T {
    if (!key) return action();
    if (key.length > 240)
      throw Object.assign(new Error("幂等键过长"), { code: "INVALID_INPUT" });
    return this.commit(() => {
      const file = "jobs/idempotency.json";
      const records: Record<string, { fingerprint: string; result: T }> =
        this.files.has(file) ? JSON.parse(this.files.read(file)) : {};
      if (records[key]) {
        if (records[key].fingerprint !== fingerprint)
          throw Object.assign(new Error("同一幂等键对应不同请求"), {
            code: "CONFLICT",
          });
        return records[key].result;
      }
      const result = action();
      records[key] = { fingerprint, result };
      this.atomicWrite(path.join(this.dataDir, file), json(records));
      return result;
    }, "idempotent");
  }
  setting<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  saveSetting(key: string, value: unknown) {
    return this.commit(() => {
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, json(value));
      const rows = this.db.prepare("SELECT key,value FROM settings").all() as {
        key: string;
        value: string;
      }[];
      this.atomicWrite(
        path.join(this.dataDir, "registry/settings.json"),
        json({
          schema: "swb.settings/2",
          values: Object.fromEntries(
            rows.map((row) => [row.key, JSON.parse(row.value)]),
          ),
        }),
      );
    }, "saveSetting");
  }
  locateAttachment(
    id: string,
    location: RemoteAttachmentLocation,
    remoteOnly: boolean,
  ) {
    return this.commit(() => {
      this.getAttachment(id);
      this.db
        .prepare(
          "UPDATE attachments SET remote_key=?,remote_location=?,remote_only=? WHERE id=?",
        )
        .run(location.key, json(location), remoteOnly ? 1 : 0, id);
      return this.getAttachment(id);
    }, "locateAttachment");
  }
  updateJob(
    id: string,
    status: string,
    payload: Record<string, unknown>,
    error?: string,
  ) {
    return this.commit(() => {
      this.db
        .prepare(
          "UPDATE jobs SET status=?,payload=?,error=?,updated_at=? WHERE id=?",
        )
        .run(status, json(payload), error ?? null, now(), id);
    }, "updateJob");
  }
  listJobs() {
    return this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
      .all()
      .map((j: any) => ({
        ...j,
        status: j.status === "canceled" ? "cancelled" : j.status,
        payload: parseJson(j.payload, {}),
      }));
  }
  createJob(type: string, payload: Record<string, unknown>): Job {
    return this.commit(() => {
      const id = uuid(),
        t = now();
      this.db
        .prepare(
          "INSERT INTO jobs(id,type,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, type, "queued", json(payload), t, t);
      return {
        id,
        type,
        status: "queued",
        payload,
        createdAt: t,
        updatedAt: t,
      };
    }, "createJob");
  }
  backupManifest() {
    const missing = (
      this.db
        .prepare("SELECT original_name,local_path FROM attachments")
        .all() as any[]
    ).filter((a) => !a.local_path || !fs.existsSync(a.local_path));
    if (missing.length)
      throw new Error(
        `完整备份缺少附件: ${missing.map((x) => x.original_name).join("、")}`,
      );
    const files: string[] = [];
    for (const dir of [
      "samples",
      "data",
      "analyses",
      "claims",
      "registry",
      "attachments",
      "history",
      "evidence",
    ]) {
      const root = path.join(this.dataDir, dir);
      if (fs.existsSync(root))
        for (const f of fs.readdirSync(root)) files.push(path.join(dir, f));
    }
    return files.map((rel) => {
      const p = path.join(this.dataDir, rel);
      const b = fs.readFileSync(p);
      return { path: rel, size: b.byteLength, sha256: sha256(b) };
    });
  }
  rebuildIndex() {
    const readRegistry = <T>(relative: string): T[] => {
      if (!fs.existsSync(this.files.resolve(relative))) return [];
      const value = JSON.parse(this.files.read(relative)) as {
        schema: string;
        records: T[];
      };
      if (value.schema !== "swb.registry/2" || !Array.isArray(value.records))
        throw new Error(`登记文件格式无效：${relative}`);
      return value.records;
    };
    const documents: { file: string; doc: DocumentFile }[] = [];
    for (const directory of ["samples", "data", "analyses", "claims"]) {
      for (const name of fs
        .readdirSync(path.join(this.dataDir, directory))
        .filter((name) => name.endsWith(".md"))) {
        const file = `${directory}/${name}`,
          doc = parseDocument(this.files.read(file));
        if (
          doc.head.schema !== `swb.${doc.head.entityType}/2` ||
          name !== `${doc.head.id}.md`
        )
          throw new Error(`文件身份或格式冲突：${file}`);
        if (
          !Number.isInteger(doc.head.contentVersion) ||
          doc.head.contentVersion < 1
        )
          throw new Error(`内容版本无效：${file}`);
        documents.push({ file, doc });
      }
    }
    const allJson = (directory: string): string[] => {
      const root = path.join(this.dataDir, directory);
      return fs
        .readdirSync(root, { recursive: true })
        .filter(
          (name): name is string =>
            typeof name === "string" && name.endsWith(".json"),
        )
        .map((name) => `${directory}/${name}`);
    };
    const rebuild = this.db.transaction(() => {
      for (const table of [
        "documents",
        "samples",
        "objects",
        "object_aliases",
        "properties",
        "property_aliases",
        "property_values",
        "data_records",
        "analyses",
        "claims",
        "claim_evidence",
        "attachments",
        "snapshots",
        "jobs",
      ])
        this.db.exec(`DELETE FROM ${table}`);
      this.entityFiles.reset();
      const objects = readRegistry<ResearchObject>("registry/objects.json");
      for (const object of objects) {
        this.db
          .prepare(
            "INSERT INTO objects(id,canonical_name,role,lifecycle,redirect_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            object.id,
            object.canonicalName,
            object.role,
            object.lifecycle,
            object.redirectTo ?? null,
            object.createdAt,
            object.updatedAt,
          );
        this.db
          .prepare(
            "UPDATE objects SET version=?,identity_text=?,recommended_property_ids=? WHERE id=?",
          )
          .run(
            object.version,
            object.identityText ?? "",
            json(object.recommendedPropertyIds ?? []),
            object.id,
          );
        for (const alias of object.aliases)
          this.db
            .prepare("INSERT INTO object_aliases(object_id,alias) VALUES(?,?)")
            .run(object.id, alias);
      }
      const properties = readRegistry<PropertyDefinition>(
        "registry/properties.json",
      );
      for (const property of properties) {
        this.db
          .prepare(
            "INSERT INTO properties(id,canonical_name,dimension,recommended_unit,usage_count,last_used_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            property.id,
            property.canonicalName,
            property.dimension ?? null,
            property.recommendedUnit ?? null,
            property.usageCount,
            property.lastUsedAt ?? null,
          );
        this.db
          .prepare("UPDATE properties SET version=? WHERE id=?")
          .run(property.version, property.id);
        for (const alias of property.aliases)
          this.db
            .prepare(
              "INSERT INTO property_aliases(property_id,alias) VALUES(?,?)",
            )
            .run(property.id, alias);
      }
      for (const attachment of readRegistry<Attachment>(
        "attachments/manifest.json",
      )) {
        const local = this.files.resolve(attachment.localPath);
        this.db
          .prepare(
            "INSERT INTO attachments(id,sha256,original_name,mime_type,size_bytes,local_path,created_at,remote_key,remote_only) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            attachment.id,
            attachment.sha256,
            attachment.originalName,
            attachment.mimeType,
            attachment.sizeBytes,
            local,
            attachment.createdAt,
            attachment.remoteKey ?? null,
            attachment.remoteOnly ? 1 : 0,
          );
        this.db
          .prepare("UPDATE attachments SET remote_location=? WHERE id=?")
          .run(
            attachment.remoteLocation ? json(attachment.remoteLocation) : null,
            attachment.id,
          );
      }
      for (const { file, doc } of documents) {
        const { head, body } = doc;
        if (head.entityType !== "sample")
          this.entityFiles.accept(head.id, this.files.read(file));
        if (head.entityType === "sample") {
          if (!head.code || !head.sample)
            throw new Error(`样品缺少完整元数据：${file}`);
          this.db
            .prepare(
              "INSERT INTO samples(id,code,title,document_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              head.id,
              head.code,
              head.sample.title,
              head.id,
              head.sample.createdAt,
              head.updatedAt,
            );
          this.db
            .prepare(
              "INSERT INTO documents(id,entity_type,file_path,content_version,body_hash,extraction_status,projection_version,updated_at,file_hash) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              head.id,
              "sample",
              path.join(this.dataDir, file),
              head.contentVersion,
              sha256(body),
              head.bodyHash === sha256(body)
                ? head.extractionStatus
                : "pending",
              head.projectionVersion,
              head.updatedAt,
              sha256(this.files.read(file)),
            );
          // External header projections are not trusted. Recompute only from the actual body and dictionary.
          for (const record of parseBody(head.id, body).records)
            for (const value of record.properties) {
              const reference = record.references.find(
                (item) =>
                  item.blockId === value.blockId &&
                  item.rawText === value.objectId,
              );
              const resolved = reference
                ? resolveReference(reference, head.references || [], objects)
                : undefined;
              const object = resolved?.objectId
                ? objects.find((item) => item.id === resolved.objectId)
                : undefined;
              const property = properties.find(
                (item) => item.canonicalName === value.propertyName,
              );
              if (!object || !property) continue;
              this.db
                .prepare(
                  "INSERT OR IGNORE INTO property_values(id,sample_id,document_id,block_id,object_id,property_id,value_text,source_line,source_column) VALUES(?,?,?,?,?,?,?,?,?)",
                )
                .run(
                  value.id,
                  head.id,
                  head.id,
                  value.blockId,
                  object.id,
                  property.id,
                  value.valueText,
                  value.sourceLine,
                  value.sourceColumn,
                );
            }
        } else if (head.entityType === "data") {
          const data = head.data;
          if (!data || data.id !== head.id)
            throw new Error(`Data缺少完整元数据：${file}`);
          this.db
            .prepare(
              "INSERT INTO data_records(id,name,description,version,about_sample_ids,source_document_id,source_block_id,component_ids,body,body_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              data.id,
              data.name,
              data.description,
              head.contentVersion,
              json(data.aboutSampleIds),
              data.sourceDocumentId ?? null,
              data.sourceBlockId ?? null,
              json(data.componentIds),
              body,
              sha256(body),
              data.updatedAt,
            );
          const metadata = validateComponents(
            data.components ??
              legacyComponents(data.componentIds, (id) =>
                this.getAttachment(id),
              ),
            [],
            (id) => this.getAttachment(id),
          );
          this.db
            .prepare("UPDATE data_records SET components_json=? WHERE id=?")
            .run(json(metadata), data.id);
        } else if (head.entityType === "analysis") {
          const analysis = head.analysis;
          if (!analysis || analysis.id !== head.id)
            throw new Error(`Analysis缺少完整元数据：${file}`);
          this.db
            .prepare(
              "INSERT INTO analyses(id,title,question,body,item_ids,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              analysis.id,
              analysis.title,
              analysis.question,
              body,
              json(analysis.itemIds),
              analysis.createdAt,
              analysis.updatedAt,
              head.contentVersion,
            );
          this.db
            .prepare(
              "UPDATE analyses SET layout_json=?,attachment_ids=? WHERE id=?",
            )
            .run(
              json(normalizeAnalysisLayout(analysis.layout)),
              json(analysis.attachmentIds ?? []),
              analysis.id,
            );
        } else {
          const claim = head.claim;
          if (!claim || claim.id !== head.id)
            throw new Error(`Claim缺少完整元数据：${file}`);
          this.db
            .prepare(
              "INSERT INTO claims(id,host_type,host_id,text,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              claim.id,
              claim.hostType,
              claim.hostId,
              body,
              claim.createdAt,
              claim.updatedAt,
              head.contentVersion,
            );
          this.db
            .prepare("UPDATE claims SET legacy_evidence_warning=? WHERE id=?")
            .run(claim.legacyEvidenceWarning ?? null, claim.id);
          for (const evidenceId of claim.evidenceIds) {
            const evidence: ClaimEvidence = JSON.parse(
              this.files.read(`evidence/${head.id}/${evidenceId}.json`),
            );
            if (
              evidence.id !== evidenceId ||
              evidence.bodyHash !== sha256(evidence.content)
            )
              throw new Error(`证据校验失败：${evidenceId}`);
            if (
              evidence.documents &&
              !evidence.content.startsWith(
                Object.values(evidence.documents).join("\n\n---\n\n"),
              )
            )
              throw new Error(`证据分实体正文与完整快照不一致：${evidenceId}`);
            this.db
              .prepare(
                "INSERT INTO claim_evidence(id,claim_id,entity_type,entity_id,version,body_hash,content,attachment_ids,captured_at) VALUES(?,?,?,?,?,?,?,?,?)",
              )
              .run(
                evidence.id,
                claim.id,
                evidence.entityType,
                evidence.entityId,
                evidence.version,
                evidence.bodyHash,
                evidence.content,
                json(evidence.attachmentIds),
                evidence.capturedAt,
              );
            this.db
              .prepare(
                "UPDATE claim_evidence SET manifest_json=?,documents_json=? WHERE id=?",
              )
              .run(
                evidence.manifest ? json(evidence.manifest) : null,
                evidence.documents ? json(evidence.documents) : null,
                evidence.id,
              );
          }
        }
      }
      for (const file of allJson("history")) {
        const snapshot = JSON.parse(this.files.read(file)) as {
          id: string;
          entity_type: string;
          entity_id: string;
          body_hash: string;
          body: string;
          created_at: string;
        };
        if (sha256(snapshot.body) !== snapshot.body_hash)
          throw new Error(`历史正文校验失败：${file}`);
        this.db
          .prepare(
            "INSERT INTO snapshots(id,entity_type,entity_id,body_hash,body,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            snapshot.id,
            snapshot.entity_type,
            snapshot.entity_id,
            snapshot.body_hash,
            snapshot.body,
            snapshot.created_at,
          );
      }
      for (const job of readRegistry<{
        id: string;
        type: string;
        status: string;
        payload: unknown;
        error?: string;
        created_at: string;
        updated_at: string;
      }>("jobs/tasks.json"))
        this.db
          .prepare(
            "INSERT INTO jobs(id,type,status,payload,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            job.id,
            job.type,
            job.status,
            json(job.payload),
            job.error ?? null,
            job.created_at,
            job.updated_at,
          );
      this.db.exec(
        "UPDATE properties SET usage_count=(SELECT count(*) FROM property_values WHERE property_id=properties.id)",
      );
    });
    rebuild();
    const settingsPath = "registry/settings.json";
    this.db.exec("DELETE FROM settings");
    if (this.files.has(settingsPath)) {
      const settings = JSON.parse(this.files.read(settingsPath)) as {
        schema: string;
        values: Record<string, unknown>;
      };
      if (settings.schema !== "swb.settings/2")
        throw new Error("设置文件格式无效");
      for (const [key, value] of Object.entries(settings.values))
        this.db
          .prepare("INSERT INTO settings(key,value) VALUES(?,?)")
          .run(key, json(value));
    }
    return this.status();
  }
}
