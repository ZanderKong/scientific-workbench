import { test, expect } from "@playwright/test";

test("analysis layout, columns and artifacts persist across leaving and reopening, and enter evidence", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/objects", {
    data: { canonicalName: "比较搅拌", role: "process" },
  });
  const sample = await (
    await request.post("/api/v1/samples", {
      data: {
        code: "ANALYSIS-01",
        body: "- [比较搅拌]\n  - [比较搅拌]｜时间：30 min｜转速：300 rpm\n  - [数据] 来自样品的光谱\n    - 实际样品数据正文",
      },
    })
  ).json();
  await request.post(`/api/v1/documents/${sample.id}/finalize`);
  const analysis = await (
    await request.post("/api/v1/analyses", {
      data: { title: "布局持久化验收", itemIds: [sample.id] },
    })
  ).json();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "◫ 分析" }).click();
  await page.getByRole("cell", { name: "布局持久化验收", exact: true }).click();
  await expect(page.getByText("来自样品的光谱", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "布局", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("上下文", { exact: true })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await page
    .locator(".block")
    .filter({ hasText: "参数比较" })
    .getByRole("button", { name: "•••" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("比较搅拌 / 时间", { exact: true })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await page
    .getByLabel("添加分析产物")
    .setInputFiles({
      name: "模拟比较.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("sample,value\nA,1\n"),
    });
  await expect(
    page.getByRole("button", { name: /模拟比较.csv/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByRole("button", { name: "← 分析", exact: true }).click();
  await page.getByRole("cell", { name: "布局持久化验收", exact: true }).click();
  await expect(
    page.locator(".blockTitle").getByText("上下文", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "比较搅拌 / 时间" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "比较搅拌 / 转速" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /模拟比较.csv/ }),
  ).toBeVisible();
  const saved = await (
    await request.get(`/api/v1/analyses/${analysis.id}`)
  ).json();
  expect(saved.layout.visibleSections).not.toContain("context");
  expect(saved.attachmentIds).toHaveLength(1);
  const exported = await (
    await request.get(`/api/v1/analyses/${analysis.id}/export`)
  ).json();
  expect(exported.manifest.attachments[0].name).toBe("模拟比较.csv");
});
