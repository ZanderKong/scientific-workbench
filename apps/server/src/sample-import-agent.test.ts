import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildImportRuntimeConfig,
  checkImportReadiness,
  ImportAgentRuntime,
  profileHashOf,
  importPolicyHash,
  repositoryRoot,
  type VerifiedImportCapability,
} from "./sample-import-agent";

const roots: string[] = [];
const runtimes: ImportAgentRuntime[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-agent-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-import-agent`, { recursive: true, force: true });
  }
});

function makeRuntime(root: string, overrides: Record<string, unknown> = {}) {
  let stopped = false;
  const runtime = new ImportAgentRuntime({
    dataDir: root,
    repoRoot: repositoryRoot(),
    workbenchBaseUrl: "http://127.0.0.1:45999/api/v1",
    workbenchToken: "workbench-token-secret",
    model: "deepseek/deepseek-v4-flash-vision-exp",
    importId: "11111111-1111-4111-8111-111111111111",
    attemptId: "22222222-2222-4222-8222-222222222222",
    port: 45991,
    launcher: async () => ({
      pid: 4242,
      stop: async () => {
        stopped = true;
      },
    }),
    ...overrides,
  });
  runtimes.push(runtime);
  return { runtime, wasStopped: () => stopped };
}

describe("import runtime profile", () => {
  it("denies built-in capabilities and scopes the workbench MCP to one import", () => {
    const text = buildImportRuntimeConfig({
      repoRoot: "/repo",
      model: "deepseek/deepseek-v4-flash-vision-exp",
      importId: "11111111-1111-4111-8111-111111111111",
      attemptId: "22222222-2222-4222-8222-222222222222",
      workbenchBaseUrl: "http://127.0.0.1:45999/api/v1",
      workbenchToken: "token-value",
    });
    const config = JSON.parse(text);
    expect(config.permission.read).toBe("deny");
    expect(config.permission.bash).toBe("deny");
    expect(config.permission.webfetch).toBe("deny");
    expect(config.permission.task).toBe("deny");
    expect(config.permission.question).toBe("allow");
    expect(config.permission["scientific-workbench*"]).toBe("allow");
    const mcp = config.mcp["scientific-workbench"];
    expect(mcp.type).toBe("local");
    expect(mcp.environment.WORKBENCH_IMPORT_SCOPE).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mcp.environment.WORKBENCH_IMPORT_ATTEMPT).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    // The MCP filter is the second line of defence, not the runtime config only.
    expect(mcp.command.join(" ")).toContain("apps/mcp/src/main.ts");
  });

  it("writes the profile privately and keeps the token out of anything public", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    expect(status.state).toBe("ready");
    expect(status.baseUrl).toBe("http://127.0.0.1:45991");
    const mode = fs.statSync(status.configPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(status.configPath, "utf8")).toContain(
      "workbench-token-secret",
    );
    // The reported status never carries the token or the loopback password.
    expect(JSON.stringify(status)).not.toContain("workbench-token-secret");
    expect(JSON.stringify(status)).not.toContain(runtime.password);
    // The managed agent runs in its own directory tree outside the scientific
    // data directory, and never in a user-global OpenCode location.
    expect(status.executionDir.startsWith(root + path.sep)).toBe(false);
    expect(
      path
        .dirname(status.executionDir)
        .startsWith(fs.realpathSync(path.dirname(root)) + path.sep),
    ).toBe(true);
    expect(status.profileHash).toBe(
      profileHashOf(fs.readFileSync(status.configPath, "utf8")),
    );
  });
});

describe("attempt isolation boundaries", () => {
  it("coalesces concurrent initialization and rejects changed binding without overwriting", async () => {
    const root = setup();
    let launches = 0;
    const { runtime } = makeRuntime(root, {
      launcher: async () => {
        launches++;
        return { pid: 1, stop: async () => {} };
      },
    });
    const [a, b] = await Promise.all([runtime.ensure(), runtime.ensure()]);
    expect(a).toEqual(b);
    expect(launches).toBe(1);
    const before = fs.readFileSync(a.configPath, "utf8");
    const other = makeRuntime(root, {
      workbenchToken: "different-private-token",
    }).runtime;
    await expect(other.ensure()).rejects.toThrow(/绑定/);
    expect(fs.readFileSync(a.configPath, "utf8")).toBe(before);
  });

  it("normalizes only declared bindings and retains unknown configuration", async () => {
    const root = setup();
    const first = makeRuntime(root).runtime;
    const second = makeRuntime(root, {
      attemptId: "55555555-5555-4555-8555-555555555555",
      workbenchToken: "new-secret",
    }).runtime;
    await first.ensure();
    await second.ensure();
    expect(first.policyHash()).toBe(second.policyHash());
    const config = JSON.parse(
      fs.readFileSync(first.status().configPath, "utf8"),
    );
    config.mcp["scientific-workbench"].environment.EXTRA = "unknown";
    expect(importPolicyHash(JSON.stringify(config))).not.toBe(
      first.policyHash(),
    );
  });

  it("rejects path traversal identities before writing", () => {
    const root = setup();
    expect(() => makeRuntime(root, { attemptId: "../../escape" })).toThrow(
      /UUID/,
    );
  });
});

describe("attached mode", () => {
  it("pins the profile in the managed execution directory without starting a process", async () => {
    const root = setup();
    const { runtime, wasStopped } = makeRuntime(root, {
      endpoint: {
        baseUrl: "http://127.0.0.1:4199",
        username: "opencode",
        password: "attachment-password",
      },
    });
    const status = await runtime.ensure();
    expect(status.state).toBe("ready");
    expect(status.baseUrl).toBe("http://127.0.0.1:4199");
    expect(status.pid).toBeUndefined();
    const workspaceConfig = path.join(status.executionDir, "opencode.jsonc");
    expect(status.configPath).toBe(workspaceConfig);
    expect(fs.statSync(workspaceConfig).mode & 0o777).toBe(0o600);
    const profile = JSON.parse(fs.readFileSync(workspaceConfig, "utf8"));
    expect(profile.permission.read).toBe("deny");
    expect(
      profile.mcp["scientific-workbench"].environment.WORKBENCH_IMPORT_SCOPE,
    ).toBe("11111111-1111-4111-8111-111111111111");
    const config = runtime.config();
    expect(config.baseUrl).toBe("http://127.0.0.1:4199");
    expect(config.password).toBe("attachment-password");
    expect(config.executionDir).toBe(status.executionDir);
    await runtime.stop();
    expect(wasStopped()).toBe(false);
  });
});

describe("import readiness", () => {
  const capability = (profileHash: string): VerifiedImportCapability => ({
    schema: "swb.import-capability/2",
    bundleHash: "bundle",
    checks: Object.fromEntries(
      [
        "isolation",
        "runtimeIdentityAndModel",
        "asyncSubmission",
        "correlatedImageAnswer",
        "restrictedAllow",
        "restrictedDeny",
        "noSensitiveWorkbenchLeakage",
      ].map((key) => [key, "PASS" as const]),
    ),
    flavor: "v1",
    version: "1.18.31",
    model: "deepseek/deepseek-v4-flash-vision-exp",
    transport: "/session/:id/prompt_async",
    profileHash,
    verifiedAt: "2026-09-21T00:00:00.000Z",
    evidence: "docs/VERIFICATION.md#s2",
  });
  const probeWith =
    (overrides: Record<string, unknown> = {}) =>
    async () => ({
      flavor: "v1" as const,
      version: "1.18.31",
      models: [
        {
          providerId: "deepseek",
          modelId: "deepseek-v4-flash-vision-exp",
          supportsImage: true as const,
        },
      ],
      ...overrides,
    });

  it("is not ready before the managed profile exists", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const result = await checkImportReadiness({
      runtime,
      dataDir: root,
      bundleHash: "bundle",
    });
    expect(result).toMatchObject({
      ready: false,
      reasonCode: "PROFILE_MISSING",
    });
  });

  it("rejects missing capability, missing bundle and a different provider", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    const base = {
      runtime,
      dataDir: root,
      probe: probeWith(),
      bundleHash: "bundle",
    };
    expect.soft((await checkImportReadiness(base)).ready).toBe(false);
    expect
      .soft(
        (
          await checkImportReadiness({
            ...base,
            capability: capability(runtime.policyHash()),
            bundleHash: undefined,
          })
        ).ready,
      )
      .toBe(false);
    expect
      .soft(
        (
          await checkImportReadiness({
            ...base,
            capability: capability(runtime.policyHash()),
            probe: probeWith({
              models: [
                {
                  providerId: "other",
                  modelId: "deepseek-v4-flash-vision-exp",
                  supportsImage: true,
                },
              ],
            }),
          })
        ).ready,
      )
      .toBe(false);
  });

  it("does not trust a cached profile hash after disk changes", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    fs.writeFileSync(status.configPath, "{}");
    expect(
      (
        await checkImportReadiness({
          runtime,
          dataDir: root,
          bundleHash: "bundle",
          capability: capability(runtime.policyHash()),
          probe: probeWith(),
        })
      ).ready,
    ).toBe(false);
  });

  it("keeps two attempts in different directories without overwriting", async () => {
    const root = setup();
    const first = makeRuntime(root).runtime;
    const second = makeRuntime(root, {
      importId: "33333333-3333-4333-8333-333333333333",
      attemptId: "44444444-4444-4444-8444-444444444444",
    }).runtime;
    const a = await first.ensure();
    const before = fs.readFileSync(a.configPath, "utf8");
    const b = await second.ensure();
    expect(b.configPath).not.toBe(a.configPath);
    expect(fs.readFileSync(a.configPath, "utf8")).toBe(before);
  });

  it("is ready only for the verified combination", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    const result = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability(runtime.policyHash()),
      bundleHash: "bundle",
      probe: probeWith({
        effectivePolicyHash: runtime.policyHash(),
        transport: "/session/:id/prompt_async",
      }),
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      ready: true,
      reasonCode: "READY",
      model: "deepseek/deepseek-v4-flash-vision-exp",
      version: "1.18.31",
    });
  });

  it("re-evaluates when the profile, version or model drifts", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    const stale = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability("0".repeat(64)),
      bundleHash: "bundle",
      probe: probeWith({
        effectivePolicyHash: runtime.policyHash(),
        transport: "/session/:id/prompt_async",
      }),
    });
    expect(stale).toMatchObject({
      ready: false,
      reasonCode: "CAPABILITY_STALE",
    });
    const drifted = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability(runtime.policyHash()),
      bundleHash: "bundle",
      probe: probeWith({ version: "1.19.0" }),
    });
    expect(drifted).toMatchObject({
      ready: false,
      reasonCode: "VERSION_UNSUPPORTED",
    });
    const missing = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability(runtime.policyHash()),
      bundleHash: "bundle",
      probe: probeWith({ models: [] }),
    });
    expect(missing).toMatchObject({
      ready: false,
      reasonCode: "MODEL_MISSING",
    });
    const noImage = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability(runtime.policyHash()),
      bundleHash: "bundle",
      probe: probeWith({
        models: [
          {
            providerId: "deepseek",
            modelId: "deepseek-v4-flash-vision-exp",
            supportsImage: "unknown" as const,
          },
        ],
      }),
    });
    expect(noImage).toMatchObject({
      ready: false,
      reasonCode: "MODEL_WITHOUT_IMAGE",
    });
  });

  it("reports an unreachable runtime instead of assuming readiness", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    const status = await runtime.ensure();
    const result = await checkImportReadiness({
      runtime,
      dataDir: root,
      capability: capability(runtime.policyHash()),
      bundleHash: "bundle",
      probe: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(result).toMatchObject({
      ready: false,
      reasonCode: "RUNTIME_UNREACHABLE",
    });
  });

  it("refuses an execution directory outside the private managed root", async () => {
    const root = setup();
    const { runtime } = makeRuntime(root);
    await runtime.ensure();
    const status = {
      ...runtime.status(),
      executionDir: path.join(root, "elsewhere"),
    };
    const guarded = new ImportAgentRuntime({
      dataDir: root,
      repoRoot: repositoryRoot(),
      workbenchBaseUrl: "http://127.0.0.1:45999/api/v1",
      workbenchToken: "workbench-token-secret",
      model: "deepseek/deepseek-v4-flash-vision-exp",
      importId: "11111111-1111-4111-8111-111111111111",
      attemptId: "22222222-2222-4222-8222-222222222222",
      launcher: async () => ({ pid: 1, stop: async () => {} }),
    });
    runtimes.push(guarded);
    await guarded.ensure();
    Object.defineProperty(guarded, "status", { value: () => status });
    Object.defineProperty(guarded, "config", { value: () => runtime.config() });
    const result = await checkImportReadiness({
      runtime: guarded,
      dataDir: root,
      bundleHash: "bundle",
      probe: probeWith({
        effectivePolicyHash: runtime.policyHash(),
        transport: "/session/:id/prompt_async",
      }),
    });
    expect(result).toMatchObject({
      ready: false,
      reasonCode: "EXECUTION_DIR_NOT_ISOLATED",
    });
  });
});
