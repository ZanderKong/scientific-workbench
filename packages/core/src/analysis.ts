import type { AnalysisLayout } from "./types";

export const analysisSections = [
  "context",
  "compare",
  "data",
  "artifacts",
  "body",
  "claims",
] as const;
export function defaultAnalysisLayout(): AnalysisLayout {
  return {
    visibleSections: [...analysisSections],
    hiddenColumns: [],
    columnOrder: [],
  };
}
/** File and API inputs use the same validation, including during index rebuild. */
export function normalizeAnalysisLayout(
  input?: AnalysisLayout,
): AnalysisLayout {
  if (input === undefined) return defaultAnalysisLayout();
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  if (
    !input ||
    !strings(input.visibleSections) ||
    !strings(input.hiddenColumns) ||
    !strings(input.columnOrder) ||
    input.visibleSections.some(
      (key) =>
        !analysisSections.includes(key as (typeof analysisSections)[number]),
    )
  ) {
    throw Object.assign(new Error("分析布局格式无效"), {
      code: "INVALID_INPUT",
    });
  }
  return {
    visibleSections: [...new Set(input.visibleSections)],
    hiddenColumns: [...new Set(input.hiddenColumns)],
    columnOrder: [...new Set(input.columnOrder)],
  };
}
