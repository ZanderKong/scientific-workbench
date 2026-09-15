import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("sample keyboard editing survives save, source navigation and reopen with stable IDs", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/v1/objects", {
    data: { canonicalName: "测试水", role: "material" },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  await editor.click();
  await page.keyboard.insertText("添加 [测试水]");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("[测试水]｜添加量：80 g");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("结构已更新");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const files = fs.readdirSync(
    path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples"),
  );
  const file = files.find((name) =>
    fs
      .readFileSync(
        path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples", name),
        "utf8",
      )
      .includes("80 g"),
  )!;
  expect(file).toBeTruthy();
  const raw = fs.readFileSync(
    path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples", file),
    "utf8",
  );
  const ids = [...raw.matchAll(/<!-- swb:block id="([^"]+)" -->/g)].map(
    (match) => match[1],
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  await page.getByRole("button", { name: "← 样品", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: /添加量/ }),
  ).toBeVisible();
  await page.getByRole("cell", { name: "80 g", exact: true }).click();
  await expect(editor).toContainText("80 g");
  await page.reload();
  await page.getByRole("cell", { name: "80 g", exact: true }).click();
  await expect(editor).toContainText("80 g");
  const reopened = fs.readFileSync(
    path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples", file),
    "utf8",
  );
  expect(
    [...reopened.matchAll(/<!-- swb:block id="([^"]+)" -->/g)].map(
      (match) => match[1],
    ),
  ).toEqual(ids);
});

test("failed save blocks navigation and preserves the draft for retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  await editor.click();
  await page.route("**/api/v1/documents/*", (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.keyboard.insertText("断网仍要保留的正文");
  await expect(
    page.getByText("保存失败，可重试", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← 样品", exact: true }).click();
  await expect(editor).toContainText("断网仍要保留的正文");
  await page.unroute("**/api/v1/documents/*");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
});

test("navigation exposes all work areas", async ({ page }) => {
  await page.goto("/");
  for (const name of ["分析", "数据", "论点", "资源"]) {
    await page
      .locator("nav")
      .getByRole("button", { name: new RegExp(name) })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: /设置/ }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
});

test("batch template edits actual properties, excludes results, and leaves source intact", async ({
  page,
  request,
}) => {
  const object = await request.post("/api/v1/objects", {
    data: { canonicalName: "批量搅拌", role: "process" },
  });
  expect(object.ok()).toBeTruthy();
  const response = await request.post("/api/v1/samples", {
    data: {
      code: "BATCH-SOURCE",
      body: "- [批量搅拌]\n  - [批量搅拌]｜时间：30 min\n  - [数据] 模板原始数据\n    - 不应复制的结果",
    },
  });
  const source = await response.json();
  await request.post(`/api/v1/documents/${source.id}/finalize`);
  const before = await (
    await request.get(`/api/v1/documents/${source.id}`)
  ).json();
  await page.goto("/");
  await page.getByRole("cell", { name: "BATCH-SOURCE", exact: true }).click();
  await page.getByRole("button", { name: "样品更多操作" }).click();
  await page.getByRole("menuitem", { name: "批量新建样品" }).click();
  await expect(
    page.getByRole("heading", { name: "批量新建样品" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "第 1 行编号", exact: true })
    .fill("BATCH-60");
  await page
    .getByRole("textbox", { name: "第 1 行 批量搅拌 时间", exact: true })
    .fill("60 min");
  await page
    .getByRole("button", { name: "创建 3 个样品", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "样品正文" })).toContainText(
    "60 min",
  );
  const all = await (await request.get("/api/v1/samples")).json();
  const entry = all.find((row: { code: string }) => row.code === "BATCH-60");
  const copy = await (await request.get(`/api/v1/samples/${entry.id}`)).json();
  expect(
    copy.properties.map(
      (property: { value_text: string }) => property.value_text,
    ),
  ).toEqual(["60 min"]);
  expect(copy.document.body).not.toContain("不应复制");
  expect(copy.document.body).not.toContain("模板原始数据");
  expect(
    (await (await request.get(`/api/v1/documents/${source.id}`)).json()).body,
  ).toBe(before.body);
});

test("markerless Data is explicitly reassociated in the sample editor without creating a duplicate", async ({
  page,
  request,
}) => {
  const sample = await (
    await request.post("/api/v1/samples", {
      data: {
        code: "IDENTITY-01",
        body: "- 测量\n  - [数据] 身份光谱\n    - 原始测量记录",
      },
    })
  ).json();
  await request.post(`/api/v1/documents/${sample.id}/finalize`);
  const before = (await (await request.get("/api/v1/data")).json()).filter(
    (data: { sourceDocumentId: string }) => data.sourceDocumentId === sample.id,
  );
  expect(before).toHaveLength(1);
  const file = path.join(
    process.env.SWB_ACCEPTANCE_DIR!,
    "samples",
    `${sample.id}.md`,
  );
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/^[ \t]*<!-- swb:block id="[^"]+" -->\r?\n/gm, ""),
  );
  await request.post(`/api/v1/documents/${sample.id}/reload`);
  await request.post(`/api/v1/documents/${sample.id}/finalize`);
  await page.goto("/");
  await page.getByText("IDENTITY-01", { exact: true }).click();
  await page.getByRole("button", { name: "数据待关联 · 1" }).click();
  await page
    .getByRole("dialog", { name: "确认数据身份" })
    .getByRole("button", { name: "关联 身份光谱", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "数据待关联 · 1" }),
  ).toHaveCount(0);
  const after = (await (await request.get("/api/v1/data")).json()).filter(
    (data: { sourceDocumentId: string }) => data.sourceDocumentId === sample.id,
  );
  expect(after.map((data: { id: string }) => data.id)).toEqual(
    before.map((data: { id: string }) => data.id),
  );
  await expect(page.getByRole("textbox", { name: "样品正文" })).toContainText(
    "原始测量记录",
  );
});

test("explicit object creation stays a saved intent until completion and edited intent creates nothing", async ({
  page,
  request,
}) => {
  const name = `意图设备-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  await editor.click();
  await page.keyboard.insertText(`[${name}`);
  await page.getByRole("button", { name: `创建「${name}」 设备` }).click();
  await expect(editor.locator("[data-create-intent]")).toHaveCount(1);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  expect(
    await (
      await request.get(`/api/v1/objects?q=${encodeURIComponent(name)}`)
    ).json(),
  ).toHaveLength(0);
  const dir = path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples");
  const filename = fs
    .readdirSync(dir)
    .find((file) =>
      fs.readFileSync(path.join(dir, file), "utf8").includes(name),
    )!;
  expect(fs.readFileSync(path.join(dir, filename), "utf8")).toContain(
    "create-intent",
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(`[${name}]｜添加量：5 g`);
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("结构已更新");
  const objects = await (
    await request.get(`/api/v1/objects?q=${encodeURIComponent(name)}`)
  ).json();
  expect(objects).toHaveLength(1);
  expect(objects[0].role).toBe("equipment");
  await expect(editor.locator("[data-create-intent]")).toHaveCount(0);
  expect(fs.readFileSync(path.join(dir, filename), "utf8")).toContain(
    "valueText: 5 g",
  );
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  expect(
    await (
      await request.get(`/api/v1/objects?q=${encodeURIComponent(name)}`)
    ).json(),
  ).toHaveLength(1);

  await page.getByRole("button", { name: "← 样品", exact: true }).click();
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  const canceled = name + "取消";
  await editor.click();
  await page.keyboard.insertText(`[${canceled}`);
  await page.getByRole("button", { name: `创建「${canceled}」 过程` }).click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.insertText("改名");
  await expect(editor.locator("[data-create-intent]")).toHaveCount(0);
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("结构已更新");
  expect(
    await (
      await request.get(`/api/v1/objects?q=${encodeURIComponent(canceled)}`)
    ).json(),
  ).toHaveLength(0);
});
