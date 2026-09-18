import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FakeOpenCode } from "./fake-opencode";

const fake = new FakeOpenCode();
const agentDir = () => `${process.env.SWB_ACCEPTANCE_DIR}-Agent`;

test.beforeAll(async () => {
  await fake.start();
});
test.afterAll(async () => {
  await fake.stop();
});

test.beforeEach(async () => {
  fake.permissions = [];
  fake.questions = [];
  fake.replies = [];
  fake.active.clear();
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
  expect(response.ok()).toBeTruthy();
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
    action: "shell",
    resources: ["python analyse.py"],
  });
  fake.emit({
    type: "permission.asked",
    data: {
      id: "perm-e2e",
      sessionID: sessionId,
      action: "shell",
      resources: ["python analyse.py"],
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
    { sessionID: sessionId, requestID: "perm-e2e", decision: "once" },
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
    action: "edit",
    resources: ["/tmp/a"],
  });
  fake.emit({
    type: "permission.asked",
    data: {
      id: "perm-auto",
      sessionID: sessionId,
      action: "edit",
      resources: ["/tmp/a"],
    },
  });
  const block = page.locator(`[data-run-id="${run.id}"]`);
  await expect(block).toHaveClass(/running/);
  await expect.poll(() => fake.permissions.length).toBe(0);
  expect(fake.replies.every((reply) => reply.decision === "once")).toBe(true);
  expect(fake.replies.some((reply) => reply.decision === "always")).toBe(false);
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
  fake.emit({ type: "form.created", data: { form: { id: "form-e2e", sessionID: sessionId, title: "请选择参数" } } });
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
  fake.emit({ type: "session.idle", data: { sessionID: sessionId } });
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
  fake.emit({ type: "session.status", data: { sessionID: sessionId, status: { type: "idle" } } });
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
  fake.emit({ type: "session.idle", data: { sessionID: middleSession } });
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
