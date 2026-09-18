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

test("UI-003c/UI-DENSITY-001: Claim keeps prototype layout with frozen Data cards", async ({
  page,
  browser,
}, testInfo) => {
  const reference = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate(
    "goPage({type:'claim-detail',id:'C-260909-01'},'claims')",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const documents = {
    "data/D-260909-09.md":
      "# 滴加后白色液滴\n\n2 g HPMC 条件下，继续搅拌后液滴尺寸逐渐减小。",
    "data/D-260909-08.md":
      "# 反射率曲线 260909-01\n\n高 HPMC 组在目标区间表现出更稳定的响应趋势。",
  };
  const claim = {
    id: "C-260909-01",
    version: 1,
    hostType: "analysis",
    hostId: "A-260909-01",
    text: "HPMC 可能抑制液滴聚并，并改善静置稳定性。\n  - 状态：待验证｜置信度：Medium｜作者来源：人工记录",
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
    evidence: [
      {
        id: "e1",
        entityType: "analysis",
        entityId: "A-260909-01",
        version: 1,
        bodyHash: "visual-fixture",
        content: Object.values(documents).join("\n\n---\n\n"),
        documents,
        attachmentIds: [],
        capturedAt: "2026-09-09",
        manifest: {
          host: { type: "analysis", id: "A-260909-01", version: 1 },
          entities: Object.keys(documents).map((file) => ({
            id: file.slice(5, -3),
            type: "data",
            version: 1,
            bodyHash: "visual-fixture",
            file,
          })),
          identities: [
            {
              id: "S260909-01",
              type: "sample",
              name: "S260909-01",
              reason: "Data About",
            },
          ],
          relations: ["D-260909-09", "D-260909-08"].map((fromId) => ({
            fromId,
            toId: "S260909-01",
            kind: "about",
          })),
          attachments: [],
          warnings: [],
        },
      },
    ],
  };
  await page.route("**/api/v1/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        endpoint === "/api/v1/claims"
          ? [claim]
          : endpoint === "/api/v1/analyses"
            ? [
                {
                  id: claim.hostId,
                  title: "HPMC 稳定性分析",
                  itemIds: [],
                  createdAt: "2026-09-09",
                },
              ]
            : [],
    });
  });
  await page.goto("/?acceptance=1");
  await page.locator("nav").getByRole("button", { name: "◌ 论点" }).click();
  await page
    .getByRole("cell", {
      name: "HPMC 可能抑制液滴聚并，并改善静置稳定性。",
      exact: true,
    })
    .click();
  await expect(page.locator(".evidenceCard")).toHaveCount(2);
  const measurements = [];
  for (const selector of [
    ".detailTop",
    ".claimHero",
    ".claimHero h1",
    ".claimLayout",
    ".evidenceColumn",
    ".evidenceCard",
    ".claimLayout aside",
    ".infoCard",
  ]) {
    await expectHorizontalInvariant(page, reference, selector);
    measurements.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  // The claim heading scale is preserved.
  const heading = await page.locator(".claimHero h1").first().boundingBox();
  expect.soft(Math.abs(heading!.height - 36)).toBeLessThanOrEqual(2);
  await expectFontAtLeast(page, ".evidenceCard span", DESIGN_V2.micro);
  await expectFontAtLeast(page, ".evidenceCard p", DESIGN_V2.meta);
  await expectFontAtLeast(page, ".infoCard label", DESIGN_V2.micro);
  await expectFontSize(page, ".claimHero p", DESIGN_V2.meta);
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
      ".detailTop",
      ".claimHero",
      ".claimHero h1",
      ".claimLayout",
      ".evidenceColumn",
      ".evidenceCard",
      ".claimLayout aside",
      ".infoCard",
    ],
    { screenshot: true },
  );
  await reference.close();
});
