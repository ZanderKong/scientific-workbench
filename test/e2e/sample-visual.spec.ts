import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

test("UI-002b: full sample operations and attachment rows follow the prototype", async ({
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
  const pairs = [
    ".sidebar",
    ".topbar",
    ".editorTop",
    ".editorHeader",
    ".directEditor",
    ".editorFooter",
    ".docParseNote",
  ].map((selector) => [selector, selector]);
  for (let index = 1; index <= 3; index++)
    pairs.push(
      [
        `.record:nth-child(${index})`,
        `.ProseMirror > ul > li:nth-child(${index})`,
      ],
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
  }
  for (const [original, current] of pairs) {
    const expected = await reference.locator(original).first().boundingBox(),
      actual = await page.locator(current).first().boundingBox();
    measures.push({ selector: original, expected, actual });
  }
  fs.writeFileSync(
    info.outputPath("geometry.json"),
    JSON.stringify(measures, null, 2),
  );
  const a = PNG.sync.read(
    await page.screenshot({ path: info.outputPath("actual.png") }),
  );
  const original = PNG.sync.read(
    await reference.screenshot({ path: info.outputPath("reference.png") }),
  );
  // Explicitly approved grammar difference (OBJ-001/EDIT-007), applied only to this
  // disposable comparison DOM. The frozen file and raw screenshot remain unchanged.
  await reference
    .locator(".directEditor .ref,.directEditor .semanticBadge")
    .evaluateAll((tokens) => {
      tokens.forEach((token) => {
        token.textContent = `[${token.textContent}]`;
      });
    });
  const b = PNG.sync.read(
    await reference.screenshot({
      path: info.outputPath("reference-bracket-syntax.png"),
    }),
  );
  const rawPixels = pixelmatch(
    a.data,
    original.data,
    undefined,
    viewport.width,
    viewport.height,
    { threshold: 0.1 },
  );
  const diff = new PNG(viewport);
  const pixels = pixelmatch(
    a.data,
    b.data,
    diff.data,
    viewport.width,
    viewport.height,
    { threshold: 0.1 },
  );
  fs.writeFileSync(info.outputPath("diff.png"), PNG.sync.write(diff));
  fs.writeFileSync(
    info.outputPath("pixels.json"),
    JSON.stringify({
      rawPixels,
      rawRatio: rawPixels / 1440000,
      pixels,
      ratio: pixels / 1440000,
      normalization:
        "Only bracket syntax added to reference object/type text; no masks, style changes or structural changes.",
    }),
  );
  for (const item of measures) {
    // recordMain includes the fold button; the actual editable paragraph starts after its 26px gutter.
    const gutter = item.selector.endsWith(".recordMain") ? 26 : 0;
    for (const key of ["x", "y", "width", "height"] as const) {
      const expected =
        item.expected![key] +
        (key === "x" ? gutter : key === "width" ? -gutter : 0);
      expect
        .soft(Math.abs(expected - item.actual![key]), `${item.selector}.${key}`)
        .toBeLessThanOrEqual(2);
    }
  }
  expect(pixels / 1440000).toBeLessThanOrEqual(0.005);
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
      for (const key of ["x", "y", "width", "height"] as const) {
        const target =
          expected![key] +
          (key === "x" ? gutter : key === "width" ? -gutter : 0);
        expect
          .soft(Math.abs(target - actual![key]), `${width}:${original}.${key}`)
          .toBeLessThanOrEqual(2);
      }
    }
    fs.writeFileSync(
      info.outputPath(`geometry-${width}.json`),
      JSON.stringify(narrow, null, 2),
    );
    await page.screenshot({ path: info.outputPath(`actual-${width}.png`) });
    await reference.screenshot({
      path: info.outputPath(`reference-brackets-${width}.png`),
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
  await expect(reference.locator(".record .details").first()).toHaveAttribute("hidden", "");
  const referenceDetails = await reference.locator(".record .details").first().evaluate(element => ({
    height: element.getBoundingClientRect().height,
    marginTop: parseFloat(getComputedStyle(element).marginTop),
    display: getComputedStyle(element).display,
  }));
  expect(referenceDetails.display).toBe("grid");
  fs.writeFileSync(info.outputPath("fold-difference.json"), JSON.stringify({ reason: "Original hidden attribute is overridden by display:grid; actual editor hides the child list as required.", referenceDetails }));
  const closedOriginal = await reference.locator(".directEditor").boundingBox();
  const closedActual = await page.locator(".directEditor").boundingBox();
  expect(
    Math.abs(closedOriginal!.height - referenceDetails.height - referenceDetails.marginTop - closedActual!.height),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("actual-folded.png") });
  await reference.screenshot({ path: info.outputPath("reference-folded.png") });
  await reference.close();
});
