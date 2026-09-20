import { describe, expect, it } from "vitest";
import {
  buildAgentKnowledgeBundle,
  KNOWLEDGE_IDS,
  KnowledgeNotFoundError,
  knowledgeIndex,
  loadKnowledgeBundle,
  readKnowledge,
  type AgentKnowledgeManifest,
} from "./agent-knowledge";

const makeManifest = (): AgentKnowledgeManifest => ({
  schemaVersion: 1,
  version: "2026-09-21.1",
  content: KNOWLEDGE_IDS.map((id) => ({
    id,
    path: `${id}.md`,
    title: id,
    summary: `summary ${id}`,
    dependencies: id === "guide" ? [] : ["guide"],
  })),
});
const makeContents = () =>
  new Map<string, string>(
    KNOWLEDGE_IDS.map((id) => [id, `# ${id}\n\nbody\n`]),
  );
const build = (overrides: Record<string, unknown> = {}) =>
  buildAgentKnowledgeBundle({
    manifest: makeManifest(),
    contents: makeContents(),
    operationNames: ["search"],
    resolveLink: () => true,
    ...overrides,
  });

describe("agent knowledge bundle", () => {
  it("builds a stable, sorted bundle with hashes and dependency order", () => {
    const bundle = build();
    expect(bundle.content.map((entry) => entry.id)).toEqual(
      [...KNOWLEDGE_IDS].sort((a, b) => a.localeCompare(b)),
    );
    const guide = readKnowledge(bundle, "guide");
    expect(guide.content).toBe("# guide\n\nbody\n");
    expect(guide.contentHash).toHaveLength(64);
    const ordered = loadKnowledgeBundle(bundle, "protocol-data-attachments");
    expect(ordered.map((entry) => entry.id)).toEqual([
      "guide",
      "protocol-data-attachments",
    ]);
    const index = knowledgeIndex(bundle);
    expect(index.every((entry) => !("content" in entry))).toBe(true);
    const rebuilt = build();
    expect(rebuilt.bundleHash).toBe(bundle.bundleHash);
  });

  it("rejects duplicate ids, missing files and illegal paths", () => {
    const duplicate = makeManifest();
    duplicate.content.push({ ...duplicate.content[0] });
    expect(() => build({ manifest: duplicate })).toThrowError(/重复内容 ID/);
    const missing = makeContents();
    missing.delete("guide");
    expect(() => build({ contents: missing })).toThrowError(/缺少内容文件/);
    const illegal = makeManifest();
    illegal.content[0].path = "../outside.md";
    expect(() => build({ manifest: illegal })).toThrowError(/路径非法/);
    const badVersion = makeManifest();
    badVersion.version = "latest";
    expect(() => build({ manifest: badVersion })).toThrowError(/version 格式/);
  });

  it("rejects dependency cycles and unknown dependencies", () => {
    const cyclic = makeManifest();
    cyclic.content.find((entry) => entry.id === "guide")!.dependencies = [
      "protocol-common",
    ];
    expect(() => build({ manifest: cyclic })).toThrowError(/循环/);
    const unknown = makeManifest();
    unknown.content[1].dependencies = ["nope"];
    expect(() => build({ manifest: unknown })).toThrowError(/依赖未知 ID/);
  });

  it("rejects broken links and unknown operation references", () => {
    const contents = makeContents();
    contents.set("guide", "# guide\n\n[bad](./missing.md)\n");
    expect(() =>
      build({ contents, resolveLink: () => false }),
    ).toThrowError(/坏链接/);
    const operations = makeContents();
    operations.set("guide", "# guide\n\nuse `totally_unknown_op`\n");
    expect(() => build({ contents: operations })).toThrowError(/未知操作/);
  });

  it("reads only whitelisted ids and never a path", () => {
    const bundle = build();
    expect(() => readKnowledge(bundle, "../../etc/passwd")).toThrowError(
      KnowledgeNotFoundError,
    );
    expect(() => readKnowledge(bundle, "https://example.com/x")).toThrowError(
      KnowledgeNotFoundError,
    );
    expect(() => readKnowledge(bundle, "unknown")).toThrowError(
      KnowledgeNotFoundError,
    );
  });
});
