import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkbenchStore } from "./store";

describe("WorkbenchStore", () => {
  it("saves, finalizes and updates a projection without duplicating values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    store.createObject({ canonicalName: "水", role: "material" });
    const sample = store.createSample({
      body: "- 加水 [水]\n  - [水]｜添加量：80 g\n",
    });
    store.finalizeDocument(sample.id);
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties).toHaveLength(1);
    const saved = store.saveDocument(
      sample.id,
      "- 加水 [水]\n  - [水]｜添加量：100 g\n",
      1,
    );
    expect(saved.contentVersion).toBe(2);
    store.finalizeDocument(sample.id);
    expect(store.getSample(sample.id).properties[0].value_text).toBe("100 g");
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("returns a version conflict instead of silently overwriting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    const sample = store.createSample();
    store.saveDocument(sample.id, "- one", 1);
    expect(() => store.saveDocument(sample.id, "- stale", 1)).toThrow(
      "文档版本冲突",
    );
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("blocks an overwrite after an external file edit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    const sample = store.createSample({ body: "- original" });
    const file = sample.document.filePath;
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("- original", "- external"),
    );
    expect(() => store.saveDocument(sample.id, "- mine", 1)).toThrow(
      "磁盘文件已被外部修改",
    );
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("creates one stable Data record for repeated extraction", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    const sample = store.createSample({ body: "- 测试\n  - [数据] FTIR-01" });
    store.finalizeDocument(sample.id);
    store.finalizeDocument(sample.id);
    expect(store.listData()).toHaveLength(1);
    expect(store.listData()[0].name).toBe("FTIR-01");
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('accepts external content only through reload and permits a subsequent versioned save', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-'));
    const store = new WorkbenchStore({ dataDir: dir });
    try {
      const sample = store.createSample({ body: '- original' });
      const file = sample.document.filePath;
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('- original', '- external'));
      expect(() => store.ensureLatest(sample.id)).toThrow();
      const loaded = store.reloadDocument(sample.id);
      expect(loaded.body).toContain('- external');
      store.saveDocument(sample.id, loaded.body.replace('external', 'accepted'), loaded.head.contentVersion);
      expect(fs.readFileSync(file, 'utf8')).toContain('- accepted');
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('keeps unknown objects as text and creates history only on finalization', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-'));
    const store = new WorkbenchStore({ dataDir: dir });
    try {
      const sample = store.createSample({ body: '- [未知搅拌器]\n  - [未知搅拌器]｜添加量：5 g' });
      store.saveDocument(sample.id, sample.document.body + '\n- 完成', 1);
      expect(store.listSnapshots(sample.id)).toHaveLength(0);
      store.finalizeDocument(sample.id); store.finalizeDocument(sample.id);
      expect(store.searchObjects().filter(object => object.role !== 'sample')).toHaveLength(0);
      expect(store.getSample(sample.id).properties).toHaveLength(0);
      expect(store.listSnapshots(sample.id)).toHaveLength(1);
      expect(store.readDocument(sample.id).body).toContain('添加量：5 g');
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("extracts every Data block and exposes sample properties in the list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    store.createObject({ canonicalName: "水", role: "material" });
    const sample = store.createSample({
      body: "- 记录 [水]\n  - [水]｜温度：25 ℃\n  - [数据] FTIR\n    - 光谱正文\n  - [数据] DSC",
    });
    store.finalizeDocument(sample.id);
    expect(store.listData()).toHaveLength(2);
    expect(store.listData().find((d) => d.name === "FTIR")?.body).toContain('- 光谱正文');
    expect(store.listData().find((d) => d.name === "FTIR")?.body).toContain('<!-- swb:block');
    expect(store.listSamples()[0].properties).toHaveLength(1);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("does not store S3 credentials in SQLite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swb-"));
    const store = new WorkbenchStore({ dataDir: dir });
    const { StorageService } = await import("./storage");
    const storage = new StorageService(store);
    storage.configure({
      accessKeyId: "fake-key",
      secretAccessKey: "fake-secret",
    });
    const setting = store.db
      .prepare("SELECT value FROM settings WHERE key='s3'")
      .get() as any;
    expect(setting.value).not.toContain("fake-secret");
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
