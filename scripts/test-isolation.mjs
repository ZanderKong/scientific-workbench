import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTestEnvironment() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "swb-acceptance-"));
  const port = 14317;
  return { workspace, port, origin: `http://127.0.0.1:${port}` };
}
