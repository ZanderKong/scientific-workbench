/**
 * CLI integration tests: the real entry point is executed in a subprocess so
 * the dependency boundary, the opt-in guard, the endpoint plumbing and the
 * temporary-resource cleanup are exercised for real. Every SWB_SPIKE_* variable
 * is explicitly controlled so a user's real endpoint or credentials can never
 * be inherited, and no real model is ever called.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { countRedRegions } from "./vision-spike";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = path.join(repoRoot, "scripts", "spike-opencode-vision.mts");
const SWB_VARS = [
  "SWB_VISION_SPIKE",
  "SWB_SPIKE_OPENCODE_URL",
  "SWB_SPIKE_OPENCODE_USERNAME",
  "SWB_SPIKE_OPENCODE_PASSWORD",
  "SWB_SPIKE_ALLOW_TOOLS",
  "SWB_SPIKE_ARTIFACT_DIR",
];

function envFor(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of SWB_VARS) delete env[name];
  return { ...env, ...overrides };
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  overrides: Record<string, string>,
  args: string[] = [cliPath],
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      cwd: repoRoot,
      env: envFor(overrides),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

class FakeEndpoint {
  server!: http.Server;
  baseUrl = "";
  paths: string[] = [];
  asyncPromptCalls = 0;
  syncPromptCalls = 0;
  active = new Set<string>();
  private sequence = 0;
  private messages = new Map<string, any[]>();
  /**
   * Replies are queued at submit time and only materialise on a later read, so
   * the endpoint behaves asynchronously without any timer deciding the
   * outcome: the read right after submit never sees the answer, while the
   * following poll does.
   */
  private queued = new Map<string, any[]>();
  /** List reads observed since the newest queued reply was queued. */
  private queuedReads = new Map<string, number>();

  async start() {
    this.server = http.createServer((request, response) =>
      void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
  private push(sessionId: string, role: string, parts: unknown[], info: Record<string, unknown>) {
    const list = this.messages.get(sessionId) ?? [];
    list.push({ info, parts });
    this.messages.set(sessionId, list);
  }
  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    this.paths.push(url.pathname);
    const send = (status: number, body?: unknown) => {
      if (status === 204) {
        response.writeHead(status);
        response.end();
        return;
      }
      const text = JSON.stringify(body ?? {});
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      });
      response.end(text);
    };
    if (method === "GET" && url.pathname === "/global/health")
      return send(200, { healthy: true, version: "1.18.31" });
    if (method === "GET" && url.pathname === "/config/providers")
      return send(200, {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              claude: {
                id: "claude",
                providerID: "anthropic",
                capabilities: { attachment: true },
              },
            },
          },
        ],
      });
    if (method === "GET" && url.pathname === "/permission") return send(200, []);
    if (method === "GET" && url.pathname === "/session/status") {
      const data: Record<string, unknown> = {};
      for (const id of this.queued.keys()) data[id] = { type: "busy" };
      for (const id of this.active) data[id] = { type: "busy" };
      return send(200, data);
    }
    if (method === "POST" && url.pathname === "/session") {
      const body = await readBody(request);
      const id = `ses_${++this.sequence}`;
      this.messages.set(id, []);
      return send(200, {
        id,
        title: body.title,
        directory: request.headers["x-opencode-directory"],
      });
    }
    if (
      method === "POST" &&
      segments[0] === "session" &&
      segments[2] === "prompt_async"
    ) {
      this.asyncPromptCalls++;
      const body = await readBody(request);
      const sessionId = segments[1];
      const messageId = String(body.messageID);
      const image = (body.parts as any[]).find((part) => part.type === "file");
      this.push(sessionId, "user", body.parts, {
        id: messageId,
        role: "user",
        time: { created: Date.now() },
      });
      const queued: any[] = [];
      if (image) {
        // The fake reads the pixels itself, so the image answers are genuine.
        const decoded = Buffer.from(String(image.url).split(",")[1] ?? "", "base64");
        const raw = await sharp(decoded)
          .raw()
          .toBuffer({ resolveWithObject: true });
        const count = countRedRegions(raw.data, raw.info.width, raw.info.height);
        queued.push({
          info: {
            id: `msg_a_${++this.sequence}`,
            role: "assistant",
            parentID: messageId,
            time: { created: Date.now(), completed: Date.now() },
          },
          parts: [{ type: "text", text: `${count}` }],
        });
      } else {
        // A refusal-with-evidence reply for every restricted probe, referring
        // to the operation it was supposed to perform.
        queued.push({
          info: {
            id: `msg_a_${++this.sequence}`,
            role: "assistant",
            parentID: messageId,
            time: { created: Date.now(), completed: Date.now() },
          },
          parts: [
            { type: "text", text: "该操作被拒绝。" },
            {
              type: "tool",
              tool: "bash",
              state: {
                status: "error",
                error: "permission denied by policy",
                input: { request: body.parts },
              },
            },
          ],
        });
      }
      this.queued.set(sessionId, queued);
      this.queuedReads.set(sessionId, 0);
      return send(204);
    }
    if (
      method === "POST" &&
      segments[0] === "session" &&
      segments[2] === "message"
    ) {
      this.syncPromptCalls++;
      return send(200, { id: "msg_sync" });
    }
    if (method === "GET" && segments[0] === "session" && segments[2] === "message") {
      const sessionId = segments[1];
      const entries = this.queued.get(sessionId);
      if (entries?.length) {
        const reads = (this.queuedReads.get(sessionId) ?? 0) + 1;
        this.queuedReads.set(sessionId, reads);
        // The read right after submit must not see the answer; the poll does.
        if (reads >= 2) {
          const list = this.messages.get(sessionId) ?? [];
          list.push(...entries);
          this.messages.set(sessionId, list);
          this.queued.delete(sessionId);
        }
      }
      return send(200, this.messages.get(sessionId) ?? []);
    }
    if (method === "GET" && segments[0] === "session" && segments.length === 2)
      return send(200, {
        id: segments[1],
        directory: request.headers["x-opencode-directory"],
      });
    return send(404, { name: "NotFoundError" });
  }
}

function readBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function freeClosedPort() {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function spikeTempDirs() {
  return fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("swb-vision-"));
}

const endpoints: FakeEndpoint[] = [];
afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.stop();
});

describe("vision spike CLI", () => {
  it("makes no request at all without the explicit opt-in", async () => {
    const before = spikeTempDirs();
    const result = await runCli({});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("NOT VERIFIED");
    expect(result.stderr).toContain("SWB_VISION_SPIKE=1");
    expect(spikeTempDirs()).toEqual(before);
  }, 30000);

  it("reports NOT VERIFIED with zero requests when no isolated endpoint is given", async () => {
    const endpoint = await new FakeEndpoint().start();
    endpoints.push(endpoint);
    const before = spikeTempDirs();
    const result = await runCli({ SWB_VISION_SPIKE: "1" });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("NOT VERIFIED");
    expect(result.stderr).toContain("SWB_SPIKE_OPENCODE_URL");
    expect(endpoint.paths).toEqual([]);
    expect(spikeTempDirs()).toEqual(before);
  }, 30000);

  it("reaches an isolated fake endpoint without a dependency-resolution failure", async () => {
    const endpoint = await new FakeEndpoint().start();
    endpoints.push(endpoint);
    const before = spikeTempDirs();
    const result = await runCli({
      SWB_VISION_SPIKE: "1",
      SWB_SPIKE_OPENCODE_URL: endpoint.baseUrl,
      SWB_SPIKE_OPENCODE_PASSWORD: "integration-password",
    });
    expect(result.stderr).not.toContain("Cannot find package 'sharp'");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(endpoint.paths).toContain("/global/health");
    expect(endpoint.paths).toContain("/config/providers");
    expect(endpoint.asyncPromptCalls).toBeGreaterThan(0);
    expect(endpoint.syncPromptCalls).toBe(0);
    const report = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
    expect(report.schema).toBe("swb.vision-spike/2");
    expect(report.isolation.sessionDirectoryMatches).toBe(true);
    expect(report.checks.isolation.status).toBe("PASS");
    expect(report.checks.correlatedImageAnswer.status).toBe("PASS");
    expect(report.checks.restrictedDeny.status).toBe("PASS");
    expect(report.checks.restrictedAllow.status).toBe("NOT VERIFIED");
    expect(report.checks.noSensitiveWorkbenchLeakage.status).toBe(
      "NOT VERIFIED",
    );
    expect(report.conclusion).toBe("NOT VERIFIED");
    expect(result.stderr).not.toContain("integration-password");
    expect(spikeTempDirs()).toEqual(before);
  }, 60000);

  it("reports a failure conclusion when the fake endpoint is unreachable", async () => {
    const port = await freeClosedPort();
    const before = spikeTempDirs();
    const result = await runCli({
      SWB_VISION_SPIKE: "1",
      SWB_SPIKE_OPENCODE_URL: `http://127.0.0.1:${port}`,
    });
    const report = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
    expect(report.conclusion).not.toBe("PASS");
    expect(report.reason).toContain("无法连接 OpenCode Server");
    expect(spikeTempDirs()).toEqual(before);
  }, 30000);

  it("does not run the probe when the module is only imported", async () => {
    const endpoint = await new FakeEndpoint().start();
    endpoints.push(endpoint);
    const probeFile = path.join(
      os.tmpdir(),
      `swb-spike-import-${Date.now()}.mts`,
    );
    fs.writeFileSync(
      probeFile,
      `const mod = await import(${JSON.stringify(cliPath)});\nconsole.log("imported", typeof mod.main);\n`,
    );
    try {
      const result = await new Promise<CliResult>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", probeFile], {
          cwd: repoRoot,
          env: envFor({
            SWB_VISION_SPIKE: "1",
            SWB_SPIKE_OPENCODE_URL: endpoint.baseUrl,
          }),
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
      expect(result.stdout).toContain("imported function");
      expect(result.code).toBe(0);
      expect(endpoint.paths).toEqual([]);
    } finally {
      fs.rmSync(probeFile, { force: true });
    }
  }, 30000);
});
