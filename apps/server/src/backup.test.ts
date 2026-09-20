import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import archiver from "archiver";
import { pipeline } from "node:stream/promises";
import { WorkbenchStore } from "./store";
import { createCompleteBackup, restoreCompleteBackup } from "./backup";
const IMPORT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const roots: string[] = [];
const stores: WorkbenchStore[] = [];
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-backup-"));
  roots.push(root);
  const store = new WorkbenchStore({ dataDir: path.join(root, "source") });
  stores.push(store);
  return { root, store };
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
describe("complete file backups", () => {
  it("restores nested evidence, history and bytes with the original directory unavailable and without credentials", async () => {
    const { root, store } = setup();
    const sample = store.createSample({ body: "- 操作" });
    store.finalizeDocument(sample.id);
    const file = store.saveAttachment(
      Buffer.from("不可变附件"),
      "模拟.txt",
      "text/plain",
    );
    const data = store.createData({
      name: "数据",
      body: "- 说明",
      aboutSampleIds: [sample.id],
    });
    store.updateData(data.id, {
      componentIds: [file.id],
      expectedVersion: data.version,
    });
    const claim = store.createClaim({
      text: "论点",
      hostType: "data",
      hostId: data.id,
    });
    fs.writeFileSync(
      path.join(store.dataDir, "private", "secret.json"),
      "DO-NOT-BACKUP",
    );
    const backup = await createCompleteBackup(store, async () => {
      throw Error("unexpected remote access");
    });
    const zip = path.join(root, "complete.zip");
    fs.copyFileSync(backup.file, zip);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    fs.renameSync(store.dataDir, path.join(root, "unavailable-source"));
    const target = path.join(root, "restored");
    await restoreCompleteBackup(zip, target, store.dataDir);
    const recovered = new WorkbenchStore({ dataDir: target });
    stores.push(recovered);
    expect(recovered.getClaim(claim.id).evidence).toEqual(claim.evidence);
    expect(recovered.readDocument(sample.id).body).toContain("操作");
    expect(
      fs.readFileSync(recovered.getAttachment(file.id).localPath, "utf8"),
    ).toBe("不可变附件");
    expect(fs.readdirSync(path.join(target, "private"))).toEqual([]);
  });
  it("fails on missing bytes and never publishes a complete archive", async () => {
    const { store } = setup();
    const file = store.saveAttachment(
      Buffer.from("missing"),
      "缺失.txt",
      "text/plain",
    );
    fs.unlinkSync(file.localPath);
    await expect(
      createCompleteBackup(store, async () => {
        throw Error("远端不可用");
      }),
    ).rejects.toThrow("远端不可用");
    expect(fs.readdirSync(path.join(store.dataDir, "backups"))).toEqual([]);
  });
  it("cancels without publishing a partial or complete archive", async () => {
    const { store } = setup();
    store.saveAttachment(
      Buffer.alloc(1024 * 1024, 7),
      "待取消.bin",
      "application/octet-stream",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      createCompleteBackup(
        store,
        async (attachment) => attachment.localPath,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELED" });
    expect(fs.readdirSync(path.join(store.dataDir, "backups"))).toEqual([]);
  });
  it("restores committed import receipts without relying on the jobs cache", async () => {
    const { root, store } = setup();
    const png = store.saveAttachment(IMPORT_PNG, "record.png", "image/png");
    const importId = randomUUID();
    const prepared = store.prepareSampleImport({
      importId,
      attachmentIds: [png.id],
    });
    const saved = store.saveSampleImportDraft(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: prepared.recordVersion,
      expectedDraftVersion: 0,
      draft: {
        schemaVersion: 1,
        samples: [
          {
            key: "s1",
            body: "- 记录正文",
            sourceMappings: [],
            references: [],
          },
        ],
        objectIntents: [],
        ambiguities: [],
      },
    });
    const sourceVersion = store.getData(prepared.sourceDataId).version;
    const committed = store.commitSampleImport(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: sourceVersion,
      commitFingerprint: saved.commitFingerprint,
    });
    expect(committed.status).toBe("committed");
    const backup = await createCompleteBackup(store, async () => {
      throw Error("unexpected remote access");
    });
    const zip = path.join(root, "import.zip");
    fs.copyFileSync(backup.file, zip);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const target = path.join(root, "restored-import");
    await restoreCompleteBackup(zip, target, store.dataDir);
    const recovered = new WorkbenchStore({ dataDir: target });
    stores.push(recovered);
    const view = recovered.getSampleImport(importId);
    expect(view.status).toBe("committed");
    expect((view as any).receipt.createdSampleIds).toEqual(
      committed.receipt.createdSampleIds,
    );
    const retried = recovered.commitSampleImport(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: sourceVersion,
      commitFingerprint: saved.commitFingerprint,
    });
    expect(retried.receipt).toEqual(committed.receipt);
    expect(recovered.listSamples()).toHaveLength(1);
  });
  it("rejects traversal in the manifest before creating a restore directory", async () => {
    const { root, store } = setup();
    const zip = path.join(root, "invalid.zip");
    const archive = archiver("zip");
    const done = pipeline(archive, fs.createWriteStream(zip));
    archive.append(
      JSON.stringify({
        schema: "swb.backup/2",
        files: [
          { path: "registry/../../outside", size: 0, sha256: "0".repeat(64) },
        ],
      }),
      { name: "manifest.json" },
    );
    await Promise.all([archive.finalize(), done]);
    const target = path.join(root, "restored");
    await expect(
      restoreCompleteBackup(zip, target, store.dataDir),
    ).rejects.toThrow("路径非法");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(root, "outside"))).toBe(false);
  });
});
