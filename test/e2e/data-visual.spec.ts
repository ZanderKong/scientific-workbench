import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import {
  DESIGN_V2,
  checkViewport,
  expectFontAtLeast,
  expectFontSize,
  expectHorizontalInvariant,
  expectNoPageOverflow,
} from "./design-v2";

test("UI-003a/UI-DENSITY-001: descriptive Data keeps prototype content width at Design v2 density", async ({
  page,
  browser,
}, testInfo) => {
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate(
    "goPage({type:'data-detail',id:'D-260909-09'},'data')",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const datum = {
    id: "D-260909-09",
    name: "滴加后白色液滴",
    description: "",
    body: "滴加熔化的 2-苯氧基苯胺后形成明显白色液滴，继续搅拌后液滴尺寸逐渐减小。",
    version: 1,
    aboutSampleIds: ["S260909-01"],
    sourceDocumentId: "S260909-01",
    componentIds: [],
    updatedAt: "2026-09-09",
  };
  const claim = {
    id: "C1",
    hostType: "data",
    hostId: datum.id,
    text: "HPMC 可能抑制液滴聚并。\n  - 状态: 待验证｜置信度: Medium",
    evidence: [],
    version: 1,
  };
  await page.route("**/api/v1/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        endpoint === "/api/v1/data"
          ? [datum]
          : endpoint === "/api/v1/claims"
            ? [claim]
            : endpoint === "/api/v1/samples"
              ? [{ id: "S260909-01", code: "S260909-01", properties: [] }]
              : [],
    });
  });
  await page.goto("/?acceptance=1");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: datum.name, exact: true }).click();
  await expect(page.getByLabel("数据名称")).toBeVisible();
  const measurements = [];
  for (const selector of [
    ".detailTop",
    ".detailHero",
    ".metaLine",
    ".contentArea",
    ".dataBox",
    ".infoGrid",
  ]) {
    await expectHorizontalInvariant(page, reference, selector);
    measurements.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  await expectFontSize(page, ".dataDescription .literalLine", 15);
  await expectFontSize(page, ".metaLine", DESIGN_V2.meta);
  await expectFontAtLeast(page, ".infoCard label", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".infoCard span", DESIGN_V2.meta);
  await expectNoPageOverflow(page);
  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await reference.screenshot({ path: testInfo.outputPath("reference.png") });
  await page.screenshot({ path: testInfo.outputPath("actual.png") });
  const detailSelectors = [
    ".detailTop",
    ".detailHero",
    ".metaLine",
    ".contentArea",
    ".dataBox",
    ".infoGrid",
  ];
  await checkViewport(page, reference, 1600, 900, testInfo, detailSelectors, {
    screenshot: true,
  });
  await checkViewport(page, reference, 1280, 800, testInfo, detailSelectors);
  for (const width of [980, 640]) {
    await reference.setViewportSize({ width, height: 1000 });
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of [
      ".detailHero",
      ".contentArea",
      ".dataBox",
      ".infoGrid",
    ]) {
      await expectHorizontalInvariant(page, reference, selector);
    }
    await expectNoPageOverflow(page);
    await reference.screenshot({
      path: testInfo.outputPath(`reference-${width}.png`),
    });
    await page.screenshot({ path: testInfo.outputPath(`actual-${width}.png`) });
  }
  await reference.close();
});

test("UI-003a/UI-DENSITY-001: multi-component FTIR Data keeps rows and larger type", async ({
  page,
  browser,
}, testInfo) => {
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate(
    "goPage({type:'data-detail',id:'D-FTIR-260910-01'},'data')",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const files = [
    {
      id: "f1",
      originalName: "8F2A_001_20260910.csv",
      mimeType: "text/csv",
      sizeBytes: 200,
      sha256: "simulated",
      createdAt: "2026-09-10",
    },
    {
      id: "f2",
      originalName: "FTIR_processed_overlay.png",
      mimeType: "image/png",
      sizeBytes: 300,
      sha256: "simulated",
      createdAt: "2026-09-10",
    },
  ];
  const shared = {
    createdAt: "2026-09-10",
    provenance: "",
    derivedFrom: [],
    creator: "human",
  };
  const datum = {
    id: "D-FTIR-260910-01",
    name: "红外测试结果",
    body: "",
    description: "",
    version: 1,
    aboutSampleIds: ["S260909-01"],
    sourceDocumentId: "S260909-01",
    sourceBlockId: "ftir",
    updatedAt: "2026-09-10",
    componentIds: ["f1", "f2"],
    components: [
      {
        ...shared,
        id: "c1",
        kind: "text",
        name: "红外测试结果",
        content: "来自编辑器 [数据] 主行；同时作为默认 display name。",
        role: "primary_description",
      },
      {
        ...shared,
        id: "c2",
        kind: "file",
        name: files[0].originalName,
        attachmentId: "f1",
        role: "raw",
      },
      {
        ...shared,
        id: "c3",
        kind: "file",
        name: files[1].originalName,
        attachmentId: "f2",
        role: "processed",
        derivedFrom: ["c2"],
      },
      {
        ...shared,
        id: "c4",
        kind: "text",
        name: "1200 cm⁻¹ 附近峰强增加，基线整体稳定。",
        content: "只描述数据趋势，不解释机理",
        role: "ai_description",
        creator: "external",
        derivedFrom: ["c2"],
      },
    ],
  };
  await page.route("**/api/v1/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    const value =
      endpoint === "/api/v1/data"
        ? [datum]
        : endpoint === "/api/v1/claims"
          ? [
              {
                id: "c",
                version: 1,
                hostType: "data",
                hostId: datum.id,
                text: "HPMC 可能抑制液滴聚并。\n  - 状态: 待验证｜置信度: Medium",
                evidence: [],
              },
            ]
          : endpoint === "/api/v1/samples"
            ? [{ id: "S260909-01", code: "S260909-01", properties: [] }]
            : (files.find(
                (file) => endpoint === `/api/v1/attachments/${file.id}`,
              ) ?? []);
    return route.fulfill({ json: value });
  });
  await page.goto("/?acceptance=1");
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: "红外测试结果", exact: true }).click();
  await expect(
    page.locator(".componentKind").filter({ hasText: "图 · 派生" }),
  ).toBeVisible();
  const measurements = [];
  for (const selector of [
    ".detailHero",
    ".contentArea",
    ".dataBox",
    ".componentList",
    ".componentRow",
    ".infoGrid",
  ]) {
    await expectHorizontalInvariant(page, reference, selector);
    measurements.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  await expectFontAtLeast(page, ".componentKind", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".componentMain b", DESIGN_V2.meta);
  await expectFontAtLeast(page, ".componentMain span", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".componentRole", DESIGN_V2.micro);
  await expectNoPageOverflow(page);
  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await page.screenshot({ path: testInfo.outputPath("actual.png") });
  await reference.screenshot({ path: testInfo.outputPath("reference.png") });
  await checkViewport(
    page,
    reference,
    1600,
    900,
    testInfo,
    [
      ".detailHero",
      ".contentArea",
      ".dataBox",
      ".componentList",
      ".componentRow",
      ".infoGrid",
    ],
    { screenshot: true },
  );
  await reference.close();
});
