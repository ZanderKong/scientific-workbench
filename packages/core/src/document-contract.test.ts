import { describe, expect, it } from "vitest";
import {
  documentBindingsSchema,
  sanitizeDocumentBindings,
  type JsonSchema,
} from "./document-contract";
import { openApiDocument, operationRequest, operations } from "./operations";
import type { ReferenceOccurrence, ResearchObject } from "./types";

const body = [
  '<!-- swb:block id="b1" -->',
  "- [水]｜添加量：80 g",
  '<!-- swb:block id="b2" -->',
  "- [搅拌]",
].join("\n");

const objects = [
  { id: "o-water", role: "material" },
  { id: "o-stir", role: "process" },
] as Pick<ResearchObject, "id" | "role">[];

const binding = (
  overrides: Partial<ReferenceOccurrence> = {},
): ReferenceOccurrence => ({
  id: "b1:0",
  blockId: "b1",
  rawText: "水",
  role: "material",
  start: 0,
  end: 3,
  status: "bound",
  objectId: "o-water",
  ...overrides,
});

describe("document save bindings contract", () => {
  it("publishes bindings through the operation catalogue and OpenAPI", () => {
    const save = operations.find(
      (operation) => operation.name === "document_save",
    )!;
    expect(save.input.properties.bindings).toBe(documentBindingsSchema);
    const openapi = openApiDocument() as any;
    const schema =
      openapi.paths["/api/v1/documents/{id}"].put.requestBody.content[
        "application/json"
      ].schema;
    expect(schema.properties.bindings.type).toBe("array");
    expect(
      (schema.properties.bindings.items as JsonSchema).required,
    ).toContain("blockId");
    const request = operationRequest(save, {
      id: "doc-1",
      body: "- x",
      expectedVersion: 2,
      bindings: [binding()],
    });
    expect(request.path).toBe("/documents/doc-1");
    expect(request.body).toEqual({
      body: "- x",
      expectedVersion: 2,
      bindings: [binding()],
    });
  });

  it("keeps a valid binding and gives it stable identity", () => {
    const result = sanitizeDocumentBindings(body, [binding()], objects);
    expect(result.warnings).toEqual([]);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]).toMatchObject({
      blockId: "b1",
      objectId: "o-water",
      status: "bound",
      rawText: "水",
    });
  });

  it("rejects an out-of-range position instead of storing it", () => {
    expect(() =>
      sanitizeDocumentBindings(body, [binding({ end: 999 })], objects),
    ).toThrowError(/超出区块范围/);
    expect(() =>
      sanitizeDocumentBindings(body, [binding({ start: -1, end: 2 })], objects),
    ).toThrowError(/范围无效/);
  });

  it("drops bindings for missing blocks, missing objects and forged intents", () => {
    const missingBlock = sanitizeDocumentBindings(
      body,
      [binding({ blockId: "gone" })],
      objects,
    );
    expect(missingBlock.bindings).toEqual([]);
    const missingObject = sanitizeDocumentBindings(
      body,
      [binding({ objectId: "nope" })],
      objects,
    );
    expect(missingObject.bindings).toEqual([]);
    const forgedIntent = sanitizeDocumentBindings(
      body,
      [
        binding({
          status: "create-intent",
          objectId: undefined,
          intentId: "not-a-uuid",
          role: "equipment",
        }),
      ],
      objects,
    );
    expect(forgedIntent.bindings).toEqual([]);
    const sampleIntent = sanitizeDocumentBindings(
      body,
      [
        binding({
          status: "create-intent",
          objectId: undefined,
          intentId: "11111111-1111-1111-1111-111111111111",
          role: "sample",
        }),
      ],
      objects,
    );
    expect(sampleIntent.bindings).toEqual([]);
  });

  it("keeps a well-formed create-intent for a creatable role", () => {
    const result = sanitizeDocumentBindings(
      body,
      [
        binding({
          status: "create-intent",
          objectId: undefined,
          intentId: "11111111-1111-1111-1111-111111111111",
          role: "equipment",
        }),
      ],
      objects,
    );
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].intentId).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });
});
