import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

test("UI-003c: Claim uses prototype geometry with frozen Data cards and explicit context semantics", async ({
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
