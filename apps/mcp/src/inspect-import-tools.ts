/** Internal directory-profile verifier; never registered as an MCP tool. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function inspectImportTools(
  profilePath: string,
): Promise<string[]> {
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const entry = profile.mcp?.["scientific-workbench"];
  if (
    entry?.type !== "local" ||
    !Array.isArray(entry.command) ||
    !entry.environment?.WORKBENCH_IMPORT_SCOPE ||
    !entry.environment?.WORKBENCH_IMPORT_ATTEMPT
  )
    throw new Error("Missing scoped local MCP binding");
  const transport = new StdioClientTransport({
    command: entry.command[0],
    args: entry.command.slice(1),
    cwd: entry.cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => typeof pair[1] === "string",
        ),
      ),
      ...entry.environment,
    },
    stderr: "ignore",
  });
  const client = new Client({
    name: "workbench-profile-verifier",
    version: "1",
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    if (result.nextCursor) throw new Error("Incomplete scoped tool table");
    return result.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  inspectImportTools(process.argv[2])
    .then((names) => console.log(JSON.stringify(names)))
    .catch(() => {
      process.exitCode = 1;
    });
}
