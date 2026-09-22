import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { WorkbenchStore } from "./store";
import { AgentRunService, type TerminalNotice } from "./agent-runs";
import { defaultOpenCodeConfig } from "./opencode";
import { realImageFixtures } from "./test-images";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0)) await action();
});
it("publishes an actual notice only after a matching real B1 receipt, exactly once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-receipt-notice-"));
  const store = new WorkbenchStore({ dataDir: root });
  const service = new AgentRunService({
    store,
    getConfig: () => defaultOpenCodeConfig(root),
  });
  cleanup.push(async () => {
    await service.shutdown();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const image = store.saveAttachment(
    realImageFixtures().PNG,
    "record.png",
    "image/png",
  );
  const prepared = await store.prepareSampleImport({
    importId: crypto.randomUUID(),
    attachmentIds: [image.id],
  });
  const payload = {
    name: "实验记录导入",
    runtime: "opencode",
    mode: "vision",
    importId: prepared.importId,
    attemptId: prepared.attempt.id,
  };
  const job = store.createJob("sample-import", payload);
  const notices: TerminalNotice[] = [];
  service.subscribe((state) => notices.push(...state.notices));
  expect(service.publishImportReceipt(job.id)).toBe(false);
  expect(notices).toEqual([]);
  store.saveSampleImportDraft(prepared.importId, {
    attemptId: prepared.attempt.id,
    expectedVersion: prepared.recordVersion,
    expectedDraftVersion: 0,
    draft: {
      schemaVersion: 1,
      samples: [
        {
          key: "sample-a",
          title: "模拟观察",
          body: "- 观察到红色方块。",
          references: [],
          sourceMappings: [
            {
              attachmentId: image.id,
              page: 1,
              componentId: prepared.source[0].componentId,
              positions: ["图像区域"],
              transcription: "红色方块",
            },
          ],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    },
  });
  const draft = store.getSampleImport(prepared.importId);
  if (!("draftVersion" in draft)) throw new Error("Expected uncommitted draft");
  store.commitSampleImport(prepared.importId, {
    attemptId: prepared.attempt.id,
    expectedVersion: draft.recordVersion,
    draftVersion: draft.draftVersion!,
    draftHash: draft.draftHash!,
    sourceDataVersion: store.getData(prepared.sourceDataId).version,
    commitFingerprint: draft.commitFingerprint!,
  });
  expect(service.publishImportReceipt(job.id)).toBe(true);
  expect(service.publishImportReceipt(job.id)).toBe(true);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ id: job.id, kind: "completed" });
  expect(JSON.stringify(notices)).not.toContain("红色方块");
  expect(store.listJobs().find((item) => item.id === job.id)?.status).toBe(
    "succeeded",
  );
  const stale = store.createJob("sample-import", {
    ...payload,
    attemptId: crypto.randomUUID(),
  });
  expect(service.publishImportReceipt(stale.id)).toBe(false);
  expect(store.listSamples()).toHaveLength(1);
});
