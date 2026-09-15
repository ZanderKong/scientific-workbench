import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseDocument, serializeDocument } from "@workbench/core";
import { WorkbenchStore } from "./store";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
);
it("guards all independent entity files and explicitly reloads them without changing Claim evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-external-"));
  directories.push(dir);
  const store = new WorkbenchStore({ dataDir: dir });
  try {
    const data = store.createData({ name: "光谱", body: "- 原数据" });
    const analysis = store.createAnalysis({
      title: "比较",
      body: "- 原分析",
      itemIds: [data.id],
    });
    const claim = store.createClaim({
      hostType: "analysis",
      hostId: analysis.id,
      text: "原判断",
    });
    for (const [type, plural, record] of [
      ["data", "data", data],
      ["analysis", "analyses", analysis],
      ["claim", "claims", claim],
    ] as const) {
      const file = path.join(dir, plural, `${record.id}.md`),
        document = parseDocument(fs.readFileSync(file, "utf8"));
      document.body = "- 外部文本编辑器修改";
      const external = serializeDocument(document);
      fs.writeFileSync(file, external);
      const save = () =>
        type === "data"
          ? store.updateData(record.id, {
              body: "不应覆盖",
              expectedVersion: record.version,
            })
          : type === "analysis"
            ? store.updateAnalysis(record.id, {
                body: "不应覆盖",
                expectedVersion: record.version,
              })
            : store.updateClaim(record.id, "不应覆盖", record.version);
      expect(save).toThrow("外部修改");
      expect(fs.readFileSync(file, "utf8")).toBe(external);
      const loaded = store.reloadEntity(type, record.id, record.version);
      expect(loaded.version).toBe(record.version + 1);
      expect(parseDocument(fs.readFileSync(file, "utf8")).body).toBe(
        "- 外部文本编辑器修改",
      );
      expect(() => store.reloadEntity(type, record.id, record.version)).toThrow(
        "版本冲突",
      );
    }
    expect(store.getClaim(claim.id).evidence).toEqual(claim.evidence);
    const file = path.join(dir, "claims", `${claim.id}.md`),
      invalid = parseDocument(fs.readFileSync(file, "utf8"));
    invalid.head.claim!.hostId = data.id;
    const bad = serializeDocument(invalid);
    fs.writeFileSync(file, bad);
    expect(() =>
      store.reloadEntity("claim", claim.id, claim.version + 1),
    ).toThrow("host");
    expect(store.getClaim(claim.id).hostId).toBe(analysis.id);
    expect(fs.readFileSync(file, "utf8")).toBe(bad);
    expect(() =>
      store.updateClaim(claim.id, "绕过失败重载", claim.version + 1),
    ).toThrow("外部修改");
  } finally {
    store.close();
  }
});
