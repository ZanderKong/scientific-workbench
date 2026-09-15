import { test, expect } from "@playwright/test";

test("Data edits About, retains duplicate-byte attachment identity and creates a hosted Claim", async ({
  page,
  request,
}) => {
  const sample = await (
    await request.post("/api/v1/samples", { data: { code: "DATA-ABOUT-01" } })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("button", { name: "＋ 导入数据" }).click();
  await page.getByLabel("数据名称").fill("独立光谱数据");
  const editor = page.getByRole("textbox", { name: "数据正文" });
  await editor.click();
  await page.keyboard.insertText("模拟光谱，仅用于软件验收");
  await page.getByRole("button", { name: "＋ 选择 Sample" }).click();
  await page.getByLabel("DATA-ABOUT-01", { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  const attachment = {
    name: "中文光谱.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("wave,intensity\n1000,0.42\n"),
  };
  await page.locator("input[type=file]").setInputFiles(attachment);
  await expect(
    page.getByRole("button", { name: /中文光谱.csv.*SHA-256/ }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(attachment);
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const records = await (await request.get("/api/v1/data")).json();
  const datum = records.find(
    (row: { name: string }) => row.name === "独立光谱数据",
  );
  expect(datum.aboutSampleIds).toEqual([sample.id]);
  expect(datum.componentIds).toHaveLength(1);
  expect(datum.body).toContain("模拟光谱，仅用于软件验收");
  const claim = page.getByRole("textbox", { name: "新论点正文" });
  await claim.click();
  await page.keyboard.insertText("曲线变化有待进一步确认");
  await page.getByRole("button", { name: "保存为正式论点" }).click();
  await expect(
    page.getByRole("button", { name: "曲线变化有待进一步确认" }),
  ).toBeVisible();
  const claims = await (await request.get("/api/v1/claims")).json();
  const saved = claims.find((row: { text: string }) =>
    row.text.includes("曲线变化"),
  );
  expect(saved.hostId).toBe(datum.id);
  expect(saved.hostType).toBe("data");
  expect(saved.evidence[0].content).toContain("模拟光谱，仅用于软件验收");
  expect(saved.evidence[0].attachmentIds).toEqual(datum.componentIds);
});

test("Data browser/API conflict does not silently overwrite and offers the draft", async ({
  page,
  request,
}) => {
  const datum = await (
    await request.post("/api/v1/data", {
      data: { name: "冲突检查", body: "- 原数据" },
    })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: "冲突检查", exact: true }).click();
  await expect(page.getByLabel("数据名称")).toHaveValue("冲突检查");
  await request.put(`/api/v1/data/${datum.id}`, {
    data: { body: "- API 已修改", expectedVersion: datum.version },
  });
  await page.getByLabel("数据名称").fill("页面未保存的修改");
  await expect(
    page.getByRole("dialog", { name: "保存与重新加载" }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/v1/data/${datum.id}`)).json()).body,
  ).toBe("- API 已修改");
  await expect(page.getByLabel("数据名称")).toHaveValue("页面未保存的修改");
  await page.getByRole("button", { name: "加载最新内容" }).click();
  await expect(page.getByLabel("数据名称")).toHaveValue("冲突检查");
  await expect(page.getByRole("textbox", { name: "数据正文" })).toContainText(
    "API 已修改",
  );
});

test("Data component descriptions preserve provenance and derived file references", async ({
  page,
  request,
}) => {
  const datum = await (
    await request.post("/api/v1/data", { data: { name: "组件来源验收" } })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: "组件来源验收", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "source.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("simulated\n1\n"),
    });
  await expect(
    page.getByRole("button", { name: /source.csv.*SHA-256/ }),
  ).toBeVisible();
  await page.locator(".detailTop").getByRole("button", { name: "•••" }).click();
  await page.getByRole("button", { name: "添加文本组件" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑数据组件" });
  await dialog.getByLabel("名称", { exact: true }).fill("趋势说明");
  await dialog.getByLabel("文本内容").fill("这是一条模拟数据趋势");
  await dialog.getByLabel("来源说明").fill("根据原始CSV人工记录");
  await dialog.getByLabel("派生自 source.csv").check();
  await dialog.getByRole("button", { name: "使用组件" }).click();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const saved = await (await request.get(`/api/v1/data/${datum.id}`)).json();
  expect(saved.components).toHaveLength(2);
  const description = saved.components.find(
    (component: { kind: string }) => component.kind === "text",
  );
  expect(description.provenance).toBe("根据原始CSV人工记录");
  expect(description.derivedFrom).toEqual([saved.components[0].id]);
  await page.getByRole("button", { name: "← 数据", exact: true }).click();
  await page.getByRole("cell", { name: "组件来源验收", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /趋势说明.*这是一条模拟数据趋势/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑组件 source.csv" }).click();
  await page.getByRole("button", { name: "解除组件引用" }).click();
  await expect(page.getByRole("alert")).toContainText("仍被派生组件引用");
});

test("Data navigation waits for file upload association before finalizing", async ({
  page,
  request,
}) => {
  const datum = await (
    await request.post("/api/v1/data", { data: { name: "上传切页验收" } })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: datum.name, exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const uploadStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/v1/attachments/stream", async (route) => {
    started();
    await gate;
    await route.continue();
  });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "delayed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("delayed bytes"),
    });
  await uploadStarted;
  await page.getByRole("button", { name: "← 数据", exact: true }).click();
  await expect(page.getByLabel("数据名称")).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "数据", exact: true }),
  ).toBeVisible();
  const saved = await (await request.get(`/api/v1/data/${datum.id}`)).json();
  expect(saved.components).toHaveLength(1);
  expect(saved.components[0].name).toBe("delayed.csv");
});

test("unsubmitted hosted claim drafts survive reopening and separate parent bullets create separate claims", async ({
  page,
  request,
}) => {
  const datum = await (
    await request.post("/api/v1/data", { data: { name: "论点草稿验收" } })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: datum.name, exact: true }).click();
  const editor = page.getByRole("textbox", { name: "新论点正文" });
  await editor.click();
  await page.keyboard.insertText("第一条待验证判断");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("状态：待验证");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.insertText("第二条待验证判断");
  await page.getByRole("button", { name: "← 数据", exact: true }).click();
  await page.getByRole("cell", { name: datum.name, exact: true }).click();
  await expect(editor).toContainText("第一条待验证判断");
  await expect(editor).toContainText("第二条待验证判断");
  await page.getByRole("button", { name: "保存为正式论点" }).click();
  await expect(
    page.getByRole("button", { name: "第二条待验证判断", exact: true }),
  ).toBeVisible();
  const claims = (await (await request.get("/api/v1/claims")).json()).filter(
    (claim: { hostId: string }) => claim.hostId === datum.id,
  );
  expect(claims).toHaveLength(2);
  expect(
    claims.find((claim: { text: string }) => claim.text.startsWith("第一条"))
      .text,
  ).toContain("状态：待验证");
  await page.getByRole("button", { name: "← 数据", exact: true }).click();
  await page.getByRole("cell", { name: datum.name, exact: true }).click();
  await expect(editor).not.toContainText("第一条待验证判断");
});
