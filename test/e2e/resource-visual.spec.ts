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

test("UI-003d/UI-DENSITY-001: material list and detail keep prototype layout with larger type", async ({
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
    properties: properties.slice(0, index ? 1 : 2).map((property) => ({
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
      await expectHorizontalInvariant(page, reference, selector);
      measures.push({
        selector,
        expected: await reference.locator(selector).first().boundingBox(),
        actual: await page.locator(selector).first().boundingBox(),
      });
    }
    if (state === "list") {
      await expectFontSize(page, ".tabs button", DESIGN_V2.control);
    } else {
      await expectFontAtLeast(page, ".propertyRows span", DESIGN_V2.micro);
      await expectFontAtLeast(page, ".propertyRows b", DESIGN_V2.meta);
      await expectFontAtLeast(page, ".propertyTokens span", DESIGN_V2.micro);
    }
    await expectNoPageOverflow(page);
    fs.writeFileSync(
      testInfo.outputPath(`${state}-geometry.json`),
      JSON.stringify(measures, null, 2),
    );
    await page.screenshot({
      path: testInfo.outputPath(`${state}-actual.png`),
    });
    await reference.screenshot({
      path: testInfo.outputPath(`${state}-reference.png`),
    });
    await checkViewport(page, reference, 1600, 900, testInfo, selectors, {
      screenshot: true,
      name: `${state}-actual`,
    });
  }
  await reference.close();
});
