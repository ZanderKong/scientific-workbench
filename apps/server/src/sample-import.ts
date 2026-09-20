/**
 * Pure helpers for deterministic sample-record import. They never persist or
 * open a second transaction engine; the WorkbenchStore owns durability.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  SAMPLE_IMPORT_IMAGE_MIME,
  SAMPLE_IMPORT_MAX_IMAGE_BYTES,
  sniffImageMime,
  type Attachment,
  type ReferenceOccurrence,
  type SampleImportCandidate,
  type SampleImportDraft,
  type SampleImportReceipt,
  type SampleImportSource,
} from "@workbench/core";

export interface SampleImportAttempt {
  id: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string;
  correlation?: string;
}

/** Durable minimal import record; committed records carry no draft copy. */
export interface SampleImportRecord {
  schema: "swb.import/2";
  schemaVersion: 1;
  importId: string;
  status: "prepared" | "draft" | "committed" | "cancelled";
  sourceDataId: string;
  sourceFingerprint: string;
  source: SampleImportSource[];
  recordVersion: number;
  draftVersion: number;
  draftHash?: string;
  commitFingerprint?: string;
  draft?: SampleImportDraft;
  attempt: SampleImportAttempt;
  receipt?: SampleImportReceipt;
  createdAt: string;
  updatedAt: string;
}

export function importError(message: string, code = "INVALID_INPUT"): Error {
  return Object.assign(new Error(message), { code });
}

function sha256File(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    let read = 0;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (read) {
        hash.update(buffer.subarray(0, read));
        position += read;
      }
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export interface VerifiedImage {
  mimeType: string;
  sizeBytes: number;
}

/**
 * Reads only through the stored attachment identity. The header must agree
 * with the declared MIME and the bytes with the recorded hash.
 */
export function verifyImageAttachment(attachment: Attachment): VerifiedImage {
  if (attachment.remoteOnly)
    throw importError("来源图片必须本地可读，不能只保留远端副本");
  const file = attachment.localPath;
  if (!file) throw importError("来源图片缺少本地路径");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw importError("来源图片字节缺失");
  }
  if (!stat.isFile()) throw importError("来源图片不是普通文件");
  if (stat.size <= 0) throw importError("来源图片为空");
  if (stat.size > SAMPLE_IMPORT_MAX_IMAGE_BYTES)
    throw importError("单张图片不能超过 10 MiB");
  const fd = fs.openSync(file, "r");
  const header = Buffer.alloc(16);
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  const sniffed = sniffImageMime(header);
  if (!sniffed) throw importError("无法识别图片格式（仅支持 JPEG/PNG/WebP）");
  if (sniffed !== attachment.mimeType)
    throw importError("图片声明类型与文件内容不符");
  if (!(SAMPLE_IMPORT_IMAGE_MIME as readonly string[]).includes(sniffed))
    throw importError("不支持的图片类型");
  if (sha256File(file) !== attachment.sha256)
    throw importError("附件内容与登记哈希不符");
  return { mimeType: sniffed, sizeBytes: stat.size };
}

export function sourceDataName(importId: string): string {
  return `实验记录 ${importId.slice(0, 8)}`;
}

export function sourceDataBody(sources: SampleImportSource[]): string {
  return sources
    .map((source) => `${source.page}. ${source.name}`)
    .join("\n");
}

/** Ensure the body carries a [数据] block so the source Data can be bound. */
export function withSourceDataBlock(body: string, name: string): string {
  if (/^\s*[-*]\s+[\[【［]数据[\]】］]/m.test(body)) return body;
  return `${body.replace(/\s*$/, "")}\n- [数据] ${name}`;
}

export interface MatchedReference {
  occurrence: ReferenceOccurrence;
  candidate: SampleImportCandidate["references"][number];
}

/**
 * Server-computed occurrences and caller mappings must agree exactly, so an
 * unmapped or stale reference cannot silently become unresolved.
 */
export function matchReferences(
  occurrences: ReferenceOccurrence[],
  mappings: SampleImportCandidate["references"],
  sampleKey: string,
): MatchedReference[] {
  const key = (value: {
    blockId: string;
    start: number;
    end: number;
    rawText: string;
  }) => `${value.blockId}:${value.start}:${value.end}:${value.rawText}`;
  const remaining = new Map(occurrences.map((item) => [key(item), item]));
  const matched: MatchedReference[] = [];
  for (const mapping of mappings) {
    const occurrence = remaining.get(key(mapping));
    if (!occurrence)
      throw importError(
        `样品 ${sampleKey} 的引用映射与正文解析结果不吻合：${mapping.rawText}`,
      );
    remaining.delete(key(mapping));
    matched.push({ occurrence, candidate: mapping });
  }
  if (remaining.size)
    throw importError(
      `样品 ${sampleKey} 有未映射的对象引用：${[...remaining.values()][0].rawText}`,
    );
  return matched;
}
