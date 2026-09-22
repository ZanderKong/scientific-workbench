/**
 * AI record import — browser acceptance.
 *
 * Only the managed OpenCode runtime is replaced (by the existing V1 HTTP fake).
 * The real UI, HTTP layer, multipart upload, parser, B1 commit, receipt and file
 * persistence all run for real, and the "model" performs its draft/commit work
 * through the public Workbench API.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { realImageFixtures } from "../../apps/server/src/test-images";
import { FakeOpenCode } from "./fake-opencode";

const fake = new FakeOpenCode();
const runtimeUrl = process.env.SWB_IMPORT_RUNTIME_URL ?? "http://127.0.0.1:14319";
const runtimePort = Number(new URL(runtimeUrl).port);
/** Images the runtime received, in submission order. */
let promptImages: { mimeType: string; filename: string }[] = [];
let promptTexts: string[] = [];
/** The runtime-side script failed loudly instead of being swallowed. */
let promptError: unknown;

test.beforeAll(async () => {
  await fake.start(runtimePort);
});

test.beforeEach(async ({ request }) => {
  promptImages = [];
  promptTexts = [];
  promptError = undefined;
  fake.questions = [];
  fake.permissions = [];
  fake.replies = [];
  fake.active.clear();
  fake.asyncPromptCalls = 0;
  fake.messages.clear();
  fake.sessions.clear();
  fake.onPrompt = undefined;
  // Import cancel/start are local-UI routes, so cleanup only dismisses. Every
  // assertion about formal entities is made against the API inside a test.
  for (const job of await jobs(request)) {
    if (job.type !== "sample-import") continue;
    await request
      .post(`/api/v1/agent-runs/${job.id}/dismiss`)
      .catch(() => undefined);
  }
});

async function jobs(request: APIRequestContext) {
  return (await (await request.get("/api/v1/jobs")).json()) as {
    id: string;
    type: string;
    status: string;
    payload: Record<string, unknown>;
  }[];
}

/** Import jobs created after `known` ids, i.e. by the current test only. */
async function newImportJobs(
  request: APIRequestContext,
  known: Set<string>,
) {
  return (await jobs(request)).filter(
    (job) => job.type === "sample-import" && !known.has(job.id),
  );
}

async function jobIds(request: APIRequestContext) {
  return new Set((await jobs(request)).map((job) => job.id));
}

async function samples(request: APIRequestContext) {
  return (await (await request.get("/api/v1/samples")).json()) as {
    id: string;
    code: string;
  }[];
}

function imageFile(name: string, bytes: Buffer, mimeType = "image/png") {
  return { name, mimeType, buffer: bytes };
}

/** Opens the sample list and the AI import modal through the visible menu. */
async function openImportModal(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "样品" })).toBeVisible();
  await page.getByRole("button", { name: "更多新建方式" }).click();
  await page.getByRole("menuitem", { name: "AI 从实验记录新建样品" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI 从实验记录新建样品" }),
  ).toBeVisible();
}

/** Starts the import through the modal and returns the created job. */
async function startImport(
  page: Page,
  request: APIRequestContext,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  note?: string,
) {
  await page
    .getByLabel("选择实验记录图片")
    .setInputFiles(files);
  await expect(page.getByText("已上传")).toHaveCount(files.length);
  if (note) await page.getByLabel("导入补充说明").fill(note);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI 从实验记录新建样品" }),
  ).toBeHidden();
  const created = (await jobs(request)).filter(
    (job) => job.type === "sample-import",
  );
  expect(created.length).toBeGreaterThan(0);
  return created[0];
}

/** The runtime-side "model": performs the real draft + commit through the API. */
function scriptCommit(): void {
  fake.onPrompt = async ({ sessionId, messageId, text, imageParts }) => {
    promptTexts.push(text);
    promptImages.push(...imageParts);
    try {
    const importId = /导入 ([0-9a-f-]{36})/.exec(text)?.[1];
    if (!importId) throw new Error("prompt 缺少导入身份");
    const headers = {
      authorization: `Bearer ${process.env.SWB_ACCEPTANCE_TOKEN}`,
    };
    const base = `http://127.0.0.1:${Number(process.env.WORKBENCH_PORT ?? 14317)}/api/v1`;
    const record = await (
      await fetch(`${base}/sample-imports/${importId}`, { headers })
    ).json();
    const draft = {
      schemaVersion: 1,
      samples: [
        {
          key: "page-1",
          title: "模拟显微观察",
          body: "- 第 1 页记录红色方块观察。",
          sourceMappings: [
            {
              attachmentId: record.source[0].attachmentId,
              page: 1,
              componentId: record.source[0].componentId,
              positions: "整页",
              transcription: "红色方块",
            },
          ],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [],
    };
    const saved = await fetch(`${base}/sample-imports/${importId}/draft`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        attemptId: record.attempt.id,
        expectedVersion: record.recordVersion,
        expectedDraftVersion: 0,
        draft,
      }),
    });
    if (!saved.ok) throw new Error(`draft 保存失败 ${saved.status}`);
    const afterDraft = await (
      await fetch(`${base}/sample-imports/${importId}`, { headers })
    ).json();
    const data = await (
      await fetch(`${base}/data/${record.sourceDataId}`, { headers })
    ).json();
    const committed = await fetch(`${base}/sample-imports/${importId}/commit`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        attemptId: record.attempt.id,
        expectedVersion: afterDraft.recordVersion,
        draftVersion: afterDraft.draftVersion,
        draftHash: afterDraft.draftHash,
        sourceDataVersion: data.version,
        commitFingerprint: afterDraft.commitFingerprint,
      }),
    });
    if (!committed.ok)
      throw new Error(`commit 失败 ${committed.status}: ${await committed.text()}`);
    fake.addAssistant(sessionId, "已提交。", messageId);
    } catch (error) {
      promptError = error;
      throw error;
    }
  };
}

/** The import block for exactly one job. */
function blockFor(page: Page, runId: string) {
  return page.locator(`button.taskBlock[data-run-id="${runId}"]`);
}

/** Fails the test with the runtime-side error instead of timing out later. */
async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  status: string,
) {
  await expect
    .poll(async () => {
      if (promptError) throw promptError;
      const found = (await jobs(request)).find((job) => job.id === jobId);
      return found?.status;
    }, { message: `任务 ${jobId} 未达到 ${status}` })
    .toBe(status);
}

test("ordinary sample creation is unchanged next to the AI entry", async ({
  page,
  request,
}) => {
  const before = await samples(request);
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  await expect(page.locator(".editorPage")).toBeVisible();
  await expect.poll(async () => (await samples(request)).length).toBe(
    before.length + 1,
  );
});

test("uploads pages in order, retries a failed upload and completes only on manual refresh", async ({
  page,
  request,
}) => {
  const fixtures = realImageFixtures();
  const before = await samples(request);
  const beforeJobs = await jobIds(request);
  await openImportModal(page);

  // One upload is rejected once; the page keeps its slot and can be retried.
  let failedOnce = false;
  await page.route("**/api/v1/attachments/stream", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: "网络中断" }) });
      return;
    }
    await route.continue();
  });

  await page.getByLabel("选择实验记录图片").setInputFiles([
    imageFile("page-1.png", fixtures.PNG),
    imageFile("page-2.webp", fixtures.WEBP, "image/webp"),
    imageFile("page-3.jpg", fixtures.JPEG, "image/jpeg"),
  ]);
  await expect(page.getByRole("button", { name: /重试上传第 \d+ 页/ })).toBeVisible();
  await page.getByRole("button", { name: /重试上传第 \d+ 页/ }).click();
  await expect(page.getByText("已上传")).toHaveCount(3);
  await page.unroute("**/api/v1/attachments/stream");

  // Page order is user-controlled: move page 3 to the top.
  await page.getByRole("button", { name: "第 3 页上移" }).click();
  await page.getByRole("button", { name: "第 2 页上移" }).click();
  const order = await page
    .locator(".sampleImportPages li span")
    .filter({ hasText: /\.(png|webp|jpg)$/ })
    .allTextContents();
  expect(order.slice(0, 3)).toEqual([
    "page-3.jpg",
    "page-1.png",
    "page-2.webp",
  ]);

  // Oversized and wrong-type files are refused before any upload.
  await page.getByLabel("选择实验记录图片").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
  ]);
  await expect(page.getByRole("alert")).toContainText("JPEG、PNG 或 WebP");

  scriptCommit();
  await page.getByLabel("导入补充说明").fill("第 1 页是红色方块");
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI 从实验记录新建样品" }),
  ).toBeHidden();
  const createdJobs = await newImportJobs(request, beforeJobs);
  expect(createdJobs).toHaveLength(1);
  const job = createdJobs[0];
  await waitForJob(request, job.id, "succeeded");
  // The runtime received the pages in the order the user arranged.
  expect(promptImages.map((image) => image.mimeType)).toEqual([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  expect(promptImages.map((image) => image.filename)).toEqual([
    "page-1",
    "page-2",
    "page-3",
  ]);

  // The server publishes the manual-refresh notice for this job.
  const noticeState = await (
    await request.get("/api/v1/agent-runs/state")
  ).json();
  expect(
    (noticeState.notices as { id: string; action?: string }[]).filter(
      (notice) => notice.id === job.id && notice.action === "refresh-samples",
    ),
  ).toHaveLength(1);
  // The completion banner appears by itself; the list is NOT refreshed yet.
  const banner = page.locator(".taskCompletion.withAction");
  await expect(banner).toContainText("实验记录导入完成，刷新样品列表查看");
  const committed = await samples(request);
  expect(committed).toHaveLength(before.length + 1);
  const created = committed.find(
    (row) => !before.some((item) => item.id === row.id),
  )!;
  await expect(page.locator("tbody tr").filter({ hasText: created.code })).toHaveCount(0);

  // Clicking the banner body opens nothing and navigates nowhere.
  let popups = 0;
  page.on("popup", () => {
    popups += 1;
  });
  await banner.click({ position: { x: 6, y: 17 } });
  await page.waitForTimeout(200);
  expect(popups).toBe(0);
  await expect(page.locator("tbody tr").filter({ hasText: created.code })).toHaveCount(0);

  // A query set before the refresh survives it.
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByLabel("关键词").fill("不存在的样品");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".emptyState")).toBeVisible();

  await page.getByRole("button", { name: "刷新样品" }).click();
  await expect(page.locator(".emptyState")).toBeVisible();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "清除" }).click();
  await expect(
    page.locator("tbody tr").filter({ hasText: created.code }),
  ).toHaveCount(1);

  // Reopening reads the committed record back from disk.
  await page.reload();
  await expect(
    page.locator("tbody tr").filter({ hasText: created.code }),
  ).toHaveCount(1);
});

test("a clarification question blocks the commit and offers the real session link", async ({
  page,
  request,
}) => {
  const fixtures = realImageFixtures();
  const before = await samples(request);
  fake.onPrompt = ({ sessionId }) => {
    fake.askQuestion(sessionId, "第三行的用量单位是什么？");
  };
  await openImportModal(page);
  const job = await startImport(page, request, [
    imageFile("record.png", fixtures.PNG),
  ]);

  const block = blockFor(page, job.id);
  await expect(block).toHaveClass(/attention/);
  await expect(page.locator(`[data-run-panel="${job.id}"]`)).toContainText(
    "需要澄清",
  );
  // No commit happened, so nothing was created.
  expect(await samples(request)).toHaveLength(before.length);

  // The clarification entry opens the runtime's own session link.
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.reload();
  const blockAfter = blockFor(page, job.id);
  await expect(blockAfter).toHaveClass(/attention/);
  await blockAfter.click();
  await expect(
    page.locator(`[data-run-panel="${job.id}"]`),
  ).toBeVisible();
  await page
    .locator(`[data-run-panel="${job.id}"]`)
    .getByRole("button", { name: "打开会话澄清" })
    .click();
  const opened = await page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened,
  );
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain("/server/");
  expect(opened[0]).toContain("/session/ses_fake_");
  expect(opened[0].startsWith(runtimeUrl)).toBe(true);
});

test("cancelling and retrying never leaves an active window or a formal entity", async ({
  page,
  request,
}) => {
  const fixtures = realImageFixtures();
  const before = await samples(request);
  const beforeJobs = await jobIds(request);
  // The runtime never answers, so the import stays observably running.
  fake.onPrompt = () => undefined;
  await openImportModal(page);
  const job = await startImport(page, request, [
    imageFile("record.png", fixtures.PNG),
  ]);
  const importId = String(job.payload.importId);
  const attemptId = String(job.payload.attemptId);

  const block = blockFor(page, job.id);
  await expect(block).toHaveClass(/running/);
  await block.click();
  const panel = page.locator(`[data-run-panel="${job.id}"]`);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "取消" }).click();
  await expect
    .poll(async () => {
      const record = await (
        await request.get(`/api/v1/sample-imports/${importId}`)
      ).json();
      return record.status;
    })
    .toBe("cancelled");
  const revoked = await (
    await request.get(`/api/v1/sample-imports/${importId}`)
  ).json();
  expect(revoked.attempt.status).toBe("revoked");
  expect(await samples(request)).toHaveLength(before.length);

  // Retry issues a new attempt, and the old one is never revived.
  await expect(block).toHaveClass(/failed/);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "重试" }).click();
  await expect
    .poll(async () => {
      const record = await (
        await request.get(`/api/v1/sample-imports/${importId}`)
      ).json();
      return record.attempt.id;
    })
    .not.toBe(attemptId);
  const retried = await (
    await request.get(`/api/v1/sample-imports/${importId}`)
  ).json();
  expect(retried.attempt.status).toBe("active");
  expect(await samples(request)).toHaveLength(before.length);
  await expect
    .poll(
      async () =>
        (await newImportJobs(request, beforeJobs)).filter(
          (item) => item.status === "running",
        ).length,
    )
    .toBe(1);
  const running = (await newImportJobs(request, beforeJobs)).filter(
    (item) => item.status === "running",
  );
  expect(running[0].payload.attemptId).toBe(retried.attempt.id);
});

test("a lost prepare or start response resumes with the same import identity", async ({
  page,
  request,
}) => {
  const fixtures = realImageFixtures();
  const beforeJobs = await jobIds(request);
  scriptCommit();
  await openImportModal(page);
  let prepareFailed = false;
  let startFailed = false;
  await page.route("**/api/v1/sample-imports", async (route) => {
    if (route.request().method() === "POST" && !prepareFailed) {
      prepareFailed = true;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: "网关超时" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/sample-imports/*/agent/start", async (route) => {
    if (!startFailed) {
      startFailed = true;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: "网关超时" }) });
      return;
    }
    await route.continue();
  });
  await page.getByLabel("选择实验记录图片").setInputFiles([
    imageFile("record.png", fixtures.PNG),
  ]);
  await expect(page.getByText("已上传")).toHaveCount(1);
  await page.getByRole("button", { name: "开始导入" }).click();
  // The prepare response was lost: the modal reports it and offers the retry.
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "查询并重试启动" }).click();
  // The lost start response is retried with the same identity and version.
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "查询并重试启动" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI 从实验记录新建样品" }),
  ).toBeHidden();

  const createdJobs = await newImportJobs(request, beforeJobs);
  expect(createdJobs).toHaveLength(1);
  const record = await (
    await request.get(
      `/api/v1/sample-imports/${String(createdJobs[0].payload.importId)}`,
    )
  ).json();
  // Same import identity and the same single source image: no re-fingerprint.
  expect(record.attempt.id).toBe(createdJobs[0].payload.attemptId);
  expect(record.source).toHaveLength(1);
});
