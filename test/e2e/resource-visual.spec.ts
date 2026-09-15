import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

test("UI-003d: material list and detail retain prototype layout with actual recommended properties", async ({
  page,
  browser,
}, testInfo) => {
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate("goPage({type:'list',nav:'resources'},'resources')");
  const fixture = (await reference.evaluate("resourceData['原料']")) as {
    id: string;
    name: string;
    identity: string;
    usage: string;
  }[];
  const names = [
    ...new Set(fixture.flatMap((item) => item.usage.split(" · "))),
  ];
  const properties = names.map((canonicalName, index) => ({
    id: `prop-${index}`,
    canonicalName,
    version: 1,
    aliases: [],
    usageCount: 0,
  }));
  const objects = fixture.map((item) => ({
    id: item.id,
    canonicalName: item.name,
    role: "material",
    identityText: item.identity,
    recommendedPropertyIds: item.usage
      .split(" · ")
      .map(
        (name) =>
          properties.find((property) => property.canonicalName === name)!.id,
      ),
    aliases: [],
    lifecycle: "active",
    version: 1,
  }));
  const samples = ["S260909-01", "S260909-02"].map((id, index) => ({
    id,
    code: id,
    createdAt: "2026-09-14",
    document: {
      head: {
        updatedAt: "2026-09-14",
        references: [{ objectId: fixture[0].id }],
      },
    },
    properties: properties
      .slice(0, index ? 1 : 2)
      .map((property) => ({
        object_id: fixture[0].id,
        property_id: property.id,
        property_name: property.canonicalName,
      })),
  }));
  await page.route("**/api/v1/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        endpoint === "/api/v1/objects"
          ? objects
          : endpoint === "/api/v1/properties"
            ? properties
            : endpoint === "/api/v1/samples"
              ? samples
              : [],
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?acceptance=1");
  await page.locator("nav").getByRole("button", { name: "⌘ 资源" }).click();
  for (const state of ["list", "detail"]) {
    if (state === "detail") {
      await reference.evaluate(
        "goPage({type:'resource-detail',kind:'原料',id:'m-2poa'},'resources')",
      );
      await page
        .getByRole("cell", { name: fixture[0].name, exact: true })
        .click();
    }
    const measures = [];
    const selectors =
      state === "list"
        ? [".pageHeader", ".toolbar", ".tabs", ".tableWrap", ".tableWrap tr"]
        : [
            ".detailTop",
            ".detailHero",
            ".resourceDetailGrid",
            ".detailCard",
            ".propertyRows",
            ".propertyTokens",
            ".span2",
          ];
    for (const selector of selectors) {
      const expected = await reference.locator(selector).first().boundingBox(),
        actual = await page.locator(selector).first().boundingBox();
      measures.push({ selector, expected, actual });
      for (const key of ["x", "y", "width", "height"] as const)
        expect
          .soft(
            Math.abs(expected![key] - actual![key]),
            `${state}:${selector}.${key}`,
          )
          .toBeLessThanOrEqual(2);
    }
    fs.writeFileSync(
      testInfo.outputPath(`${state}-geometry.json`),
      JSON.stringify(measures, null, 2),
    );
    const a = PNG.sync.read(
        await page.screenshot({
          path: testInfo.outputPath(`${state}-actual.png`),
        }),
      ),
      b = PNG.sync.read(
        await reference.screenshot({
          path: testInfo.outputPath(`${state}-reference.png`),
        }),
      );
    const diff = new PNG({ width: 1440, height: 1000 });
    const pixels = pixelmatch(a.data, b.data, diff.data, 1440, 1000, {
      threshold: 0.1,
    });
    fs.writeFileSync(
      testInfo.outputPath(`${state}-diff.png`),
      PNG.sync.write(diff),
    );
    fs.writeFileSync(
      testInfo.outputPath(`${state}-pixels.json`),
      JSON.stringify({ pixels, ratio: pixels / 1440000 }),
    );
    expect(pixels / 1440000).toBeLessThanOrEqual(0.005);
  }
  await reference.close();
});
