import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  blockLines,
  createHead,
  ensureBlockIds,
  normalizeAnalysisLayout,
  parseBody,
  parseDocument,
  serializeDocument,
  sha256,
  stripInternalMarkers,
  type Attachment,
  type ClaimEvidence,
  type DocumentFile,
  type PropertyDefinition,
  type ResearchObject,
} from "@workbench/core";
import { WorkbenchStore } from "../store";
import { hashFile } from "../backup";
import { legacyComponents } from "../data-components";
import { dataMirrorHash } from "../data-mirror";
import {
  LegacySource,
  array,
  number,
  safeFile,
  safeId,
  text,
  type LegacyRow,
} from "./source";

export interface MigrationReport {
  schema: "swb.migration/1";
  status: "verified" | "failed";
  createdAt: string;
  source: string;
  destination: string;
  warnings: string[];
  errors: string[];
  counts: Record<string, number>;
  bodies: { type: string; id: string; sha256: string }[];
  idMappings: { type: string; from: string; to: string }[];
}
const plural = {
  sample: "samples",
  data: "data",
  analysis: "analyses",
  claim: "claims",
} as const;
type EntityType = keyof typeof plural;
const strings = (row: LegacyRow, key: string) =>
  array<unknown>(row, key).map((value) => {
    if (typeof value !== "string") throw new Error(`旧字段${key}包含无效ID`);
    return value;
  });

/** Offline import into a staging directory; the legacy directory is never modified. */
export async function convertLegacyWorkspace(
  sourcePath: string,
  destinationPath: string,
) {
  const root = fs.realpathSync(sourcePath),
    destination = path.resolve(destinationPath);
  const parent = fs.realpathSync(path.dirname(destination));
  const target = path.join(parent, path.basename(destination));
  if (
    target === root ||
    target.startsWith(root + path.sep) ||
    root.startsWith(target + path.sep)
  )
    throw new Error("转换目标必须在旧工作区之外");
  if (fs.existsSync(target)) throw new Error("转换目标必须是尚不存在的新目录");
  if (fs.existsSync(path.join(root, "registry", "workspace.json")))
    throw new Error("此目录已有新版工作区登记，请使用完整备份与恢复");
  let reservedTarget = false;
  const stage = fs.mkdtempSync(path.join(parent, ".swb-migration-"));
  fs.chmodSync(stage, 0o700);
  const report: MigrationReport = {
    schema: "swb.migration/1",
    status: "failed",
    createdAt: new Date().toISOString(),
    source: root,
    destination: target,
    warnings: [],
    errors: [],
    counts: {},
    bodies: [],
    idMappings: [],
  };
  const reportPath = target + `.migration-${randomUUID()}.json`;
  const source = new LegacySource(root);
  const write = (relative: string, value: unknown) => {
    const file = safeFile(stage, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, "w", 0o600);
    try {
      fs.writeFileSync(
        fd,
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const registry = (relative: string, records: unknown[]) =>
    write(relative, { schema: "swb.registry/2", records });
  const incoming = new Map<string, DocumentFile>();
  const converted = new Map<string, DocumentFile>();
  const indexed = (table: string) => source.rows(table);
  try {
    for (const directory of [
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
    ])
      fs.mkdirSync(path.join(stage, directory), { recursive: true });
    await source.openIndex(stage);
    const snapshotRows = new Map(
      indexed("snapshots").map((row) => [text(row, "id"), row]),
    );
    for (const { row } of await source.jsonFiles("history")) {
      const normalized: LegacyRow = {
        id: row.id,
        entity_id: row.entity_id ?? row.entityId,
        entity_type: row.entity_type ?? row.entityType,
        body: row.body,
        body_hash: row.body_hash ?? row.bodyHash,
        created_at: row.created_at ?? row.createdAt,
      };
      snapshotRows.set(text(normalized, "id"), normalized);
    }
    const evidenceRows = new Map(
      indexed("claim_evidence").map((row) => [text(row, "id"), row]),
    );
    for (const { relative, row } of await source.jsonFiles("evidence")) {
      const existing = evidenceRows.get(text(row, "id"));
      const parts = relative.split("/");
      const normalized: LegacyRow = {
        id: row.id,
        claim_id:
          row.claim_id ??
          existing?.claim_id ??
          (parts.length === 3 ? parts[1] : undefined),
        entity_type: row.entity_type ?? row.entityType,
        entity_id: row.entity_id ?? row.entityId,
        version: row.version,
        body_hash: row.body_hash ?? row.bodyHash,
        content: row.content,
        attachment_ids:
          row.attachment_ids ?? JSON.stringify(row.attachmentIds ?? []),
        captured_at: row.captured_at ?? row.capturedAt,
        manifest_json:
          row.manifest_json ??
          (row.manifest ? JSON.stringify(row.manifest) : undefined),
        documents_json:
          row.documents_json ??
          (row.documents ? JSON.stringify(row.documents) : undefined),
      };
      if (!normalized.claim_id)
        throw new Error(`旧证据缺少论点归属：${relative}`);
      evidenceRows.set(text(normalized, "id"), normalized);
    }
    for (const type of Object.keys(plural) as EntityType[]) {
      for (const name of source.directory(plural[type])) {
        if (!name.endsWith(".md")) {
          report.warnings.push(`未纳入非Markdown文件：${plural[type]}/${name}`);
          continue;
        }
        const relative = `${plural[type]}/${name}`,
          file = await source.track(relative);
        const doc = parseDocument(fs.readFileSync(file, "utf8"));
        safeId(doc.head.id);
        if (doc.head.entityType !== type)
          throw new Error(`实体类型与目录不一致：${relative}`);
        if (incoming.has(`${type}:${doc.head.id}`))
          throw new Error(`重复实体ID：${relative}`);
        incoming.set(`${type}:${doc.head.id}`, doc);
      }
    }
    const rowMaps = {
      sample: indexed("samples"),
      data: indexed("data_records"),
      analysis: indexed("analyses"),
      claim: indexed("claims"),
    };
    const remapDocuments = new Map(
      rowMaps.sample.map((row) => [
        text(row, "document_id", text(row, "id")),
        text(row, "id"),
      ]),
    );
    const remap = (id: string) => remapDocuments.get(id) || id;
    const aliasRows = indexed("object_aliases"),
      propertyAliasRows = indexed("property_aliases");
    const objects: ResearchObject[] = indexed("objects").map((row) => ({
      id: safeId(text(row, "id")),
      version: number(row, "version"),
      canonicalName: text(row, "canonical_name"),
      role: text(row, "role") as ResearchObject["role"],
      lifecycle: text(
        row,
        "lifecycle",
        "active",
      ) as ResearchObject["lifecycle"],
      redirectTo: text(row, "redirect_to") || undefined,
      aliases: aliasRows
        .filter((alias) => text(alias, "object_id") === text(row, "id"))
        .map((alias) => text(alias, "alias")),
      identityText: text(row, "identity_text"),
      recommendedPropertyIds: strings(row, "recommended_property_ids"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    }));
    const properties: PropertyDefinition[] = indexed("properties").map(
      (row) => ({
        id: safeId(text(row, "id")),
        version: number(row, "version"),
        canonicalName: text(row, "canonical_name"),
        dimension: text(row, "dimension") || undefined,
        recommendedUnit: text(row, "recommended_unit") || undefined,
        aliases: propertyAliasRows
          .filter((alias) => text(alias, "property_id") === text(row, "id"))
          .map((alias) => text(alias, "alias")),
        usageCount: number(row, "usage_count", 0),
        lastUsedAt: text(row, "last_used_at") || undefined,
      }),
    );
    if (!objects.length && incoming.size)
      report.warnings.push(
        "旧对象字典缺失，无法按名称补造对象；未匹配引用将保持未绑定。",
      );
    const attachments: Attachment[] = [];
    const registeredFiles = new Set<string>();
    for (const row of indexed("attachments")) {
      const id = safeId(text(row, "id")),
        storedPath = text(row, "local_path");
      const relative = path.isAbsolute(storedPath)
        ? ([
            path.relative(root, storedPath),
            path.relative(path.resolve(sourcePath), storedPath),
          ].find((value) => value.startsWith("attachments/")) ?? "")
        : storedPath;
      if (!relative.startsWith("attachments/"))
        throw new Error(`附件位置不在旧目录内：${id}`);
      if (!fs.existsSync(safeFile(root, relative)))
        throw new Error(`附件字节缺失（远端唯一附件需先取回）：${id}`);
      registeredFiles.add(relative);
      const file = await source.track(relative),
        digest = source.files.get(relative)!;
      if (
        digest.sha256 !== text(row, "sha256") ||
        digest.size !== number(row, "size_bytes", 0)
      )
        throw new Error(`附件哈希或大小不一致：${id}`);
      const localPath = `attachments/${digest.sha256}`;
      fs.copyFileSync(file, safeFile(stage, localPath));
      const copied = await hashFile(safeFile(stage, localPath));
      if (copied.sha256 !== digest.sha256 || copied.size !== digest.size)
        throw new Error(`附件复制校验失败：${id}`);
      attachments.push({
        id,
        sha256: digest.sha256,
        sizeBytes: digest.size,
        originalName: text(row, "original_name"),
        mimeType: text(row, "mime_type", "application/octet-stream"),
        localPath,
        createdAt: text(row, "created_at"),
      });
    }
    for (const relative of await source.allFiles("attachments")) {
      if (registeredFiles.has(relative)) continue;
      const localPath =
        "attachments/unregistered/" + relative.slice("attachments/".length);
      const output = safeFile(stage, localPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(safeFile(root, relative), output);
      const actual = await hashFile(output),
        expected = source.files.get(relative)!;
      if (actual.sha256 !== expected.sha256)
        throw new Error(`未登记附件复制校验失败：${relative}`);
      report.warnings.push(`保留未登记附件，请人工关联：${localPath}`);
    }
    const attachment = (id: string) => {
      const file = attachments.find((file) => file.id === id);
      if (!file) throw new Error(`组件引用缺少附件登记：${id}`);
      return file;
    };
    registry("attachments/manifest.json", attachments);
    for (const type of Object.keys(plural) as EntityType[]) {
      const records = new Map(
        rowMaps[type].map((row) => [
          text(row, type === "sample" ? "document_id" : "id", text(row, "id")),
          row,
        ]),
      );
      const ids = new Set([
        ...records.keys(),
        ...[...incoming.keys()]
          .filter((key) => key.startsWith(type + ":"))
          .map((key) => key.slice(type.length + 1)),
      ]);
      for (const oldId of ids) {
        const row = records.get(oldId),
          old = incoming.get(`${type}:${oldId}`);
        const id = safeId(
          type === "sample" ? text(row || {}, "id", oldId) : oldId,
        );
        if (oldId !== id)
          report.idMappings.push({ type: "document", from: oldId, to: id });
        const oldMeta = old?.head[type] as unknown as LegacyRow | undefined;
        if (!row && !oldMeta && type !== "sample")
          throw new Error(`旧文件缺少关系元数据且无索引可恢复：${type}:${id}`);
        const body =
          old?.body ?? text(row || {}, type === "claim" ? "text" : "body");
        if (!old)
          report.warnings.push(
            `正文从旧索引恢复，原Markdown缺失：${type}:${id}`,
          );
        if (
          row &&
          old &&
          typeof row[type === "claim" ? "text" : "body"] === "string" &&
          row[type === "claim" ? "text" : "body"] !== body
        )
          report.warnings.push(
            `正文文件与旧索引不同，采用文件内容：${type}:${id}`,
          );
        const version =
          old?.head.contentVersion ?? number(row || {}, "version");
        const head = {
          ...createHead(type, id, body),
          contentVersion: version,
          updatedAt: old?.head.updatedAt || text(row || {}, "updated_at"),
          blocks: old?.head.blocks || {},
          references: old?.head.references,
        };
        const doc: DocumentFile = { head, body };
        if (type === "sample") {
          head.code = old?.head.code || text(row || {}, "code");
          if (!head.code) throw new Error(`样品编号缺失：${id}`);
          head.sample = {
            title:
              old?.head.sample?.title || text(row || {}, "title", head.code),
            createdAt:
              old?.head.sample?.createdAt || text(row || {}, "created_at"),
          };
          doc.body = ensureBlockIds(body);
          if (!objects.some((object) => object.id === id))
            objects.push({
              id,
              canonicalName: head.code,
              role: "sample",
              lifecycle: "active",
              aliases: [],
              version: 1,
              createdAt: head.sample.createdAt,
              updatedAt: head.updatedAt,
            });
        } else if (type === "data") {
          const data = old?.head.data;
          const componentIds =
            data?.componentIds || strings(row || {}, "component_ids");
          const sourceId =
            data?.sourceDocumentId || text(row || {}, "source_document_id");
          head.data = {
            id,
            name: data?.name || text(row || {}, "name", id),
            description: data?.description ?? text(row || {}, "description"),
            version,
            aboutSampleIds: (
              data?.aboutSampleIds || strings(row || {}, "about_sample_ids")
            ).map(remap),
            sourceDocumentId: sourceId ? remap(sourceId) : undefined,
            sourceBlockId:
              data?.sourceBlockId ||
              text(row || {}, "source_block_id") ||
              undefined,
            componentIds,
            components:
              data?.components || legacyComponents(componentIds, attachment),
            updatedAt: head.updatedAt,
          };
        } else if (type === "analysis") {
          const analysis = old?.head.analysis;
          head.analysis = {
            id,
            title: analysis?.title || text(row || {}, "title", id),
            question: analysis?.question ?? text(row || {}, "question"),
            version,
            itemIds: (analysis?.itemIds || strings(row || {}, "item_ids")).map(
              remap,
            ),
            layout: normalizeAnalysisLayout(analysis?.layout),
            attachmentIds: analysis?.attachmentIds || [],
            createdAt: analysis?.createdAt || text(row || {}, "created_at"),
            updatedAt: head.updatedAt,
          };
        } else {
          const claim = old?.head.claim;
          const hostType = claim?.hostType || text(row || {}, "host_type");
          if (hostType !== "data" && hostType !== "analysis")
            throw new Error(`论点host无效：${id}`);
          const evidenceIds: string[] = [];
          for (const evidenceRow of [...evidenceRows.values()].filter(
            (e) => text(e, "claim_id") === id,
          )) {
            const evidenceId = safeId(text(evidenceRow, "id")),
              content = text(evidenceRow, "content");
            if (text(evidenceRow, "body_hash") !== sha256(content))
              throw new Error(`旧证据正文哈希不一致：${evidenceId}`);
            const evidence: ClaimEvidence = {
              id: evidenceId,
              entityType: text(evidenceRow, "entity_type"),
              entityId: remap(text(evidenceRow, "entity_id")),
              version: number(evidenceRow, "version"),
              bodyHash: sha256(content),
              content,
              attachmentIds: strings(evidenceRow, "attachment_ids"),
              capturedAt: text(evidenceRow, "captured_at"),
            };
            if (evidenceRow.manifest_json)
              evidence.manifest = JSON.parse(
                text(evidenceRow, "manifest_json"),
              );
            if (evidenceRow.documents_json)
              evidence.documents = JSON.parse(
                text(evidenceRow, "documents_json"),
              );
            evidence.attachmentIds.forEach(attachment);
            write(`evidence/${id}/${evidenceId}.json`, evidence);
            evidenceIds.push(evidenceId);
          }
          const warning =
            "旧格式证据不完整：仅保留原有快照，无法补造当时未保存的实体版本、正文或证据关联。";
          head.claim = {
            id,
            version,
            hostType,
            hostId: claim?.hostId || text(row || {}, "host_id"),
            evidenceIds,
            createdAt: claim?.createdAt || text(row || {}, "created_at"),
            updatedAt: head.updatedAt,
            legacyEvidenceWarning: warning,
          };
          report.warnings.push(`论点证据需人工检查：${id}`);
        }
        converted.set(`${type}:${id}`, doc);
        report.bodies.push({
          type,
          id,
          sha256: sha256(stripInternalMarkers(body)),
        });
      }
    }
    // Do not infer a Data identity by its name. Preserve exact known bindings only.
    const dataDocs = [...converted.values()].filter((doc) => doc.head.data);
    for (const doc of converted.values())
      if (doc.head.entityType === "sample") {
        const parsed = parseBody(doc.head.id, doc.body);
        const blocks: typeof doc.head.blocks = {};
        for (const item of parsed.records.flatMap(
          (record) => record.dataItems || [],
        )) {
          const oldBinding = doc.head.blocks[item.blockId];
          const candidate = oldBinding?.dataId
            ? converted.get(`data:${oldBinding.dataId}`)
            : dataDocs.find(
                (data) =>
                  data.head.data!.sourceDocumentId === doc.head.id &&
                  data.head.data!.sourceBlockId === item.blockId,
              );
          if (
            candidate &&
            candidate.head.data &&
            dataMirrorHash(candidate.body) === dataMirrorHash(item.body) &&
            candidate.head.data.name === item.name
          ) {
            const canonicalBlocks = blockLines(candidate.body),
              mirrorBlocks = blockLines(item.body);
            blocks[item.blockId] = {
              kind: "data",
              dataId: candidate.head.id,
              baseVersion: candidate.head.contentVersion,
              baseHash: dataMirrorHash(candidate.body),
              baseName: candidate.head.data.name,
              dataBlockIds: Object.fromEntries(
                canonicalBlocks.map((block, index) => [
                  block.id,
                  mirrorBlocks[index]?.id || block.id,
                ]),
              ),
            };
          } else {
            blocks[item.blockId] = {
              kind: "data-unresolved",
              candidateDataIds: candidate
                ? [candidate.head.id]
                : dataDocs
                    .filter(
                      (data) =>
                        data.head.data?.sourceDocumentId === doc.head.id,
                    )
                    .map((data) => data.head.id),
            };
            report.warnings.push(
              `样品Data需明确重新关联：${doc.head.id}:${item.blockId}`,
            );
          }
        }
        doc.head.blocks = blocks;
      }
    const entityIds = new Set(
      [...converted.values()].map((doc) => doc.head.id),
    );
    if(entityIds.size !== converted.size)throw new Error("旧实体之间存在重复ID，需人工处理后转换");
    for (const doc of converted.values()) {
      const metadata = doc.head;
      for (const id of metadata.data?.aboutSampleIds || [])
        if (!converted.has(`sample:${id}`))
          report.warnings.push(`Data About样品缺失：${metadata.id}:${id}`);
      for (const id of metadata.analysis?.itemIds || [])
        if (!entityIds.has(id) && !objects.some((object) => object.id === id))
          report.warnings.push(`分析条目缺失：${metadata.id}:${id}`);
      if (
        metadata.claim &&
        !converted.has(`${metadata.claim.hostType}:${metadata.claim.hostId}`)
      )
        report.warnings.push(`论点host缺失：${metadata.id}`);
      write(
        `${plural[metadata.entityType]}/${metadata.id}.md`,
        serializeDocument(doc),
      );
    }
    registry("registry/objects.json", objects);
    registry("registry/properties.json", properties);
    const lastByDate: Record<string, number> = {};
    for (const doc of converted.values()) {
      const match = doc.head.code?.match(/^S?(\d{6})-(\d+)$/);
      if (match)
        lastByDate[match[1]] = Math.max(
          lastByDate[match[1]] || 0,
          Number(match[2]),
        );
    }
    write("registry/numbers.json", { schema: "swb.numbering/2", lastByDate });
    write("registry/workspace.json", {
      schema: "swb.workspace/2",
      id: randomUUID(),
      createdAt: report.createdAt,
    });
    for (const snapshot of snapshotRows.values()) {
      const id = safeId(text(snapshot, "id")),
        entityId = safeId(remap(text(snapshot, "entity_id"))),
        body = text(snapshot, "body");
      if (text(snapshot, "body_hash") !== sha256(body))
        throw new Error(`旧正文历史哈希不一致：${id}`);
      write(`history/${entityId}/${id}.json`, {
        id,
        entity_type: text(snapshot, "entity_type"),
        entity_id: entityId,
        body_hash: sha256(body),
        body,
        created_at: text(snapshot, "created_at"),
      });
    }
    for (const evidence of evidenceRows.values())
      if (!converted.has(`claim:${text(evidence, "claim_id")}`))
        throw new Error(`证据所属论点缺失：${text(evidence, "id")}`);
    source.close();
    fs.rmSync(path.join(stage, "jobs"), { recursive: true });
    fs.mkdirSync(path.join(stage, "jobs"));
    const rebuilt = new WorkbenchStore({ dataDir: stage });
    try {
      report.counts = {
        samples: rebuilt.listSamples().length,
        data: rebuilt.listData().length,
        analyses: rebuilt.listAnalyses().length,
        claims: rebuilt.listClaims().length,
        objects: rebuilt.searchObjects().length,
        properties: rebuilt.searchProperties().length,
        attachments: attachments.length,
      };
      for (const entry of report.bodies) {
        const actual =
          entry.type === "sample"
            ? rebuilt.readDocument(entry.id).body
            : entry.type === "data"
              ? rebuilt.getData(entry.id).body
              : entry.type === "analysis"
                ? rebuilt.getAnalysis(entry.id).body
                : rebuilt.getClaim(entry.id).text;
        if (sha256(stripInternalMarkers(actual)) !== entry.sha256)
          throw new Error(`转换后正文核对失败：${entry.type}:${entry.id}`);
      }
    } finally {
      rebuilt.close();
    }
    await source.unchanged();
    report.status = "verified";
    write("registry/migration-report.json", report);
    // All bytes are already in the target; there are no old-directory links or credentials.
    // Claim the destination name exclusively before publishing the validated directory.
    fs.mkdirSync(target, { mode: 0o700 });
    reservedTarget = true;
    fs.renameSync(stage, target);
    reservedTarget = false;
    const parentFd = fs.openSync(parent, "r");
    try {
      fs.fsyncSync(parentFd);
    } finally {
      fs.closeSync(parentFd);
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    source.close();
    if (
      reservedTarget &&
      fs.existsSync(target) &&
      fs.readdirSync(target).length === 0
    )
      fs.rmdirSync(target);
    if (fs.existsSync(stage))
      fs.rmSync(stage, { recursive: true, force: true });
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return { report, reportPath };
}
