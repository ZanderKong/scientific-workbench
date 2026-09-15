import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface WorkspaceLocation {
  dataDir: string;
  source: "environment" | "selection" | "default";
  selectionFile: string;
}

export function workspaceSelectionFile(environment = process.env) {
  return path.resolve(
    environment.WORKBENCH_RUNTIME_CONFIG ??
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "ScientificWorkbench",
        "runtime.json",
      ),
  );
}

export function resolveWorkspaceLocation(
  environment = process.env,
): WorkspaceLocation {
  const selectionFile = workspaceSelectionFile(environment);
  if (environment.WORKBENCH_DATA_DIR) {
    return {
      dataDir: path.resolve(environment.WORKBENCH_DATA_DIR),
      source: "environment",
      selectionFile,
    };
  }
  if (fs.existsSync(selectionFile)) {
    const selection = JSON.parse(fs.readFileSync(selectionFile, "utf8")) as {
      schema?: string;
      dataDir?: string;
    };
    if (
      selection.schema !== "swb.runtime/1" ||
      typeof selection.dataDir !== "string" ||
      !path.isAbsolute(selection.dataDir)
    ) {
      throw new Error(`工作区启动配置无效：${selectionFile}`);
    }
    return {
      dataDir: path.resolve(selection.dataDir),
      source: "selection",
      selectionFile,
    };
  }
  return {
    dataDir: path.join(os.homedir(), "ScientificWorkbench"),
    source: "default",
    selectionFile,
  };
}

export function selectWorkspaceForNextStart(
  dataDir: string,
  environment = process.env,
) {
  const target = path.resolve(dataDir);
  const marker = path.join(target, "registry", "workspace.json");
  if (!fs.existsSync(marker)) throw new Error("恢复目录缺少工作区登记");
  const workspace = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    schema?: string;
  };
  if (workspace.schema !== "swb.workspace/2") {
    throw new Error("恢复目录不是当前工作区格式");
  }
  if (environment.WORKBENCH_DATA_DIR) {
    return {
      selected: false as const,
      reason: "WORKBENCH_DATA_DIR 环境变量固定了当前启动目录",
    };
  }
  const selectionFile = workspaceSelectionFile(environment);
  fs.mkdirSync(path.dirname(selectionFile), { recursive: true, mode: 0o700 });
  const pending = `${selectionFile}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(
    pending,
    JSON.stringify({ schema: "swb.runtime/1", dataDir: target }),
    { mode: 0o600, flag: "wx" },
  );
  const descriptor = fs.openSync(pending, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(pending, selectionFile);
  fs.chmodSync(selectionFile, 0o600);
  return { selected: true as const, selectionFile };
}
