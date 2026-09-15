import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { WorkbenchStore } from "./store";

it("keeps identification and optional recommendations in registry files without constraining sample facts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-resource-"));
  let store = new WorkbenchStore({ dataDir: root });
  try {
    const duration = store.createProperty({
      canonicalName: "时间",
      recommendedUnit: "min",
    });
    const device = store.createObject({
      canonicalName: "搅拌器",
      role: "equipment",
      identityText: "MS-01",
      recommendedPropertyIds: [duration.id],
    });
    const sample = store.createSample({
      body: "- [搅拌器]\n  - [搅拌器]｜添加量：5 g",
    });
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties[0].value_text).toBe("5 g");
    const updated = store.updateObject(device.id, {
      canonicalName: "磁力搅拌器",
      aliases: ["搅拌器", "stirrer"],
      identityText: "MS-02",
      recommendedPropertyIds: [duration.id, duration.id],
      expectedVersion: device.version,
    });
    expect(updated.recommendedPropertyIds).toEqual([duration.id]);
    expect(() =>
      store.updateObject(device.id, {
        expectedVersion: device.version,
        identityText: "旧版本",
      }),
    ).toThrow("版本冲突");
    expect(() =>
      store.updateObject(device.id, {
        expectedVersion: updated.version,
        recommendedPropertyIds: ["missing"],
      }),
    ).toThrow("推荐属性无效");
    expect(
      store.searchObjects().find((object) => object.id === device.id),
    ).toEqual(updated);
    expect(() =>
      store.updateObject(device.id, {
        expectedVersion: updated.version,
        canonicalName: "论点",
      }),
    ).toThrow("保留标记");
    store.close();
    fs.rmSync(path.join(root, "index"), { recursive: true });
    store = new WorkbenchStore({ dataDir: root });
    expect(
      store.searchObjects().find((object) => object.id === device.id),
    ).toEqual(updated);
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties[0].object_id).toBe(device.id);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("merges stable references into files, survives index rebuild, and refuses referenced deletion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-resource-merge-"));
  let store = new WorkbenchStore({ dataDir: root });
  try {
    const source = store.createObject({
      canonicalName: "旧搅拌器",
      role: "equipment",
      aliases: ["old stirrer"],
    });
    const target = store.createObject({
      canonicalName: "标准搅拌器",
      role: "equipment",
    });
    const sample = store.createSample({
      body: "- 使用 [旧搅拌器]\n  - [旧搅拌器]｜时间：10 min",
    });
    store.finalizeDocument(sample.id);
    expect(() => store.deleteObject(source.id, source.version)).toThrow(
      "仍有引用",
    );
    store.mergeObjects(source.id, target.id, source.version, target.version);
    const merged = store.searchObjects().find((item) => item.id === source.id)!;
    const currentTarget = store
      .searchObjects()
      .find((item) => item.id === target.id)!;
    expect(merged.lifecycle).toBe("merged");
    expect(merged.redirectTo).toBe(target.id);
    expect(currentTarget.aliases).toEqual(
      expect.arrayContaining(["旧搅拌器", "old stirrer"]),
    );
    expect(store.readDocument(sample.id).head.references?.[0].objectId).toBe(
      target.id,
    );
    expect(store.getSample(sample.id).properties[0].object_id).toBe(target.id);
    expect(() =>
      store.mergeObjects(source.id, target.id, source.version, target.version),
    ).toThrow("版本已变化");

    store.close();
    fs.rmSync(path.join(root, "index"), { recursive: true });
    store = new WorkbenchStore({ dataDir: root });
    expect(store.getSample(sample.id).properties[0].object_id).toBe(target.id);
    expect(store.readDocument(sample.id).head.references?.[0].objectId).toBe(
      target.id,
    );
    const unused = store.createObject({
      canonicalName: "未使用设备",
      role: "equipment",
    });
    expect(store.deleteObject(unused.id, unused.version)).toEqual({
      deleted: true,
    });
    expect(store.searchObjects().some((item) => item.id === unused.id)).toBe(
      false,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
