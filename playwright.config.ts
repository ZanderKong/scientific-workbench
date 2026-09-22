import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Playwright workers inherit the exact workspace chosen by the parent process.
const workspace =
  process.env.SWB_ACCEPTANCE_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "swb-acceptance-"));
process.env.SWB_ACCEPTANCE_DIR = workspace;
const port = 14317;
const apiToken = process.env.SWB_ACCEPTANCE_TOKEN ?? crypto.randomUUID();
process.env.SWB_ACCEPTANCE_TOKEN = apiToken;
// The AI import acceptance replaces the managed OpenCode runtime with the local
// V1 fake, so the server needs an endpoint plus a private credential file. The
// fake ignores credentials, and the file only exists for this acceptance run.
const importRuntimeUrl =
  process.env.SWB_IMPORT_RUNTIME_URL ?? "http://127.0.0.1:14319";
process.env.SWB_IMPORT_RUNTIME_URL = importRuntimeUrl;
const importEnvFile = `${workspace}-import-runtime.env`;
fs.writeFileSync(
  importEnvFile,
  "OPENCODE_SERVER_USERNAME=workbench-import\nOPENCODE_SERVER_PASSWORD=acceptance-only\n",
  { mode: 0o600 },
);
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, extraHTTPHeaders: { Authorization: `Bearer ${apiToken}` } },
  webServer: {
    command: "pnpm --filter @workbench/server start",
    env: {
      WORKBENCH_DATA_DIR: workspace,
      WORKBENCH_PORT: String(port),
      WORKBENCH_ACCEPTANCE: "1",
      WORKBENCH_API_TOKEN: apiToken,
      WORKBENCH_AGENT_POLL_MS: "300",
      WORKBENCH_AGENT_UNHEALTHY_POLL_MS: "200",
      WORKBENCH_IMPORT_OPENCODE_URL: importRuntimeUrl,
      WORKBENCH_IMPORT_ENV_FILE: importEnvFile,
      WORKBENCH_IMPORT_RUNTIME_STUB: "1",
    },
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
