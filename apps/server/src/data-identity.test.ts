import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseDocument,
  serializeDocument,
  stripInternalMarkers,
} from "@workbench/core";
import { WorkbenchStore } from "./store";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
it.each(["associate", "new"] as const)(
  "keeps valid properties but does not duplicate markerless Data without an explicit %s decision",
  (decision) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-data-identity-"));
    roots.push(root);
    const store = new WorkbenchStore({ dataDir: root });
    try {
      store.createObject({ canonicalName: "水", role: "material" });
      const sample = store.createSample({
        body: "- [水]\n  - [水]｜添加量：5 g\n  - [数据] 光谱\n    - 原数据",
      });
      store.finalizeDocument(sample.id);
      const original = store.listData()[0],
        file = path.join(root, "samples", `${sample.id}.md`);
      const external = parseDocument(fs.readFileSync(file, "utf8"));
      external.body = stripInternalMarkers(external.body)
        .replace("5 g", "8 g")
        .replace("原数据", "外部编辑文本");
      fs.writeFileSync(file, serializeDocument(external));
      store.reloadDocument(sample.id);
      const result = store.finalizeDocument(sample.id);
      expect(result.parsed.warnings.join(" ")).toContain("身份无法确认");
      expect(store.getSample(sample.id).properties[0].value_text).toBe("8 g");
      store.finalizeDocument(sample.id);
      expect(store.listData()).toHaveLength(1);
      expect(store.getData(original.id).body).toContain("原数据");
      const analysis = store.createAnalysis({
        title: "待关联导出检查",
        itemIds: [sample.id],
      });
      expect(
        store
          .exportContext("analysis", analysis.id)
          .manifest.warnings.join(" "),
      ).toContain("数据身份待关联");
      const pending = store.readDocument(sample.id);
      const blockId = Object.entries(pending.head.blocks).find(
        ([, binding]) => binding.kind === "data-unresolved",
      )![0];
      const resolved = store.resolveDataIdentity(sample.id, blockId, {
        expectedVersion: pending.head.contentVersion,
        ...(decision === "associate"
          ? { dataId: original.id }
          : { createNew: true }),
      });
      store.finalizeDocument(sample.id);
      store.finalizeDocument(sample.id);
      expect(store.listData()).toHaveLength(decision === "associate" ? 1 : 2);
      expect(resolved.body).toContain(
        decision === "associate" ? "原数据" : "外部编辑文本",
      );
      expect(store.getSample(sample.id).properties[0].value_text).toBe("8 g");
    } finally {
      store.close();
    }
  },
);

it("restores Data identity from its exact source block when external YAML bindings are removed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-data-head-"));
  roots.push(root);
  const store = new WorkbenchStore({ dataDir: root });
  try {
    const sample = store.createSample({
      body: "- 测试\n  - [数据] 光谱\n    - 原始结果",
    });
    store.finalizeDocument(sample.id);
    const original = store.listData()[0];
    const file = path.join(root, "samples", `${sample.id}.md`);
    const external = parseDocument(fs.readFileSync(file, "utf8"));
    external.head.blocks = {};
    external.body = external.body.replace("原始结果", "外部更新结果");
    fs.writeFileSync(file, serializeDocument(external));

    store.reloadDocument(sample.id);
    store.finalizeDocument(sample.id);
    store.finalizeDocument(sample.id);

    expect(store.listData()).toHaveLength(1);
    expect(store.getData(original.id).body).toContain("外部更新结果");
    const restored = store.readDocument(sample.id).head.blocks;
    expect(
      Object.values(restored).some(
        (binding) => binding.dataId === original.id && binding.kind === "data",
      ),
    ).toBe(true);
  } finally {
    store.close();
  }
});
