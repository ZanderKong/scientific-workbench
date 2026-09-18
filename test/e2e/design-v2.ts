import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Design v2 readability pass (UI-DENSITY-001).
 *
 * The frozen prototype remains a historical reference, but the production
 * workbench intentionally uses a larger type/control scale. Visual tests
 * therefore assert:
 *   - approved macro layout invariants (sidebar, topbar, content widths),
 *   - the Design v2 typography scale,
 *   - absence of page overflow / clipped controls.
 *
 * They no longer assert pixel equality with the frozen prototype.
 */
export const DESIGN_V2 = {
  micro: 10,
  meta: 11,
  control: 12,
  nav: 13,
  sidebarWidth: 168,
  topbarHeight: 48,
  sampleEditorWidth: 840,
  detailWidth: 980,
} as const;

export async function fontSize(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

export async function fieldSize(
  page: Page,
  selector: string,
  property: string,
) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name),
      property,
    );
}

export async function expectFontSize(
  page: Page,
  selector: string,
  expected: number,
) {
  expect
    .soft(await fontSize(page, selector), `${selector} font-size`)
    .toBe(expected);
}

export async function expectFontAtLeast(
  page: Page,
  selector: string,
  minimum: number,
) {
  expect
    .soft(await fontSize(page, selector), `${selector} font-size`)
    .toBeGreaterThanOrEqual(minimum);
}

/**
 * Horizontal geometry that Design v2 must not silently change: element x and
 * width derived from the frozen layout. Vertical size is intentionally free
 * because it follows the larger type scale.
 */
export async function expectHorizontalInvariant(
  page: Page,
  reference: Page,
  selector: string,
  tolerance = 2,
) {
  const expected = await reference.locator(selector).first().boundingBox();
  const actual = await page.locator(selector).first().boundingBox();
  // Responsive states may hide the element in both implementations.
  if (!expected && !actual) return;
  expect(expected, `reference ${selector}`).not.toBeNull();
  expect(actual, `actual ${selector}`).not.toBeNull();
  expect
    .soft(Math.abs(expected!.x - actual!.x), `${selector}.x`)
    .toBeLessThanOrEqual(tolerance);
  expect
    .soft(Math.abs(expected!.width - actual!.width), `${selector}.width`)
    .toBeLessThanOrEqual(tolerance);
}

export async function expectBox(
  page: Page,
  selector: string,
  expected: { x?: number; y?: number; width?: number; height?: number },
  tolerance = 2,
) {
  const actual = await page.locator(selector).first().boundingBox();
  expect(actual, `actual ${selector}`).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) {
    if (expected[key] === undefined) continue;
    expect
      .soft(Math.abs(expected[key]! - actual![key]), `${selector}.${key}`)
      .toBeLessThanOrEqual(tolerance);
  }
}

/** No page-level horizontal scrolling; internal table wrapping is allowed. */
export async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect
    .soft(overflow.scrollWidth, "documentElement horizontal overflow")
    .toBeLessThanOrEqual(overflow.clientWidth);
}

/**
 * Re-check the approved horizontal invariants and page overflow at a viewport,
 * optionally saving a screenshot artifact (used for the 1600x900 pass and the
 * 1280/980/640 regression matrix).
 */
export async function checkViewport(
  page: Page,
  reference: Page,
  width: number,
  height: number,
  testInfo: { outputPath: (name: string) => string },
  selectors: string[],
  options: { screenshot?: boolean; name?: string } = {},
) {
  await reference.setViewportSize({ width, height });
  await page.setViewportSize({ width, height });
  for (const selector of selectors)
    await expectHorizontalInvariant(page, reference, selector);
  await expectNoPageOverflow(page);
  if (options.screenshot)
    await page.screenshot({
      path: testInfo.outputPath(
        `${options.name ?? "actual"}-${width}x${height}.png`,
      ),
    });
}

/** A control must render all of its label without clipping or ellipsis. */
export async function expectNotClipped(page: Page, target: string | Locator) {
  const locator = typeof target === "string" ? page.locator(target) : target;
  const clipped = await locator.first().evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect
    .soft(clipped.scrollWidth, `${target} horizontal clipping`)
    .toBeLessThanOrEqual(clipped.clientWidth + 1);
  expect
    .soft(clipped.scrollHeight, `${target} vertical clipping`)
    .toBeLessThanOrEqual(clipped.clientHeight + 1);
}
