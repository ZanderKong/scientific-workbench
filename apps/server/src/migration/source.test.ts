import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LegacySource, safeFile } from "./source";

it("detects source changes and rejects symlink traversal without opening external files", async () => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "swb-migration-source-"),
  );
  const root = fs.realpathSync(parent);
  fs.mkdirSync(path.join(root, "samples"));
  fs.mkdirSync(path.join(root, "index"));
  fs.writeFileSync(path.join(root, "samples", "a.md"), "original");
  const source = new LegacySource(root);
  try {
    source.directory("samples");
    await source.track("samples/a.md");
    fs.writeFileSync(path.join(root, "samples", "a.md"), "changed");
    await expect(source.unchanged()).rejects.toThrow("来源发生变化");
    fs.writeFileSync(path.join(root, "samples", "a.md"), "original");
    fs.writeFileSync(path.join(root, "samples", "b.md"), "new");
    await expect(source.unchanged()).rejects.toThrow("来源目录发生变化");
    fs.symlinkSync("/etc", path.join(root, "escape"));
    expect(() => safeFile(root, "escape/hosts")).toThrow("符号链接");
    expect(() => safeFile(root, "../outside")).toThrow("越界");
  } finally {
    source.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
