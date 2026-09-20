import { describe, expect, it } from "vitest";
import { parseBody, sha256 } from "@workbench/core";
import {
  getKnowledge,
  knowledgeBundleHash,
  knowledgeDependencies,
  knowledgeVersion,
  listKnowledge,
  KnowledgeNotFoundError,
} from "./knowledge";

describe("server knowledge loader", () => {
  it("lists the full whitelist with versions, summaries and content hashes", () => {
    const index = listKnowledge();
    expect(index.map((entry) => entry.id).sort()).toEqual(
      [
        "guide",
        "protocol-analysis-claims-evidence",
        "protocol-common",
        "protocol-data-attachments",
        "protocol-objects-properties",
        "protocol-sample-document",
      ].sort(),
    );
    expect(knowledgeVersion).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(knowledgeBundleHash).toHaveLength(64);
    for (const entry of index) {
      expect(entry.contentHash).toHaveLength(64);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.version).toBe(knowledgeVersion);
    }
  });

  it("returns the published text whose hash matches the index", () => {
    const entry = getKnowledge("protocol-common");
    expect(entry.content.length).toBeGreaterThan(0);
    expect(sha256(entry.content)).toBe(entry.contentHash);
    expect(entry.content.endsWith("\n")).toBe(true);
    expect(entry.content).not.toContain("\r");
  });

  it("injects dependencies before the requested content exactly once", () => {
    const bundle = knowledgeDependencies("protocol-data-attachments");
    const ids = bundle.map((entry) => entry.id);
    expect(ids[ids.length - 1]).toBe("protocol-data-attachments");
    expect(ids).toContain("guide");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects unknown and path-like ids", () => {
    for (const id of ["unknown", "../guide", "a/b", "https://x/y"])
      expect(() => getKnowledge(id)).toThrowError(KnowledgeNotFoundError);
  });

  it("publishes a sample syntax example the real parser accepts", () => {
    const content = getKnowledge("protocol-sample-document").content;
    const snippet = content.match(/```text\n([\s\S]*?)```/)?.[1];
    expect(snippet).toBeTruthy();
    const parsed = parseBody("doc", snippet!);
    expect(parsed.records[0].references.slice(0, 4).map((ref) => ref.rawText)).toEqual([
      "磁力搅拌器",
      "水",
      "样品A",
      "搅拌",
    ]);
    expect(parsed.records[0].properties.map((property) => property.valueText)).toEqual([
      "80 g",
      "2",
      "500 rpm",
      "30 min",
    ]);
    expect(parsed.records[1].references).toEqual([]);
  });
});
