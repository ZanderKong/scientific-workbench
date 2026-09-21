import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureBlockIds,
  parseBody,
  type SampleImportDraft,
  type SampleImportReferenceTarget,
} from "@workbench/core";
import { WorkbenchStore } from "./store";
import { createCompleteBackup, restoreCompleteBackup } from "./backup";
import {
  assertVerifiedImageUnchanged,
  decodeImageBytes,
  IMPORT_PROVENANCE_SCHEMA,
  verifyImageAttachment,
} from "./sample-import";
import { realImageFixtures } from "./test-images";

const { PNG, JPEG, WEBP } = realImageFixtures();

const roots: string[] = [];
const stores: WorkbenchStore[] = [];
function setup(prefix = "swb-import-reg-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const store = new WorkbenchStore({ dataDir: root });
  stores.push(store);
  return { store, root };
}
afterEach(() => {
  stores.splice(0).forEach((store) => {
    try {
      store.close();
    } catch {
      /* already closed */
    }
  });
  roots.splice(0).forEach((root) => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
});

function referenceSet(
  body: string,
  targetFor: (rawText: string) => SampleImportReferenceTarget,
) {
  const normalized = ensureBlockIds(body);
  const occurrences = parseBody("draft", normalized).records.flatMap(
    (record) => record.references,
  );
  return {
    body: normalized,
    references: occurrences.map((occurrence) => ({
      blockId: occurrence.blockId,
      start: occurrence.start,
      end: occurrence.end,
      rawText: occurrence.rawText,
      target: targetFor(occurrence.rawText),
    })),
  };
}

async function prepareOne(store: WorkbenchStore, bytes: Buffer, name: string) {
  const attachment = store.saveAttachment(bytes, name, "image/png");
  const importId = randomUUID();
  const prepared = await store.prepareSampleImport({
    importId,
    attachmentIds: [attachment.id],
  });
  return { attachment, importId, prepared };
}

function saveDraft(
  store: WorkbenchStore,
  importId: string,
  prepared: { attempt: { id: string }; recordVersion: number },
  draft: SampleImportDraft,
) {
  return store.saveSampleImportDraft(importId, {
    attemptId: prepared.attempt.id,
    expectedVersion: prepared.recordVersion,
    expectedDraftVersion: 0,
    draft,
  });
}

function commit(
  store: WorkbenchStore,
  importId: string,
  prepared: { attempt: { id: string }; sourceDataId: string },
  saved: {
    recordVersion: number;
    draftVersion: number;
    draftHash: string;
    commitFingerprint: string;
  },
) {
  return store.commitSampleImport(importId, {
    attemptId: prepared.attempt.id,
    expectedVersion: saved.recordVersion,
    draftVersion: saved.draftVersion,
    draftHash: saved.draftHash,
    sourceDataVersion: store.getData(prepared.sourceDataId).version,
    commitFingerprint: saved.commitFingerprint,
  });
}

describe("F02 explicit source block identity", () => {
  it("refuses to reuse an existing [数据] block as the import source and keeps the draft", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const body = ensureBlockIds(
      "- 升温至 37 度\n- [数据] 实测温度\n  - 温度为37度",
    );
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [{ key: "s1", body, sourceMappings: [], references: [] }],
      objectIntents: [],
      ambiguities: [],
    });
    expect(saved.draftVersion).toBe(1);
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /未指定 sourceBlockId/,
    );
    expect(store.listSamples()).toHaveLength(0);
    expect(store.listData()).toHaveLength(1);
    const view = store.getSampleImport(importId) as any;
    expect(view.status).toBe("draft");
    expect(view.draft.samples[0].body).toContain("温度为37度");
    expect(view.draft.samples[0].body).toContain("实测温度");
  });

  it("rejects two Data blocks instead of binding by position", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const body = ensureBlockIds(
      "- [数据] 实测温度\n  - 温度为37度\n- [数据] 观察记录\n  - 颜色淡黄",
    );
    const set = referenceSet("- 记录正文", () => ({
      kind: "sample",
      sampleKey: "s1",
    }));
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        { key: "s1", body, sourceMappings: [], references: [] },
        { key: "s2", body: set.body, sourceMappings: [], references: [] },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /未指定 sourceBlockId/,
    );
    expect(store.listSamples()).toHaveLength(0);
  });

  it("accepts only an empty explicitly identified placeholder block", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const sourceName = store.getData(prepared.sourceDataId).name;
    const empty = ensureBlockIds(`- 观察记录\n- [数据] ${sourceName}`);
    const placeholderId = parseBody("draft", empty).records.flatMap(
      (record) => record.dataItems ?? [],
    )[0].blockId;
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: empty,
          sourceBlockId: placeholderId,
          sourceMappings: [],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    const committed = commit(store, importId, prepared, saved);
    expect(committed.status).toBe("committed");
    expect(store.listSamples()).toHaveLength(1);
    const doc = store.readDocument(committed.receipt.createdSampleIds[0]);
    expect(doc.head.blocks![placeholderId].dataId).toBe(prepared.sourceDataId);
  });

  it("rejects an explicitly identified but non-empty source block and a wrong block ID", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const body = ensureBlockIds("- [数据] 实测温度\n  - 温度为37度");
    const blockId = parseBody("draft", body).records.flatMap(
      (record) => record.dataItems ?? [],
    )[0].blockId;
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body,
          sourceBlockId: blockId,
          sourceMappings: [],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /空 placeholder/,
    );
    expect(store.listSamples()).toHaveLength(0);

    const { importId: second, prepared: secondPrepared } = await prepareOne(
      store,
      PNG,
      "record2.png",
    );
    const wrong = saveDraft(store, second, secondPrepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 观察"),
          sourceBlockId: "00000000-0000-4000-8000-000000000000",
          sourceMappings: [],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, second, secondPrepared, wrong)).toThrowError(
      /指定的来源区块不存在/,
    );
    expect(store.listSamples()).toHaveLength(0);
  });
});

describe("F04 uncertain values never become confirmed properties", () => {
  it("blocks commit for a locally unresolved property value and keeps zero entities", async () => {
    const { store } = setup();
    const material = store.createObject({ canonicalName: "水", role: "material" });
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const set = referenceSet("- 使用 [水]\n  - [水]｜添加量：待确认", () => ({
      kind: "existing",
      objectId: material.id,
    }));
    const before = {
      samples: store.listSamples().length,
      objects: store.searchObjects().length,
      values: store.db.prepare("SELECT count(*) n FROM property_values").get() as any,
    };
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: set.body,
          sourceMappings: [],
          references: set.references,
        },
      ],
      objectIntents: [],
      ambiguities: [
        { level: "local", sampleKey: "s1", message: "添加量待确认" },
      ],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /仍未确认/,
    );
    expect(store.listSamples()).toHaveLength(before.samples);
    expect(store.searchObjects()).toHaveLength(before.objects);
    expect(
      store.db.prepare("SELECT count(*) n FROM property_values").get(),
    ).toEqual(before.values);
    expect((store.getSampleImport(importId) as any).status).toBe("draft");
  });

  it("accepts the same information once it is written as an ordinary observation", async () => {
    const { store } = setup();
    const material = store.createObject({ canonicalName: "水", role: "material" });
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const set = referenceSet("- 使用 [水]，添加量待确认，等待复核", () => ({
      kind: "existing",
      objectId: material.id,
    }));
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: set.body,
          sourceMappings: [],
          references: set.references,
        },
      ],
      objectIntents: [],
      ambiguities: [
        { level: "local", sampleKey: "s1", message: "添加量待确认" },
      ],
    });
    const committed = commit(store, importId, prepared, saved);
    const sample = store.getSample(committed.receipt.createdSampleIds[0]);
    expect(sample.document.body).toContain("添加量待确认");
    expect(sample.properties).toHaveLength(0);
  });

  it("rejects a critical ambiguity that was only flipped to resolved", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [{ key: "s1", body: ensureBlockIds("- 记录"), sourceMappings: [], references: [] }],
      objectIntents: [],
      ambiguities: [
        { level: "critical", message: "用量归属不明", resolved: true },
      ],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /非空澄清说明/,
    );
    expect(store.listSamples()).toHaveLength(0);
  });

  it("writes zero entities when one of five samples is illegal", async () => {
    const { store } = setup();
    const material = store.createObject({ canonicalName: "水", role: "material" });
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const samples = Array.from({ length: 5 }, (_, index) => {
      const set = referenceSet(
        index === 3
          ? "- 使用 [水]\n  - [水]｜添加量：待确认"
          : "- 使用 [水]\n  - [水]｜添加量：80 g",
        () => ({ kind: "existing", objectId: material.id }),
      );
      return {
        key: `s${index + 1}`,
        body: set.body,
        sourceMappings: [],
        references: set.references,
      };
    });
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples,
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(/s4/);
    expect(store.listSamples()).toHaveLength(0);
    expect(store.getSampleImport(importId).status).toBe("draft");
  });
});

describe("F05/F08 persistent positions and one shared source version", () => {
  it("persists positions-only mappings with the final sample IDs and a final source version", async () => {
    const { store } = setup();
    const { attachment, importId, prepared } = await prepareOne(
      store,
      PNG,
      "record.png",
    );
    const beforeVersion = store.getData(prepared.sourceDataId).version;
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 观察 A"),
          sourceMappings: [
            { attachmentId: attachment.id, page: 1, positions: "行1-3" },
          ],
          references: [],
        },
        {
          key: "s2",
          body: ensureBlockIds("- 观察 B"),
          sourceMappings: [
            { attachmentId: attachment.id, page: 1, positions: "行7-9" },
          ],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    const committed = commit(store, importId, prepared, saved);
    const receipt = committed.receipt;
    const data = store.getData(prepared.sourceDataId);
    expect(receipt.sourceDataVersion).toBe(data.version);
    expect(data.version).toBeGreaterThan(beforeVersion);
    expect(receipt.derivedComponentIds).toHaveLength(1);
    const mapping = data.components.find(
      (component) => component.role === "import-provenance",
    );
    expect(mapping).toBeTruthy();
    const provenance = JSON.parse(mapping!.provenance);
    expect(provenance.schema).toBe(IMPORT_PROVENANCE_SCHEMA);
    expect(mapping!.derivedFrom).toEqual([prepared.source[0].componentId]);
    const bySample = new Map<string, { positions?: string }>(
      provenance.entries.map((entry: any) => [entry.sampleId, entry]),
    );
    expect(provenance.entries).toHaveLength(2);
    expect(bySample.get(receipt.createdSampleIds[0])!.positions).toBe("行1-3");
    expect(bySample.get(receipt.createdSampleIds[1])!.positions).toBe("行7-9");
    for (const id of receipt.createdSampleIds) {
      const doc = store.readDocument(id);
      const binding = Object.values(doc.head.blocks!).find(
        (item) => item.dataId === prepared.sourceDataId,
      );
      expect(binding!.baseVersion).toBe(data.version);
    }
    // The transient draft is gone; the mapping survives a rebuild and a reopen.
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(store.dataDir, "registry", "imports", `${importId}.json`),
        "utf8",
      ),
    );
    expect(raw.draft).toBeUndefined();
    store.rebuildIndex();
    expect(
      store
        .getData(prepared.sourceDataId)
        .components.some(
          (component) => component.role === "import-provenance",
        ),
    ).toBe(true);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new WorkbenchStore({ dataDir: store.dataDir });
    stores.push(reopened);
    const reopenedData = reopened.getData(receipt.sourceDataId);
    expect(reopenedData.version).toBe(receipt.sourceDataVersion);
    expect(
      JSON.parse(
        reopenedData.components.find(
          (component) => component.role === "import-provenance",
        )!.provenance,
      ).entries,
    ).toHaveLength(2);
  });

  it("keeps the mapping through a complete backup and restore", async () => {
    const { store, root } = setup();
    const { attachment, importId, prepared } = await prepareOne(
      store,
      PNG,
      "record.png",
    );
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 观察"),
          sourceMappings: [
            { attachmentId: attachment.id, page: 1, positions: "第4段" },
          ],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    const receipt = commit(store, importId, prepared, saved).receipt;
    const backup = await createCompleteBackup(store, async () => {
      throw new Error("unexpected remote access");
    });
    const zip = path.join(root, "mapping.zip");
    fs.copyFileSync(backup.file, zip);
    const sourceDir = store.dataDir;
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const restoreRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "swb-import-restore-"),
    );
    roots.push(restoreRoot);
    const target = path.join(restoreRoot, "restored-mapping");
    await restoreCompleteBackup(zip, target, sourceDir);
    const restored = new WorkbenchStore({ dataDir: target });
    stores.push(restored);
    const data = restored.getData(receipt.sourceDataId);
    expect(data.version).toBe(receipt.sourceDataVersion);
    const entries = JSON.parse(
      data.components.find(
        (component) => component.role === "import-provenance",
      )!.provenance,
    ).entries;
    expect(entries[0].sampleId).toBe(receipt.createdSampleIds[0]);
    expect(entries[0].positions).toBe("第4段");
  });

  it("rejects a wrong source component and a wrong page", async () => {
    const { store } = setup();
    const { attachment, importId, prepared } = await prepareOne(
      store,
      PNG,
      "record.png",
    );
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 观察"),
          sourceMappings: [
            { attachmentId: attachment.id, page: 1, componentId: "wrong" },
          ],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, importId, prepared, saved)).toThrowError(
      /来源组件与导入不一致/,
    );
    const { attachment: secondFile, importId: second, prepared: secondPrepared } =
      await prepareOne(store, PNG, "other.png");
    const wrongPage = saveDraft(store, second, secondPrepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 观察"),
          sourceMappings: [{ attachmentId: secondFile.id, page: 2 }],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(() => commit(store, second, secondPrepared, wrongPage)).toThrowError(
      /来源页序与导入不一致/,
    );
  });
});

describe("F06 real image decoding", () => {
  it("accepts real JPEG/PNG/WebP and rejects truncated or fake bytes", async () => {
    for (const [bytes, mime] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [WEBP, "image/webp"],
    ] as const) {
      const decoded = await decodeImageBytes(bytes, mime);
      expect(decoded.mimeType).toBe(mime);
      expect(decoded.width).toBe(16);
      expect(decoded.height).toBe(16);
    }
    const twelveByteJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const fakeWebp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x1a, 0, 0, 0]),
      Buffer.from("WEBP"),
      Buffer.alloc(32, 0x22),
    ]);
    for (const broken of [
      twelveByteJpeg,
      fakeWebp,
      PNG.subarray(0, 24),
      JPEG.subarray(0, 40),
      WEBP.subarray(0, 20),
    ])
      await expect(decodeImageBytes(broken, "image/png")).rejects.toThrowError(
        /无法完整解码/,
      );
    await expect(decodeImageBytes(JPEG, "image/png")).rejects.toThrowError(
      /声明类型与文件内容不符/,
    );
  });

  it("enforces an explicit pixel budget", async () => {
    await expect(decodeImageBytes(PNG, "image/png", 100)).rejects.toThrowError(
      /无法完整解码|像素超过解码资源预算/,
    );
    // A tiny PNG header declaring 30000×30000 pixels is rejected without ever
    // allocating the decoded buffer.
    const bomb = Buffer.from(PNG);
    const dataOffset = 16;
    bomb.writeUInt32BE(30000, dataOffset);
    bomb.writeUInt32BE(30000, dataOffset + 4);
    bomb.writeUInt32BE(
      zlib.crc32(bomb.subarray(12, dataOffset + 13)) >>> 0,
      dataOffset + 13,
    );
    await expect(decodeImageBytes(bomb, "image/png")).rejects.toThrowError(
      /无法完整解码|像素超过解码资源预算/,
    );
  });

  it("rejects empty files and mismatched MIME before creating any import", async () => {
    const { store } = setup();
    const empty = store.saveAttachment(Buffer.alloc(0), "empty.png", "image/png");
    const declaredPng = store.saveAttachment(PNG, "actually.png", "image/jpeg");
    const fake = store.saveAttachment(
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]),
      "jpeg-fake.jpg",
      "image/jpeg",
    );
    for (const attachment of [empty, declaredPng, fake])
      await expect(
        store.prepareSampleImport({
          importId: randomUUID(),
          attachmentIds: [attachment.id],
        }),
      ).rejects.toThrow();
    expect(store.listData()).toHaveLength(0);
    const importsDir = path.join(store.dataDir, "registry", "imports");
    expect(fs.existsSync(importsDir) ? fs.readdirSync(importsDir) : []).toEqual(
      [],
    );
  });

  it("refuses a source image replaced while its pixels are being decoded", async () => {
    const { store } = setup();
    const attachment = store.saveAttachment(PNG, "race.png", "image/png");
    const start = store.prepareSampleImport({
      importId: randomUUID(),
      attachmentIds: [attachment.id],
    });
    // The call above has already read the original bytes and is awaiting the
    // asynchronous pixel decode; this overwrite lands inside that window.
    fs.writeFileSync(attachment.localPath, Buffer.alloc(PNG.length, 0x7f));
    await expect(start).rejects.toThrow();
    expect(store.listData()).toHaveLength(0);
    const importsDir = path.join(store.dataDir, "registry", "imports");
    expect(fs.existsSync(importsDir) ? fs.readdirSync(importsDir) : []).toEqual(
      [],
    );
  });

  it("re-checks the current file content before persisting a verified image", async () => {
    const { store } = setup();
    const attachment = store.saveAttachment(PNG, "swap.png", "image/png");
    const verified = await verifyImageAttachment(store.getAttachment(attachment.id));
    expect(verified.sha256).toBe(attachment.sha256);
    // Same length, different bytes: size and mtime are not sufficient evidence.
    fs.writeFileSync(attachment.localPath, Buffer.alloc(PNG.length, 0x11));
    expect(() =>
      assertVerifiedImageUnchanged(store.getAttachment(attachment.id), verified),
    ).toThrowError(/已被替换|已被改动|内容已变化|不一致/);
  });

  it("rejects the whole batch when an earlier image changes during a later decode", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-race2-"));
    roots.push(root);
    const first = new WorkbenchStore({ dataDir: root });
    const firstImage = first.saveAttachment(PNG, "one.png", "image/png");
    const secondImage = first.saveAttachment(JPEG, "two.jpg", "image/jpeg");
    first.close();
    stores.splice(stores.indexOf(first), 1);
    // A controlled pause point: while the second image is being decoded, the
    // first image file is replaced with same-length different bytes.
    const store = new WorkbenchStore({
      dataDir: root,
      imageVerificationPhase: (phase, attachmentId) => {
        if (phase === "bytes-read" && attachmentId === secondImage.id)
          fs.writeFileSync(firstImage.localPath, Buffer.alloc(PNG.length, 0x2a));
      },
    });
    stores.push(store);
    await expect(
      store.prepareSampleImport({
        importId: randomUUID(),
        attachmentIds: [firstImage.id, secondImage.id],
      }),
    ).rejects.toThrowError(/内容已变化|已被替换|被改动/);
    expect(store.listData()).toHaveLength(0);
    const importsDir = path.join(store.dataDir, "registry", "imports");
    expect(fs.existsSync(importsDir) ? fs.readdirSync(importsDir) : []).toEqual(
      [],
    );
    // The user's uploaded bytes are never removed by a failed verification.
    expect(fs.existsSync(secondImage.localPath)).toBe(true);
  });

  it("rejects a symlinked attachment path", async () => {
    const { store } = setup();
    const attachment = store.saveAttachment(PNG, "record.png", "image/png");
    const copy = path.join(path.dirname(attachment.localPath), "copy.png");
    fs.copyFileSync(attachment.localPath, copy);
    fs.rmSync(attachment.localPath);
    fs.symlinkSync(copy, attachment.localPath);
    await expect(
      verifyImageAttachment(store.getAttachment(attachment.id)),
    ).rejects.toThrowError(/符号链接/);
    expect(store.listData()).toHaveLength(0);
  });

  it("leaves the stored attachment bytes untouched and detects a swap after verification", async () => {
    const { store } = setup();
    const attachment = store.saveAttachment(PNG, "record.png", "image/png");
    const before = fs.readFileSync(attachment.localPath);
    const verified = await verifyImageAttachment(store.getAttachment(attachment.id));
    expect(verified.width).toBe(16);
    expect(fs.readFileSync(attachment.localPath)).toEqual(before);
    expect(() =>
      assertVerifiedImageUnchanged(store.getAttachment(attachment.id), verified),
    ).not.toThrow();
    // Replace the bytes with a different same-length payload.
    fs.writeFileSync(attachment.localPath, Buffer.alloc(before.length, 0x7f));
    expect(() =>
      assertVerifiedImageUnchanged(store.getAttachment(attachment.id), verified),
    ).toThrowError(/内容已变化|已被替换/);
  });
});

describe("F07 exact committed replay", () => {
  async function committedFixture() {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const set = referenceSet("- 观察记录", () => ({
      kind: "sample",
      sampleKey: "s1",
    }));
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: set.body,
          sourceMappings: [],
          references: set.references,
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    const request = {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: store.getData(prepared.sourceDataId).version,
      commitFingerprint: saved.commitFingerprint,
    };
    const committed = store.commitSampleImport(importId, request);
    return { store, importId, request, committed };
  }

  it("returns the original receipt only for the identical submission", async () => {
    const { store, importId, request, committed } = await committedFixture();
    expect(
      store.commitSampleImport(importId, request).receipt,
    ).toEqual(committed.receipt);
    for (const variation of [
      { attemptId: randomUUID() },
      { draftHash: "0".repeat(64) },
      { draftVersion: 99 },
      { sourceDataVersion: 7 },
      { expectedVersion: 42 },
    ])
      expect(() =>
        store.commitSampleImport(importId, { ...request, ...variation }),
      ).toThrowError(/不一致/);
    expect(store.listSamples()).toHaveLength(1);
    expect(
      store.commitSampleImport(importId, request).receipt.createdSampleIds,
    ).toEqual(committed.receipt.createdSampleIds);
  });

  it("keeps the receipt stable while the scientific entities are edited", async () => {
    const { store, importId, request, committed } = await committedFixture();
    const sampleId = committed.receipt.createdSampleIds[0];
    const sample = store.getSample(sampleId);
    store.updateSample(sampleId, {
      code: "RENAMED-01",
      expectedVersion: sample.document.head.contentVersion,
    });
    expect(
      store.commitSampleImport(importId, request).receipt,
    ).toEqual(committed.receipt);
    expect(store.listSamples()).toHaveLength(1);
  });

  it("reports an old committed record instead of accepting any request", async () => {
    const { store, importId, request, committed } = await committedFixture();
    const file = path.join(store.dataDir, "registry", "imports", `${importId}.json`);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    delete record.submissionHash;
    delete record.replayProofVersion;
    fs.writeFileSync(file, JSON.stringify(record));
    expect(store.getSampleImport(importId).status).toBe("committed");
    expect(() => store.commitSampleImport(importId, request)).toThrowError(
      /缺少可验证的提交证明/,
    );
    expect(
      (store.getSampleImport(importId) as any).receipt.createdSampleIds,
    ).toEqual(committed.receipt.createdSampleIds);
  });

  it("rejects a late attempt that was revoked by cancel and retry", async () => {
    const { store } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        { key: "s1", body: ensureBlockIds("- 观察"), sourceMappings: [], references: [] },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    const request = {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: store.getData(prepared.sourceDataId).version,
      commitFingerprint: saved.commitFingerprint,
    };
    store.cancelSampleImport(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
    });
    expect(() => store.commitSampleImport(importId, request)).toThrowError(
      /已取消/,
    );
    expect(store.listSamples()).toHaveLength(0);
  });
});

describe("F03 prepare never caches transient bodies", () => {
  it("returns a small confirmation and keeps the draft out of every long-term file", async () => {
    const { store, root } = setup();
    const { importId, prepared } = await prepareOne(store, PNG, "record.png");
    const sentinel = `SENTINEL-${randomUUID()}`;
    const saved = saveDraft(store, importId, prepared, {
      schemaVersion: 1,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds(`- ${sentinel}`),
          sourceMappings: [],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    });
    expect(saved.draftVersion).toBe(1);
    const again = await store.prepareSampleImport({
      importId,
      attachmentIds: [prepared.source[0].attachmentId],
    });
    expect(again.status).toBe("draft");
    expect((again as any).draft).toBeUndefined();
    expect((again as any).normalized).toBeUndefined();
    expect(JSON.stringify(again)).not.toContain(sentinel);
    const request = {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: store.getData(prepared.sourceDataId).version,
      commitFingerprint: saved.commitFingerprint,
    };
    store.commitSampleImport(importId, request);
    // The transient draft may only live in the import record while it is
    // still a draft; the long-term registry and the jobs cache must not carry it.
    const leaked: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (name.name.endsWith(".sqlite") || name.name.endsWith(".sqlite-wal"))
          continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.includes(sentinel)) leaked.push(path.relative(root, full));
      }
    };
    walk(path.join(store.dataDir, "registry", "imports"));
    walk(path.join(store.dataDir, "jobs"));
    walk(path.join(store.dataDir, "data"));
    expect(leaked).toEqual([]);
    const idempotency = path.join(store.dataDir, "jobs", "idempotency.json");
    if (fs.existsSync(idempotency))
      expect(fs.readFileSync(idempotency, "utf8")).not.toContain(sentinel);
  });

  it("purges only the legacy prepare cache namespace at startup", () => {
    const { root } = setup();
    const store = stores[stores.length - 1];
    const idempotency = path.join(store.dataDir, "jobs", "idempotency.json");
    fs.mkdirSync(path.dirname(idempotency), { recursive: true });
    fs.writeFileSync(
      idempotency,
      JSON.stringify({
        "POST:/api/v1/sample-imports:legacy-key": {
          fingerprint: "x",
          result: { draft: "SENTINEL-LEGACY" },
        },
        "POST:/api/v1/samples:keep-key": {
          fingerprint: "y",
          result: { id: "keep" },
        },
      }),
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new WorkbenchStore({ dataDir: root });
    stores.push(reopened);
    const remaining = JSON.parse(fs.readFileSync(idempotency, "utf8"));
    expect(Object.keys(remaining)).toEqual(["POST:/api/v1/samples:keep-key"]);
    expect(fs.readFileSync(idempotency, "utf8")).not.toContain("SENTINEL-LEGACY");
  });

  it("does not rewrite the cache file when nothing matches", () => {
    const { root } = setup();
    const store = stores[stores.length - 1];
    const idempotency = path.join(store.dataDir, "jobs", "idempotency.json");
    fs.mkdirSync(path.dirname(idempotency), { recursive: true });
    const original = JSON.stringify({
      "POST:/api/v1/samples:keep": { fingerprint: "y", result: { id: "keep" } },
    });
    fs.writeFileSync(idempotency, original);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new WorkbenchStore({ dataDir: root });
    stores.push(reopened);
    expect(fs.readFileSync(idempotency, "utf8")).toBe(original);
  });

  it("reports a corrupt cache file instead of silently dropping it", () => {
    const { root } = setup();
    const store = stores[stores.length - 1];
    const idempotency = path.join(store.dataDir, "jobs", "idempotency.json");
    fs.mkdirSync(path.dirname(idempotency), { recursive: true });
    fs.writeFileSync(idempotency, "{not json");
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(() => new WorkbenchStore({ dataDir: root })).toThrow();
    expect(fs.readFileSync(idempotency, "utf8")).toBe("{not json");
  });
});
