import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { completions } from "../apps/web/src/editor/completion";
import { WorkbenchStore } from "../apps/server/src/store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-performance-"));
const store = new WorkbenchStore({ dataDir: root });

function elapsed<T>(action: () => T) {
  const started = performance.now();
  const value = action();
  return {
    value,
    milliseconds: Number((performance.now() - started).toFixed(2)),
  };
}

try {
  store.createObject({ canonicalName: "水", role: "material" });
  store.createObject({ canonicalName: "搅拌", role: "process" });
  store.createProperty({ canonicalName: "添加量", recommendedUnit: "g" });
  store.createProperty({ canonicalName: "时间", recommendedUnit: "min" });

  const documents = [20, 100, 500].map((operationCount) => {
    const body = Array.from(
      { length: operationCount },
      (_, index) =>
        `- 第 ${index + 1} 次使用 [搅拌]\n  - [水]｜添加量：${index + 1} g\n  - [搅拌]｜时间：30 min`,
    ).join("\n");
    const created = elapsed(() =>
      store.createSample({ code: `PERF-${operationCount}`, body }),
    );
    const finalized = elapsed(() => store.finalizeDocument(created.value.id));
    if (finalized.value.parsed.records.length !== operationCount) {
      throw new Error(`${operationCount} 操作文档提取数量不正确`);
    }
    return {
      operations: operationCount,
      saveMilliseconds: created.milliseconds,
      finalizeMilliseconds: finalized.milliseconds,
    };
  });

  const createdAt = new Date().toISOString();
  const insertObjects = store.db.transaction(() => {
    const object = store.db.prepare(
      "INSERT INTO objects(id,canonical_name,role,created_at,updated_at) VALUES(?,?,?,?,?)",
    );
    const alias = store.db.prepare(
      "INSERT INTO object_aliases(object_id,alias) VALUES(?,?)",
    );
    for (let index = 0; index < 50_000; index++) {
      const id = `performance-object-${String(index).padStart(5, "0")}`;
      object.run(
        id,
        `性能对象-${String(index).padStart(5, "0")}`,
        "material",
        createdAt,
        createdAt,
      );
      if (index % 5 === 0) alias.run(id, `别名-${index}`);
    }
  });
  insertObjects();

  const all = elapsed(() => store.searchObjects());
  const search5k = elapsed(() =>
    completions(all.value.slice(0, 5_000), "性能对象-04990"),
  );
  const search50k = elapsed(() => completions(all.value, "性能对象-49999"));
  if (
    search5k.value[0]?.canonicalName !== "性能对象-04990" ||
    search50k.value[0]?.canonicalName !== "性能对象-49999"
  ) {
    throw new Error("大字典补全没有返回目标对象");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
        },
        documents,
        dictionary: {
          totalObjects: all.value.length,
          load50kMilliseconds: all.milliseconds,
          complete5kMilliseconds: search5k.milliseconds,
          complete50kMilliseconds: search50k.milliseconds,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
