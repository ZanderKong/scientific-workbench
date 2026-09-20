import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBody } from "@workbench/core";
import { WorkbenchStore } from "./store";
import { dataMirrorHash } from "./data-mirror";

const roots: string[] = [];
const stores: WorkbenchStore[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-bind-data-"));
  roots.push(root);
  const store = new WorkbenchStore({ dataDir: root });
  stores.push(store);
  return store;
}
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

function dataBlockId(store: WorkbenchStore, sampleId: string) {
  const doc = store.readDocument(sampleId);
  const item = parseBody(sampleId, doc.body).records.flatMap(
    (record) => record.dataItems || [],
  )[0];
  if (!item) throw new Error("no data block");
  return { doc, blockId: item.blockId };
}

describe("document_bind_data", () => {
  it("binds a normal [数据] block without changing other operations or About", () => {
    const store = setup();
    const data = store.createData({
      name: "红外结果",
      body: "- 原始曲线\n",
      description: "",
    });
    const sample = store.createSample({
      body: "- 保持不变的下一操作\n  - [水]｜添加量：5 g\n- [数据] 红外结果",
    });
    const before = store.readDocument(sample.id).body;
    const { doc, blockId } = dataBlockId(store, sample.id);
    const bound = store.bindDataBlock(
      sample.id,
      blockId,
      data.id,
      doc.head.contentVersion,
      data.version,
    );
    expect(bound.idempotent).toBeUndefined();
    const after = store.readDocument(sample.id);
    expect(after.body).toContain("保持不变的下一操作");
    expect(after.body).toContain("原始曲线");
    expect(after.head.blocks[blockId].dataId).toBe(data.id);
    expect(after.head.blocks[blockId].baseHash).toBe(dataMirrorHash(data.body));
    expect(after.head.blocks[blockId].baseVersion).toBe(data.version);
    // Binding one block leaves the rest of the document byte-stable in meaning.
    expect(before).toContain("保持不变的下一操作");
    store.finalizeDocument(sample.id);
    expect(store.listData()).toHaveLength(1);
    expect(store.getData(data.id).aboutSampleIds).toEqual([]);
    // Re-binding the same target is idempotent.
    const again = store.bindDataBlock(
      sample.id,
      blockId,
      data.id,
      after.head.contentVersion,
      data.version,
    );
    expect(again.idempotent).toBe(true);
    expect(store.listData()).toHaveLength(1);
  });

  it("rejects a different target, a stale Data version and a non-data block", () => {
    const store = setup();
    const data = store.createData({ name: "A", body: "- a\n" });
    const other = store.createData({ name: "B", body: "- b\n" });
    const sample = store.createSample({ body: "- [数据] A\n- 普通操作" });
    const { doc, blockId } = dataBlockId(store, sample.id);
    expect(() =>
      store.bindDataBlock(sample.id, blockId, data.id, doc.head.contentVersion, data.version + 1),
    ).toThrowError(/Data 版本冲突/);
    expect(() =>
      store.bindDataBlock(sample.id, "missing-block", data.id, doc.head.contentVersion, data.version),
    ).toThrowError(/不是可绑定的/);
    store.bindDataBlock(sample.id, blockId, data.id, doc.head.contentVersion, data.version);
    const bound = store.readDocument(sample.id);
    expect(() =>
      store.bindDataBlock(
        sample.id,
        blockId,
        other.id,
        bound.head.contentVersion,
        other.version,
      ),
    ).toThrowError(/已绑定其他 Data/);
  });
});
