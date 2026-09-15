import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blockLines, stripInternalMarkers } from "@workbench/core";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchStore } from "./store";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PVA demonstration workspace", () => {
  it("generates the complete workflow and remains sufficient after deleting SQLite", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-demo-test-"));
    const destination = path.join(root, "workspace");
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    temporaryRoots.push(root);

    execFileSync(
      path.join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [path.join(repositoryRoot, "scripts", "create-demo.ts")],
      {
        cwd: repositoryRoot,
        env: { ...process.env, WORKBENCH_DEMO_DIR: destination },
        stdio: "pipe",
      },
    );

    let store = new WorkbenchStore({ dataDir: destination });
    try {
      const samples = store.listSamples();
      expect(samples.map((sample) => sample.code).sort()).toEqual([
        "Draft-01",
        "PVA-01",
        "PVA-03",
        "PVA-EG",
      ]);

      const pva03 = samples.find((sample) => sample.code === "PVA-03")!;
      const operations = blockLines(pva03.document.body).filter(
        (block) => block.indent === 0,
      );
      expect(operations).toHaveLength(8);
      expect(new Set(operations.map((block) => block.id)).size).toBe(8);
      expect(
        operations.filter((block) => block.text.includes("使用 [冻结]")),
      ).toHaveLength(3);
      expect(
        operations.filter((block) => block.text.includes("使用 [解冻]")),
      ).toHaveLength(3);

      const imported = store
        .listData()
        .find((data) => data.name === "Import-01")!;
      expect(imported.aboutSampleIds).toHaveLength(2);
      expect(imported.components).toHaveLength(2);
      expect(
        imported.components.map((component) => component.role).sort(),
      ).toEqual(["documentation", "raw"]);

      const analysis = store
        .listAnalyses()
        .find((item) => item.title.startsWith("Analysis-01"))!;
      expect(analysis.itemIds).toHaveLength(4);
      expect(analysis.attachmentIds).toHaveLength(1);

      const claim = store.listClaims()[0];
      expect(claim.hostType).toBe("analysis");
      expect(claim.hostId).toBe(analysis.id);
      expect(claim.evidence).toHaveLength(1);
      expect(Object.keys(claim.evidence[0].documents ?? {})).toHaveLength(
        claim.evidence[0].manifest?.entities.length ?? 0,
      );

      const draft = samples.find((sample) => sample.code === "Draft-01")!;
      expect(stripInternalMarkers(draft.document.body)).toContain(
        "[论点] 这里只作为文本保存",
      );
      expect(store.listClaims()).toHaveLength(1);

      const exportDirectory = path.join(destination, "exports", analysis.id);
      expect(
        fs.readFileSync(path.join(exportDirectory, "context.md"), "utf8"),
      ).toContain("第 3 次使用 [冻结]");
      expect(
        JSON.parse(
          fs.readFileSync(path.join(exportDirectory, "manifest.json"), "utf8"),
        ).entities.length,
      ).toBeGreaterThan(4);
    } finally {
      store.close();
    }

    fs.rmSync(path.join(destination, "index"), { recursive: true });
    store = new WorkbenchStore({ dataDir: destination });
    try {
      expect(store.listSamples()).toHaveLength(4);
      expect(store.listData()).toHaveLength(4);
      expect(store.listAnalyses()).toHaveLength(1);
      expect(store.listClaims()).toHaveLength(1);
      expect(
        Object.keys(store.listClaims()[0].evidence[0].documents ?? {}).length,
      ).toBeGreaterThan(4);
    } finally {
      store.close();
    }
  }, 15_000);

  it("refuses to overwrite an existing destination", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-demo-existing-"));
    const destination = path.join(root, "workspace");
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    temporaryRoots.push(root);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "keep.txt"), "must remain");

    expect(() =>
      execFileSync(
        path.join(repositoryRoot, "node_modules", ".bin", "tsx"),
        [path.join(repositoryRoot, "scripts", "create-demo.ts")],
        {
          cwd: repositoryRoot,
          env: { ...process.env, WORKBENCH_DEMO_DIR: destination },
          stdio: "pipe",
        },
      ),
    ).toThrow();
    expect(fs.readFileSync(path.join(destination, "keep.txt"), "utf8")).toBe(
      "must remain",
    );
  });
});
