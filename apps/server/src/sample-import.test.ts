import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureBlockIds,
  parseBody,
  type SampleImportDraft,
  type SampleImportReferenceTarget,
} from "@workbench/core";
import { WorkbenchStore } from "./store";

const roots: string[] = [];
const stores: WorkbenchStore[] = [];
function setup(extra: { fileCheckpoint?: any } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-"));
  roots.push(root);
  const store = new WorkbenchStore({ dataDir: root, ...extra });
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x11),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.alloc(32, 0x22),
]);
const oversized = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);

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

describe("sample import prepare", () => {
  it("verifies real image bytes and is idempotent per source fingerprint", () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "p1.png", "image/png");
    const jpeg = store.saveAttachment(JPEG, "p2.jpg", "image/jpeg");
    const webp = store.saveAttachment(WEBP, "p3.webp", "image/webp");
    const importId = randomUUID();
    const first = store.prepareSampleImport({
      importId,
      attachmentIds: [png.id, jpeg.id, webp.id],
    });
    expect(first.status).toBe("prepared");
    expect(first.source.map((source) => source.page)).toEqual([1, 2, 3]);
    const again = store.prepareSampleImport({
      importId,
      attachmentIds: [png.id, jpeg.id, webp.id],
    });
    expect(again.sourceDataId).toBe(first.sourceDataId);
    expect(again.attempt.id).toBe(first.attempt.id);
    expect(store.listData()).toHaveLength(1);
    expect(store.getData(first.sourceDataId).aboutSampleIds).toEqual([]);
    expect(() =>
      store.prepareSampleImport({
        importId,
        attachmentIds: [jpeg.id, png.id, webp.id],
      }),
    ).toThrowError(/来源图片已经不同/);
  });

  it("rejects fake MIME, non-images, count and size limits", () => {
    const { store } = setup();
    const fake = store.saveAttachment(JPEG, "fake.png", "image/png");
    const text = store.saveAttachment(Buffer.from("not an image at all"), "x.png", "image/png");
    expect(() =>
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [fake.id] }),
    ).toThrowError(/声明类型与文件内容不符/);
    expect(() =>
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [text.id] }),
    ).toThrowError(/无法识别图片格式/);
    expect(() =>
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [] }),
    ).toThrowError(/1 至 10/);
    const big = store.saveAttachment(oversized, "big.png", "image/png");
    expect(() =>
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [big.id] }),
    ).toThrowError(/10 MiB/);
    const heavy = [0, 1, 2, 3].map((index) =>
      store.saveAttachment(
        Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024 + index)]),
        `h${index}.png`,
        "image/png",
      ),
    );
    expect(() =>
      store.prepareSampleImport({
        importId: randomUUID(),
        attachmentIds: heavy.map((item) => item.id),
      }),
    ).toThrowError(/30 MiB/);
  });
});

describe("sample import draft and commit", () => {
  it("commits five samples sharing one source Data with a minimal receipt", () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "record.png", "image/png");
    const equipment = store.createObject({
      canonicalName: "磁力搅拌器",
      role: "equipment",
    });
    const material = store.createObject({ canonicalName: "水", role: "material" });
    store.createObject({ canonicalName: "烧杯", role: "material" });
    const importId = randomUUID();
    const prepared = store.prepareSampleImport({
      importId,
      attachmentIds: [png.id],
    });
    const targetFor = (rawText: string): SampleImportReferenceTarget => {
      if (rawText === "磁力搅拌器")
        return { kind: "existing", objectId: equipment.id };
      if (rawText === "水" || rawText === "烧杯")
        return { kind: "existing", objectId: material.id };
      if (rawText === "搅拌") return { kind: "new", objectKey: "stir" };
      throw new Error(`unexpected reference ${rawText}`);
    };
    const samples = Array.from({ length: 5 }, (_, index) => {
      const set = referenceSet(
        `- 使用 [磁力搅拌器] 将 [水] 加入 [烧杯]，进行 [搅拌]\n  - [水]｜添加量：${60 + index * 10} g\n  - [磁力搅拌器]｜档位：2\n  - [搅拌]｜转速：500 rpm｜时间：30 min\n- 样品呈淡黄色`,
        targetFor,
      );
      return {
        key: `s${index + 1}`,
        title: `记录 ${index + 1}`,
        body: set.body,
        sourceMappings:
          index === 0
            ? [
                {
                  attachmentId: png.id,
                  page: 1,
                  componentId: prepared.source[0].componentId,
                  transcription: "第1页转录文本",
                  positions: "行1-3",
                },
              ]
            : [],
        references: set.references,
      };
    });
    const draft: SampleImportDraft = {
      schemaVersion: 1,
      samples,
      objectIntents: [
        { key: "stir", canonicalName: "搅拌", role: "process" },
      ],
      ambiguities: [
        { level: "local", sampleKey: "s1", message: "气泡数量待确认" },
      ],
    };
    const saved = store.saveSampleImportDraft(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: prepared.recordVersion,
      expectedDraftVersion: 0,
      draft,
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
    const receipt = committed.receipt;
    expect(receipt.createdSampleIds).toHaveLength(5);
    expect(new Set(receipt.createdSampleIds).size).toBe(5);
    expect(receipt.createdObjectIds).toHaveLength(1);
    expect(receipt.derivedComponentIds).toHaveLength(1);
    expect(store.listSamples()).toHaveLength(5);
    expect(
      store.searchObjects().filter((object) => object.canonicalName === "搅拌"),
    ).toHaveLength(1);
    const data = store.getData(prepared.sourceDataId);
    expect([...data.aboutSampleIds].sort()).toEqual(
      [...receipt.createdSampleIds].sort(),
    );
    expect(data.components.filter((component) => component.creator === "external")).toHaveLength(1);
    expect(data.components.find((component) => component.creator === "external")!.derivedFrom).toEqual([
      prepared.source[0].componentId,
    ]);
    for (const id of receipt.createdSampleIds) {
      const doc = store.readDocument(id);
      const bindings = Object.values(doc.head.blocks || {});
      expect(bindings.some((binding) => binding.dataId === prepared.sourceDataId)).toBe(true);
      expect(
        doc.head.references?.length &&
          doc.head.references.every((reference) => reference.status === "bound" && reference.objectId),
      ).toBe(true);
      expect(store.getSample(id).properties.length).toBeGreaterThan(0);
    }
    // Response-loss retry with the same fingerprint returns the original receipt.
    const retried = store.commitSampleImport(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: saved.recordVersion,
      draftVersion: saved.draftVersion,
      draftHash: saved.draftHash,
      sourceDataVersion: sourceVersion,
      commitFingerprint: saved.commitFingerprint,
    });
    expect(retried.receipt).toEqual(receipt);
    expect(store.listSamples()).toHaveLength(5);
    const view = store.getSampleImport(importId);
    expect(view.status).toBe("committed");
    expect((view as any).draft).toBeUndefined();
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(store.dataDir, "registry", "imports", `${importId}.json`),
        "utf8",
      ),
    );
    expect(raw.status).toBe("committed");
    expect(raw.draft).toBeUndefined();
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain("样品的转录");
    expect(serialized).not.toContain("添加量");
    expect(serialized).not.toContain("淡黄色");
    // A changed fingerprint cannot create a second batch.
    expect(() =>
      store.commitSampleImport(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: saved.recordVersion,
        draftVersion: saved.draftVersion,
        draftHash: saved.draftHash,
        sourceDataVersion: sourceVersion,
        commitFingerprint: "0".repeat(64),
      }),
    ).toThrowError(/fingerprint/);
  });

  it("blocks commit on unresolved critical ambiguity and leaves no entities", () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const material = store.createObject({ canonicalName: "水", role: "material" });
    const importId = randomUUID();
    const prepared = store.prepareSampleImport({ importId, attachmentIds: [png.id] });
    const set = referenceSet("- [水]｜添加量：80 g", () => ({
      kind: "existing",
      objectId: material.id,
    }));
    const saved = store.saveSampleImportDraft(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: prepared.recordVersion,
      expectedDraftVersion: 0,
      draft: {
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
        ambiguities: [{ level: "critical", message: "用量归属不明" }],
      },
    });
    expect(() =>
      store.commitSampleImport(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: saved.recordVersion,
        draftVersion: saved.draftVersion,
        draftHash: saved.draftHash,
        sourceDataVersion: store.getData(prepared.sourceDataId).version,
        commitFingerprint: saved.commitFingerprint,
      }),
    ).toThrowError(/关键歧义/);
    expect(store.listSamples()).toHaveLength(0);
    expect(store.getSampleImport(importId).status).toBe("draft");
  });

  it("rejects unknown fields, CAS conflicts and stale attempts", () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const importId = randomUUID();
    const prepared = store.prepareSampleImport({ importId, attachmentIds: [png.id] });
    expect(() =>
      store.prepareSampleImport({
        importId: randomUUID(),
        attachmentIds: [png.id],
        surprise: true,
      } as any),
    ).toThrowError(/未知字段/);
    const draft = {
      schemaVersion: 1 as const,
      samples: [],
      objectIntents: [],
      ambiguities: [],
    };
    expect(() =>
      store.saveSampleImportDraft(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: prepared.recordVersion,
        expectedDraftVersion: 0,
        draft,
      }),
    ).toThrowError(/至少需要一个样品候选/);
    expect(() =>
      store.saveSampleImportDraft(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: prepared.recordVersion,
        expectedDraftVersion: 5,
        draft: { ...draft, samples: [{ key: "s", body: "- x", sourceMappings: [], references: [] }] },
      }),
    ).toThrowError(/草稿版本冲突/);
    store.cancelSampleImport(importId, {
      attemptId: prepared.attempt.id,
      expectedVersion: prepared.recordVersion,
    });
    expect(() =>
      store.saveSampleImportDraft(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: 2,
        expectedDraftVersion: 0,
        draft: { ...draft, samples: [{ key: "s", body: "- x", sourceMappings: [], references: [] }] },
      }),
    ).toThrowError(/已取消/);
  });

  it("issues a new attempt on retry and rejects the late old attempt", () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const importId = randomUUID();
    const prepared = store.prepareSampleImport({ importId, attachmentIds: [png.id] });
    const retried = store.retrySampleImport(importId, {
      expectedVersion: prepared.recordVersion,
    });
    expect(retried.attempt.id).not.toBe(prepared.attempt.id);
    expect(() =>
      store.saveSampleImportDraft(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: retried.recordVersion,
        expectedDraftVersion: 0,
        draft: {
          schemaVersion: 1,
          samples: [{ key: "s", body: "- x", sourceMappings: [], references: [] }],
          objectIntents: [],
          ambiguities: [],
        },
      }),
    ).toThrowError(/资格已失效/);
  });
});

describe("sample import recovery", () => {
  it.each(["journal", "file", "index"] as const)(
    "recovers the whole batch after a durable failure at %s",
    (phase) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-recovery-"));
      roots.push(root);
      let store = new WorkbenchStore({ dataDir: root });
      const png = store.saveAttachment(PNG, "a.png", "image/png");
      const material = store.createObject({ canonicalName: "水", role: "material" });
      const importId = randomUUID();
      const prepared = store.prepareSampleImport({ importId, attachmentIds: [png.id] });
      const set = referenceSet("- [水]｜添加量：80 g", () => ({
        kind: "existing",
        objectId: material.id,
      }));
      const saved = store.saveSampleImportDraft(importId, {
        attemptId: prepared.attempt.id,
        expectedVersion: prepared.recordVersion,
        expectedDraftVersion: 0,
        draft: {
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
        },
      });
      store.close();
      stores.splice(stores.indexOf(store), 1);
      store = new WorkbenchStore({
        dataDir: root,
        fileCheckpoint: (where) => {
          if (where === phase) throw new Error(`simulated crash at ${phase}`);
        },
      });
      stores.push(store);
      const sourceVersion = store.getData(prepared.sourceDataId).version;
      expect(() =>
        store.commitSampleImport(importId, {
          attemptId: prepared.attempt.id,
          expectedVersion: saved.recordVersion,
          draftVersion: saved.draftVersion,
          draftHash: saved.draftHash,
          sourceDataVersion: sourceVersion,
          commitFingerprint: saved.commitFingerprint,
        }),
      ).toThrowError(/simulated crash/);
      expect(store.recoveryRequired()).toBe(true);
      // Before the durable journal no index commit happened; after it the
      // committed index is present but barred from business reads at the API.
      expect(store.listSamples()).toHaveLength(phase === "index" ? 1 : 0);
      store.close();
      stores.splice(stores.indexOf(store), 1);
      const reopened = new WorkbenchStore({ dataDir: root });
      stores.push(reopened);
      expect(reopened.recoveryRequired()).toBe(false);
      expect(reopened.listSamples()).toHaveLength(1);
      const view = reopened.getSampleImport(importId);
      expect(view.status).toBe("committed");
      expect((view as any).receipt.createdSampleIds).toHaveLength(1);
    },
  );
});
