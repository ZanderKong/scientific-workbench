import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { SampleRow } from "../../apps/web/src/api";

const definitions = [
  ["poa", "2-POA", "添加量"],
  ["waterTemp", "水", "温度"],
  ["waterAmount", "水", "添加量"],
  ["hpmc", "HPMC", "添加量"],
  ["stir", "搅拌", "转速"],
  ["ftirRes", "傅里叶变换红外光谱仪", "光谱分辨率"],
  ["polymerMw", "聚羟丙基甲基纤维素高黏度等级", "重均分子量"],
];

async function geometry(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const box = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
        fontSize: style.fontSize,
        padding: style.padding,
      };
    });
}

test("UI-001a: original sample table geometry and pixels", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  const originalRows: Record<string, string>[] =
    await reference.evaluate("samples");
  const rows: SampleRow[] = originalRows.map((sample) => ({
    id: sample.id,
    code: sample.id,
    title: "",
    createdAt: sample.createdAt,
    contentVersion: 1,
    extractionStatus: "ready",
    properties: definitions.map(([key, object, property]) => ({
      id: `${sample.id}-${key}`,
      object_id: object,
      property_id: property,
      object_name: object,
      property_name: property,
      value_text: sample[key],
      block_id: `${sample.id}-${key}`,
      source_line: 1,
    })),
  }));
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/samples") ? rows : [],
    }),
  );
  await page.goto("/?acceptance=1");
  await expect(page.getByText("S260909-01", { exact: true })).toBeVisible();
  const measurements = [];
  for (const selector of [
    ".sidebar",
    ".navItem",
    ".topbar",
    ".pageHeader",
    ".toolbar",
    ".primary",
    ".searchPseudo",
    ".tableWrap",
    ".dbRow",
  ]) {
    const expected = await geometry(reference, selector),
      actual = await geometry(page, selector);
    measurements.push({ selector, expected, actual });
    for (const key of ["x", "y", "width", "height"] as const)
      expect
        .soft(Math.abs(expected[key] - actual[key]), `${selector}.${key}`)
        .toBeLessThanOrEqual(2);
    for (const key of ["radius", "fontSize", "padding"] as const)
      expect.soft(actual[key], `${selector}.${key}`).toBe(expected[key]);
  }
  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  // The reference's hard-coded save status is intentionally replaced by real state.
  const expectedImage = PNG.sync.read(
    await reference.screenshot({
      path: testInfo.outputPath("reference.png"),
      mask: [reference.locator(".topRight > span")],
    }),
  );
  const actualImage = PNG.sync.read(
    await page.screenshot({
      path: testInfo.outputPath("actual.png"),
      mask: [page.locator(".topRight > span")],
    }),
  );
  const diff = new PNG({ width: 1440, height: 1000 });
  const pixels = pixelmatch(
    expectedImage.data,
    actualImage.data,
    diff.data,
    1440,
    1000,
    { threshold: 0.1 },
  );
  fs.writeFileSync(testInfo.outputPath("diff.png"), PNG.sync.write(diff));
  fs.writeFileSync(
    testInfo.outputPath("pixels.json"),
    JSON.stringify({ pixels, ratio: pixels / 1440000 }),
  );
  expect(pixels / 1440000).toBeLessThanOrEqual(0.005);
  await reference.close();
});

test('UI-002a: empty editor layout follows the frozen prototype', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reference = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await reference.goto(`file://${path.resolve('prototype/reference.html')}`);
  await reference.evaluate("goPage({type:'sample',id:'S260910-01',fresh:true},'samples')");
  await page.goto('/?acceptance=1');
  await page.getByRole('button', { name: '＋ 新建样品', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '样品正文' })).toBeVisible();
  const measurements = [];
  for (const selector of ['.sidebar', '.topbar', '.editorTop', '.editorHeader', '.directEditor', '.editorFooter', '.docParseNote']) {
    const expected = await geometry(reference, selector), actual = await geometry(page, selector);
    measurements.push({ selector, expected, actual });
    for (const key of ['x', 'y', 'width', 'height'] as const) expect.soft(Math.abs(expected[key] - actual[key]), `${selector}.${key}`).toBeLessThanOrEqual(2);
  }
  fs.writeFileSync(testInfo.outputPath('geometry.json'), JSON.stringify(measurements, null, 2));
  await reference.screenshot({ path: testInfo.outputPath('reference.png') });
  await page.screenshot({ path: testInfo.outputPath('actual.png') });
  await reference.close();
});
