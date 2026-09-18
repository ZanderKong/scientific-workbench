import { test, expect } from "@playwright/test";
import {
  DESIGN_V2,
  expectBox,
  expectFontAtLeast,
  expectFontSize,
  expectNoPageOverflow,
  expectNotClipped,
} from "./design-v2";

/**
 * UI-DENSITY-001 regression test.
 *
 * Locks the Design v2 readability scale so a future change cannot silently
 * shrink persistent production UI text back to prototype microtext, while
 * proving the approved macro geometry (sidebar, topbar, content width) and the
 * Sample scientific typography stay untouched.
 */

const definitions = [
  ["poa", "2-POA", "添加量"],
  ["waterTemp", "水", "温度"],
  ["waterAmount", "水", "添加量"],
  ["hpmc", "HPMC", "添加量"],
  ["stir", "搅拌", "转速"],
  ["ftirRes", "傅里叶变换红外光谱仪", "光谱分辨率"],
  ["polymerMw", "聚羟丙基甲基纤维素高黏度等级", "重均分子量"],
];

const rows = [
  {
    id: "S260909-01",
    code: "S260909-01",
    title: "",
    createdAt: "2026-09-09 14:12",
    contentVersion: 1,
    extractionStatus: "ready",
    properties: definitions.map(([key, object, property], index) => ({
      id: `p-${index}`,
      object_id: object,
      property_id: property,
      object_name: object,
      property_name: property,
      value_text: ["2 g", "60 ℃", "98 g", "2 g", "300 rpm", "4 cm⁻¹", "86,000"][
        index
      ],
      block_id: `b-${index}`,
      source_line: 1,
    })),
  },
];

test("UI-DENSITY-001: shell, navigation and sample table use the Design v2 scale", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/samples") ? rows : [],
    }),
  );
  await page.goto("/?acceptance=1");
  await expect(page.getByText("S260909-01", { exact: true })).toBeVisible();

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
  await expectFontSize(page, ".topbar button", DESIGN_V2.meta);
  await expectFontSize(page, ".primary", DESIGN_V2.control);
  await expectFontSize(page, ".toolbar button", DESIGN_V2.control);
  await expectFontSize(page, "td", DESIGN_V2.control);
  await expectFontAtLeast(page, "th", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".objToken", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".propText", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".sortMark", DESIGN_V2.micro);

  // Sidebar labels must stay on one line at the larger navigation size.
  const labels = await page
    .locator(".navItem span:last-child")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    );
  for (const label of labels)
    expect
      .soft(label.scrollWidth, `sidebar label ${label.text}`)
      .toBeLessThanOrEqual(label.clientWidth + 1);

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

  // Card mode exposes the mini property chips.
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(page.locator(".miniProps span").first()).toBeVisible();
  await expectFontAtLeast(page, ".miniProps span", DESIGN_V2.micro);

  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("samples-density.png") });
});

test("UI-DENSITY-001: Sample scientific typography is untouched", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const created = await request.post("/api/v1/samples", {
    data: {
      code: "S260916-DENSITY",
      title: "density",
      body: "- 使用 [磁力搅拌器]，将 [水] 加入 [样品A]\n  - [水]｜添加量：77 g\n  - 普通自由文本",
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/");
  await page.getByText("S260916-DENSITY", { exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "样品正文" })).toBeVisible();

  await expectBox(page, ".sidebar", { width: DESIGN_V2.sidebarWidth });
  await expectBox(page, ".topbar", { height: DESIGN_V2.topbarHeight });
  await expectFontSize(page, ".ProseMirror > ul > li", 15);
  await expectFontSize(page, ".ProseMirror > ul > li li", 13);
  await expectFontAtLeast(page, ".editorFooter", DESIGN_V2.meta);
  await expectFontAtLeast(page, ".docParseNote", DESIGN_V2.micro);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("sample-density.png") });
});
