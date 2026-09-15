import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchStore } from "./store";
import { StorageService } from "./storage";

const stores: WorkbenchStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    const root = store.dataDir;
    if (store.db.open) store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("attachment cleanup preview", () => {
  it("protects body, component and evidence references and removes only selected orphans", () => {
    const store = new WorkbenchStore({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "swb-cleanup-")),
    });
    stores.push(store);
    const retained = store.saveAttachment(
      Buffer.from("fixed evidence"),
      "保留.txt",
      "text/plain",
    );
    const orphan = store.saveAttachment(
      Buffer.from("orphan"),
      "待清理.txt",
      "text/plain",
    );
    const data = store.createData({
      name: "证据Data",
      componentIds: [retained.id],
    });
    store.createClaim({ hostType: "data", hostId: data.id, text: "论点" });
    store.updateData(data.id, {
      componentIds: [],
      expectedVersion: data.version,
    });

    const preview = store.attachmentCleanupPreview();
    expect(preview.find((item) => item.id === retained.id)).toMatchObject({
      eligible: false,
      references: [{ type: "claim-evidence" }],
    });
    expect(preview.find((item) => item.id === orphan.id)).toMatchObject({
      eligible: true,
      references: [],
    });
    expect(() => store.deleteUnreferencedAttachment(retained.id)).toThrow(
      "仍被正文、Data、分析或证据引用",
    );

    const orphanPath = orphan.localPath;
    expect(store.deleteUnreferencedAttachment(orphan.id)).toEqual({
      id: orphan.id,
      deleted: true,
    });
    expect(fs.existsSync(orphanPath)).toBe(false);
    expect(() => store.getAttachment(orphan.id)).toThrow("附件不存在");

    store.close();
    stores.splice(stores.indexOf(store), 1);
    fs.rmSync(path.join(store.dataDir, "index"), { recursive: true });
    const rebuilt = new WorkbenchStore({ dataDir: store.dataDir });
    stores.push(rebuilt);
    expect(() => rebuilt.getAttachment(orphan.id)).toThrow("附件不存在");
    expect(rebuilt.getAttachment(retained.id).sha256).toBe(retained.sha256);
  });

  it("preflights every selected attachment before deleting any", async () => {
    const store = new WorkbenchStore({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "swb-cleanup-batch-")),
    });
    stores.push(store);
    const orphan = store.saveAttachment(
      Buffer.from("orphan"),
      "孤立.txt",
      "text/plain",
    );
    const used = store.saveAttachment(
      Buffer.from("used"),
      "引用中.txt",
      "text/plain",
    );
    store.createData({ name: "Data", componentIds: [used.id] });

    const storage = new StorageService(store);
    await expect(
      storage.cleanupAttachments([orphan.id, used.id]),
    ).rejects.toThrow("仍被引用");
    expect(fs.readFileSync(orphan.localPath, "utf8")).toBe("orphan");
    expect(store.getAttachment(orphan.id).id).toBe(orphan.id);
  });
});
