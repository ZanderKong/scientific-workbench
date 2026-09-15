import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function box(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        padding: style.padding,
        radius: style.borderRadius,
      };
    });
}

test("UI-003e: search, help and settings keep the prototype modal shell and expose real state", async ({
  page,
  request,
  browser,
}, testInfo) => {
  await request.post("/api/v1/samples", {
    data: { code: "OVERLAY-SEARCH", title: "用于全局搜索", body: "- 操作" },
  });
  const orphan = await (
    await request.post("/api/v1/attachments", {
      data: {
        originalName: "设置页待清理.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("orphan").toString("base64"),
      },
    })
  ).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await page.getByRole("button", { name: "⌕ 搜索", exact: true }).click();
  const search = page.getByRole("dialog", { name: "全局搜索" });
  await expect(search).toBeVisible();
  const input = search.getByRole("textbox", { name: "全局搜索" });
  await expect(input).toBeFocused();
  await input.fill("OVERLAY-SEARCH");
  await search.getByRole("button", { name: /OVERLAY-SEARCH/ }).click();
  await expect(page.getByRole("textbox", { name: "样品正文" })).toBeVisible();

  await page.getByRole("button", { name: "?", exact: true }).click();
  const help = page.getByRole("dialog", { name: "快捷说明" });
  await expect(help).toContainText("[对象]");
  await expect(help).toContainText("样品中仅文字；Data/分析中正式创建");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.getByRole("button", { name: "⚙ 设置", exact: true }).click();
  await page.getByRole("button", { name: "⚙ 设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings).toBeVisible();

  const measurements = [];
  for (const selector of [".overlay", ".modal", ".modalHeader", ".modalBody"]) {
    const expected = await box(reference, selector);
    const actual = await box(page, selector);
    measurements.push({ selector, expected, actual });
    for (const key of ["x", "y", "width"] as const) {
      expect
        .soft(Math.abs(expected[key] - actual[key]), `${selector}.${key}`)
        .toBeLessThanOrEqual(2);
    }
    for (const key of ["padding", "radius"] as const) {
      expect.soft(actual[key], `${selector}.${key}`).toBe(expected[key]);
    }
  }
  fs.writeFileSync(
    testInfo.outputPath("settings-shell-geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await reference.screenshot({
    path: testInfo.outputPath("settings-reference.png"),
  });
  await page.screenshot({ path: testInfo.outputPath("settings-actual.png") });

  await expect(settings).toContainText(process.env.SWB_ACCEPTANCE_DIR!);
  await settings.getByRole("button", { name: "附件存储", exact: true }).click();
  await expect(settings.getByLabel("严格大于此大小（字节）")).toHaveValue(
    "100000000",
  );
  await expect(settings.getByLabel("本地保存满多少天后上传")).toHaveValue("15");
  await settings.getByRole("button", { name: "检查可清理附件" }).click();
  const orphanChoice = settings.getByRole("checkbox", {
    name: /设置页待清理\.txt/,
  });
  await expect(orphanChoice).toBeEnabled();
  await orphanChoice.check();
  await settings
    .getByRole("button", { name: "授权并永久清理所选附件" })
    .click();
  await expect(page.getByRole("status")).toContainText("已永久清理 1 个");
  await expect
    .poll(async () => {
      const rows = await (
        await request.get("/api/v1/attachments/orphans")
      ).json();
      return rows.some((row: { id: string }) => row.id === orphan.id);
    })
    .toBe(false);
  await settings.getByRole("button", { name: "接口", exact: true }).click();
  await expect(
    settings.getByRole("link", { name: "查看当前 OpenAPI" }),
  ).toHaveAttribute("href", "/api/v1/openapi.json");
  await reference.close();

  await page.setViewportSize({ width: 640, height: 900 });
  const narrow = await settings.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(narrow).toBeLessThanOrEqual(608);
});
