import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("sample Data child uploads multiple files, previews, roundtrips and shares canonical Data attachments", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新建样品" }).click();
  const editor = page.getByRole("textbox", { name: "样品正文" });
  await editor.click();
  await page.keyboard.insertText("进行光谱测试");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("[数据] 样品附件验收");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    editor.getByRole("button", { name: "＋ 添加附件" }),
  ).toBeVisible();
  const bytes = Buffer.from("wave,intensity\n1000,0.5\n");
  await page.getByLabel("添加 Data 附件", { exact: true }).setInputFiles([
    { name: "中文]光谱.csv", mimeType: "text/csv", buffer: bytes },
    {
      name: "说明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("模拟软件验收"),
    },
  ]);
  await expect(editor.locator("[data-file-id]")).toHaveCount(2);
  await editor.getByRole("button", { name: /中文\]光谱.csv/ }).click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "1000,0.5",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("结构已更新");
  const data = (await (await request.get("/api/v1/data")).json()).find(
    (row: { name: string }) => row.name === "样品附件验收",
  );
  expect(data.componentIds).toHaveLength(2);
  const samples = await (await request.get("/api/v1/samples")).json();
  const sample = samples.find(
    (row: { id: string }) => row.id === data.sourceDocumentId,
  );
  const raw = fs.readFileSync(
    path.join(process.env.SWB_ACCEPTANCE_DIR!, "samples", sample.id + ".md"),
    "utf8",
  );
  expect(raw).toContain("swb-file:");
  expect(raw).toContain("中文\\]光谱.csv");
  await page.getByRole("button", { name: "← 样品", exact: true }).click();
  await page.getByRole("cell", { name: sample.code, exact: true }).click();
  await expect(editor.locator("[data-file-id]")).toHaveCount(2);
  await expect(editor.locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const repeated = await (await request.get(`/api/v1/data/${data.id}`)).json();
  expect(repeated.componentIds).toEqual(data.componentIds);
  expect(repeated.version).toBe(data.version);
  await page.locator("nav").getByRole("button", { name: "▥ 数据" }).click();
  await page.getByRole("cell", { name: "样品附件验收", exact: true }).click();
  await expect(page.locator(".componentList")).toContainText("中文]光谱.csv");
  await expect(page.locator(".componentList")).toContainText("说明.txt");
});
