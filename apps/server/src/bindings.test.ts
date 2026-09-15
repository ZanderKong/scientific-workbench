import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkbenchStore } from "./store";
const stores: WorkbenchStore[] = [];
const setup = () => {
  const store = new WorkbenchStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "swb-bindings-")),
  });
  stores.push(store);
  return store;
};
afterEach(() =>
  stores.splice(0).forEach((store) => {
    store.close();
    fs.rmSync(store.dataDir, { recursive: true, force: true });
  }),
);
describe("stable object and operation identities", () => {
  it("keeps renamed object identity, releases edited names, and counts separate operations once each", () => {
    const store = setup();
    const stir = store.createObject({ canonicalName: "搅拌", role: "process" });
    const sample = store.createSample({
      body: "- [搅拌]\n  - [搅拌]｜时间：30 min\n- [搅拌]\n  - [搅拌]｜时间：60 min\n- [搅拌]",
    });
    store.finalizeDocument(sample.id);
    expect(
      store
        .readDocument(sample.id)
        .head.usages?.filter((usage) => usage.objectId === stir.id),
    ).toHaveLength(3);
    store.updateObject(stir.id, {
      canonicalName: "磁力搅拌",
      expectedVersion: stir.version,
    });
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties).toHaveLength(2);
    expect(
      store
        .getSample(sample.id)
        .properties.every((property) => property.object_id === stir.id),
    ).toBe(true);
    const current = store.readDocument(sample.id);
    store.saveDocument(
      sample.id,
      current.body.replaceAll("[搅拌]", "[未确定过程]"),
      current.head.contentVersion,
    );
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties).toHaveLength(0);
    expect(
      store
        .readDocument(sample.id)
        .head.references?.every(
          (reference) => reference.status === "unresolved",
        ),
    ).toBe(true);
  });
  it("copies only the operation template and gives every copied block a new identity", () => {
    const store = setup();
    store.createObject({ canonicalName: "搅拌", role: "process" });
    const sample = store.createSample({
      body: "- [搅拌]\n  - [搅拌]｜时间：30 min\n  - 【数据】 FTIR\n    - 原始实验结果\n  - ［论点］ 原始结论\n- 下一操作",
    });
    store.finalizeDocument(sample.id);
    const before = store.readDocument(sample.id),
      originalData = store.listData()[0];
    const copies = store.batchSamples([sample.id], 2);
    expect(new Set(copies.map((copy) => copy.code)).size).toBe(2);
    for (const copy of copies) {
      expect(copy.id).not.toBe(sample.id);
      expect(copy.document.body).toContain("时间：30 min");
      expect(copy.document.body).toContain("下一操作");
      expect(copy.document.body).not.toMatch(/FTIR|原始实验结果|原始结论/);
      expect(copy.properties).toHaveLength(1);
      expect(
        Object.values(copy.document.head.blocks).some(
          (binding) => binding.dataId,
        ),
      ).toBe(false);
      const originalIds = [
        ...before.body.matchAll(/swb:block id="([^"]+)"/g),
      ].map((match) => match[1]);
      expect(
        [...copy.document.body.matchAll(/swb:block id="([^"]+)"/g)].every(
          (match) => !originalIds.includes(match[1]),
        ),
      ).toBe(true);
    }
    expect(store.listData()).toHaveLength(1);
    expect(store.getData(originalData.id)).toEqual(originalData);
    expect(store.readDocument(sample.id).body).toBe(before.body);
  });
});
