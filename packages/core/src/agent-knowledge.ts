/**
 * Single-source agent knowledge bundle. The manifest is hand-written; content
 * hashes and the bundle hash are computed from the published UTF-8/LF text so
 * they cannot drift. The same pure functions validate the generator input, the
 * server loader and tests.
 */
import { sha256 } from "./hash";

export const KNOWLEDGE_IDS = [
  "guide",
  "protocol-common",
  "protocol-sample-document",
  "protocol-objects-properties",
  "protocol-data-attachments",
  "protocol-analysis-claims-evidence",
  "skill-sample-from-record",
] as const;
export type KnowledgeId = (typeof KNOWLEDGE_IDS)[number];
export const KNOWLEDGE_ID_SET: ReadonlySet<string> = new Set(KNOWLEDGE_IDS);

export interface AgentKnowledgeManifestEntry {
  id: string;
  path: string;
  title: string;
  summary: string;
  dependencies: string[];
}
export interface AgentKnowledgeManifest {
  schemaVersion: number;
  version: string;
  content: AgentKnowledgeManifestEntry[];
}
export interface AgentKnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  version: string;
  contentHash: string;
  dependencies: string[];
  content: string;
}
export interface AgentKnowledgeBundle {
  version: string;
  bundleHash: string;
  content: AgentKnowledgeEntry[];
}

export class KnowledgeNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(id: string) {
    super(`未知知识内容：${id}`);
  }
}
export class KnowledgeContractError extends Error {
  readonly code = "INVALID_KNOWLEDGE";
}

/** Only the fixed slash-free whitelist is addressable; never a filesystem path. */
export function assertKnowledgeId(id: string): asserts id is KnowledgeId {
  if (!KNOWLEDGE_ID_SET.has(id))
    throw new KnowledgeNotFoundError(String(id));
}

export function normalizeKnowledgeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
}

const VERSION_RE = /^\d{4}-\d{2}-\d{2}(\.\d+)?$/;
const LINK_RE = /\]\(([^)]+)\)/g;
const OPERATION_RE = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

function fail(message: string): never {
  throw new KnowledgeContractError(message);
}

function validateManifest(manifest: AgentKnowledgeManifest) {
  if (manifest.schemaVersion !== 1)
    fail(`manifest.schemaVersion 必须为 1，当前 ${manifest.schemaVersion}`);
  if (!VERSION_RE.test(manifest.version))
    fail(`manifest.version 格式无效：${manifest.version}`);
  if (!Array.isArray(manifest.content) || manifest.content.length === 0)
    fail("manifest.content 不能为空");
  const ids = new Set<string>();
  for (const entry of manifest.content) {
    if (!KNOWLEDGE_ID_SET.has(entry.id))
      fail(`manifest 含未登记内容 ID：${entry.id}`);
    if (ids.has(entry.id)) fail(`manifest 含重复内容 ID：${entry.id}`);
    ids.add(entry.id);
    if (
      !entry.path ||
      entry.path.startsWith("/") ||
      entry.path.includes("..") ||
      entry.path.includes("\\") ||
      !entry.path.endsWith(".md")
    )
      fail(`内容 ${entry.id} 的路径非法：${entry.path}`);
    if (!entry.title || !entry.summary)
      fail(`内容 ${entry.id} 缺少 title 或 summary`);
    for (const dependency of entry.dependencies ?? [])
      if (!ids.has(dependency) && !KNOWLEDGE_ID_SET.has(dependency))
        fail(`内容 ${entry.id} 依赖未知 ID：${dependency}`);
  }
  for (const id of KNOWLEDGE_IDS)
    if (!ids.has(id)) fail(`manifest 缺少已登记内容：${id}`);
  // cycle detection
  const byId = new Map(manifest.content.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) fail(`依赖出现循环：${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dependency)) fail(`依赖 ${dependency} 不在 manifest 中`);
      visit(dependency);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const entry of manifest.content) visit(entry.id);
}

export function buildAgentKnowledgeBundle(input: {
  manifest: AgentKnowledgeManifest;
  contents: Map<string, string>;
  operationNames: string[];
  resolveLink?: (fromId: string, target: string) => boolean;
}): AgentKnowledgeBundle {
  const { manifest, contents } = input;
  validateManifest(manifest);
  const operationNames = new Set(input.operationNames);
  const entries: AgentKnowledgeEntry[] = [];
  for (const entry of [...manifest.content].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const raw = contents.get(entry.id);
    if (raw === undefined) fail(`缺少内容文件：${entry.path}`);
    const content = normalizeKnowledgeText(raw);
    if (!content.trim()) fail(`内容 ${entry.id} 为空`);
    for (const match of content.matchAll(LINK_RE)) {
      const target = match[1].split("#")[0].trim();
      if (!target || /^(https?:|mailto:|data:)/.test(target)) continue;
      if (input.resolveLink && !input.resolveLink(entry.id, target))
        fail(`内容 ${entry.id} 含坏链接：${target}`);
    }
    for (const match of content.matchAll(OPERATION_RE)) {
      const name = match[1];
      if (!operationNames.has(name))
        fail(`内容 ${entry.id} 引用了未知操作：${name}`);
    }
    entries.push({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      version: manifest.version,
      contentHash: sha256(content),
      dependencies: [...(entry.dependencies ?? [])],
      content,
    });
  }
  const bundleHash = sha256(
    entries
      .map((entry) => `${entry.id}:${entry.version}:${entry.contentHash}`)
      .join("\n"),
  );
  return { version: manifest.version, bundleHash, content: entries };
}

/** Index metadata without the body, safe for discovery. */
export function knowledgeIndex(
  bundle: AgentKnowledgeBundle,
): Omit<AgentKnowledgeEntry, "content">[] {
  return bundle.content.map(({ content: _content, ...meta }) => meta);
}

export function readKnowledge(
  bundle: AgentKnowledgeBundle,
  id: string,
): AgentKnowledgeEntry {
  assertKnowledgeId(id);
  const entry = bundle.content.find((item) => item.id === id);
  if (!entry) throw new KnowledgeNotFoundError(id);
  return entry;
}

/** Dependencies first, then the requested content, de-duplicated. */
export function loadKnowledgeBundle(
  bundle: AgentKnowledgeBundle,
  id: string,
): AgentKnowledgeEntry[] {
  const requested = readKnowledge(bundle, id);
  const order: AgentKnowledgeEntry[] = [];
  const seen = new Set<string>();
  const visit = (entry: AgentKnowledgeEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    for (const dependency of entry.dependencies)
      visit(readKnowledge(bundle, dependency));
    order.push(entry);
  };
  visit(requested);
  return order;
}
