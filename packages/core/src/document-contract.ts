/**
 * Shared machine contract for document saves. This module owns the JSON schema
 * published through OpenAPI/MCP and the pure validation used by the server, so
 * tool discovery and runtime behavior cannot drift apart.
 */
import { blockLines } from "./markdown";
import type {
  ObjectRole,
  ReferenceOccurrence,
  ResearchObject,
} from "./types";

/** Minimal JSON Schema vocabulary used by the operation catalogue. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
  description?: string;
}

export const REFERENCE_ROLES: (ObjectRole | "unresolved")[] = [
  "sample",
  "material",
  "equipment",
  "process",
  "other",
  "unresolved",
];

export const REFERENCE_STATUSES = [
  "bound",
  "unresolved",
  "ambiguous",
  "create-intent",
] as const;

/** Roles an explicit create-intent may materialize. Samples are never created this way. */
export const CREATABLE_ROLES = ["material", "equipment", "process"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const referenceOccurrenceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "一条正文对象引用绑定。blockId/start/end/rawText 是稳定定位；objectId 绑定已有对象；intentId 只用于明确的创建意图。",
  properties: {
    id: { type: "string", minLength: 1 },
    blockId: { type: "string", minLength: 1 },
    operationId: { type: "string", minLength: 1 },
    objectId: { type: "string", minLength: 1 },
    intentId: { type: "string", minLength: 1 },
    rawText: { type: "string", minLength: 1 },
    role: { type: "string", enum: REFERENCE_ROLES as unknown as string[] },
    start: { type: "integer", minimum: 0 },
    end: { type: "integer", minimum: 0 },
    status: {
      type: "string",
      enum: REFERENCE_STATUSES as unknown as string[],
    },
  },
  required: ["blockId", "rawText", "start", "end", "status"],
};

export const documentBindingsSchema: JsonSchema = {
  type: "array",
  items: referenceOccurrenceSchema,
  maxItems: 5000,
  description:
    "替换文档正文的对象引用绑定；省略时保留已有 references，空数组清空。不能用于修改文件头、版本或 Data 镜像基线。",
};

export interface SanitizeBindingsResult {
  bindings: ReferenceOccurrence[];
  warnings: string[];
}

function invalidBinding(message: string): Error {
  return Object.assign(new Error(message), { code: "INVALID_INPUT" });
}

/**
 * Normalizes caller-supplied bindings against the saved body. Out-of-range
 * offsets are rejected (a forged position cannot be stored); bindings that
 * point at blocks that no longer exist or that reference a missing object or
 * an invalid create-intent are dropped instead of being honored, preserving
 * the existing tolerant editing behavior for stale clients.
 */
export function sanitizeDocumentBindings(
  body: string,
  bindings: ReferenceOccurrence[],
  objects: Pick<ResearchObject, "id" | "role">[],
): SanitizeBindingsResult {
  const warnings: string[] = [];
  const blocks = new Map(blockLines(body).map((block) => [block.id, block.text]));
  const objectIds = new Set(objects.map((object) => object.id));
  const result: ReferenceOccurrence[] = [];
  for (const input of bindings) {
    const blockId = typeof input?.blockId === "string" ? input.blockId : "";
    const rawText =
      typeof input?.rawText === "string" ? input.rawText.trim() : "";
    const status = input?.status;
    const start = Number(input?.start);
    const end = Number(input?.end);
    if (
      !blockId ||
      !rawText ||
      !(REFERENCE_STATUSES as readonly string[]).includes(status)
    ) {
      warnings.push("忽略字段不完整或状态无效的绑定");
      continue;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start
    )
      throw invalidBinding("绑定位置范围无效");
    const text = blocks.get(blockId);
    if (text === undefined) {
      warnings.push("忽略指向不存在区块的绑定");
      continue;
    }
    if (end > text.length)
      throw invalidBinding("绑定位置超出区块范围");
    let objectId = input.objectId;
    let intentId = input.intentId;
    let role: ObjectRole | "unresolved" = input.role ?? "unresolved";
    if (status === "create-intent") {
      if (
        !intentId ||
        !UUID_RE.test(intentId) ||
        !(CREATABLE_ROLES as readonly string[]).includes(role)
      ) {
        warnings.push("忽略无效的创建意图绑定");
        continue;
      }
    } else {
      intentId = undefined;
      if (status === "bound" && (!objectId || !objectIds.has(objectId))) {
        warnings.push("忽略无法解析到已有对象的绑定");
        continue;
      }
    }
    result.push({
      id: input.id || `${blockId}:${start}`,
      blockId,
      operationId: input.operationId,
      objectId: status === "bound" ? objectId : input.objectId,
      intentId,
      rawText,
      role,
      start,
      end,
      status,
    });
  }
  return { bindings: result, warnings };
}
