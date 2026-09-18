import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  DESIGN_V2,
  expectBox,
  expectFontSize,
  expectHorizontalInvariant,
  expectNoPageOverflow,
} from "./design-v2";

test("UI-002b/UI-DENSITY-001: sample content keeps frozen geometry at Design v2 chrome density", async ({
  page,
  browser,
}, info) => {
  const viewport = { width: 1440, height: 1000 };
  const reference = await browser.newPage({ viewport });
  await reference.goto(`file://${path.resolve("prototype/reference.html")}`);
  await reference.evaluate("goPage({type:'sample',id:'S260909-01'},'samples')");
  const fixture = await reference.evaluate(() => {
    const objects: {
      id: string;
      canonicalName: string;
      role: string;
      aliases: string[];
      lifecycle: string;
      version: number;
    }[] = [];
    document.querySelectorAll(".directEditor .ref").forEach((element) => {
      const canonicalName = element.textContent!;
      if (!objects.some((object) => object.canonicalName === canonicalName))
        objects.push({
          id: `object-${objects.length}`,
          canonicalName,
          role: element.classList.contains("equipment")
            ? "equipment"
            : element.classList.contains("process")
              ? "process"
              : "material",
          aliases: [],
          lifecycle: "active",
          version: 1,
        });
    });
    const text = (element: Element) => {
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll(".ref,.semanticBadge").forEach((token) => {
        token.textContent = `[${token.textContent}]`;
      });
      return clone.textContent!.trim();
    };
    const lines: string[] = [];
    let block = 0;
    const add = (depth: number, content: string) => {
      const indent = "  ".repeat(depth);
      lines.push(
        `${indent}<!-- swb:block id="visual-${block++}" -->`,
        `${indent}- ${content}`,
      );
    };
    document.querySelectorAll(".directEditor .record").forEach((record) => {
      add(0, text(record.querySelector(".recordText")!));
      record
        .querySelectorAll(".details > .detailLine")
        .forEach((line) => add(1, text(line)));
      record.querySelectorAll(".fileChildRow").forEach((row, index) => {
        const names = [...row.querySelectorAll(".fileName")].map(
          (name) => name.textContent!,
        );
        add(
          2,
          names
            .map(
              (name, file) =>
                `[${name}](swb-file:visual-file-${index}-${file})`,
            )
            .join(""),
        );
      });
    });
    add(0, "");
    return { body: lines.join("\n"), objects };
  });
  const head = {
    sampleId: "visual-sample",
    code: "S260909-01",
    contentVersion: 1,
    indexVersion: 1,
    extractionStatus: "ready",
    blocks: {},
    references: [],
    properties: [],
  };
  const document = { body: fixture.body, head };
  const sample = {
    id: "visual-sample",
    code: head.code,
    createdAt: "2026-09-09",
    contentVersion: 1,
    extractionStatus: "ready",
    properties: [],
    document,
  };
  await page.route("**/api/v1/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        endpoint === "/api/v1/samples"
          ? [sample]
          : endpoint === "/api/v1/samples/visual-sample"
            ? sample
            : endpoint === "/api/v1/documents/visual-sample"
              ? document
              : endpoint === "/api/v1/objects"
                ? fixture.objects
                : [],
    });
  });
  await page.setViewportSize(viewport);
  await page.goto("/?acceptance=1");
  await page.getByText(head.code, { exact: true }).click();
  const fileCount = await reference.locator(".fileChip").count();
  await expect(page.locator(".fileChip")).toHaveCount(fileCount);
  const measures = [];
  const shell = [
    ".sidebar",
    ".topbar",
    ".editorTop",
    ".editorHeader",
    ".directEditor",
    ".editorFooter",
    ".docParseNote",
  ];
  for (const selector of shell) {
    await expectHorizontalInvariant(page, reference, selector);
    measures.push({
      selector,
      expected: await reference.locator(selector).first().boundingBox(),
      actual: await page.locator(selector).first().boundingBox(),
    });
  }
  const pairs = [
    ".record:nth-child(1)",
    ".record:nth-child(2)",
    ".record:nth-child(3)",
  ].map((selector) => [
    selector,
    selector.replace(".record", ".ProseMirror > ul > li"),
  ]);
  for (let index = 1; index <= 3; index++)
    pairs.push(
      [
        `.record:nth-child(${index}) .recordMain`,
        `.ProseMirror > ul > li:nth-child(${index}) > p`,
      ],
      [
        `.record:nth-child(${index}) .details`,
        `.ProseMirror > ul > li:nth-child(${index}) > ul`,
      ],
    );
  for (let index = 0; index < fileCount; index++) {
    const expected = await reference
        .locator(".fileChip")
        .nth(index)
        .boundingBox(),
      actual = await page.locator(".fileChip").nth(index).boundingBox();
    measures.push({ selector: `file-${index}`, expected, actual });
    // File chips keep their fixed 22px height and left edge; the filename text
    // is on the Design v2 scale so the chip may grow a few px wider.
    expect
      .soft(Math.abs(expected!.height - actual!.height))
      .toBeLessThanOrEqual(2);
    expect.soft(Math.abs(expected!.x - actual!.x)).toBeLessThanOrEqual(2);
  }
  for (const [original, current] of pairs) {
    const expected = await reference.locator(original).first().boundingBox(),
      actual = await page.locator(current).first().boundingBox();
    measures.push({ selector: original, expected, actual });
    // recordMain includes the fold button; the editable paragraph starts after its 26px gutter.
    const gutter = original.endsWith(".recordMain") ? 26 : 0;
    for (const key of ["x", "width"] as const) {
      const target =
        expected![key] + (key === "x" ? gutter : key === "width" ? -gutter : 0);
      expect
        .soft(Math.abs(target - actual![key]), `${original}.${key}`)
        .toBeLessThanOrEqual(2);
    }
  }

  // Approved macro invariants.
  await expectBox(page, ".sidebar", { width: DESIGN_V2.sidebarWidth });
  await expectBox(page, ".topbar", { height: DESIGN_V2.topbarHeight });
  await expectBox(page, ".editorHeader", {
    width: DESIGN_V2.sampleEditorWidth,
  });
  await expectBox(page, ".directEditor", {
    width: DESIGN_V2.sampleEditorWidth,
  });
  // The sample scientific body height must be untouched by Design v2 chrome changes.
  const referenceEditor = await reference
    .locator(".directEditor")
    .first()
    .boundingBox();
  await expectBox(page, ".directEditor", { height: referenceEditor!.height });

  // Sample scientific typography is explicitly out of scope for Design v2.
  await expectFontSize(page, ".ProseMirror > ul > li", 15);
  await expectFontSize(page, ".ProseMirror > ul > li li", 13);
  await expectFontSize(page, ".fileName", 10);
  await expectNoPageOverflow(page);

  fs.writeFileSync(
    info.outputPath("geometry.json"),
    JSON.stringify(measures, null, 2),
  );
  await page.screenshot({ path: info.outputPath("actual.png") });
  await reference.screenshot({ path: info.outputPath("reference.png") });

  for (const width of [980, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await reference.setViewportSize({ width, height: 1000 });
    const narrow = [];
    for (const [original, current] of pairs) {
      const expected = await reference.locator(original).first().boundingBox();
      const actual = await page.locator(current).first().boundingBox();
      const gutter = original.endsWith(".recordMain") ? 26 : 0;
      narrow.push({ original, expected, actual });
      if (!expected || !actual) {
        expect(actual, `${width}:${original} visibility`).toEqual(expected);
        continue;
      }
      for (const key of ["x", "width"] as const) {
        const target =
          expected[key] +
          (key === "x" ? gutter : key === "width" ? -gutter : 0);
        expect
          .soft(Math.abs(target - actual[key]), `${width}:${original}.${key}`)
          .toBeLessThanOrEqual(2);
      }
    }
    await expectNoPageOverflow(page);
    fs.writeFileSync(
      info.outputPath(`geometry-${width}.json`),
      JSON.stringify(narrow, null, 2),
    );
    await page.screenshot({ path: info.outputPath(`actual-${width}.png`) });
    await reference.screenshot({
      path: info.outputPath(`reference-${width}.png`),
    });
  }
  await page.setViewportSize(viewport);
  await reference.setViewportSize(viewport);
  await reference.locator(".record .fold").first().click();
  await page
    .getByRole("button", { name: "折叠操作", exact: true })
    .first()
    .click();
  await expect(
    page.locator(".ProseMirror > ul > li > ul").first(),
  ).toBeHidden();
  // Frozen prototype sets hidden but its author display:grid overrides that browser
  // default. The real editor must actually fold (EDIT-002); record this prototype bug.
  await expect(reference.locator(".record .details").first()).toHaveAttribute(
    "hidden",
    "",
  );
  const referenceDetails = await reference
    .locator(".record .details")
    .first()
    .evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      marginTop: parseFloat(getComputedStyle(element).marginTop),
      display: getComputedStyle(element).display,
    }));
  expect(referenceDetails.display).toBe("grid");
  fs.writeFileSync(
    info.outputPath("fold-difference.json"),
    JSON.stringify({
      reason:
        "Original hidden attribute is overridden by display:grid; actual editor hides the child list as required.",
      referenceDetails,
    }),
  );
  const closedOriginal = await reference.locator(".directEditor").boundingBox();
  const closedActual = await page.locator(".directEditor").boundingBox();
  expect(
    Math.abs(
      closedOriginal!.height -
        referenceDetails.height -
        referenceDetails.marginTop -
        closedActual!.height,
    ),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("actual-folded.png") });
  await reference.screenshot({ path: info.outputPath("reference-folded.png") });
  await reference.close();
});
