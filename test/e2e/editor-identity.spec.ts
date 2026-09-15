import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("operation moves and clipboard copies preserve the correct identities through undo, finalize and reopen", async ({
  page,
  request,
}) => {
  const sample = await (
    await request.post("/api/v1/samples", {
      data: {
        code: "IDENTITY-MOVES",
        body: "- 第一操作\n  - 第一属性\n- 第二操作\n  - 第二属性",
      },
    })
  ).json();
  await request.post(`/api/v1/documents/${sample.id}/finalize`);
  await page.goto("/");
  await page.getByText("IDENTITY-MOVES", { exact: true }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  const ids = () =>
    editor
      .locator("li")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-id")),
      );
  await expect.poll(async () => (await ids()).filter(Boolean).length).toBe(4);
  const before = await ids();
  expect(new Set(before).size).toBe(4);
  await editor.locator("p").filter({ hasText: "第一操作" }).click();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(ids).toEqual([...before.slice(2), ...before.slice(0, 2)]);
  await page.keyboard.press("Meta+z");
  await expect.poll(ids).toEqual(before);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(ids).toEqual([...before.slice(2), ...before.slice(0, 2)]);

  // Real drag/drop path using the existing fold gutter as an operation handle.
  const handle = page
    .getByRole("button", { name: "折叠操作", exact: true })
    .last();
  const target = editor.locator(":scope > ul > li > p").first();
  await handle.dragTo(target, { targetPosition: { x: 10, y: 2 } });
  await expect.poll(ids).toEqual(before);

  // Use the real browser copy serializer: decoration buttons must not enter the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await editor
    .locator(":scope > ul > li")
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNode(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page.keyboard.press("Meta+c");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("第一操作");
  expect(clipboard).not.toContain("⌄");
  const copiedHtml = await editor
    .locator(":scope > ul > li")
    .first()
    .evaluate((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(".ProseMirror-widget,.ProseMirror-separator")
        .forEach((item) => item.remove());
      return `<ul>${clone.outerHTML}</ul>`;
    });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await editor.locator("p").filter({ hasText: "第二属性" }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await editor.evaluate((element, html) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "第一操作\n第一属性");
    clipboardData.setData("text/html", html);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, copiedHtml);
  await expect.poll(async () => (await ids()).length).toBe(6);
  const copied = await ids();
  expect(copied).toHaveLength(6);
  expect(new Set(copied).size).toBe(6);
  expect(copied.slice(0, 4)).toEqual(before);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await ids()).includes(copied[5])).toBe(false);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(ids).toEqual(copied);
  const editorNode = await editor.elementHandle();
  await page
    .getByRole("button", { name: "折叠操作", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("结构已更新");
  expect(await editorNode!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  await expect(editor.locator(":scope > ul > li > ul").first()).toBeHidden();
  const disk = fs.readFileSync(
    path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples", `${sample.id}.md`),
    "utf8",
  );
  expect(
    [...disk.matchAll(/<!-- swb:block id="([^"]+)" -->/g)].map(
      (match) => match[1],
    ),
  ).toEqual(copied);
  await page.getByRole("button", { name: "← 样品", exact: true }).click();
  await page.getByText("IDENTITY-MOVES", { exact: true }).click();
  await expect.poll(ids).toEqual(copied);
});

test("keyboard indentation only permits a third level under Data and keeps text on refusal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  await editor.click();
  await page.keyboard.insertText("操作");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("属性");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("普通文字");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("status")).toContainText("只有 Data 子级");
  await expect(editor.locator("ul ul ul")).toHaveCount(0);
  await expect(editor).toContainText("普通文字");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("[数据] 结果");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("附件说明");
  await expect(editor.locator("ul ul ul")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("不可四层");
  await page.keyboard.press("Tab");
  await expect(editor.locator("ul ul ul ul")).toHaveCount(0);
  await expect(editor).toContainText("不可四层");
});
