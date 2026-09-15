import { test, expect } from "@playwright/test";

test("Claim cards show frozen content, text edits preserve evidence, supplement appends, and related Sample opens", async ({
  page,
  request,
}) => {
  const sample = await (
    await request.post("/api/v1/samples", {
      data: { code: `CLAIM-${Date.now()}` },
    })
  ).json();
  const datum = await (
    await request.post("/api/v1/data", {
      data: {
        name: "创建时光谱",
        body: "原始固定光谱正文",
        aboutSampleIds: [sample.id],
      },
    })
  ).json();
  const claim = await (
    await request.post("/api/v1/claims", {
      data: {
        hostType: "data",
        hostId: datum.id,
        text: "待确认的变化\n  - 状态：待验证｜置信度：Medium",
      },
    })
  ).json();
  const updated = await request.put(`/api/v1/data/${datum.id}`, {
    data: {
      name: "后来改名光谱",
      body: "后来改写的数据",
      expectedVersion: datum.version,
    },
  });
  expect(updated.ok()).toBeTruthy();
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: "◌ 论点" }).click();
  await page.getByRole("cell", { name: "待确认的变化", exact: true }).click();
  const card = page.locator(".evidenceCard").first();
  await expect(card).toContainText("创建时光谱");
  await expect(card).toContainText("原始固定光谱正文");
  await expect(page.locator(".claimHero .status")).toHaveText("待验证");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByLabel("论点正文")
    .fill("修改后的判断\n  - 状态：待复测｜置信度：Low");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(page.locator(".claimHero h1")).toHaveText("修改后的判断");
  await expect(page.locator(".claimHero .status")).toHaveText("待复测");
  const afterEdit = await (
    await request.get(`/api/v1/claims/${claim.id}`)
  ).json();
  expect(afterEdit.evidence).toEqual(claim.evidence);
  await card.click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "原始固定光谱正文",
  );
  await expect(page.getByRole("dialog").locator("pre")).not.toContainText(
    "后来改写的数据",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "查看完整上下文" })
    .click();
  await expect(page.getByRole("dialog").locator("pre")).toHaveText(
    claim.evidence[0].content,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 补充当前证据", exact: true })
    .click();
  await expect(page.locator(".evidenceCard")).toHaveCount(2);
  await expect(page.locator(".evidenceCard").last()).toContainText(
    "后来改写的数据",
  );
  const afterSupplement = await (
    await request.get(`/api/v1/claims/${claim.id}`)
  ).json();
  expect(afterSupplement.evidence[0]).toEqual(claim.evidence[0]);
  await page
    .getByRole("button", { name: `${sample.code} ↗`, exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "样品正文" })).toBeVisible();
});
