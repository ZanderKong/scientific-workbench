import { expect, it } from "vitest";
import { claimDrafts } from "./claim-draft";
it("keeps each explicitly submitted claim and its own child text, without leaking internal markers", () => {
  const entries = claimDrafts(
    "- [论点] 第一个判断\n  - 状态: 待验证｜置信度: Medium\n- 【论点】第二个判断\n  - 说明含 [水] 和 \\ 原文",
  );
  expect(entries.map((entry) => entry.text)).toEqual([
    "第一个判断\n  - 状态: 待验证｜置信度: Medium",
    "第二个判断\n  - 说明含 [水] 和 \\ 原文",
  ]);
  expect(entries[0].blockId).not.toBe(entries[1].blockId);
  expect(claimDrafts("- ")).toEqual([]);
});
