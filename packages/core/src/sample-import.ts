/**
 * Deterministic sample-record import contract. This module owns the transient
 * draft schema, the strict shape validation and the pure fingerprint helpers;
 * the server owns persistence, CAS and the batch transaction.
 */
import { sha256 } from "./hash";
import { CREATABLE_ROLES, type JsonSchema } from "./document-contract";

export const SAMPLE_IMPORT_CONTRACT_VERSION = 1;
export const SAMPLE_IMPORT_MAX_IMAGES = 10;
export const SAMPLE_IMPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const SAMPLE_IMPORT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
export const SAMPLE_IMPORT_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SampleImportStatus = "prepared" | "draft" | "committed" | "cancelled";
export type SampleImportAttemptStatus = "active" | "revoked";

export interface SampleImportSource {
  attachmentId: string;
  page: number;
  name: string;
  sha256: string;
  componentId: string;
}

export interface SampleImportSourceMapping {
  attachmentId: string;
  page: number;
  componentId?: string;
  transcription?: string;
  positions?: string;
}

export interface SampleImportReferenceTarget {
  kind: "existing" | "new" | "sample";
  objectId?: string;
  objectKey?: string;
  sampleKey?: string;
}

export interface SampleImportReference {
  blockId: string;
  start: number;
  end: number;
  rawText: string;
  role?: string;
  target: SampleImportReferenceTarget;
}

export interface SampleImportCandidate {
  key: string;
  code?: string;
  title?: string;
  body: string;
  sourceMappings: SampleImportSourceMapping[];
  references: SampleImportReference[];
}

export interface SampleImportObjectIntent {
  key: string;
  canonicalName: string;
  role: "material" | "equipment" | "process";
  aliases?: string[];
}

export interface SampleImportAmbiguity {
  level: "critical" | "local";
  sampleKey?: string;
  message: string;
  resolved?: boolean;
  resolution?: string;
}

export interface SampleImportDraft {
  schemaVersion: 1;
  samples: SampleImportCandidate[];
  objectIntents: SampleImportObjectIntent[];
  ambiguities: SampleImportAmbiguity[];
}

export interface SampleImportReceipt {
  schemaVersion: 1;
  importId: string;
  sourceDataId: string;
  createdSampleIds: string[];
  createdObjectIds: string[];
  derivedComponentIds: string[];
  commitFingerprint: string;
  sourceDataVersion: number;
  contractVersion: number;
  committedAt: string;
}

export const sampleImportDraftSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "samples", "objectIntents", "ambiguities"],
  properties: {
    schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
    samples: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "body", "sourceMappings", "references"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 64 },
          code: { type: "string", maxLength: 128 },
          title: { type: "string", maxLength: 512 },
          body: { type: "string", minLength: 1, maxLength: 200000 },
          sourceMappings: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["attachmentId", "page"],
              properties: {
                attachmentId: { type: "string", minLength: 1, maxLength: 128 },
                page: { type: "integer", minimum: 1 },
                componentId: { type: "string", maxLength: 128 },
                transcription: { type: "string", maxLength: 200000 },
                positions: { type: "string", maxLength: 4000 },
              },
            },
          },
          references: {
            type: "array",
            maxItems: 2000,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["blockId", "start", "end", "rawText", "target"],
              properties: {
                blockId: { type: "string", minLength: 1, maxLength: 128 },
                start: { type: "integer", minimum: 0 },
                end: { type: "integer", minimum: 0 },
                rawText: { type: "string", minLength: 1, maxLength: 512 },
                role: { type: "string", maxLength: 32 },
                target: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind"],
                  properties: {
                    kind: { type: "string", enum: ["existing", "new", "sample"] },
                    objectId: { type: "string", maxLength: 128 },
                    objectKey: { type: "string", maxLength: 64 },
                    sampleKey: { type: "string", maxLength: 64 },
                  },
                },
              },
            },
          },
        },
      },
    },
    objectIntents: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "canonicalName", "role"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 64 },
          canonicalName: { type: "string", minLength: 1, maxLength: 256 },
          role: { type: "string", enum: [...CREATABLE_ROLES] },
          aliases: {
            type: "array",
            maxItems: 50,
            items: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    ambiguities: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level", "message"],
        properties: {
          level: { type: "string", enum: ["critical", "local"] },
          sampleKey: { type: "string", maxLength: 64 },
          message: { type: "string", minLength: 1, maxLength: 2000 },
          resolved: { type: "boolean" },
          resolution: { type: "string", maxLength: 4000 },
        },
      },
    },
  },
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "INVALID_INPUT" });
}

export function assertKnownKeys(
  value: unknown,
  allowed: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} 必须是对象`);
  const allow = new Set(allowed);
  for (const key of Object.keys(value as Record<string, unknown>))
    if (!allow.has(key)) invalid(`${label} 含未知字段：${key}`);
}

/** Strict, bounded shape validation. Semantic checks live on the server. */
export function validateSampleImportDraft(
  value: unknown,
): SampleImportDraft {
  assertKnownKeys(
    value,
    ["schemaVersion", "samples", "objectIntents", "ambiguities"],
    "import draft",
  );
  const draft = value as unknown as SampleImportDraft;
  if (draft.schemaVersion !== 1) invalid("import draft schemaVersion 必须为 1");
  if (!Array.isArray(draft.samples) || draft.samples.length < 1)
    invalid("import draft 至少需要一个样品候选");
  if (draft.samples.length > 50) invalid("样品候选超过上限");
  if (!Array.isArray(draft.objectIntents)) invalid("objectIntents 必须是数组");
  if (!Array.isArray(draft.ambiguities)) invalid("ambiguities 必须是数组");
  const sampleKeys = new Set<string>();
  for (const sample of draft.samples) {
    assertKnownKeys(
      sample,
      ["key", "code", "title", "body", "sourceMappings", "references"],
      "sample candidate",
    );
    if (typeof sample.key !== "string" || !sample.key.trim())
      invalid("样品候选缺少非空 key");
    if (sampleKeys.has(sample.key))
      invalid(`样品候选 key 重复：${sample.key}`);
    sampleKeys.add(sample.key);
    if (typeof sample.body !== "string" || !sample.body.trim())
      invalid(`样品候选 ${sample.key} 缺少正文`);
    if (sample.code !== undefined && typeof sample.code !== "string")
      invalid("样品 code 必须是字符串");
    if (sample.title !== undefined && typeof sample.title !== "string")
      invalid("样品 title 必须是字符串");
    if (!Array.isArray(sample.sourceMappings) || !Array.isArray(sample.references))
      invalid("sourceMappings/references 必须是数组");
    for (const mapping of sample.sourceMappings) {
      assertKnownKeys(
        mapping,
        ["attachmentId", "page", "componentId", "transcription", "positions"],
        "source mapping",
      );
      if (typeof mapping.attachmentId !== "string" || !mapping.attachmentId)
        invalid("source mapping 缺少 attachmentId");
      if (!Number.isInteger(mapping.page) || mapping.page < 1)
        invalid("source mapping page 必须为正整数");
    }
    for (const reference of sample.references) {
      assertKnownKeys(
        reference,
        ["blockId", "start", "end", "rawText", "role", "target"],
        "reference mapping",
      );
      if (
        typeof reference.blockId !== "string" ||
        !reference.blockId ||
        typeof reference.rawText !== "string" ||
        !reference.rawText ||
        !Number.isInteger(reference.start) ||
        !Number.isInteger(reference.end) ||
        reference.start < 0 ||
        reference.end <= reference.start
      )
        invalid("reference mapping 字段无效");
      assertKnownKeys(
        reference.target,
        ["kind", "objectId", "objectKey", "sampleKey"],
        "reference target",
      );
      const target = reference.target;
      if (target.kind === "existing") {
        if (!target.objectId || target.objectKey || target.sampleKey)
          invalid("existing 目标只能提供 objectId");
      } else if (target.kind === "new") {
        if (!target.objectKey || target.objectId || target.sampleKey)
          invalid("new 目标只能提供 objectKey");
      } else if (target.kind === "sample") {
        if (!target.sampleKey || target.objectId || target.objectKey)
          invalid("sample 目标只能提供 sampleKey");
      } else invalid("reference target.kind 无效");
    }
  }
  const objectKeys = new Set<string>();
  for (const intent of draft.objectIntents) {
    assertKnownKeys(
      intent,
      ["key", "canonicalName", "role", "aliases"],
      "object intent",
    );
    if (typeof intent.key !== "string" || !intent.key)
      invalid("object intent 缺少 key");
    if (objectKeys.has(intent.key))
      invalid(`object intent key 重复：${intent.key}`);
    objectKeys.add(intent.key);
    if (typeof intent.canonicalName !== "string" || !intent.canonicalName.trim())
      invalid("object intent 缺少 canonicalName");
    if (!(CREATABLE_ROLES as readonly string[]).includes(intent.role))
      invalid(`object intent 类别无效：${intent.role}`);
  }
  for (const sample of draft.samples)
    for (const reference of sample.references)
      if (
        reference.target.kind === "new" &&
        !objectKeys.has(reference.target.objectKey!)
      )
        invalid(`引用指向未知 objectKey：${reference.target.objectKey}`);
  for (const ambiguity of draft.ambiguities) {
    assertKnownKeys(
      ambiguity,
      ["level", "sampleKey", "message", "resolved", "resolution"],
      "ambiguity",
    );
    if (ambiguity.level !== "critical" && ambiguity.level !== "local")
      invalid("ambiguity level 无效");
    if (typeof ambiguity.message !== "string" || !ambiguity.message.trim())
      invalid("ambiguity 缺少 message");
  }
  return draft;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sampleImportDraftHash(draft: SampleImportDraft): string {
  return sha256(canonicalJson(draft));
}

export function sampleImportSourceFingerprint(
  sources: { attachmentId: string; sha256: string }[],
): string {
  return sha256(
    sources.map((source) => `${source.attachmentId}:${source.sha256}`).join("|"),
  );
}

export interface SampleImportCommitFingerprintInput {
  importId: string;
  sourceFingerprint: string;
  draftHash: string;
  sourceDataVersion: number;
  objects: { id: string; version: number }[];
  intents: { key: string; canonicalName: string; role: string }[];
  contractVersion: number;
}

export function sampleImportCommitFingerprint(
  input: SampleImportCommitFingerprintInput,
): string {
  return sha256(
    canonicalJson({
      ...input,
      objects: [...input.objects].sort((a, b) => a.id.localeCompare(b.id)),
      intents: [...input.intents].sort((a, b) => a.key.localeCompare(b.key)),
    }),
  );
}

/** Detect real image bytes; the declared MIME must agree with the file header. */
export function sniffImageMime(
  buffer: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (buffer.length < 12) return undefined;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return "image/webp";
  return undefined;
}
