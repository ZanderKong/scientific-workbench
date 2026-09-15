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
    },
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
