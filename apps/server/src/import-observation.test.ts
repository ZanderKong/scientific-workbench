import { expect, it } from "vitest";
import { importReplyEnded } from "./import-observation";
it("keeps observing completed intermediate tool steps until a final idle reply", () => {
  const step = {
    parentId: "current",
    completed: 1,
    tools: [
      { name: "scientific-workbench_knowledge_index", status: "completed" },
    ],
  };
  expect(importReplyEnded([step], "current", "idle")).toBe(false);
  expect(
    importReplyEnded(
      [step, { parentId: "other", completed: 2 }],
      "current",
      "idle",
    ),
  ).toBe(false);
  expect(
    importReplyEnded(
      [step, { parentId: "current", completed: 2 }],
      "current",
      "busy",
    ),
  ).toBe(false);
  expect(
    importReplyEnded(
      [step, { parentId: "current", completed: 2 }],
      "current",
      "idle",
    ),
  ).toBe(true);
});
