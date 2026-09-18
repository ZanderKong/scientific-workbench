import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FakeOpenCode } from "./fake-opencode";

const fake = new FakeOpenCode();
const fakePort = Number(process.env.SWB_FAKE_OPENCODE_PORT ?? 45998);
const agentDir = () => `${process.env.SWB_ACCEPTANCE_DIR}-Agent`;

test.beforeAll(async () => {
  await fake.start(fakePort);
});
test.afterAll(async () => {
  await fake.stop();
});

test.beforeEach(async ({ request }) => {
  fake.permissions = [];
  fake.questions = [];
  fake.replies = [];
  fake.active.clear();
  fake.asyncPromptCalls = 0;
  fake.syncPromptCalls = 0;
  const jobs = (await (await request.get("/api/v1/jobs")).json()) as {
    id: string;
    type: string;
    status: string;
  }[];
  for (const job of jobs) {
    if (job.type !== "agent-run") continue;
    if (job.status === "running" || job.status === "queued")
      await request.post(`/api/v1/jobs/${job.id}/cancel`);
    else if (job.status === "succeeded" || job.status === "failed")
      await request.post(`/api/v1/agent-runs/${job.id}/dismiss`);
  }
});

async function configure(
  request: APIRequestContext,
  permissionMode: "ask" | "auto-allow" = "ask",
) {
  const response = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: fake.baseUrl,
      username: "opencode",
      executionDir: agentDir(),
      permissionMode,
    },
  });
  if (!response.ok())
    throw new Error(
      `configure failed ${response.status()}: ${await response.text()}`,
    );
}

async function createRun(
  request: APIRequestContext,
  name: string,
  prompt = "请分析",
) {
  const response = await request.post("/api/v1/agent-runs", {
    data: { name, prompt },
  });
  expect(response.ok()).toBeTruthy();
  await waitForStream();
  return (await response.json()) as { id: string; sessionUrl?: string };
}

async function sessionIdOf(request: APIRequestContext, runId: string) {
  const jobs = (await (await request.get("/api/v1/jobs")).json()) as {
    id: string;
    payload: { sessionId?: string };
  }[];
  return jobs.find((job) => job.id === runId)?.payload.sessionId;
}

async function waitForStream() {
  await expect.poll(() => fake.streamCount()).toBeGreaterThan(0);
}

test("OpenCode settings expose connection, models, permission and MCP status", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.goto("/");
  await page.getByRole("button", { name: "⚙ 设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "OpenCode", exact: true }).click();

  await expect(settings.locator("#opencode-base-url")).toHaveAttribute(
    "placeholder",
    "http://127.0.0.1:49374",
  );
  await expect(settings.locator("#opencode-password")).toBeVisible();
  await expect(settings.locator("#opencode-execution-dir")).toBeVisible();
  await expect(settings.locator("#opencode-permission-mode")).toHaveValue("ask");
  await expect(settings).toContainText("Workbench MCP");
  await expect(settings).toContainText("● 已连接");

  await settings.locator("#opencode-base-url").fill(fake.baseUrl);
  await settings
    .getByRole("button", { name: "保存并测试", exact: true })
    .click();
  await expect(settings).toContainText("● 已连接");
  await expect(
    settings.locator("#opencode-text-model option", { hasText: "Anthropic" }),
  ).toHaveCount(1);

  const saved = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: fake.baseUrl,
      username: "opencode",
      executionDir: agentDir(),
      permissionMode: "ask",
      password: "e2e-secret",
    },
  });
  const savedText = await saved.text();
  expect(savedText).not.toContain("e2e-secret");
  expect(JSON.parse(savedText).config.hasPassword).toBe(true);
  const fetched = await request.get("/api/v1/integrations/opencode");
  expect(await fetched.text()).not.toContain("e2e-secret");
});

test("running agent task shows a plain black block without animation", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.goto("/");
  const run = await createRun(request, "运行中的任务");
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toBeVisible();
  await expect(block).toHaveClass(/running/);
  const box = await block.boundingBox();
  expect(box?.width).toBe(30);
  expect(box?.height).toBe(30);
  const animation = await block.evaluate(
    (element) => getComputedStyle(element).animationName,
  );
  expect(animation).toBe("none");
});

test("POST /agent-runs returns while the OpenCode agent is still busy", async ({
  page,
  request,
}) => {
  await configure(request, "ask");
  await page.goto("/");
  const started = Date.now();
  const response = await request.post("/api/v1/agent-runs", {
    data: { name: "非阻塞任务", prompt: "请分析" },
  });
  const elapsed = Date.now() - started;
  expect(response.status()).toBe(202);
  expect(elapsed).toBeLessThan(3000);
  const run = (await response.json()) as { id: string };
  const sessionId = (await sessionIdOf(request, run.id))!;
  expect(fake.busy(sessionId)).toBe(true);
  expect(fake.asyncPromptCalls).toBe(1);
  expect(fake.syncPromptCalls).toBe(0);
  await expect(page.locator(`[data-run-id="${run.id}"]`)).toHaveClass(
    /running/,
  );
});

test("prompt submission uses prompt_async and never a blocking prompt", async ({
  page,
  request,
}) => {
  await configure(request, "ask");
  await page.goto("/");
  await createRun(request, "异步提交任务");
  expect(fake.asyncPromptCalls).toBe(1);
  expect(fake.syncPromptCalls).toBe(0);
});

test("permission attention turns yellow and allows exactly one time", async ({
  page,
  request,
}) => {
  await configure(request, "ask");
  await page.goto("/");
  const run = await createRun(request, "需要权限的任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.permissions.push({
    id: "perm-e2e",
    sessionID: sessionId,
    permission: "shell",
    patterns: ["python analyse.py"],
    title: "shell",
  });
  fake.emit({
    type: "permission.updated",
    properties: {
      id: "perm-e2e",
      sessionID: sessionId,
      permission: "shell",
      patterns: ["python analyse.py"],
      title: "shell",
    },
  });
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toHaveClass(/attention/);
  await block.hover();
  await expect(block.locator(".taskTooltip")).toContainText("需要权限");
  await expect(block.locator(".taskTooltip")).toContainText("点击允许一次");
  await block.click();
  await expect(block).toHaveClass(/running/);
  expect(fake.replies).toEqual([
    { sessionID: sessionId, requestID: "perm-e2e", response: "once" },
  ]);
});

test("auto-allow replies once, never always, and stays black", async ({
  page,
  request,
}) => {
  await configure(request, "auto-allow");
  await page.goto("/");
  const run = await createRun(request, "自动允许的任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.permissions.push({
    id: "perm-auto",
    sessionID: sessionId,
    permission: "edit",
    patterns: ["/tmp/a"],
    title: "edit",
  });
  fake.emit({
    type: "permission.updated",
    properties: {
      id: "perm-auto",
      sessionID: sessionId,
      permission: "edit",
      patterns: ["/tmp/a"],
      title: "edit",
    },
  });
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toHaveClass(/running/);
  await expect.poll(() => fake.permissions.length).toBe(0);
  expect(fake.replies.every((reply) => reply.response === "once")).toBe(true);
  expect(fake.replies.some((reply) => reply.response === "always")).toBe(false);
});

test("question shows a yellow block and clicking never replies", async ({
  page,
  request,
}) => {
  await configure(request, "ask");
  await page.goto("/");
  const run = await createRun(request, "提问任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.questions.push({
    id: "form-e2e",
    sessionID: sessionId,
    title: "请选择参数",
  });
  fake.emit({
    type: "question.updated",
    properties: { id: "form-e2e", sessionID: sessionId },
  });
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toHaveClass(/attention/);
  await block.hover();
  await expect(block.locator(".taskTooltip")).toContainText(
    "OpenCode 需要你的输入",
  );
  await block.click();
  await expect(block).toHaveClass(/attention/);
  expect(fake.replies).toHaveLength(0);
});

test("completed task shows a banner that disappears after five seconds", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.goto("/");
  const run = await createRun(request, "完成条幅任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.addAssistant(sessionId, "最终结论：完成");
  fake.emit({ type: "session.idle", properties: { sessionID: sessionId } });
  const banner = page.locator(".taskCompletion");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("完成条幅任务 完成");
  await expect(banner).toBeHidden({ timeout: 8000 });
  await expect(page.locator(`[data-run-id="${run.id}"]`)).toHaveCount(0);
});

test("failed task stays orange until dismissed while job history remains", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.goto("/");
  const run = await createRun(request, "失败任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.sessions.delete(sessionId);
  fake.emit({
    type: "session.status",
    properties: { sessionID: sessionId, status: { type: "idle" } },
  });
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toHaveClass(/failed/);
  await page.waitForTimeout(5_500);
  await expect(block).toBeVisible();
  await block.hover();
  await expect(block.locator(".taskTooltip")).toContainText("执行失败");
  await block.click();
  await expect(block).toHaveCount(0);
  const jobs = (await (await request.get("/api/v1/jobs")).json()) as {
    id: string;
    status: string;
  }[];
  expect(jobs.find((job) => job.id === run.id)?.status).toBe("failed");
});

test("long press opens the OpenCode session deep link", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string) => {
      (window as unknown as { __opened: string[] }).__opened.push(url);
      return null;
    }) as typeof window.open;
  });
  await page.goto("/");
  const run = await createRun(request, "长按任务");
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toBeVisible();
  await block.dispatchEvent("pointerdown", { clientX: 10, clientY: 10 });
  await page.waitForTimeout(600);
  await block.dispatchEvent("pointerup", { clientX: 10, clientY: 10 });
  const opened = await page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened,
  );
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain("/server/");
  expect(opened[0]).toContain(`/session/${(await sessionIdOf(request, run.id))!}`);
});

test("multiple tasks stack newest on top and refill after completion", async ({
  page,
  request,
}) => {
  await configure(request);
  const jobs = (await (await request.get("/api/v1/jobs")).json()) as {
    id: string;
    type: string;
    status: string;
  }[];
  for (const job of jobs)
    if (job.type === "agent-run" && job.status === "running")
      await request.post(`/api/v1/jobs/${job.id}/cancel`);
  await page.goto("/");
  const first = await createRun(request, "堆叠一");
  const middle = await createRun(request, "堆叠二");
  const last = await createRun(request, "堆叠三");
  const block = (id: string) => page.locator(`[data-run-id="${id}"]`);
  await expect(block(first.id)).toBeVisible();
  await expect(block(middle.id)).toBeVisible();
  await expect(block(last.id)).toBeVisible();
  const firstBox = (await block(first.id).boundingBox())!;
  const lastBox = (await block(last.id).boundingBox())!;
  expect(lastBox.y).toBeLessThan(firstBox.y);

  const middleSession = (await sessionIdOf(request, middle.id))!;
  fake.addAssistant(middleSession, "中间完成");
  fake.emit({ type: "session.idle", properties: { sessionID: middleSession } });
  await expect(page.locator(".taskCompletion")).toBeVisible();
  await expect(block(middle.id)).toHaveCount(0, { timeout: 8000 });
  await expect(block(first.id)).toBeVisible();
  await expect(block(last.id)).toBeVisible();
});

test("task history labels OpenCode jobs and offers no retry", async ({
  page,
  request,
}) => {
  await configure(request);
  const run = await createRun(request, "历史记录任务");
  await page.goto("/");
  await page.getByRole("button", { name: "⚙ 设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "任务", exact: true }).click();
  const row = settings.locator(".propertyRows > div", {
    hasText: "历史记录任务",
  });
  await expect(row).toContainText("OpenCode · 历史记录任务");
  await expect(row.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "历史记录任务" }),
  ).toBeVisible();
});

test("running agent locks connection identity but allows defaults", async ({
  request,
}) => {
  await configure(request, "ask");
  const run = await createRun(request, "连接锁定任务");
  const current = await (
    await request.get("/api/v1/integrations/opencode")
  ).json();
  expect(current.config.connectionLocked).toBe(true);

  const blockedUrl = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: "http://127.0.0.1:1",
      username: "opencode",
      executionDir: agentDir(),
      permissionMode: "ask",
    },
  });
  expect(blockedUrl.status()).toBe(409);
  expect((await blockedUrl.json()).code).toBe("OPENCODE_CONFIG_IN_USE");

  const blockedDir = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: fake.baseUrl,
      username: "opencode",
      executionDir: `${agentDir()}-other`,
      permissionMode: "ask",
    },
  });
  expect(blockedDir.status()).toBe(409);

  const blockedPassword = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: fake.baseUrl,
      username: "opencode",
      executionDir: agentDir(),
      permissionMode: "ask",
      password: "new-secret",
    },
  });
  expect(blockedPassword.status()).toBe(409);

  const allowed = await request.put("/api/v1/integrations/opencode", {
    data: {
      baseUrl: fake.baseUrl,
      username: "opencode",
      executionDir: agentDir(),
      permissionMode: "auto-allow",
      textModel: { providerId: "anthropic", modelId: "claude" },
    },
  });
  expect(allowed.status()).toBe(200);
  const saved = await allowed.json();
  expect(saved.config.permissionMode).toBe("auto-allow");
  expect(saved.config.textModel).toEqual({
    providerId: "anthropic",
    modelId: "claude",
  });
  await request.post(`/api/v1/jobs/${run.id}/cancel`);
});

test("completion notice survives a page refresh within its TTL", async ({
  page,
  request,
}) => {
  await configure(request);
  await page.goto("/");
  const run = await createRun(request, "刷新恢复任务");
  const sessionId = (await sessionIdOf(request, run.id))!;
  fake.addAssistant(sessionId, "done");
  fake.emit({ type: "session.idle", properties: { sessionID: sessionId } });
  await expect
    .poll(async () => {
      const jobs = (await (await request.get("/api/v1/jobs")).json()) as {
        id: string;
        status: string;
      }[];
      return jobs.find((job) => job.id === run.id)?.status;
    })
    .toBe("succeeded");

  await page.reload();
  const banner = page.getByRole("button", { name: /刷新恢复任务 完成/ });
  await expect(banner).toBeVisible();
  await expect(banner).toBeHidden({ timeout: 8000 });
});
