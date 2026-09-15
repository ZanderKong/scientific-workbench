import { describe, expect, it } from "vitest";
import { decodeBody, encodeBody, encodeBindings } from "./codec";

describe("research body codec", () => {
  it("preserves literal brackets, backslashes and unsupported Markdown", () => {
    const body =
      '# 外部标题\n\n<!-- swb:block id="a" -->\n- [水] C:\\folder\n  <!-- swb:block id="b" -->\n  - [水]｜备注：\\[保留\\]\n\n```x\nraw\n```';
    expect(encodeBody(decodeBody(body))).toBe(body);
  });
  it("roundtrips hard line breaks and nested children without splitting the operation", () => {
    const body =
      '<!-- swb:block id="a" -->\n- 操作第一行\n  同一操作第二行\n  <!-- swb:block id="b" -->\n  - 属性\n\n  <!-- swb:block id="c" -->\n  - 下一属性';
    const decoded = decodeBody(body);
    expect(encodeBody(decoded)).toBe(body);
    expect(
      decoded.content![0].content![0].content![0].content!.some(
        (node) => node.type === "hardBreak",
      ),
    ).toBe(true);
    expect(
      decoded.content![0].content![0].content!.find(
        (node) => node.type === "bulletList",
      )!.content,
    ).toHaveLength(2);
  });
  it("does not silently discard an orphan block comment", () => {
    const body = '<!-- swb:block id="orphan" -->\nordinary text';
    expect(encodeBody(decodeBody(body))).toBe(body);
  });
  it("keeps identity when moving a complete operation", () => {
    const document = decodeBody(
      '<!-- swb:block id="a" -->\n- 第一操作\n<!-- swb:block id="b" -->\n- 第二操作',
    );
    document.content![0].content!.reverse();
    expect(encodeBody(document)).toBe(
      '<!-- swb:block id="b" -->\n- 第二操作\n<!-- swb:block id="a" -->\n- 第一操作',
    );
  });
  it("assigns independent identities to external ordinary bullets", () => {
    const document = decodeBody("- 同名\n- 同名");
    const ids = document.content![0].content!.map((item) => item.attrs!.id);
    expect(new Set(ids).size).toBe(2);
  });
});

it("roundtrips a pending creation intent and drops it when its text changes", () => {
  const body = '<!-- swb:block id="operation" -->\n- [设备 A]';
  const bindings: import("@workbench/core").ReferenceOccurrence[] = [
    {
      id: "operation:0",
      blockId: "operation",
      start: 0,
      end: 6,
      rawText: "设备 A",
      role: "equipment",
      status: "create-intent",
      intentId: "intent-id",
    },
  ];
  const doc = decodeBody(body, bindings);
  expect(encodeBindings(doc)).toEqual(bindings);
  doc.content![0].content![0].content![0].content![0].text = "[设备 B]";
  expect(encodeBindings(doc)).toEqual([]);
});

it("roundtrips attachment tokens only under Data and preserves escaped file names", () => {
  const link = "[测试\\]光谱.csv](swb-file:file-1)";
  const body = `<!-- swb:block id="a" -->\n- 普通 ${link}\n<!-- swb:block id="d" -->\n- [数据] 光谱\n  <!-- swb:block id="f" -->\n  - ${link}[另一个.png](swb-file:file-2)`;
  const document = decodeBody(body);
  expect(
    document.content![0].content![0].content![0].content?.every(
      (node) => node.type === "text",
    ),
  ).toBe(true);
  const child = document.content![0].content![1].content![1].content![0];
  expect(
    child.content![0].content?.filter((node) => node.type === "fileToken"),
  ).toHaveLength(2);
  expect(child.content![0].content![0].attrs?.name).toBe("测试]光谱.csv");
  expect(encodeBody(document)).toBe(body);
});
