/**
 * Starts the delivered inspection instance for the AI record import.
 *
 * It is the same process the G2 acceptance ran against: an isolated scientific
 * directory, an isolated Workbench port and the already-verified isolated
 * OpenCode runtime. It prints the effective (secret-free) configuration and then
 * runs the server in the foreground, so Ctrl-C is the stop mechanism.
 *
 *   pnpm import:instance
 *   Ctrl-C            stop
 *
 * The menu entry lives in 样品 → 新建样品 右侧的小箭头 → AI 从实验记录新建样品.
 */
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir =
  process.env.WORKBENCH_DATA_DIR ??
  path.join(path.dirname(repoRoot), "ScientificWorkbench-g2-20260923");
const port = process.env.WORKBENCH_PORT ?? "14323";
const host = process.env.WORKBENCH_HOST ?? "127.0.0.1";
const runtimeUrl =
  process.env.WORKBENCH_IMPORT_OPENCODE_URL ?? "http://127.0.0.1:4199";
const envFile =
  process.env.WORKBENCH_IMPORT_ENV_FILE ??
  "/Users/kong/.opencode-acceptance/server.env";
const capabilityFile =
  process.env.WORKBENCH_IMPORT_CAPABILITY_FILE ??
  path.join(repoRoot, "audit/2026-09-22/ai-import/capability.json");

if (!fs.existsSync(dataDir))
  throw new Error(`科研数据目录不存在：${dataDir}`);
if (!fs.existsSync(envFile))
  throw new Error(`导入运行时凭据文件不存在：${envFile}`);
if (fs.existsSync(envFile)) {
  const stat = fs.lstatSync(envFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("导入运行时凭据必须是私密普通文件（0600）");
}
if (!fs.existsSync(capabilityFile))
  throw new Error(`缺少已验证能力记录：${capabilityFile}`);

console.log(
  JSON.stringify(
    {
      url: `http://${host}:${port}/`,
      dataDir,
      importRuntime: runtimeUrl,
      credentialFile: envFile,
      capabilityFile,
      model: "deepseek/deepseek-v4-flash-vision-exp",
      menu: "样品 → ＋新建样品 右侧箭头 → AI 从实验记录新建样品",
      sampleImages: "audit/2026-09-22/ai-import/g2/fixtures",
      note: "关闭弹窗不会取消已开始的任务；完成后点击「刷新样品」手动刷新。",
    },
    null,
    2,
  ),
);

const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(repoRoot, "apps/server/src/main.ts")],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      WORKBENCH_DATA_DIR: dataDir,
      WORKBENCH_PORT: port,
      WORKBENCH_HOST: host,
      WORKBENCH_IMPORT_OPENCODE_URL: runtimeUrl,
      WORKBENCH_IMPORT_ENV_FILE: envFile,
      WORKBENCH_IMPORT_CAPABILITY_FILE: capabilityFile,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
