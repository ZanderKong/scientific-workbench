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
import { realImageFixtures } from "./test-images";

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

const { PNG, JPEG, WEBP } = realImageFixtures();
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
  it("verifies real image bytes and is idempotent per source fingerprint", async () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "p1.png", "image/png");
    const jpeg = store.saveAttachment(JPEG, "p2.jpg", "image/jpeg");
    const webp = store.saveAttachment(WEBP, "p3.webp", "image/webp");
    const importId = randomUUID();
    const first = await store.prepareSampleImport({
      importId,
      attachmentIds: [png.id, jpeg.id, webp.id],
    });
    expect(first.status).toBe("prepared");
    expect(first.source.map((source) => source.page)).toEqual([1, 2, 3]);
    // The confirmation is small: it carries no transient draft or body.
    expect(JSON.stringify(first)).not.toContain("draft");
    const again = await store.prepareSampleImport({
      importId,
      attachmentIds: [png.id, jpeg.id, webp.id],
    });
    expect(again.sourceDataId).toBe(first.sourceDataId);
    expect(again.attempt.id).toBe(first.attempt.id);
    expect(store.listData()).toHaveLength(1);
    expect(store.getData(first.sourceDataId).aboutSampleIds).toEqual([]);
    await expect(
      store.prepareSampleImport({
        importId,
        attachmentIds: [jpeg.id, png.id, webp.id],
      }),
    ).rejects.toThrowError(/来源图片已经不同/);
  });

  it("rejects fake MIME, undecodable bytes, count and size limits", async () => {
    const { store } = setup();
    const fake = store.saveAttachment(JPEG, "fake.png", "image/png");
    const text = store.saveAttachment(
      Buffer.from("not an image at all"),
      "x.png",
      "image/png",
    );
    const twelveByteJpeg = store.saveAttachment(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]),
      "tiny.jpg",
      "image/jpeg",
    );
    const truncatedPng = store.saveAttachment(PNG.subarray(0, 24), "t.png", "image/png");
    await expect(
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [fake.id] }),
    ).rejects.toThrowError(/声明类型与文件内容不符/);
    await expect(
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [text.id] }),
    ).rejects.toThrowError(/无法识别图片格式/);
    for (const broken of [twelveByteJpeg, truncatedPng])
      await expect(
        store.prepareSampleImport({
          importId: randomUUID(),
          attachmentIds: [broken.id],
        }),
      ).rejects.toThrowError(/无法完整解码/);
    await expect(
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [] }),
    ).rejects.toThrowError(/1 至 10/);
    const big = store.saveAttachment(oversized, "big.png", "image/png");
    await expect(
      store.prepareSampleImport({ importId: randomUUID(), attachmentIds: [big.id] }),
    ).rejects.toThrowError(/10 MiB/);
  });
});

describe("sample import draft and commit", () => {
  it("commits five samples sharing one source Data with a minimal receipt", async () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "record.png", "image/png");
    const equipment = store.createObject({
      canonicalName: "磁力搅拌器",
      role: "equipment",
    });
    const material = store.createObject({ canonicalName: "水", role: "material" });
    store.createObject({ canonicalName: "烧杯", role: "material" });
    const importId = randomUUID();
    const prepared = await store.prepareSampleImport({
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
        sourceMappings: [
          {
            attachmentId: png.id,
            page: 1,
            componentId: prepared.source[0].componentId,
            ...(index === 0 ? { transcription: "第1页转录文本" } : {}),
            positions: `行${index * 3 + 1}-${index * 3 + 3}`,
          },
        ],
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
    // One import-provenance mapping component plus one transcription component.
    expect(receipt.derivedComponentIds).toHaveLength(2);
    expect(store.listSamples()).toHaveLength(5);
    expect(
      store.searchObjects().filter((object) => object.canonicalName === "搅拌"),
    ).toHaveLength(1);
    const data = store.getData(prepared.sourceDataId);
    expect([...data.aboutSampleIds].sort()).toEqual(
      [...receipt.createdSampleIds].sort(),
    );
    const external = data.components.filter(
      (component) => component.creator === "external",
    );
    expect(external).toHaveLength(2);
    const mapping = external.find(
      (component) => component.role === "import-provenance",
    )!;
    const provenance = JSON.parse(mapping.provenance);
    // Every sample keeps its own page/line relation to the shared original.
    expect(provenance.entries).toHaveLength(5);
    expect(
      provenance.entries.map((entry: any) => [entry.sampleId, entry.positions]),
    ).toEqual(
      receipt.createdSampleIds.map((id, index) => [id, `行${index * 3 + 1}-${index * 3 + 3}`]),
    );
    expect(provenance.entries[0]).toMatchObject({
      sampleKey: "s1",
      attachmentId: png.id,
      sourceComponentId: prepared.source[0].componentId,
      page: 1,
    });
    expect(mapping.derivedFrom).toEqual([prepared.source[0].componentId]);
    const transcription = external.find(
      (component) => component.role === "transcription",
    )!;
    expect(transcription.content).toBe("第1页转录文本");
    expect(transcription.provenance).not.toContain("model");
    for (const id of receipt.createdSampleIds) {
      const doc = store.readDocument(id);
      const bindings = Object.values(doc.head.blocks || {});
      const source = bindings.find(
        (binding) => binding.dataId === prepared.sourceDataId,
      );
      expect(source).toBeTruthy();
      // Mirrors, the formal Data and the receipt all agree on one version.
      expect(source!.baseVersion).toBe(data.version);
      expect(source!.baseVersion).toBe(receipt.sourceDataVersion);
      expect(
        doc.head.references?.length &&
          doc.head.references.every((reference) => reference.status === "bound" && reference.objectId),
      ).toBe(true);
      expect(store.getSample(id).properties.length).toBeGreaterThan(0);
    }
    // Response-loss retry with the same submission returns the original receipt.
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
    expect(raw.submissionHash).toHaveLength(64);
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain("第1页转录文本");
    expect(serialized).not.toContain("添加量");
    expect(serialized).not.toContain("淡黄色");
  });

  it("blocks commit on unresolved critical ambiguity and leaves no entities", async () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const material = store.createObject({ canonicalName: "水", role: "material" });
    const importId = randomUUID();
    const prepared = await store.prepareSampleImport({ importId, attachmentIds: [png.id] });
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

  it("rejects unknown fields, CAS conflicts and stale attempts", async () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const importId = randomUUID();
    const prepared = await store.prepareSampleImport({ importId, attachmentIds: [png.id] });
    await expect(
      store.prepareSampleImport({
        importId: randomUUID(),
        attachmentIds: [png.id],
        surprise: true,
      } as any),
    ).rejects.toThrowError(/未知字段/);
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

  it("issues a new attempt on retry and rejects the late old attempt", async () => {
    const { store } = setup();
    const png = store.saveAttachment(PNG, "a.png", "image/png");
    const importId = randomUUID();
    const prepared = await store.prepareSampleImport({ importId, attachmentIds: [png.id] });
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
    async (phase) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-recovery-"));
      roots.push(root);
      let store = new WorkbenchStore({ dataDir: root });
      const png = store.saveAttachment(PNG, "a.png", "image/png");
      const material = store.createObject({ canonicalName: "水", role: "material" });
      const importId = randomUUID();
      const prepared = await store.prepareSampleImport({ importId, attachmentIds: [png.id] });
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
      const receipt = (view as any).receipt;
      const data = reopened.getData(receipt.sourceDataId);
      expect(receipt.sourceDataVersion).toBe(data.version);
    },
  );
});
