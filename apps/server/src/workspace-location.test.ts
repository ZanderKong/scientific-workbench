import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveWorkspaceLocation,
  selectWorkspaceForNextStart,
} from "./workspace-location";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace launch selection", () => {
  it("selects a verified restored workspace for the next start", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-location-"));
    const target = path.join(root, "restored");
    const selectionFile = path.join(root, "config", "runtime.json");
    roots.push(root);
    fs.mkdirSync(path.join(target, "registry"), { recursive: true });
    fs.writeFileSync(
      path.join(target, "registry", "workspace.json"),
      JSON.stringify({ schema: "swb.workspace/2", id: "restored" }),
    );

    expect(
      selectWorkspaceForNextStart(target, {
        WORKBENCH_RUNTIME_CONFIG: selectionFile,
      }),
    ).toMatchObject({ selected: true, selectionFile });
    expect(
      resolveWorkspaceLocation({ WORKBENCH_RUNTIME_CONFIG: selectionFile }),
    ).toMatchObject({ dataDir: target, source: "selection" });
    expect(fs.statSync(selectionFile).mode & 0o777).toBe(0o600);
  });

  it("does not override an explicitly configured data directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-location-env-"));
    const target = path.join(root, "restored");
    const fixed = path.join(root, "fixed");
    const selectionFile = path.join(root, "runtime.json");
    roots.push(root);
    fs.mkdirSync(path.join(target, "registry"), { recursive: true });
    fs.writeFileSync(
      path.join(target, "registry", "workspace.json"),
      JSON.stringify({ schema: "swb.workspace/2", id: "restored" }),
    );

    expect(
      selectWorkspaceForNextStart(target, {
        WORKBENCH_RUNTIME_CONFIG: selectionFile,
        WORKBENCH_DATA_DIR: fixed,
      }),
    ).toMatchObject({ selected: false });
    expect(fs.existsSync(selectionFile)).toBe(false);
  });
});
