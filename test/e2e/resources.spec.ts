import { test, expect } from "@playwright/test";

test("resource recommendations and aliases persist, bare references are listed, and list controls work", async ({
  page,
  request,
}) => {
  const name = `资源设备-${Date.now()}`;
  const property = await (
    await request.post("/api/v1/properties", {
      data: { canonicalName: `推荐时间-${Date.now()}`, recommendedUnit: "min" },
    })
  ).json();
  const device = await (
    await request.post("/api/v1/objects", {
      data: { canonicalName: name, role: "equipment" },
    })
  ).json();
  const sample = await (
    await request.post("/api/v1/samples", {
      data: { body: `- 使用 [${name}]` },
    })
  ).json();
  const finalized = await request.post(
    `/api/v1/documents/${sample.id}/finalize`,
    { data: {} },
  );
  expect(finalized.ok()).toBeTruthy();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "⌘ 资源" }).click();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "设备", exact: true })
    .click();
  await page.getByRole("cell", { name, exact: true }).click();
  await expect(
    page.getByRole("cell", { name: sample.code, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "仅引用" })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("标识信息", { exact: true }).fill("MS-01");
  await page.getByLabel("手动别名（每行一个）").fill("stirrer\n磁力设备");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".metaLine")).toContainText("MS-01");
  await page.getByRole("button", { name: "＋ 添加推荐属性" }).click();
  await page.getByLabel(property.canonicalName, { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator(".propertyTokens")).toContainText(
    property.canonicalName,
  );
  const stored = (await (await request.get("/api/v1/objects")).json()).find(
    (row: { id: string }) => row.id === device.id,
  );
  expect(stored.aliases).toEqual(["stirrer", "磁力设备"]);
  expect(stored.identityText).toBe("MS-01");
  expect(stored.recommendedPropertyIds).toEqual([property.id]);
  await page.getByRole("button", { name: "•••", exact: true }).click();
  await page.getByRole("button", { name: "废弃", exact: true }).click();
  await expect(page.locator(".metaLine")).toContainText("已废弃");
  await page.getByRole("button", { name: "← 资源", exact: true }).click();
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await page.getByLabel("包含文字").fill("stirrer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "属性", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("标识信息", { exact: true })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "标识信息", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("cell", { name, exact: true }).click();
  await expect(page.locator(".propertyTokens")).toContainText(
    property.canonicalName,
  );
});

test("resource merge and permanent deletion use explicit UI authorization and persist the result", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const source = await (
    await request.post("/api/v1/objects", {
      data: { canonicalName: `待合并设备-${suffix}`, role: "equipment" },
    })
  ).json();
  const target = await (
    await request.post("/api/v1/objects", {
      data: { canonicalName: `标准设备-${suffix}`, role: "equipment" },
    })
  ).json();
  const unused = await (
    await request.post("/api/v1/objects", {
      data: { canonicalName: `未使用设备-${suffix}`, role: "equipment" },
    })
  ).json();
  const sample = await (
    await request.post("/api/v1/samples", {
      data: { body: `- 使用 [${source.canonicalName}]` },
    })
  ).json();
  await request.post(`/api/v1/documents/${sample.id}/finalize`);

  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "⌘ 资源" }).click();
  await page
    .locator(".tabs")
    .getByRole("button", { name: "设备", exact: true })
    .click();
  await page.getByRole("cell", { name: source.canonicalName }).click();
  await page.getByRole("button", { name: "•••", exact: true }).click();
  await page.getByRole("button", { name: "合并到其他对象" }).click();
  await page.getByLabel("合并目标").selectOption(target.id);
  await page.getByRole("button", { name: "确认合并" }).click();
  await expect(page.getByRole("status")).toContainText("已合并到");
  await expect(page.getByRole("heading", { name: target.canonicalName })).toBeVisible();
  const objectsAfterMerge = await (await request.get("/api/v1/objects")).json();
  const merged = objectsAfterMerge.find((item: { id: string }) => item.id === source.id);
  const updatedTarget = objectsAfterMerge.find((item: { id: string }) => item.id === target.id);
  expect(merged.lifecycle).toBe("merged");
  expect(merged.redirectTo).toBe(target.id);
  expect(updatedTarget.aliases).toContain(source.canonicalName);
  const document = await (await request.get(`/api/v1/documents/${sample.id}`)).json();
  expect(document.head.references[0].objectId).toBe(target.id);

  await page.getByRole("button", { name: "← 资源", exact: true }).click();
  await page.getByRole("cell", { name: unused.canonicalName }).click();
  await page.getByRole("button", { name: "•••", exact: true }).click();
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page.getByRole("dialog", { name: "永久删除对象" })).toContainText(
    unused.canonicalName,
  );
  await page.getByRole("button", { name: "确认永久删除" }).click();
  await expect(page.getByRole("status")).toContainText("对象已永久删除");
  expect(
    (await (await request.get("/api/v1/objects")).json()).some(
      (item: { id: string }) => item.id === unused.id,
    ),
  ).toBe(false);
});
