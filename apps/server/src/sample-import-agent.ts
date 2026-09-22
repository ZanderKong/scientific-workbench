/**
 * Import-specific agent wiring: the restricted runtime profile, the managed
 * runtime process and the readiness check.
 *
 * Everything here is derived from what S2 actually verified for one target
 * combination. It never touches the user's global OpenCode configuration: the
 * profile lives in a dedicated directory under the workbench data directory and
 * is only used to start a loopback-only runtime for this import.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256 } from "@workbench/core";
import {
  createOpenCodeAdapter,
  defaultOpenCodeConfig,
  detectOpenCodeFlavor,
  openCodeAuthHeaders,
  validateOpenCodeBaseUrl,
  type ResolvedOpenCodeConfig,
} from "./opencode";

export const IMPORT_PROFILE_SCHEMA = "swb.import-profile/1";
export const IMPORT_AGENT_DIRNAME = "import-agent";

/** Tools the managed profile permits; everything else is denied by default. */
export const IMPORT_ALLOWED_PERMISSIONS: Record<string, string> = {
  question: "allow",
  todowrite: "allow",
};

/**
 * Capability record for the combination S2 verified. Readiness compares the
 * live runtime against it and re-evaluates on any drift; there is no client
 * switch and no environment variable that can mark a runtime verified.
 */
export interface VerifiedImportCapability {
  schema: "swb.import-capability/2";
  flavor: "v1" | "v2";
  version: string;
  model: string;
  transport: string;
  /** Hash of the generated profile file this capability was verified with. */
  profileHash: string;
  bundleHash: string;
  checks: Record<string, "PASS">;
  verifiedAt: string;
  /** Evidence pointer, kept short and non-sensitive. */
  evidence: string;
}

export function profileHashOf(configText: string): string {
  return sha256(configText);
}

export interface ImportProfileInput {
  repoRoot: string;
  model: string;
  importId: string;
  attemptId: string;
  workbenchBaseUrl: string;
  workbenchToken: string;
  mcpCommand?: string[];
}

/**
 * The restricted profile: every built-in capability that could reach the disk,
 * the network or other scientific entities is denied, while the workbench MCP
 * tools and the Question flow stay available. Denial wins over any generic
 * auto-allow because it is expressed as the instance default.
 */
export function buildImportRuntimeConfig(input: ImportProfileInput): string {
  const command = input.mcpCommand ?? [
    process.execPath,
    "--import",
    "tsx",
    path.join(input.repoRoot, "apps", "mcp", "src", "main.ts"),
  ];
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: input.model,
    default_agent: "build",
    permission: {
      "*": "deny",
      read: "deny",
      edit: "deny",
      write: "deny",
      glob: "deny",
      grep: "deny",
      list: "deny",
      bash: "deny",
      task: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny",
      lsp: "deny",
      skill: "deny",
      ...IMPORT_ALLOWED_PERMISSIONS,
      // MCP tools are permitted by name; the MCP process itself also filters.
      "scientific-workbench*": "allow",
    },
    mcp: {
      "scientific-workbench": {
        type: "local",
        command,
        cwd: input.repoRoot,
        environment: {
          WORKBENCH_API: input.workbenchBaseUrl,
          WORKBENCH_API_TOKEN: input.workbenchToken,
          WORKBENCH_IMPORT_SCOPE: input.importId,
          WORKBENCH_IMPORT_ATTEMPT: input.attemptId,
        },
        enabled: true,
      },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export interface ImportAgentRuntimeOptions {
  dataDir: string;
  repoRoot: string;
  workbenchBaseUrl: string;
  workbenchToken: string;
  model: string;
  importId: string;
  attemptId: string;
  /**
   * Attach to an already running isolated runtime instead of starting one.
   * The restricted profile is then applied per managed execution directory
   * through the workspace config, so the user's global configuration is never
   * touched and no second runtime has to be launched. S2 verified that a
   * workspace config is loaded per directory on the target flavor.
   */
  endpoint?: { baseUrl: string; username?: string; password?: string };
  /** Test-only: replaces the real process launcher. */
  launcher?: (input: {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<{ pid: number; stop: () => Promise<void> }>;
  /** Test-only: overrides the port chosen for the managed instance. */
  port?: number;
}

export interface ImportAgentStatus {
  state: "stopped" | "starting" | "ready" | "failed";
  baseUrl?: string;
  pid?: number;
  executionDir: string;
  configPath: string;
  profileHash?: string;
  detail?: string;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Owns one managed OpenCode instance for one import attempt. The instance uses
 * its own XDG directories and the generated profile, so nothing here depends on
 * or modifies the user's OpenCode installation or configuration.
 */
export class ImportAgentRuntime {
  private child?: ChildProcess;
  private stopHook?: () => Promise<void>;
  private readonly root: string;
  private readonly executionDir: string;
  private readonly configDir: string;
  private readonly configPath: string;
  private readonly workspaceConfigPath: string;
  private state: ImportAgentStatus["state"] = "stopped";
  private detail?: string;
  private url?: string;
  private pid?: number;
  private hash?: string;
  private initializing?: Promise<ImportAgentStatus>;
  /** Loopback-only credential for this instance; kept in memory only. */
  readonly password = crypto.randomBytes(24).toString("base64url");
  readonly username = "workbench-import";
  private attached?: { username?: string; password?: string };

  constructor(private readonly options: ImportAgentRuntimeOptions) {
    // A sibling of the workspace, so the managed agent never runs inside the
    // scientific data directory and never writes into the user's global
    // OpenCode configuration.
    const data = path.resolve(options.dataDir);
    this.root = path.join(
      fs.realpathSync(path.dirname(data)),
      `${path.basename(data)}-${IMPORT_AGENT_DIRNAME}`,
      safeIdentity(options.importId),
      safeIdentity(options.attemptId),
    );
    this.executionDir = path.join(this.root, "execution");
    this.configDir = path.join(this.root, "config");
    this.configPath = path.join(this.configDir, "opencode", "opencode.jsonc");
    // Workspace profile: applied only when the runtime is routed to this
    // directory, which is how the restricted profile is pinned per import.
    this.workspaceConfigPath = path.join(this.executionDir, "opencode.jsonc");
  }

  private profileText() {
    return buildImportRuntimeConfig({
      repoRoot: this.options.repoRoot,
      model: this.options.model,
      importId: this.options.importId,
      attemptId: this.options.attemptId,
      workbenchBaseUrl: this.options.workbenchBaseUrl,
      workbenchToken: this.options.workbenchToken,
    });
  }

  /** Writes the profile and starts the instance when it is not running yet. */
  ensure(): Promise<ImportAgentStatus> {
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize().finally(() => {
      this.initializing = undefined;
    });
    return this.initializing;
  }

  bindingIntact(): boolean {
    const profilePath = this.options.endpoint
      ? this.workspaceConfigPath
      : this.configPath;
    try {
      const stat = fs.lstatSync(profilePath);
      return (
        !stat.isSymbolicLink() &&
        stat.isFile() &&
        (stat.mode & 0o077) === 0 &&
        fs.readFileSync(profilePath, "utf8") === this.profileText() &&
        fs.realpathSync(this.executionDir) === this.executionDir
      );
    } catch {
      return false;
    }
  }

  ownsExecutionDirectory(directory: string): boolean {
    return path.resolve(directory) === this.executionDir;
  }

  policyHash(): string {
    return importPolicyHash(this.profileText());
  }

  private async initialize(): Promise<ImportAgentStatus> {
    if (this.state === "ready" && this.url) {
      if (!this.bindingIntact()) throw new Error("导入配置或绑定已变化");
      return this.status();
    }
    this.state = "starting";
    try {
      const text = this.profileText();
      const attach = this.options.endpoint;
      for (const dir of [
        this.root,
        path.dirname(this.configPath),
        path.join(this.root, "data"),
        path.join(this.root, "cache"),
        path.join(this.root, "work"),
        this.executionDir,
      ]) {
        privateDirectory(dir);
      }
      // The profile carries the workbench token, so keep it private.
      const profilePath = attach ? this.workspaceConfigPath : this.configPath;
      if (fs.existsSync(profilePath)) {
        const stat = fs.lstatSync(profilePath);
        if (
          stat.isSymbolicLink() ||
          !stat.isFile() ||
          fs.readFileSync(profilePath, "utf8") !== text
        )
          throw new Error("已有 attempt 配置与本次绑定不一致");
      } else fs.writeFileSync(profilePath, text, { mode: 0o600, flag: "wx" });
      fs.chmodSync(profilePath, 0o600);
      this.hash = profileHashOf(text);
      if (attach) {
        this.url = validateOpenCodeBaseUrl(attach.baseUrl);
        this.attached = {
          username: attach.username,
          password: attach.password,
        };
        this.state = "ready";
        this.detail = undefined;
        return this.status();
      }
      const port = this.options.port ?? (await freePort());
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_CONFIG_HOME: this.configDir,
        XDG_DATA_HOME: path.join(this.root, "data"),
        XDG_CACHE_HOME: path.join(this.root, "cache"),
        OPENCODE_SERVER_USERNAME: this.username,
        OPENCODE_SERVER_PASSWORD: this.password,
      };
      if (this.options.launcher) {
        const started = await this.options.launcher({
          command: "opencode",
          args: ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
          cwd: path.join(this.root, "work"),
          env,
        });
        this.pid = started.pid;
        this.stopHook = started.stop;
      } else {
        const child = spawn(
          "opencode",
          ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
          { cwd: path.join(this.root, "work"), env, stdio: "ignore" },
        );
        this.child = child;
        this.pid = child.pid;
      }
      this.url = `http://127.0.0.1:${port}`;
      this.state = "ready";
      this.detail = undefined;
      return this.status();
    } catch (error) {
      this.state = "failed";
      this.detail = "导入运行时初始化失败；请检查隔离目录与配置绑定";
      throw error;
    }
  }

  config(): ResolvedOpenCodeConfig {
    if (!this.url) throw new Error("managed runtime 尚未启动");
    return {
      ...defaultOpenCodeConfig(this.options.dataDir),
      baseUrl: this.url,
      username: this.attached?.username ?? this.username,
      password: this.attached?.password ?? this.password,
      executionDir: this.executionDir,
      permissionMode: "ask",
    };
  }

  status(): ImportAgentStatus {
    return {
      state: this.state,
      ...(this.url ? { baseUrl: this.url } : {}),
      ...(this.pid ? { pid: this.pid } : {}),
      executionDir: this.executionDir,
      configPath: this.options.endpoint
        ? this.workspaceConfigPath
        : this.configPath,
      ...(this.hash ? { profileHash: this.hash } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }

  async stop(): Promise<void> {
    if (this.initializing) await this.initializing.catch(() => undefined);
    try {
      if (this.stopHook) await this.stopHook();
      else if (this.child && this.child.exitCode === null)
        this.child.kill("SIGTERM");
    } finally {
      this.stopHook = undefined;
      this.child = undefined;
      this.state = "stopped";
      this.url = undefined;
      this.pid = undefined;
    }
  }
}

export type ImportReadinessReason =
  | "READY"
  | "IMPORT_NOT_FOUND"
  | "ATTEMPT_INACTIVE"
  | "CAPABILITY_MISSING"
  | "EFFECTIVE_POLICY_UNVERIFIED"
  | "PROFILE_MISSING"
  | "RUNTIME_UNREACHABLE"
  | "VERSION_UNSUPPORTED"
  | "MODEL_MISSING"
  | "MODEL_WITHOUT_IMAGE"
  | "CAPABILITY_STALE"
  | "EXECUTION_DIR_NOT_ISOLATED"
  | "KNOWLEDGE_BUNDLE_MISSING";

export interface ImportReadinessInput {
  runtime: ImportAgentRuntime;
  capability?: VerifiedImportCapability;
  dataDir: string;
  bundleHash?: string;
  /** Injected in tests; the product always uses the real adapter. */
  probe?: (config: ResolvedOpenCodeConfig) => Promise<{
    flavor: "v1" | "v2";
    version: string;
    transport?: string;
    effectivePolicyHash?: string;
    models: {
      providerId: string;
      modelId: string;
      supportsImage?: boolean | "unknown";
    }[];
  }>;
}

export interface ImportReadinessResult {
  ready: boolean;
  reasonCode: ImportReadinessReason;
  detail: string;
  flavor?: string;
  version?: string;
  model?: string;
  profileHash?: string;
}

/**
 * Readiness is a live check against the managed instance: identity, image
 * capability, profile applicability and isolation. A capability record that no
 * longer matches the generated profile is reported as stale so a model or
 * profile change is re-evaluated instead of silently trusted.
 */
export async function checkImportReadiness(
  input: ImportReadinessInput,
): Promise<ImportReadinessResult> {
  const status = input.runtime.status();
  if (!status.profileHash || !status.baseUrl)
    return {
      ready: false,
      reasonCode: "PROFILE_MISSING",
      detail: "专属导入 profile 尚未生成，无法启动受限实例",
    };
  const execution = path.resolve(status.executionDir);
  const data = path.resolve(input.dataDir);
  if (
    execution === data ||
    execution.startsWith(data + path.sep) ||
    !input.runtime.ownsExecutionDirectory(execution)
  )
    return {
      ready: false,
      reasonCode: "EXECUTION_DIR_NOT_ISOLATED",
      detail: "执行目录必须属于专属 managed 目录且不在科研数据目录内",
    };
  if (!input.runtime.bindingIntact())
    return {
      ready: false,
      reasonCode: "CAPABILITY_STALE",
      detail: "配置文件或任务绑定已变化",
    };
  const capability = input.capability;
  const checks = [
    "isolation",
    "runtimeIdentityAndModel",
    "asyncSubmission",
    "correlatedImageAnswer",
    "restrictedAllow",
    "restrictedDeny",
    "noSensitiveWorkbenchLeakage",
  ];
  if (
    !capability ||
    capability.schema !== "swb.import-capability/2" ||
    !capability.evidence ||
    !Number.isFinite(Date.parse(capability.verifiedAt)) ||
    checks.some((key) => capability.checks?.[key] !== "PASS")
  )
    return {
      ready: false,
      reasonCode: "CAPABILITY_MISSING",
      detail: "缺少完整七项真实验证记录",
    };
  if (!input.bundleHash || input.bundleHash !== capability.bundleHash)
    return {
      ready: false,
      reasonCode: "KNOWLEDGE_BUNDLE_MISSING",
      detail: "知识 bundle 缺失或与验证记录不一致",
    };
  if (
    capability.flavor !== "v1" ||
    capability.version !== "1.18.31" ||
    capability.model !== "deepseek/deepseek-v4-flash-vision-exp" ||
    capability.transport !== "/session/:id/prompt_async"
  )
    return {
      ready: false,
      reasonCode: "CAPABILITY_STALE",
      detail: "目标组合或 transport 未获验证",
    };
  const config = input.runtime.config();
  let observed: {
    flavor: "v1" | "v2";
    version: string;
    transport?: string;
    effectivePolicyHash?: string;
    models: {
      providerId: string;
      modelId: string;
      supportsImage?: boolean | "unknown";
    }[];
  };
  try {
    observed = input.probe
      ? await input.probe(config)
      : await (async () => {
          const adapter = createOpenCodeAdapter(config);
          const health = await adapter.health();
          return {
            flavor: await detectOpenCodeFlavor(config),
            version: health.version ?? "",
            models: await adapter.listModels(),
            transport: "/session/:id/prompt_async",
            effectivePolicyHash: await observeEffectiveImportPolicy(
              config,
              status.configPath,
            ),
          };
        })();
  } catch (error) {
    return {
      ready: false,
      reasonCode: "RUNTIME_UNREACHABLE",
      detail: "无法连接专属运行时",
    };
  }
  if (!observed.version)
    return {
      ready: false,
      reasonCode: "VERSION_UNSUPPORTED",
      detail: "运行时未报告版本",
    };
  {
    if (capability.flavor !== observed.flavor)
      return {
        ready: false,
        reasonCode: "VERSION_UNSUPPORTED",
        detail: `flavor 与验证记录不一致：${observed.flavor}`,
      };
    if (capability.version !== observed.version)
      return {
        ready: false,
        reasonCode: "VERSION_UNSUPPORTED",
        detail: `version 与验证记录不一致：${observed.version}`,
      };
    if (capability.profileHash !== input.runtime.policyHash())
      return {
        ready: false,
        reasonCode: "CAPABILITY_STALE",
        detail: "受限 profile 已变化，需要重新验证后才能启用",
      };
  }
  const wanted = capability.model;
  const [wantedProvider, wantedId] = wanted.split("/");
  const model = observed.models.find(
    (item) => item.providerId === wantedProvider && item.modelId === wantedId,
  );
  if (!model)
    return {
      ready: false,
      reasonCode: "MODEL_MISSING",
      detail: wanted
        ? `运行时不提供已验证模型：${wanted}`
        : "运行时没有可用模型",
      flavor: observed.flavor,
      version: observed.version,
    };
  if (model.supportsImage !== true)
    return {
      ready: false,
      reasonCode: "MODEL_WITHOUT_IMAGE",
      detail: `模型未声明图片能力：${model.providerId}/${model.modelId}`,
      flavor: observed.flavor,
      version: observed.version,
    };
  if (
    observed.transport !== capability.transport ||
    observed.effectivePolicyHash !== capability.profileHash
  )
    return {
      ready: false,
      reasonCode: "EFFECTIVE_POLICY_UNVERIFIED",
      detail: "尚未证明目标目录的有效策略与 transport",
    };
  if (!input.bundleHash)
    return {
      ready: false,
      reasonCode: "KNOWLEDGE_BUNDLE_MISSING",
      detail: "知识 bundle 缺失",
    };
  return {
    ready: true,
    reasonCode: "READY",
    detail: "专属运行时、模型与受限 profile 均可用",
    flavor: observed.flavor,
    version: observed.version,
    model: `${model.providerId}/${model.modelId}`,
    profileHash: status.profileHash,
  };
}

/** Repository root, so the managed runtime can start the workbench MCP server. */
export function repositoryRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}

function safeIdentity(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("导入和 attempt 身份必须是 UUID");
  return value;
}

export function importPolicyHash(text: string): string {
  const config = JSON.parse(text);
  const environment = config.mcp?.["scientific-workbench"]?.environment;
  if (!environment) throw new Error("缺少受限 MCP 绑定");
  for (const key of [
    "WORKBENCH_API",
    "WORKBENCH_API_TOKEN",
    "WORKBENCH_IMPORT_SCOPE",
    "WORKBENCH_IMPORT_ATTEMPT",
  ]) {
    if (typeof environment[key] !== "string" || !environment[key])
      throw new Error("MCP 绑定不完整");
    environment[key] = `<${key}>`;
  }
  const implementationFiles = [
    "apps/mcp/src/main.ts",
    "packages/core/src/operations.ts",
  ];
  const root = config.mcp["scientific-workbench"].cwd;
  const implementation = implementationFiles.map((file) =>
    sha256(fs.readFileSync(path.join(root, file))),
  );
  return sha256(
    JSON.stringify({ schema: "swb.import-policy/2", implementation, config }),
  );
}

/** Read-only, directory-routed evidence. No model request or configuration write. */
export async function observeEffectiveImportPolicy(
  runtime: ResolvedOpenCodeConfig,
  profilePath: string,
): Promise<string | undefined> {
  const headers = {
    ...openCodeAuthHeaders(runtime),
    "x-opencode-directory": runtime.executionDir,
  };
  const get = async (endpoint: string): Promise<unknown> => {
    const response = await fetch(`${runtime.baseUrl}${endpoint}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("无法读取有效运行时策略");
    return response.json();
  };
  const expected = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const [configuration, agents, tools, mcp] = await Promise.all([
    get("/config"),
    get("/agent"),
    get(
      `/experimental/tool?provider=deepseek&model=deepseek-v4-flash-vision-exp`,
    ),
    get("/mcp"),
  ]);
  if (
    !isRecord(configuration) ||
    !isRecord(mcp) ||
    !Array.isArray(agents) ||
    !Array.isArray(tools)
  )
    return undefined;
  // Effective configuration must preserve the complete scoped MCP binding.
  if (
    JSON.stringify(configuration.mcp) !== JSON.stringify(expected.mcp) ||
    canonical(configuration.permission) !== canonical(expected.permission) ||
    configuration.model !== expected.model ||
    (configuration.default_agent !== undefined &&
      configuration.default_agent !== "build")
  )
    return undefined;
  if (
    Object.keys(mcp).length !== 1 ||
    !isRecord(mcp["scientific-workbench"]) ||
    mcp["scientific-workbench"].status !== "connected"
  )
    return undefined;
  const agent = agents.find(
    (item: unknown) => isRecord(item) && item.name === "build",
  );
  if (!isRecord(agent) || !Array.isArray(agent.permission)) return undefined;
  const rules = agent.permission;
  // Accept only understood rules. A later inherited allow/ask, including a
  // target-specific exception, invalidates this proof instead of being ignored.
  const allowed = new Set(["question", "todowrite", "scientific-workbench*"]);
  if (
    !rules.every(
      (rule: unknown) =>
        isRecord(rule) &&
        typeof rule.permission === "string" &&
        typeof rule.pattern === "string" &&
        ["allow", "deny", "ask"].includes(String(rule.action)),
    )
  )
    return undefined;
  let defaultDeny = -1;
  rules.forEach((rule: Record<string, unknown>, index: number) => {
    if (
      rule.permission === "*" &&
      rule.pattern === "*" &&
      rule.action === "deny"
    )
      defaultDeny = index;
  });
  if (
    defaultDeny < 0 ||
    rules
      .slice(defaultDeny + 1)
      .some(
        (rule: Record<string, unknown>) =>
          rule.action !== "deny" &&
          !(
            rule.action === "allow" &&
            ((rule.pattern === "*" && allowed.has(String(rule.permission))) ||
              rule.permission === "external_directory")
          ),
      )
  )
    return undefined;
  // OpenCode adds an external_directory allowance for its tool-output cache.
  // This alone cannot run a file tool: read/edit/write/bash are still denied.
  // No other inherited allow/ask survives the default-deny rule above.
  const scopedNames = await new Promise<string[] | undefined>((resolve) => {
    execFile(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(
          expected.mcp["scientific-workbench"].cwd,
          "apps/mcp/src/inspect-import-tools.ts",
        ),
        profilePath,
      ],
      { timeout: 10000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) return resolve(undefined);
        try {
          const value = JSON.parse(stdout);
          resolve(
            Array.isArray(value) &&
              value.every((item) => typeof item === "string")
              ? value
              : undefined,
          );
        } catch {
          resolve(undefined);
        }
      },
    );
  });
  if (!scopedNames) return undefined;
  const names = tools.map((tool: unknown) =>
    isRecord(tool) ? tool.id : undefined,
  );
  if (names.some((name) => typeof name !== "string")) return undefined;
  const scoped = scopedNames.map((name) => `scientific-workbench_${name}`);
  const permitted = [
    "knowledge_index",
    "knowledge_read",
    "object_search",
    "property_search",
    "sample_import_get",
    "sample_import_save_draft",
    "sample_import_commit",
  ];
  if (
    scoped.length !== permitted.length ||
    !permitted.every((name) => scoped.includes(`scientific-workbench_${name}`))
  )
    return undefined;
  return importPolicyHash(fs.readFileSync(profilePath, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function privateDirectory(directory: string): void {
  if (!fs.existsSync(directory)) {
    privateDirectory(path.dirname(directory));
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(directory) !== directory
  )
    throw new Error("managed 目录不允许符号链接或路径替换");
}

function canonical(value: unknown): string {
  const order = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(order)
      : isRecord(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, order(item[key])]),
          )
        : item;
  return JSON.stringify(order(value));
}
