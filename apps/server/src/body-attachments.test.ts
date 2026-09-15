import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { fileLink } from "@workbench/core";
import { WorkbenchStore } from "./store";
it("extracts all Data attachment links once, removes only body component references and preserves evidence bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-body-files-"));
  let store = new WorkbenchStore({ dataDir: root });
  try {
    const file = store.saveAttachment(
      Buffer.from("原始附件"),
      "中文]光谱.csv",
      "text/csv",
    );
    const link = fileLink(file.id, file.originalName);
    const sample = store.createSample({
      body: `- 测试\n  - [数据] 第一组\n    - ${link}\n  - [数据] 第二组\n    - ${link}[缺失](swb-file:missing)`,
    });
    const result = store.finalizeDocument(sample.id);
    expect(result.parsed.warnings.join()).toContain("附件「缺失」不存在");
    store.finalizeDocument(sample.id);
    const records = store.listData();
    expect(records).toHaveLength(2);
    for (const data of records) {
      expect(data.componentIds).toEqual([file.id]);
      expect(data.components).toHaveLength(1);
      expect(data.components[0].bodyLinked).toBe(true);
    }
    const first = records.find((data) => data.name === "第一组")!;
    const claim = store.createClaim({
      hostType: "data",
      hostId: first.id,
      text: "保留证据",
    });
    const doc = store.readDocument(sample.id);
    store.saveDocument(
      sample.id,
      doc.body.replace(link, ""),
      doc.head.contentVersion,
    );
    store.finalizeDocument(sample.id);
    expect(store.getData(first.id).componentIds).toEqual([]);
    expect(
      fs.readFileSync(store.getAttachment(file.id).localPath, "utf8"),
    ).toBe("原始附件");
    expect(store.getClaim(claim.id).evidence[0].attachmentIds).toEqual([
      file.id,
    ]);
    const current = store.readDocument(sample.id);
    store.saveDocument(sample.id, "- 删除引用", current.head.contentVersion);
    store.finalizeDocument(sample.id);
    expect(store.listData()).toHaveLength(2);
    store.close();
    fs.rmSync(path.join(root, "index"), { recursive: true });
    store = new WorkbenchStore({ dataDir: root });
    expect(store.getClaim(claim.id).evidence).toEqual(claim.evidence);
    expect(store.getData(first.id).componentIds).toEqual([]);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
