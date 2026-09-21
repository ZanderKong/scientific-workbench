/**
 * Pure helpers for deterministic sample-record import. They never persist or
 * open a second transaction engine; the WorkbenchStore owns durability.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import {
  SAMPLE_IMPORT_IMAGE_MIME,
  SAMPLE_IMPORT_MAX_IMAGE_BYTES,
  SAMPLE_IMPORT_MAX_PIXELS,
  ensureBlockIds,
  parseBody,
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
  /** Replay-proof format of `submissionHash`; absent on older records. */
  replayProofVersion?: number;
  submissionHash?: string;
  createdAt: string;
  updatedAt: string;
}

export function importError(message: string, code = "INVALID_INPUT"): Error {
  return Object.assign(new Error(message), { code });
}

export function conflictError(message: string): Error {
  return Object.assign(new Error(message), { code: "CONFLICT" });
}

export interface FileIdentity {
  ino: string;
  size: number;
  mtimeMs: number;
}

export function fileIdentityOf(file: string): FileIdentity {
  const stat = fs.statSync(file);
  return { ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

export function sha256File(file: string): string {
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

export const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface DecodedImage {
  mimeType: string;
  width: number;
  height: number;
}

function messageOf(error: unknown): string {
  const message = String((error as { message?: string })?.message ?? error);
  return message.split("\n")[0].slice(0, 160);
}

/**
 * Fully decodes the pixels of an image, inside an explicit resource budget.
 * A magic-number header alone is never accepted: corrupt, truncated or
 * mismatched bytes fail here. This is a server resource boundary, not a
 * statement about the scientific content of the picture.
 */
export async function decodeImageBytes(
  bytes: Uint8Array,
  declaredMimeType: string,
  maxPixels: number = SAMPLE_IMPORT_MAX_PIXELS,
): Promise<DecodedImage> {
  const input = Buffer.from(bytes);
  const options = { limitInputPixels: maxPixels, failOn: "warning" as const };
  let metadata: Metadata;
  try {
    metadata = await sharp(input, options).metadata();
  } catch (error) {
    throw importError(`图片无法完整解码：${messageOf(error)}`);
  }
  const mimeType = IMAGE_MIME_BY_FORMAT[String(metadata.format ?? "")];
  if (!mimeType) throw importError("无法识别图片格式（仅支持 JPEG/PNG/WebP）");
  if (mimeType !== declaredMimeType) throw importError("图片声明类型与文件内容不符");
  if (!(SAMPLE_IMPORT_IMAGE_MIME as readonly string[]).includes(mimeType))
    throw importError("不支持的图片类型");
  const width = Number(metadata.width ?? 0);
  const height = Number(metadata.height ?? 0);
  if (!width || !height) throw importError("图片尺寸无效");
  if (width * height > maxPixels)
    throw importError(`图片像素超过解码资源预算（${maxPixels} 像素）`);
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await sharp(input, options)
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw importError(`图片无法完整解码：${messageOf(error)}`);
  }
  const { info } = decoded;
  if (info.width !== width || info.height !== height)
    throw importError("图片解码尺寸与文件头不一致");
  const expected = width * height * info.channels;
  if (decoded.data.byteLength !== expected)
    throw importError("图片像素数据不完整");
  return { mimeType, width, height };
}

export interface VerifiedImage {
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  identity: FileIdentity;
}

/**
 * Reads only through the stored attachment identity. The header must agree
 * with the declared MIME, the bytes with the recorded hash, and the pixels must
 * decode completely. Async by design: image decoding stays outside the
 * synchronous store transaction.
 */
export async function verifyImageAttachment(
  attachment: Attachment,
): Promise<VerifiedImage> {
  if (attachment.remoteOnly)
    throw importError("来源图片必须本地可读，不能只保留远端副本");
  const file = attachment.localPath;
  if (!file) throw importError("来源图片缺少本地路径");
  let stat: fs.Stats;
  try {
    if (fs.lstatSync(file).isSymbolicLink())
      throw importError("来源图片不允许符号链接");
    stat = fs.statSync(file);
  } catch (error) {
    if ((error as { code?: string }).code === "INVALID_INPUT") throw error;
    throw importError("来源图片字节缺失");
  }
  if (!stat.isFile()) throw importError("来源图片不是普通文件");
  if (stat.size <= 0) throw importError("来源图片为空");
  if (stat.size > SAMPLE_IMPORT_MAX_IMAGE_BYTES)
    throw importError("单张图片不能超过 10 MiB");
  const bytes = fs.readFileSync(file);
  const sniffed = sniffImageMime(bytes.subarray(0, 16));
  if (!sniffed) throw importError("无法识别图片格式（仅支持 JPEG/PNG/WebP）");
  if (sniffed !== attachment.mimeType)
    throw importError("图片声明类型与文件内容不符");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== attachment.sha256)
    throw importError("附件内容与登记哈希不符");
  const decoded = await decodeImageBytes(bytes, sniffed);
  return {
    mimeType: decoded.mimeType,
    sizeBytes: bytes.byteLength,
    width: decoded.width,
    height: decoded.height,
    sha256: digest,
    identity: fileIdentityOf(file),
  };
}

/** Re-checks, inside the synchronous transaction, that the verified bytes are
 * still the bytes registered for that attachment. */
export function assertVerifiedImageUnchanged(
  attachment: Attachment,
  verified: VerifiedImage,
): void {
  if (attachment.sha256 !== verified.sha256)
    throw importError("附件在验证后已被替换，请重新开始导入");
  let identity: FileIdentity;
  try {
    if (fs.lstatSync(attachment.localPath).isSymbolicLink())
      throw importError("来源图片不允许符号链接");
    identity = fileIdentityOf(attachment.localPath);
  } catch (error) {
    if ((error as { code?: string }).code === "INVALID_INPUT") throw error;
    throw importError("来源图片字节缺失");
  }
  if (!sameIdentity(identity, verified.identity) || identity.size !== verified.sizeBytes)
    throw importError("来源图片在验证后被改动，请重新开始导入");
}

export function sourceDataName(importId: string): string {
  return `实验记录 ${importId.slice(0, 8)}`;
}

export function sourceDataBody(sources: SampleImportSource[]): string {
  return sources
    .map((source) => `${source.page}. ${source.name}`)
    .join("\n");
}

export interface ResolvedSourceBlock {
  /** Body that will be saved, including an appended placeholder when needed. */
  body: string;
  blockId: string;
  appended: boolean;
}

/**
 * Resolves which `[数据]` block is this candidate's dedicated import source.
 * Only the real parser identifies blocks; position is never used as identity,
 * and unknown scientific content is never overwritten or silently dropped.
 */
export function resolveSourceDataBlock(
  body: string,
  sourceBlockId: string | undefined,
  dataName: string,
  sampleKey: string,
): ResolvedSourceBlock {
  const normalized = ensureBlockIds(body);
  const dataItems = parseBody("draft", normalized).records.flatMap(
    (record) => record.dataItems ?? [],
  );
  if (sourceBlockId) {
    const match = dataItems.filter((item) => item.blockId === sourceBlockId);
    if (!match.length)
      throw importError(
        `样品 ${sampleKey} 指定的来源区块不存在或不是 [数据] 区块：${sourceBlockId}`,
      );
    if (dataItems.length > 1)
      throw importError(
        `样品 ${sampleKey} 只能有一个 [数据] 区块；请移除多余的来源区块后再提交`,
      );
    if (match[0].body.trim())
      throw importError(
        `样品 ${sampleKey} 的来源区块不是空 placeholder，包含未知科研正文；请清空该区块或把它改成普通文本后再提交`,
      );
    return { body: normalized, blockId: sourceBlockId, appended: false };
  }
  if (dataItems.length)
    throw importError(
      `样品 ${sampleKey} 正文已包含 [数据] 区块但未指定 sourceBlockId；系统不会按位置自动绑定来源，请显式指定或移除该区块`,
    );
  const appended = `${normalized.replace(/\s*$/, "")}\n- [数据] ${dataName}`;
  const resolved = ensureBlockIds(appended);
  const created = parseBody("draft", resolved).records.flatMap(
    (record) => record.dataItems ?? [],
  );
  if (created.length !== 1)
    throw importError(`样品 ${sampleKey} 的来源占位区块创建失败`);
  return { body: resolved, blockId: created[0].blockId, appended: true };
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

export const IMPORT_PROVENANCE_ROLE = "import-provenance";
export const IMPORT_PROVENANCE_SCHEMA = "swb.import-provenance/1";

export interface ImportProvenanceEntry {
  sampleId: string;
  sampleKey: string;
  attachmentId: string;
  sourceComponentId: string;
  page: number;
  positions?: string;
}

/**
 * One formal, versioned mapping component per import. It holds only IDs and
 * page/position relations; sample properties, processes, observations and full
 * markdown are deliberately excluded.
 */
export function importProvenanceComponent(
  id: string,
  importId: string,
  entries: ImportProvenanceEntry[],
  derivedFrom: string[],
  createdAt: string,
) {
  return {
    id,
    kind: "text" as const,
    name: "来源映射",
    role: IMPORT_PROVENANCE_ROLE,
    creator: "external" as const,
    provenance: JSON.stringify({
      schema: IMPORT_PROVENANCE_SCHEMA,
      importId,
      entries,
    }),
    createdAt,
    derivedFrom: [...new Set(derivedFrom)],
    content: `实验记录来源位置映射（${entries.length} 条）`,
  };
}
