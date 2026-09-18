import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import type { SampleRow } from "../../apps/web/src/api";
import {
  DESIGN_V2,
  checkViewport,
  expectBox,
  expectFontAtLeast,
  expectFontSize,
  expectHorizontalInvariant,
  expectNoPageOverflow,
  expectNotClipped,
} from "./design-v2";

const definitions = [
  ["poa", "2-POA", "添加量"],
  ["waterTemp", "水", "温度"],
  ["waterAmount", "水", "添加量"],
  ["hpmc", "HPMC", "添加量"],
  ["stir", "搅拌", "转速"],
  ["ftirRes", "傅里叶变换红外光谱仪", "光谱分辨率"],
  ["polymerMw", "聚羟丙基甲基纤维素高黏度等级", "重均分子量"],
];

test("UI-001a/UI-DENSITY-001: sample table keeps prototype layout at Design v2 density", async ({
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

  const measurements: unknown[] = [];
  for (const selector of [
    ".sidebar",
    ".topbar",
    ".pageHeader",
    ".toolbar",
    ".tableWrap",
    ".dbRow",
  ]) {
    await expectHorizontalInvariant(page, reference, selector);
    measurements.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  await expectBox(page, ".sidebar", {
    x: 0,
    y: 0,
    width: DESIGN_V2.sidebarWidth,
  });
  await expectBox(page, ".topbar", {
    x: 168,
    y: 0,
    height: DESIGN_V2.topbarHeight,
  });

  await expectFontSize(page, ".brand", DESIGN_V2.nav);
  await expectFontSize(page, ".navItem", DESIGN_V2.nav);
  await expectFontSize(page, ".sideAction", DESIGN_V2.control);
  await expectFontSize(page, ".topbar", DESIGN_V2.meta);
  await expectFontSize(page, ".primary", DESIGN_V2.control);
  await expectFontSize(page, ".toolbar button", DESIGN_V2.control);
  await expectFontSize(page, "td", DESIGN_V2.control);
  await expectFontAtLeast(page, "th", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".objToken", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".propText", DESIGN_V2.micro);

  for (const label of [
    "＋ 新建样品",
    "搜索",
    "筛选",
    "排序",
    "属性",
    "表格",
    "卡片",
  ]) {
    await expectNotClipped(
      page,
      page.getByRole("button", { name: label, exact: true }),
    );
  }
  await expectNoPageOverflow(page);

  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await reference.screenshot({ path: testInfo.outputPath("reference.png") });
  await page.screenshot({ path: testInfo.outputPath("actual.png") });
  await checkViewport(
    page,
    reference,
    1600,
    900,
    testInfo,
    [".sidebar", ".topbar", ".pageHeader", ".toolbar", ".tableWrap", ".dbRow"],
    { screenshot: true },
  );
  await checkViewport(page, reference, 1280, 800, testInfo, [
    ".sidebar",
    ".topbar",
    ".pageHeader",
    ".toolbar",
    ".tableWrap",
    ".dbRow",
  ]);
  // Below the table's min-width the row width follows the larger Design v2
  // type, so only the wrapper geometry is an invariant; the table itself is
  // allowed to scroll horizontally.
  for (const [width, height] of [
    [980, 1000],
    [640, 1000],
  ] as const) {
    await checkViewport(page, reference, width, height, testInfo, [
      ".sidebar",
      ".topbar",
      ".pageHeader",
      ".toolbar",
      ".tableWrap",
    ]);
    const wrap = await page
      .locator(".tableWrap")
      .first()
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    if (wrap.scrollWidth > wrap.clientWidth) {
      // Internal horizontal table scrolling is explicitly approved.
      expect.soft(wrap.scrollWidth).toBeGreaterThan(wrap.clientWidth);
    }
  }
  await reference.close();
});

test("UI-002a/UI-DENSITY-001: empty editor keeps frozen macro layout", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate(
    "goPage({type:'sample',id:'S260910-01',fresh:true},'samples')",
  );
  await page.goto("/?acceptance=1");
  await page.getByRole("button", { name: "＋ 新建样品", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "样品正文" })).toBeVisible();

  const measurements: unknown[] = [];
  for (const selector of [
    ".sidebar",
    ".topbar",
    ".editorTop",
    ".editorHeader",
    ".directEditor",
    ".editorFooter",
    ".docParseNote",
  ]) {
    await expectHorizontalInvariant(page, reference, selector);
    measurements.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  await expectBox(page, ".sidebar", { width: DESIGN_V2.sidebarWidth });
  await expectBox(page, ".topbar", { height: DESIGN_V2.topbarHeight });
  // The sample editor content column is an approved invariant.
  await expectBox(page, ".editorHeader", {
    width: DESIGN_V2.sampleEditorWidth,
  });
  await expectBox(page, ".directEditor", {
    width: DESIGN_V2.sampleEditorWidth,
  });
  await expectBox(page, ".editorFooter", { width: 760 });
  await expectNoPageOverflow(page);

  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await reference.screenshot({ path: testInfo.outputPath("reference.png") });
  await page.screenshot({ path: testInfo.outputPath("actual.png") });
  await checkViewport(
    page,
    reference,
    1600,
    900,
    testInfo,
    [
      ".sidebar",
      ".topbar",
      ".editorTop",
      ".editorHeader",
      ".directEditor",
      ".editorFooter",
      ".docParseNote",
    ],
    { screenshot: true },
  );
  await reference.close();
});
