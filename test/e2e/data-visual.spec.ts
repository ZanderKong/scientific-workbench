import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

test("UI-003a: descriptive Data uses the prototype content geometry", async ({
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
    const expected = await reference.locator(selector).first().boundingBox();
    const actual = await page.locator(selector).first().boundingBox();
    measurements.push({ selector, expected, actual });
    for (const key of ["x", "y", "width", "height"] as const)
      expect
        .soft(Math.abs(expected![key] - actual![key]), `${selector}.${key}`)
        .toBeLessThanOrEqual(2);
  }
  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  const expectedImage = PNG.sync.read(
    await reference.screenshot({ path: testInfo.outputPath("reference.png") }),
  );
  const actualImage = PNG.sync.read(
    await page.screenshot({ path: testInfo.outputPath("actual.png") }),
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
  for (const width of [980, 640]) {
    await reference.setViewportSize({ width, height: 1000 });
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of [
      ".detailHero",
      ".contentArea",
      ".dataBox",
      ".infoGrid",
    ]) {
      const expected = await reference.locator(selector).first().boundingBox(),
        actual = await page.locator(selector).first().boundingBox();
      for (const key of ["x", "y", "width", "height"] as const)
        expect
          .soft(
            Math.abs(expected![key] - actual![key]),
            `${width}:${selector}.${key}`,
          )
          .toBeLessThanOrEqual(2);
    }
    await reference.screenshot({
      path: testInfo.outputPath(`reference-${width}.png`),
    });
    await page.screenshot({ path: testInfo.outputPath(`actual-${width}.png`) });
  }
  await reference.close();
});

test("UI-003a: multi-component FTIR Data follows prototype rows and density", async ({
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
    const expected = await reference.locator(selector).first().boundingBox(),
      actual = await page.locator(selector).first().boundingBox();
    measurements.push({ selector, expected, actual });
    for (const key of ["x", "y", "width", "height"] as const)
      expect
        .soft(Math.abs(expected![key] - actual![key]), `${selector}.${key}`)
        .toBeLessThanOrEqual(2);
  }
  fs.writeFileSync(
    testInfo.outputPath("geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  const a = PNG.sync.read(
    await page.screenshot({ path: testInfo.outputPath("actual.png") }),
  );
  const b = PNG.sync.read(
    await reference.screenshot({ path: testInfo.outputPath("reference.png") }),
  );
  const diff = new PNG({ width: 1440, height: 1000 });
  const pixels = pixelmatch(a.data, b.data, diff.data, 1440, 1000, {
    threshold: 0.1,
  });
  fs.writeFileSync(testInfo.outputPath("diff.png"), PNG.sync.write(diff));
  fs.writeFileSync(
    testInfo.outputPath("pixels.json"),
    JSON.stringify({ pixels, ratio: pixels / 1440000 }),
  );
  expect(pixels / 1440000).toBeLessThanOrEqual(0.005);
  await reference.close();
});
