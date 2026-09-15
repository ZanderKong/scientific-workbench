import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  blockLines,
  parseBody,
  type ReferenceOccurrence,
} from "@workbench/core";
import { WorkbenchStore } from "./store";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);

it("persists an intent without an object, then commits its identity once after restart and index rebuild", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-intent-"));
  roots.push(root);
  let store = new WorkbenchStore({ dataDir: root });
  try {
    const sample = store.createSample({
      body: "- [待创建搅拌器]\n  - [待创建搅拌器]｜添加量：5 g",
    });
    const doc = store.readDocument(sample.id);
    const reference = parseBody(sample.id, doc.body).records[0].references[0];
    const intent: ReferenceOccurrence = {
      ...reference,
      status: "create-intent",
      role: "equipment",
      intentId: randomUUID(),
    };
    store.saveDocument(sample.id, doc.body, doc.head.contentVersion, [intent]);
    expect(store.searchObjects("待创建搅拌器")).toHaveLength(0);
    expect(store.readDocument(sample.id).head.references?.[0].intentId).toBe(
      intent.intentId,
    );
    store.close();
    fs.rmSync(path.join(root, "index"), { recursive: true });
    store = new WorkbenchStore({ dataDir: root });
    store.finalizeDocument(sample.id);
    store.finalizeDocument(sample.id);
    const object = store.searchObjects("待创建搅拌器");
    expect(object).toHaveLength(1);
    expect(object[0].id).toBe(intent.intentId);
    expect(object[0].role).toBe("equipment");
    expect(store.getSample(sample.id).properties[0].object_id).toBe(
      object[0].id,
    );
    expect(
      store
        .readDocument(sample.id)
        .head.references?.every(
          (ref) => ref.status === "bound" && !ref.intentId,
        ),
    ).toBe(true);
    const current = store.readDocument(sample.id);
    // An old client retry with the original explicit intent also reuses its identity.
    store.saveDocument(sample.id, current.body, current.head.contentVersion, [
      intent,
    ]);
    store.finalizeDocument(sample.id);
    expect(store.searchObjects("待创建搅拌器")).toHaveLength(1);
  } finally {
    store.close();
  }
});

it.each(["edit", "delete", "invalid-category"])(
  "does not create from a %s intent or from ordinary unmatched text",
  (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-intent-cancel-"));
    roots.push(root);
    const store = new WorkbenchStore({ dataDir: root });
    try {
      const sample = store.createSample({ body: "- [不应创建]\n- 普通记录" });
      const doc = store.readDocument(sample.id);
      const ref = parseBody(sample.id, doc.body).records[0].references[0];
      const intent: ReferenceOccurrence = {
        ...ref,
        status: "create-intent",
        role: mode === "invalid-category" ? "sample" : "process",
        intentId: randomUUID(),
      };
      const body =
        mode === "edit"
          ? doc.body.replace("不应创建", "另一名字")
          : mode === "delete"
            ? `<!-- swb:block id="${blockLines(doc.body)[1].id}" -->\n- 普通记录`
            : doc.body;
      store.saveDocument(sample.id, body, doc.head.contentVersion, [intent]);
      store.finalizeDocument(sample.id);
      expect(
        store.searchObjects().filter((object) => object.role !== "sample"),
      ).toHaveLength(0);
    } finally {
      store.close();
    }
  },
);
