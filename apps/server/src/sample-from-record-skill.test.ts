import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureBlockIds,
  parseBody,
  validateSampleImportDraft,
} from "@workbench/core";
import { getKnowledge, listKnowledge } from "./knowledge";
import { repositoryRoot } from "./sample-import-agent";

/**
 * The import Skill is knowledge content, so it must be published through the
 * same bundle as the protocols and its guidance must be expressible in the real
 * parser. This test keeps the two from drifting apart.
 */
const SKILL_ID = "skill-sample-from-record";
const skillPath = path.join(
  repositoryRoot(),
  "docs",
  "agent",
  "skills",
  "sample-from-record.md",
);

describe("sample-from-record skill", () => {
  it("is published from the same knowledge bundle as the protocols", () => {
    const entry = getKnowledge(SKILL_ID);
    expect(entry.contentHash).toHaveLength(64);
    expect(listKnowledge().map((item) => item.id)).toContain(SKILL_ID);
    const text = fs.readFileSync(skillPath, "utf8");
    expect(entry.content.replace(/\r\n/g, "\n")).toBe(
      text.replace(/\r\n/g, "\n"),
    );
    // It must send the reader to the protocols it builds on.
    for (const id of [
      "protocol-common",
      "protocol-sample-document",
      "protocol-objects-properties",
      "protocol-data-attachments",
    ])
      expect(entry.content).toContain(id);
    // It explains the flow, not the machine contract: no parameter schemas.
    expect(entry.content).not.toMatch(/"type"\s*:\s*"object"/);
    expect(entry.content).not.toMatch(/\brequired\s*:\s*\[/);
  });

  it("describes two samples with different amounts, a shared condition, an observation and a critical ambiguity", () => {
    // The example shape the Skill prescribes: one shared operation, per-sample
    // amounts, a plain observation, and an unresolved critical item.
    const body = ensureBlockIds(
      [
        "- 使用 [恒温水浴] 在 60 摄氏度下处理两份记录样品",
        "  - [恒温水浴]｜温度：60 ℃",
        "- 记录：第 1 份用量 12 mL，第 2 份用量 18 mL",
        "  - [水]｜添加量：12 mL",
        "- 第 2 份续页",
        "  - [水]｜添加量：18 mL",
        "- 两份样品均呈无色透明，未见沉淀",
      ].join("\n"),
    );
    const parsed = parseBody("skill-example", body);
    const properties = parsed.records.flatMap((record) => record.properties);
    // Two distinct amounts survive parsing as separate values.
    expect(properties.map((property) => property.valueText).sort()).toEqual([
      "12 mL",
      "18 mL",
      "60 ℃",
    ]);
    // The plain observation is never turned into a structured property.
    expect(
      properties.some((property) => property.valueText.includes("无色透明")),
    ).toBe(false);
    expect(body).toContain("两份样品均呈无色透明，未见沉淀");
    // Duplicate amounts across pages are preserved rather than merged away.
    const amounts = properties.filter(
      (property) => property.propertyName === "添加量",
    );
    expect(amounts).toHaveLength(2);
  });

  it("keeps a draft with an unresolved critical item rejected by the contract", () => {
    const draft = {
      schemaVersion: 1 as const,
      samples: [
        {
          key: "s1",
          body: ensureBlockIds("- 使用 [水]\n  - [水]｜添加量：12 mL"),
          sourceMappings: [],
          references: [],
        },
      ],
      objectIntents: [],
      ambiguities: [
        {
          level: "critical" as const,
          sampleKey: "s1",
          message: "两页记录是否属于同一份样品尚未确认",
        },
      ],
    };
    // Shape-valid, so the import backend's semantic gate is what refuses it.
    expect(validateSampleImportDraft(draft).ambiguities[0].level).toBe(
      "critical",
    );
  });
});
