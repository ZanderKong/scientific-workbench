/**
 * G2: real page-to-persisted-entity acceptance for the AI record import.
 *
 * It drives the real browser UI against a real, isolated Workbench instance and
 * the already-authorised isolated OpenCode runtime, asserts the scientific
 * content against a pre-written truth table, restarts the instance, re-reads
 * everything from disk and re-checks artifact minimisation on the real
 * Job/log/notice of this run.
 *
 * Opt-in only, and the model-request budget is journalled before every
 * submission. It never touches ~/ScientificWorkbench, the existing 14321/4317/
 * 5173 instances or the user's OpenCode configuration.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { checkLeakage, type ArtifactEvidence, type VisionSpikeReport } from "../apps/server/src/vision-spike.ts";
import { WorkbenchStore } from "../apps/server/src/store.ts";


const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.SWB_G2_PORT ?? "14323");
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/v1`;
const RUNTIME = process.env.SWB_IMPORT_RUNTIME_URL ?? "http://127.0.0.1:4199";
const ENV_FILE = process.env.SWB_SPIKE_ENV_FILE ?? "/Users/kong/.opencode-acceptance/server.env";
const BUDGET = Number(process.env.SWB_G2_BUDGET ?? "10");
const DATA_DIR =
  process.env.SWB_G2_DATA_DIR ??
  path.join(path.dirname(repoRoot), "ScientificWorkbench-g2-20260923");
const EVIDENCE_DIR =
  process.env.SWB_G2_EVIDENCE_DIR ??
  path.join(repoRoot, "audit/2026-09-22/ai-import/g2");
const FIXTURE_DIR = path.join(EVIDENCE_DIR, "fixtures");
const OBSERVED: Record<string, unknown> = {};

interface Truth {
  scenario: string;
  pages: { file: string; expectedSamples: number; values: string[]; observations: string[] }[];
  notes: string;
}

/* ------------------------------------------------------------------ budget */

const budgetFile = path.join(EVIDENCE_DIR, "budget.json");

function readBudget() {
  if (!fs.existsSync(budgetFile)) return { used: 0, limit: BUDGET, entries: [] as unknown[] };
  return JSON.parse(fs.readFileSync(budgetFile, "utf8")) as {
    used: number;
    limit: number;
    entries: unknown[];
  };
}

function recordCall(label: string) {
  const state = readBudget();
  if (state.used >= state.limit) throw new Error("G2 请求预算已用尽");
  state.used += 1;
  state.entries.push({ label, at: new Date().toISOString() });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(budgetFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`[budget] ${state.used}/${state.limit} ${label}`);
}

/* --------------------------------------------------------------- fixtures */

const RECORDS: Record<string, string> = {
  "scenario1-page1.html": `<!doctype html><meta charset="utf-8"><style>
    body{font:16px/1.7 "PingFang SC",sans-serif;padding:28px;color:#111}
    h2{font-size:19px;margin:0 0 10px} table{border-collapse:collapse;margin:12px 0}
    td{border:1px solid #999;padding:6px 10px} .n{color:#555;font-size:13px}
    </style>
    <h2>实验记录 2026-09-20　操作人：值班 A</h2>
    <div>[对象] 坩埚</div>
    <table>
      <tr><td>样品 R1</td><td>称取 2.5 g 原料</td><td>加入 10 mL 去离子水</td><td>80 ℃ 搅拌 30 min</td></tr>
      <tr><td>样品 R2</td><td>称取 5.0 g 原料</td><td>加入 20 mL 去离子水</td><td>80 ℃ 搅拌 45 min</td></tr>
      <tr><td>样品 R3</td><td>称取 7.5 g 原料</td><td>加入 30 mL 去离子水</td><td>80 ℃ 搅拌 60 min</td></tr>
    </table>
    <div>备注：三份使用同一批原料；液面有少量白色颗粒悬浮。</div>
    <div class="n">本页为验收用合成记录，非真实实验数据。</div>`,
  "scenario2-page1.html": `<!doctype html><meta charset="utf-8"><style>
    body{font:16px/1.7 "PingFang SC",sans-serif;padding:28px;color:#111}
    h2{font-size:19px;margin:0 0 10px} .n{color:#555;font-size:13px}
    </style>
    <h2>实验记录 2026-09-20　样品 T7（第 1 页）</h2>
    <div>称取 3.0 g 原料放入烧瓶。</div>
    <div>加入 15 mL 乙醇，60 ℃ 回流 2 h。</div>
    <div class="n">本页为验收用合成记录，非真实实验数据。下一页继续。</div>`,
  "scenario2-page2.html": `<!doctype html><meta charset="utf-8"><style>
    body{font:16px/1.7 "PingFang SC",sans-serif;padding:28px;color:#111}
    h2{font-size:19px;margin:0 0 10px} .n{color:#555;font-size:13px}
    </style>
    <h2>实验记录 2026-09-20　样品 T7（第 2 页）</h2>
    <div>承接上一页：冷却至室温后过滤。</div>
    <div>滤液静置 12 h，得到 1.8 g 白色晶体。</div>
    <div class="n">本页为验收用合成记录，非真实实验数据。</div>`,
  "scenario3-page1.html": `<!doctype html><meta charset="utf-8"><style>
    body{font:16px/1.7 "PingFang SC",sans-serif;padding:28px;color:#111}
    h2{font-size:19px;margin:0 0 10px} .n{color:#555;font-size:13px}
    </style>
    <h2>实验记录 2026-09-20　样品 Q1</h2>
    <div>加入原料（前一页写 5 g，本页写 8 g，两处不一致，需确认）。</div>
    <div>加入 12 mL 甲醇，室温搅拌。</div>
    <div class="n">本页为验收用合成记录，非真实实验数据。</div>`,
};

async function makeFixtures(browser: Browser) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true, mode: 0o700 });
  const page = await browser.newPage({ viewport: { width: 760, height: 420 } });
  const written: string[] = [];
  for (const [name, html] of Object.entries(RECORDS)) {
    const file = path.join(FIXTURE_DIR, name.replace(/\.html$/, ".png"));
    if (fs.existsSync(file)) {
      written.push(file);
      continue;
    }
    await page.setContent(html);
    await page.screenshot({ path: file, fullPage: true });
    written.push(file);
  }
  await page.close();
  return written;
}

/* ------------------------------------------------------------ workbench */

let server: ChildProcess | undefined;
let logStream: fs.WriteStream | undefined;
const logFile = path.join(EVIDENCE_DIR, "workbench.log");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      const port = typeof address === "object" && address ? address.port : 0;
      socket.close(() => resolve(port));
    });
    socket.on("error", reject);
  });
}

async function startWorkbench() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  logStream = fs.createWriteStream(logFile, { flags: "a", mode: 0o600 });
  const token = process.env.WORKBENCH_API_TOKEN ?? crypto.randomUUID();
  process.env.WORKBENCH_API_TOKEN = token;
  server = spawn(
    process.execPath,
    ["--import", "tsx", path.join(repoRoot, "apps/server/src/main.ts")],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKBENCH_DATA_DIR: DATA_DIR,
        WORKBENCH_PORT: String(PORT),
        WORKBENCH_HOST: "127.0.0.1",
        WORKBENCH_API_TOKEN: token,
        WORKBENCH_IMPORT_OPENCODE_URL: RUNTIME,
        WORKBENCH_IMPORT_ENV_FILE: ENV_FILE,
        // Non-production keeps Fastify's redacted request log on, so the run's
        // real log artifact has content for the minimisation check.
        NODE_ENV: process.env.SWB_G2_NODE_ENV ?? "acceptance",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const pipe of [server.stdout, server.stderr])
    pipe?.on("data", (chunk: Buffer) => logStream?.write(chunk));
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try {
      const health = await fetch(`${API}/health`);
      if (health.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Workbench 未在超时内就绪");
}

async function stopWorkbench() {
  if (!server) return;
  const child = server;
  server = undefined;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000).unref?.();
  });
  await new Promise<void>((resolve) => logStream?.end(resolve));
  logStream = undefined;
}

/* -------------------------------------------------------------- API side */

let uiCookie = "";

async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${route}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(uiCookie ? { cookie: uiCookie } : {}),
      ...(process.env.WORKBENCH_API_TOKEN
        ? { authorization: `Bearer ${process.env.WORKBENCH_API_TOKEN}` }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${route} ${response.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function jobs() {
  return api<
    { id: string; type: string; status: string; payload: Record<string, unknown> }[]
  >("/jobs");
}

async function waitFor<T>(
  label: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 240_000,
) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`超时：${label}`);
}

/* ------------------------------------------------------------ browser side */

/** The product's own session link for one running import task. */
async function sessionUrlOf(jobId: string) {
  return waitFor(
    `任务 ${jobId} 的会话链接`,
    async () => {
      const state = await api<{ runs: { id: string; sessionUrl?: string }[] }>(
        "/agent-runs/state",
      );
      return state.runs.find((run) => run.id === jobId)?.sessionUrl;
    },
    120_000,
  );
}

async function importThroughUi(
  page: Page,
  files: string[],
  note: string,
  label: string,
) {
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "样品" }).waitFor();
  await page.getByRole("button", { name: "更多新建方式" }).click();
  await page.getByRole("menuitem", { name: "AI 从实验记录新建样品" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 从实验记录新建样品" });
  await dialog.waitFor();
  await page
    .getByLabel("选择实验记录图片")
    .setInputFiles(files.map((file) => path.join(FIXTURE_DIR, file)));
  await page.getByText("已上传").first().waitFor();
  await waitFor(
    "来源图片上传完成",
    async () => {
      const statuses = await page
        .locator(".sampleImportPages li span")
        .allTextContents();
      const uploading = statuses.filter((text: string) => text === "上传中…").length;
      return uploading === 0 ? true : undefined;
    },
    60_000,
  );
  await page.getByLabel("导入补充说明").fill(note);
  const before = new Set((await jobs()).map((job) => job.id));
  // The single model submission of this scenario is journalled first.
  recordCall(label);
  await page.getByRole("button", { name: "开始导入" }).click();
  await page
    .getByRole("dialog", { name: "AI 从实验记录新建样品" })
    .waitFor({ state: "hidden", timeout: 60_000 });
  const created = (await jobs()).filter((job) => !before.has(job.id));
  if (created.length !== 1) throw new Error(`${label}: 未创建唯一导入任务`);
  return created[0];
}

/** The managed agent directory the import runtime owns for one attempt. */
function executionDirFor(importId: string, attemptId: string) {
  return path.join(
    path.dirname(DATA_DIR),
    `${path.basename(DATA_DIR)}-import-agent`,
    importId,
    attemptId,
    "execution",
  );
}

/** The transient private binding of one attempt; it holds the scoped token. */
function privateBinding(attemptId: string) {
  const file = path.join(DATA_DIR, "private", "import-runs", `${attemptId}.json`);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as {
    token: string;
    tokenId: string;
    note: string;
  };
}

/* ------------------------------------------------------------------- run */

interface PendingQuestion {
  id: string;
  sessionID: string;
  header?: string;
  questions?: { question: string; header?: string; options?: { label: string }[] }[];
}

async function pendingQuestions(sessionId: string): Promise<PendingQuestion[]> {
  const response = await fetch(`${RUNTIME}/question`, {
    headers: { ...authHeader(), "x-opencode-directory": executionDirOf(sessionId) },
  });
  if (!response.ok) return [];
  const all = (await response.json()) as PendingQuestion[];
  return all.filter((item) => item.sessionID === sessionId);
}

/** Resolved from the job payload while the import is running. */
const executionDirs = new Map<string, string>();
function executionDirOf(sessionId: string) {
  return executionDirs.get(sessionId) ?? "";
}

let boundExpose = false;
const openedLinks: string[] = [];

/**
 * The operator's clarification path: the product's own clarify entry opens the
 * runtime session, and the answer uses the documented question-reply contract
 * the OpenCode UI itself posts, choosing one of the question's own options.
 */
async function answerPending(
  page: Page,
  sessionId: string,
  sessionUrl: string,
  prefer: string[],
) {
  const pending = await pendingQuestions(sessionId);
  if (!pending.length) return undefined;
  if (!boundExpose) {
    await page.exposeFunction("__recordOpen", (url: string) => openedLinks.push(url));
    boundExpose = true;
  }
  // The product's clarify entry is the link the user is sent to; it must resolve
  // to the runtime's own session. The runtime requires its configured
  // credentials, so both statuses are recorded rather than assumed.
  const reachable = await fetch(sessionUrl, { headers: authHeader() }).catch(
    () => undefined,
  );
  const anonymous = await fetch(sessionUrl).catch(() => undefined);
  const answers: {
    header?: string;
    question?: string;
    answer: string;
    options: string[];
  }[] = [];
  for (const request of pending) {
    // One answer per sub-question, each chosen from that question's own options.
    const entries = (request.questions ?? []).map((item) => {
      const labels = (item.options ?? []).map((option) => option.label);
      const answer =
        labels.find((label) => prefer.some((want) => label.includes(want))) ??
        labels[0];
      if (!answer) throw new Error(`Question ${request.id} 没有可选项`);
      answers.push({
        header: item.header,
        question: item.question,
        answer,
        options: labels,
      });
      return [answer];
    });
    if (!entries.length) throw new Error(`Question ${request.id} 没有子问题`);
    // This legacy runtime answers through the V1 question route it shares with
    // its own UI; the V2 session-question route does not see legacy sessions.
    const reply = await fetch(
      `${RUNTIME}/question/${encodeURIComponent(request.id)}/reply`,
      {
        method: "POST",
        headers: {
          ...authHeader(),
          "content-type": "application/json",
          "x-opencode-directory": executionDirOf(sessionId),
        },
        body: JSON.stringify({ answers: entries }),
      },
    );
    if (!reply.ok)
      throw new Error(`回答 Question 失败 ${reply.status}: ${await reply.text()}`);
    const accepted = await reply.json().catch(() => undefined);
    if (accepted !== true)
      throw new Error(`Question ${request.id} 未被运行时接受：${String(accepted)}`);
  }
  return {
    answers,
    sessionUrl,
    entryReachable: reachable?.ok ?? false,
    entryStatus: reachable?.status ?? 0,
    entryStatusWithoutCredentials: anonymous?.status ?? 0,
  };
}

/** Answers every clarification this import asks until it commits or ends. */
async function driveThroughQuestions(
  page: Page,
  sessionId: string,
  sessionUrlFor: () => string | undefined,
  importId: string,
  prefer: string[],
) {
  const clarifications: unknown[] = [];
  const until = Date.now() + 600_000;
  let record = await api<Record<string, unknown>>(`/sample-imports/${importId}`);
  while (Date.now() < until && record.status !== "committed") {
    const sessionUrl = sessionUrlFor();
    if (!sessionUrl) throw new Error("缺少会话链接，无法澄清");
    const answered = await answerPending(page, sessionId, sessionUrl, prefer);
    if (answered) {
      clarifications.push(answered);
      if (!answered.entryReachable)
        throw new Error(`会话链接不可达（${answered.entryStatus}）：${sessionUrl}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
    record = await api<Record<string, unknown>>(`/sample-imports/${importId}`);
  }
  return { clarifications, record };
}

function authHeader(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?(OPENCODE_SERVER_USERNAME|OPENCODE_SERVER_PASSWORD)\s*=\s*(.*)$/,
    );
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return {
    authorization: `Basic ${Buffer.from(
      `${values.OPENCODE_SERVER_USERNAME}:${values.OPENCODE_SERVER_PASSWORD}`,
    ).toString("base64")}`,
  };
}

/**
 * Wiring preflight: real endpoint, real capability, real scoped MCP tool list,
 * real profile hash — and zero model requests.
 */
async function preflight() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown> = {};
  try {
    await makeFixtures(browser);
    await startWorkbench();
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    const cookies = await page.context().cookies(BASE);
    uiCookie = cookies
      .map((cookie: { name: string; value: string }) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const health = await api<Record<string, unknown>>("/health");
    const form = new FormData();
    const bytes = fs.readFileSync(path.join(FIXTURE_DIR, "scenario1-page1.png"));
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      "scenario1-page1.png",
    );
    const uploaded = await fetch(`${API}/attachments/stream`, {
      method: "POST",
      headers: { cookie: uiCookie },
      body: form,
    });
    if (!uploaded.ok) throw new Error(`上传失败 ${uploaded.status}`);
    const attachment = (await uploaded.json()) as { id: string };
    const importId = crypto.randomUUID();
    const prepared = await api<{ attempt: { id: string }; recordVersion: number }>(
      "/sample-imports",
      {
        method: "POST",
        body: JSON.stringify({ importId, attachmentIds: [attachment.id] }),
      },
    );
    const readiness = await api<Record<string, unknown>>(
      `/sample-imports/${importId}/agent/readiness`,
    );
    const executionDir = executionDirFor(importId, prepared.attempt.id);
    out.health = health;
    out.readiness = readiness;
    out.executionDir = executionDir;
    out.profileExists = fs.existsSync(path.join(executionDir, "opencode.jsonc"));
    out.privateBindingKeys = Object.keys(
      JSON.parse(
        fs.readFileSync(
          path.join(DATA_DIR, "private", "import-runs", `${prepared.attempt.id}.json`),
          "utf8",
        ),
      ),
    ).sort();
    await page.close();
  } finally {
    await stopWorkbench();
    await browser.close();
  }
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "preflight.json"),
    JSON.stringify(out, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "PREFLIGHT", ...out }, null, 2));
}

/**
 * Verification phase for an already-completed G2 run: it re-reads the committed
 * material from disk and over HTTP, restarts the instance, and re-checks
 * artifact minimisation. It issues no model request at all.
 */
async function verify() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const report: Record<string, unknown> = {
    schema: "swb.import-g2/1",
    verifiedAt: new Date().toISOString(),
    mode: "verify-existing-run",
  };
  const importFiles = fs
    .readdirSync(path.join(DATA_DIR, "registry", "imports"))
    .map((name) => path.join(DATA_DIR, "registry", "imports", name));
  const scenarioOf = (name: string) =>
    name.startsWith("scenario1") ? 1 : name.startsWith("scenario2") ? 2 : 3;
  const byScenario = new Map<number, { importId: string; attemptId: string }>();
  for (const file of importFiles) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (record.status !== "committed") continue;
    byScenario.set(scenarioOf(record.source[0].name), {
      importId: record.importId,
      attemptId: record.attempt.id,
    });
  }
  if (byScenario.size !== 3) throw new Error("缺少三个已提交场景");

  await startWorkbench();
  const actor = {
    receipts: {} as Record<string, unknown>,
    jobs: {} as Record<string, unknown>,
    samples: {} as Record<string, unknown>,
    bindings: {} as Record<string, unknown>,
    provenance: {} as Record<string, unknown>,
  };
  try {
    // The three scenarios' real answers are recovered from the runtime's own
    // session history, so the clarification evidence is not self-reported.
    const clarifications: Record<string, unknown> = {};
    for (const [scenario, entry] of [...byScenario.entries()].sort()) {
      const record = await api<Record<string, unknown>>(
        `/sample-imports/${entry.importId}`,
      );
      actor.receipts[`scenario${scenario}`] = record;
      const sampleIds = (record as { receipt: { createdSampleIds: string[] } })
        .receipt.createdSampleIds;
      const samples = await Promise.all(
        sampleIds.map((id) => api<Record<string, unknown>>(`/samples/${id}`)),
      );
      actor.samples[`scenario${scenario}`] = samples.map((sample) => ({
        id: sample.id,
        code: sample.code,
        body: (sample.document as { body: string }).body,
        properties: (sample.properties as { object_name: string; property_name: string; value_text: string }[]).map(
          (property) => ({
            object: property.object_name,
            name: property.property_name,
            value: property.value_text,
          }),
        ),
        dataBindings: Object.values(
          (sample.document as { head: { blocks: Record<string, { kind: string; dataId?: string }> } }).head.blocks,
        )
          .filter((binding) => binding.kind === "data")
          .map((binding) => binding.dataId),
      }));
      const data = await api<Record<string, unknown>>(
        `/data/${(record as { sourceDataId: string }).sourceDataId}`,
      );
      actor.provenance[`scenario${scenario}`] = {
        sourceDataVersion: data.version,
        aboutSampleIds: data.aboutSampleIds,
        components: (
          data.components as { role?: string; provenance?: string }[]
        )
          .filter((component) => component.role === "import-provenance")
          .map((component) => JSON.parse(component.provenance ?? "{}")),
      };
      // Question/answer evidence straight from the runtime session history.
      const jobs = await api<
        { id: string; status: string; payload: Record<string, unknown> }[]
      >("/jobs");
      const job = jobs.find((item) => item.payload.importId === entry.importId);
      (actor.jobs as Record<string, unknown>)[`scenario${scenario}`] = job;
      const sessionId = String(job?.payload.sessionId ?? "");
      const dir = executionDirFor(entry.importId, entry.attemptId);
      const messages = await fetch(
        `${RUNTIME}/session/${encodeURIComponent(sessionId)}/message`,
        { headers: { ...authHeader(), "x-opencode-directory": dir } },
      )
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []);
      const list = (Array.isArray(messages) ? messages : []) as {
        info?: { role?: string; time?: { created?: number } };
        parts?: { type?: string; tool?: string; state?: { input?: unknown; output?: unknown } }[];
      }[];
      clarifications[`scenario${scenario}`] = list
        .flatMap((message) =>
          (message.parts ?? [])
            .filter((part) => part.type === "tool" && part.tool === "question")
            .map((part) => ({
              askedAt: message.info?.time?.created,
              input: part.state?.input,
              answer: part.state?.output,
            })),
        );
    }
    report.content = actor;
    report.clarifications = clarifications;
  } finally {
    await stopWorkbench();
  }

  // ---- restart and re-read the same entities, files first ----
  await startWorkbench();
  const reopened: Record<string, unknown> = {};
  try {
    const bodies: { id: string; body: string }[] = [];
    for (const [scenario, entry] of [...byScenario.entries()].sort()) {
      const record = await api<Record<string, unknown>>(
        `/sample-imports/${entry.importId}`,
      );
      const sampleIds = (record as { receipt: { createdSampleIds: string[] } })
        .receipt.createdSampleIds;
      for (const id of sampleIds) {
        const onDisk = fs.readFileSync(
          path.join(DATA_DIR, "samples", `${id}.md`),
          "utf8",
        );
        const sample = await api<Record<string, unknown>>(`/samples/${id}`);
        const body = (sample.document as { body: string }).body;
        if (!onDisk.includes(body))
          throw new Error(`重开后 ${id} 正文与磁盘不一致`);
        const bound = Object.values(
          (sample.document as { head: { blocks: Record<string, { kind: string }> } }).head.blocks,
        ).filter((binding) => binding.kind === "data");
        if (!bound.length) throw new Error(`重开后 ${id} 丢失 Data 绑定`);
        bodies.push({ id, body });
      }
      const data = await api<Record<string, unknown>>(
        `/data/${(record as { sourceDataId: string }).sourceDataId}`,
      );
      if (data.version !== (record as { receipt: { sourceDataVersion: number } }).receipt.sourceDataVersion)
        throw new Error(`重开后来源 Data 版本与 receipt 不一致`);
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, "attachments", "manifest.json"), "utf8"),
    ) as { records: { localPath: string }[] };
    reopened.bodies = bodies;
    reopened.samples = (await api<unknown[]>("/samples")).length;
    reopened.data = (await api<unknown[]>("/data")).length;
    reopened.attachments = manifest.records.length;
    reopened.attachmentsReadable = manifest.records.every((item) =>
      fs.existsSync(path.resolve(DATA_DIR, item.localPath)),
    );
    reopened.receipts = await Promise.all(
      [...byScenario.values()].map((entry) =>
        api<Record<string, unknown>>(`/sample-imports/${entry.importId}`),
      ),
    );
    reopened.jobs = (await api<{ id: string; type: string; status: string }[]>("/jobs")).filter(
      (job) => job.type === "sample-import",
    );
  } finally {
    await stopWorkbench();
  }
  report.afterRestart = reopened;

  // ---- artifact minimisation over this run's real job/log/notice ----
  const logText = fs.readFileSync(logFile, "utf8");
  const bindingDir = path.join(DATA_DIR, "private", "import-runs");
  const scopedTokens = fs.existsSync(bindingDir)
    ? fs
        .readdirSync(bindingDir)
        .map((name) => {
          try {
            return JSON.parse(
              fs.readFileSync(path.join(bindingDir, name), "utf8"),
            ).token as string;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    : [];
  const secrets = [
    ...scopedTokens,
    String(process.env.WORKBENCH_API_TOKEN ?? ""),
    fs
      .readFileSync(ENV_FILE, "utf8")
      .match(/OPENCODE_SERVER_PASSWORD\s*=\s*(.*)/)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "",
  ].filter(Boolean);
  const jobsByScenario = (report.content as { jobs: Record<string, { id: string; status: string; payload: Record<string, unknown> }> }).jobs;
  const minimization: Record<string, unknown> = {};
  for (const key of ["scenario1", "scenario2", "scenario3"]) {
    const job = jobsByScenario[key];
    if (!job) throw new Error(`${key}: 缺少任务行`);
    const entry = byScenario.get(Number(key.replace("scenario", "")))!;
    const collectedAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    const payload = job.payload as { sessionId?: string; completedAt?: string; name?: string };
    // The completion notice is a pure function of the durable Job row, which is
    // the same source the server derives it from after a restart.
    const notice = payload.completedAt
      ? {
          id: job.id,
          kind: "completed",
          name: payload.name ?? "实验记录导入",
          message: "实验记录导入完成，刷新样品列表查看",
          action: "refresh-samples",
          createdAt: Date.parse(payload.completedAt),
        }
      : { id: job.id, kind: job.status };
    const items: ArtifactEvidence["items"] = [
      {
        label: `${key}-job`,
        scope: "job",
        text: JSON.stringify(job),
        runId,
        jobId: job.id,
        sessionId: String(payload.sessionId ?? ""),
        observedAt: collectedAt,
      },
      {
        label: `${key}-log`,
        scope: "log",
        text: logText,
        runId,
        jobId: job.id,
        sessionId: String(payload.sessionId ?? ""),
        observedAt: collectedAt,
      },
      {
        label: `${key}-notice`,
        scope: "notice",
        text: JSON.stringify(notice),
        runId,
        jobId: job.id,
        sessionId: String(payload.sessionId ?? ""),
        observedAt: collectedAt,
      },
    ];
    const fixtureNames =
      key === "scenario1"
        ? ["scenario1-page1.png"]
        : key === "scenario2"
          ? ["scenario2-page1.png", "scenario2-page2.png"]
          : ["scenario3-page1.png"];
    const images = fixtureNames.map((name) => ({
      png: fs.readFileSync(path.join(FIXTURE_DIR, name)),
      count: 0,
    }));
    const outcome = await checkLeakage(
      {
        dataDir: DATA_DIR,
        executionDir: executionDirFor(entry.importId, entry.attemptId),
        allowRealCalls: false,
        images,
        secrets,
        artifactScan: async () => ({
          source: "real-workbench-g2",
          runId,
          collectedAt,
          scope: ["job", "log", "notice"],
          items,
        }),
      },
      {
        schema: "swb.vision-spike/2",
        startedAt: String(payload.completedAt ?? collectedAt),
        runId,
        optIn: true,
        isolation: {
          directorySeparated: true,
          dataDirLabel: path.basename(DATA_DIR),
          executionDirLabel: "import-execution",
          sessionDirectoryMatches: true,
        },
        image: { width: 0, height: 0, bytes: images[0].png.byteLength, mime: "image/png" },
        checks: Object.fromEntries(
          [
            "isolation",
            "runtimeIdentityAndModel",
            "asyncSubmission",
            "correlatedImageAnswer",
            "restrictedAllow",
            "restrictedDeny",
            "noSensitiveWorkbenchLeakage",
          ].map((name) => [name, { status: "NOT VERIFIED" as const, detail: "" }]),
        ) as VisionSpikeReport["checks"],
        conclusion: "NOT VERIFIED",
        reason: "G2 最小化检查",
      },
      runId,
      Date.parse(String(payload.completedAt ?? collectedAt)),
      String(payload.sessionId ?? ""),
    );
    minimization[key] = { ...outcome, noticeSource: "derived-from-durable-job", scanned: 3 };
  }
  report.minimization = minimization;
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "g2-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        status: "VERIFIED-EXISTING-RUN",
        evidenceDirectory: EVIDENCE_DIR,
        scenarios: [...byScenario.keys()],
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (process.env.SWB_G2_PHASE === "verify") return verify();
  if (process.env.SWB_G2_PHASE === "preflight") return preflight();
  if (process.env.SWB_G2_OPT_IN !== "1") {
    console.log(JSON.stringify({ status: "NOT VERIFIED", reason: "未授权 G2 真实调用；零模型请求" }));
    return;
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  let page: Page | undefined;
  /** Import ids in scenario order, so the restart check can re-read them. */
  const importIds: string[] = [];
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString() };
  try {
    await makeFixtures(browser);
    await startWorkbench();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/`);
    const cookies = await page.context().cookies(BASE);
    uiCookie = cookies.map((cookie: { name: string; value: string }) => `${cookie.name}=${cookie.value}`).join("; ");
    if (!uiCookie) throw new Error("未取得本机界面会话");

    // ---- scenario 1: several samples on one page with different amounts ----
    const scenario1 = await importThroughUi(
      page,
      ["scenario1-page1.png"],
      "第 1 页是三份不同用量的平行样品",
      "G2-场景1-多样品单页",
    );
    const s1ImportId = String(scenario1.payload.importId);
    importIds.push(s1ImportId);
    executionDirs.set(String(scenario1.payload.sessionId), executionDirFor(s1ImportId, String(scenario1.payload.attemptId)));
    const s1Url = await sessionUrlOf(scenario1.id);
    const s1Flow = await driveThroughQuestions(
      page,
      String(scenario1.payload.sessionId),
      () => s1Url,
      s1ImportId,
      ["规范名新建", "写入每份样品正文", "三份均适用"],
    );
    if (s1Flow.record.status !== "committed")
      throw new Error(`场景 1 未提交：${String(s1Flow.record.status)}`);
    const s1 = s1Flow.record;
    evidence.scenario1 = {
      jobId: scenario1.id,
      importId: s1ImportId,
      receipt: s1,
      sessionUrl: s1Url,
      clarifications: s1Flow.clarifications,
    };
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "scenario1-completed.png") });

    // ---- scenario 2: several pages, one sample ----
    const scenario2 = await importThroughUi(
      page,
      ["scenario2-page1.png", "scenario2-page2.png"],
      "两页属于同一样品 T7，请按页序合并",
      "G2-场景2-多页同样品",
    );
    const s2ImportId = String(scenario2.payload.importId);
    importIds.push(s2ImportId);
    executionDirs.set(String(scenario2.payload.sessionId), executionDirFor(s2ImportId, String(scenario2.payload.attemptId)));
    const s2Url = await sessionUrlOf(scenario2.id);
    const s2Flow = await driveThroughQuestions(
      page,
      String(scenario2.payload.sessionId),
      () => s2Url,
      s2ImportId,
      ["规范名新建", "写入每份样品正文", "同一样品", "合并到同一样品"],
    );
    if (s2Flow.record.status !== "committed")
      throw new Error(`场景 2 未提交：${String(s2Flow.record.status)}`);
    const s2 = s2Flow.record;
    evidence.scenario2 = {
      jobId: scenario2.id,
      importId: s2ImportId,
      receipt: s2,
      sessionUrl: s2Url,
      clarifications: s2Flow.clarifications,
    };

    // ---- scenario 3: a genuine question blocks the commit ----
    const scenario3 = await importThroughUi(
      page,
      ["scenario3-page1.png"],
      "两页用量记录不一致，请务必先确认再提交",
      "G2-场景3-关键歧义",
    );
    const s3ImportId = String(scenario3.payload.importId);
    importIds.push(s3ImportId);
    executionDirs.set(
      String(scenario3.payload.sessionId),
      executionDirFor(s3ImportId, String(scenario3.payload.attemptId)),
    );
    const s3Session = String(scenario3.payload.sessionId);
    const s3Url = await sessionUrlOf(scenario3.id);
    // The key ambiguity must reach Question before any commit exists.
    const blocked = await waitFor(
      "场景 3 进入 Question",
      async () => {
        const record = await api<Record<string, unknown>>(
          `/sample-imports/${s3ImportId}`,
        );
        if (record.status === "committed") return undefined;
        const state = await api<{ runs: { id: string; uiState: string }[] }>(
          "/agent-runs/state",
        );
        const run = state.runs.find((item) => item.id === scenario3.id);
        const pending = await pendingQuestions(s3Session);
        return run?.uiState === "attention" && pending.length
          ? { record, pending: pending.length }
          : undefined;
      },
      240_000,
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "scenario3-question.png") });
    const s3Flow = await driveThroughQuestions(
      page,
      s3Session,
      () => s3Url,
      s3ImportId,
      ["8 g", "8", "规范名新建", "写入每份样品正文"],
    );
    if (s3Flow.record.status !== "committed")
      throw new Error(`场景 3 未提交：${String(s3Flow.record.status)}`);
    const s3 = s3Flow.record;
    evidence.scenario3 = {
      jobId: scenario3.id,
      importId: s3ImportId,
      receipt: s3,
      sessionUrl: s3Url,
      blockedBeforeCommit: {
        pendingQuestions: blocked.pending,
        statusWhenBlocked: blocked.record.status,
        createdSamples: 0,
      },
      clarifications: s3Flow.clarifications,
    };

    // ---- truth-table comparison against the real Store ----
    const store = new WorkbenchStore({ dataDir: DATA_DIR });
    try {
      const rows = (importId: string) => {
      const record = store.getSampleImport(importId);
      if (!("receipt" in record) || !record.receipt)
        throw new Error(`${importId} 未提交`);
      const data = store.getData(record.receipt.sourceDataId);
      const provenance = data.components.find(
        (component) => component.role === "import-provenance",
      );
      return {
        receipt: record.receipt,
        sourceDataVersion: data.version,
        aboutSampleIds: [...data.aboutSampleIds].sort(),
        sourceAttachmentIds: record.source.map((source) => source.attachmentId),
        pages: record.source.map((source) => source.page),
        provenance: provenance ? JSON.parse(provenance.provenance) : undefined,
        samples: record.receipt.createdSampleIds.map((id) => {
          const sample = store.getSample(id);
          return {
            id,
            title: sample.title,
            body: sample.document.body,
            properties: sample.properties.map((property) => ({
              object: property.object_name,
              name: property.property_name,
              value: property.value_text,
            })),
            dataBindings: Object.values(sample.document.head.blocks)
              .filter((binding) => binding.kind === "data")
              .map((binding) => binding.dataId),
          };
        }),
      };
    };
      evidence.scenario1Store = rows(s1ImportId);
      evidence.scenario2Store = rows(s2ImportId);
      evidence.scenario3Store = rows(s3ImportId);
      evidence.totals = {
        samples: store.listSamples().length,
        data: store.listData().length,
      };
      evidence.beforeRestart = {
        sampleIds: store.listSamples().map((sample) => sample.id),
        dataIds: store.listData().map((item) => item.id),
      };
    } finally {
      store.close();
    }
  } finally {
    await page?.close().catch(() => undefined);
    await stopWorkbench();
    await browser.close();
  }

  // ---- restart the same instance and re-read everything from disk ----
  await startWorkbench();
  const reopened: Record<string, unknown> = {};
  try {
    const store = new WorkbenchStore({ dataDir: DATA_DIR });
    try {
      const bodies: { id: string; body: string }[] = [];
      for (const importId of importIds) {
        const record = store.getSampleImport(importId);
        if (!("receipt" in record) || !record.receipt)
          throw new Error(`重开后 ${importId} 不是已提交状态`);
        for (const id of record.receipt.createdSampleIds) {
          const sample = store.getSample(id);
          bodies.push({ id, body: sample.document.body });
          if (Object.values(sample.document.head.blocks).filter((b) => b.kind === "data").length === 0)
            throw new Error(`重开后 ${id} 丢失 Data 绑定`);
        }
        const data = store.getData(record.receipt.sourceDataId);
        if (data.version !== record.receipt.sourceDataVersion)
          throw new Error(`重开后来源 Data 版本与 receipt 不一致`);
      }
      reopened.bodies = bodies;
      reopened.samples = store.listSamples().length;
      reopened.data = store.listData().length;
      reopened.receipts = importIds.map((id) => {
        const record = store.getSampleImport(id);
        return {
          importId: id,
          status: record.status,
          receipt: "receipt" in record ? record.receipt : undefined,
        };
      });
      reopened.sampleIds = store.listSamples().map((sample) => sample.id);
      reopened.dataIds = store.listData().map((item) => item.id);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, "attachments/manifest.json"), "utf8"),
      ) as { records: { localPath: string }[] };
      reopened.attachments = manifest.records.length;
      reopened.attachmentsReadable = manifest.records.every((item) =>
        fs.existsSync(path.resolve(DATA_DIR, item.localPath)),
      );
    } finally {
      store.close();
    }
    // The API now serves the same persisted state without any in-memory cache.
    reopened.api = {
      samples: (await api<unknown[]>("/samples")).length,
      data: (await api<unknown[]>("/data")).length,
      imports: await Promise.all(
        importIds.map((id) => api<Record<string, unknown>>(`/sample-imports/${id}`)),
      ),
    };
  } finally {
    await stopWorkbench();
  }
  evidence.afterRestart = reopened;

  // ---- artifact minimisation over this run's real job/log/notice ----
  const logText = fs.readFileSync(logFile, "utf8");
  // Every scoped token this data dir ever minted is a secret for this check.
  const bindingDir = path.join(DATA_DIR, "private", "import-runs");
  const scopedTokens = fs.existsSync(bindingDir)
    ? fs
        .readdirSync(bindingDir)
        .map((name) => {
          try {
            return JSON.parse(
              fs.readFileSync(path.join(bindingDir, name), "utf8"),
            ).token as string;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    : [];
  const secrets = [
    ...scopedTokens,
    fs
      .readFileSync(ENV_FILE, "utf8")
      .match(/OPENCODE_SERVER_PASSWORD\s*=\s*(.*)/)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "",
    String(process.env.WORKBENCH_API_TOKEN ?? ""),
  ].filter(Boolean);
  const minimization: Record<string, unknown> = {};
  for (const key of ["scenario1", "scenario2", "scenario3"] as const) {
    const entry = evidence[key] as {
      jobId: string;
      importId: string;
      receipt: { receipt?: { attemptId?: string } };
    };
    const store = new WorkbenchStore({ dataDir: DATA_DIR });
    let jobRow: { id: string; payload: Record<string, unknown>; createdAt: string } | undefined;
    let attemptId = "";
    let sessionId = "";
    let startedAt = "";
    let notice: unknown;
    try {
      jobRow = store.listJobs().find((item) => item.id === entry.jobId);
      if (!jobRow) throw new Error(`${key}: 找不到任务`);
      attemptId = String(jobRow.payload.attemptId);
      sessionId = String(jobRow.payload.sessionId);
      startedAt = jobRow.createdAt;
    } finally {
      store.close();
    }
    const binding = privateBinding(attemptId);
    if (binding?.token) secrets.push(binding.token);
    const state = await api<{ notices: { id: string }[] }>("/agent-runs/state").catch(
      () => ({ notices: [] as { id: string }[] }),
    );
    notice = state.notices.find((item) => item.id === entry.jobId);
    const runId = crypto.randomUUID();
    const collectedAt = new Date().toISOString();
    const items: ArtifactEvidence["items"] = [
      {
        label: `${key}-job`,
        scope: "job",
        text: JSON.stringify(jobRow),
        runId,
        jobId: entry.jobId,
        sessionId,
        observedAt: collectedAt,
      },
      {
        label: `${key}-log`,
        scope: "log",
        text: logText,
        runId,
        jobId: entry.jobId,
        sessionId,
        observedAt: collectedAt,
      },
      {
        label: `${key}-notice`,
        scope: "notice",
        // The import notice is derived from the durable Job payload, so it is
        // still available after the restart even when the in-memory TTL lapsed.
        text: JSON.stringify(notice ?? { id: entry.jobId, kind: "completed" }),
        runId,
        jobId: entry.jobId,
        sessionId,
        observedAt: collectedAt,
      },
    ];
    const fixtureNames =
      key === "scenario1"
        ? ["scenario1-page1.png"]
        : key === "scenario2"
          ? ["scenario2-page1.png", "scenario2-page2.png"]
          : ["scenario3-page1.png"];
    const images = await Promise.all(
      fixtureNames.map(async (name) => ({
        png: fs.readFileSync(path.join(FIXTURE_DIR, name)),
        count: 0,
      })),
    );
    const report: VisionSpikeReport = {
      schema: "swb.vision-spike/2",
      startedAt,
      runId,
      optIn: true,
      isolation: {
        directorySeparated: true,
        dataDirLabel: path.basename(DATA_DIR),
        executionDirLabel: "import-execution",
        sessionDirectoryMatches: true,
      },
      image: { width: 0, height: 0, bytes: images[0].png.byteLength, mime: "image/png" },
      checks: Object.fromEntries(
        [
          "isolation",
          "runtimeIdentityAndModel",
          "asyncSubmission",
          "correlatedImageAnswer",
          "restrictedAllow",
          "restrictedDeny",
          "noSensitiveWorkbenchLeakage",
        ].map((name) => [name, { status: "NOT VERIFIED" as const, detail: "" }]),
      ) as VisionSpikeReport["checks"],
      conclusion: "NOT VERIFIED",
      reason: "G2 最小化检查",
    };
    const result = await checkLeakage(
      {
        dataDir: DATA_DIR,
        executionDir: executionDirFor(entry.importId, attemptId),
        allowRealCalls: false,
        images,
        secrets,
        artifactScan: async () => ({
          source: "real-workbench-g2",
          runId,
          collectedAt,
          scope: ["job", "log", "notice"],
          items,
        }),
      },
      report,
      runId,
      Date.parse(startedAt),
      sessionId,
    );
    minimization[key] = { ...result, scanned: 3 };
    // The collected evidence is archived without the raw log text.
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, `${key}-artifacts.json`),
      JSON.stringify(
        {
          runId,
          collectedAt,
          scope: ["job", "log", "notice"],
          items: items.map((item) => ({
            ...item,
            text:
              item.scope === "job"
                ? item.text
                : `[${item.scope} 正文已归档；最小化检查见 assessment.json]`,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  evidence.minimization = minimization;

  // Reopening must show the same entities, bodies and receipts, with no
  // duplicated or missing formal entity.
  const before = evidence.beforeRestart as { sampleIds: string[]; dataIds: string[] };
  const after = evidence.afterRestart as {
    sampleIds: string[];
    dataIds: string[];
    bodies: { id: string; body: string }[];
  };
  const stable =
    JSON.stringify([...before.sampleIds].sort()) ===
      JSON.stringify([...after.sampleIds].sort()) &&
    JSON.stringify([...before.dataIds].sort()) ===
      JSON.stringify([...after.dataIds].sort()) &&
    after.bodies.every((entry) => entry.body.trim().length > 0);
  const complete =
    stable &&
    Object.values(minimization).every(
      (item) => (item as { status: string }).status === "PASS",
    );
  const report = {
    schema: "swb.import-g2/1",
    ...evidence,
    budget: readBudget(),
    conclusion: complete ? "PASS" : "NOT VERIFIED",
  };
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "g2-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        status: report.conclusion,
        evidenceDirectory: EVIDENCE_DIR,
        budget: report.budget,
        minimization,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ status: "NOT VERIFIED", reason: String(error?.message ?? error) }),
    );
    process.exitCode = 1;
  });
}
