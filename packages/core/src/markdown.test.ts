import { expect, it } from "vitest";
import { createHead, parseDocument, serializeDocument } from "./markdown";
import { sha256 } from "./hash";
it("preserves leading blank lines, unknown text and literal escapes with a consistent body hash", () => {
  const body = "\n\n# 外部正文\n\n[原始文本] \\ 不转换\r\n  缩进";
  const result = parseDocument(
    serializeDocument({ head: createHead("analysis", "test", body), body }),
  );
  expect(result.body).toBe(body);
  expect(result.head.bodyHash).toBe(sha256(body));
});
it("accepts CRLF frontmatter without rewriting the body", () => {
  const original = serializeDocument({
    head: createHead("data", "test"),
    body: "- Windows\n  - 原文",
  }).replaceAll("\n", "\r\n");
  expect(parseDocument(original).body).toBe("- Windows\r\n  - 原文");
});
