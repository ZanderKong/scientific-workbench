/**
 * Real HTTP coverage for the sample-import routes: input schema, request
 * schema, idempotency headers and the durable files an operator can inspect.
 * Store-level tests cannot prove the header path or the response cache.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBlockIds } from "@workbench/core";
import { realImageFixtures } from "./test-images";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "swb-import-http-"));
const dataDir = path.join(root, "workspace");
const token = crypto.randomUUID();
let server: ChildProcess;
let base = "";

async function freePort() {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function api(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + route, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, text };
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api/v1`;
  server = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./main.ts", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        WORKBENCH_PORT: String(port),
        WORKBENCH_DATA_DIR: dataDir,
        WORKBENCH_API_TOKEN: token,
        NODE_ENV: "production",
      },
      stdio: "pipe",
    },
  );
  let errors = "";
  server.stderr?.on("data", (chunk) => {
    errors += chunk;
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`本机服务未启动：${errors.slice(-2000)}`);
    if (
      await fetch(`${base}/health`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 40000);

afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 3000).unref();
    });
  }
  fs.rmSync(root, { recursive: true, force: true });
});

async function uploadImage(bytes: Buffer, name: string, mime: string) {
  const uploaded = await api("POST", "/attachments", {
    contentBase64: bytes.toString("base64"),
    originalName: name,
    mimeType: mime,
  });
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
  return uploaded.body as { id: string };
}

describe("real HTTP sample import", () => {
  it("keeps transient drafts out of the registry and the idempotency cache", async () => {
    const { PNG } = realImageFixtures();
    const attachment = await uploadImage(PNG, "record.png", "image/png");
    const importId = crypto.randomUUID();
    const sentinel = `SENTINEL-${crypto.randomUUID()}`;
    const first = await api(
      "POST",
      "/sample-imports",
      { importId, attachmentIds: [attachment.id] },
      { "idempotency-key": crypto.randomUUID() },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.draft).toBeUndefined();
    expect(first.body.normalized).toBeUndefined();
    const body = {
      attemptId: first.body.attempt.id,
      expectedVersion: first.body.recordVersion,
      expectedDraftVersion: 0,
      draft: {
        schemaVersion: 1,
        samples: [
          {
            key: "s1",
            body: ensureBlockIds(`- ${sentinel}`),
            sourceMappings: [],
            references: [],
          },
        ],
        objectIntents: [],
        ambiguities: [],
      },
    };
    const saved = await api("PUT", `/sample-imports/${importId}/draft`, body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // A brand-new idempotency key on the same import must not create a second
    // import identity and must not cache the transient draft body.
    const second = await api(
      "POST",
      "/sample-imports",
      { importId, attachmentIds: [attachment.id] },
      { "idempotency-key": crypto.randomUUID() },
    );
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.sourceDataId).toBe(first.body.sourceDataId);
    expect(second.body.draft).toBeUndefined();
    const source = await api("GET", `/data/${first.body.sourceDataId}`);
    const committed = await api("POST", `/sample-imports/${importId}/commit`, {
      attemptId: first.body.attempt.id,
      expectedVersion: saved.body.recordVersion,
      draftVersion: saved.body.draftVersion,
      draftHash: saved.body.draftHash,
      sourceDataVersion: source.body.version,
      commitFingerprint: saved.body.commitFingerprint,
    });
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body.receipt.createdSampleIds).toHaveLength(1);

    const readFiles = (dir: string, found: string[] = []): string[] => {
      if (!fs.existsSync(dir)) return found;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) readFiles(full, found);
        else if (!entry.name.includes(".sqlite")) found.push(full);
      }
      return found;
    };
    const leaking = [
      ...readFiles(path.join(dataDir, "registry", "imports")),
      ...readFiles(path.join(dataDir, "jobs")),
      ...readFiles(path.join(dataDir, "data")),
    ].filter((file) => fs.readFileSync(file, "utf8").includes(sentinel));
    expect(leaking).toEqual([]);
    const idempotency = path.join(dataDir, "jobs", "idempotency.json");
    if (fs.existsSync(idempotency))
      expect(fs.readFileSync(idempotency, "utf8")).not.toContain(sentinel);
  }, 40000);

  it("rejects the whole batch on an unresolved property value at the HTTP layer", async () => {
    const { PNG } = realImageFixtures();
    const attachment = await uploadImage(PNG, "second.png", "image/png");
    const material = await api("POST", "/objects", {
      canonicalName: `水-${crypto.randomUUID().slice(0, 6)}`,
      role: "material",
    });
    const importId = crypto.randomUUID();
    const prepared = await api("POST", "/sample-imports", {
      importId,
      attachmentIds: [attachment.id],
    });
    const raw = ensureBlockIds(`- 使用 [水]\n  - [水]｜添加量：待确认`);
    const referenceBody = await api("PUT", `/sample-imports/${importId}/draft`, {
      attemptId: prepared.body.attempt.id,
      expectedVersion: prepared.body.recordVersion,
      expectedDraftVersion: 0,
      draft: {
        schemaVersion: 1,
        samples: [
          {
            key: "s1",
            body: raw.replace(/\[水\]/g, `[${material.body.canonicalName}]`),
            sourceMappings: [],
            references: [],
          },
        ],
        objectIntents: [],
        ambiguities: [],
      },
    });
    expect(referenceBody.status, JSON.stringify(referenceBody.body)).toBe(200);
    const source = await api("GET", `/data/${prepared.body.sourceDataId}`);
    const refused = await api("POST", `/sample-imports/${importId}/commit`, {
      attemptId: prepared.body.attempt.id,
      expectedVersion: referenceBody.body.recordVersion,
      draftVersion: referenceBody.body.draftVersion,
      draftHash: referenceBody.body.draftHash,
      sourceDataVersion: source.body.version,
      commitFingerprint: referenceBody.body.commitFingerprint,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/仍未确认/);
    const view = await api("GET", `/sample-imports/${importId}`);
    expect(view.body.status).toBe("draft");
    expect(view.body.draft.samples[0].body).toContain("待确认");
  }, 40000);

  it("replays the original receipt only for the identical HTTP submission", async () => {
    const { PNG } = realImageFixtures();
    const attachment = await uploadImage(PNG, "replay.png", "image/png");
    const importId = crypto.randomUUID();
    const prepared = await api(
      "POST",
      "/sample-imports",
      { importId, attachmentIds: [attachment.id] },
      { "idempotency-key": "prepare-key" },
    );
    const saved = await api("PUT", `/sample-imports/${importId}/draft`, {
      attemptId: prepared.body.attempt.id,
      expectedVersion: prepared.body.recordVersion,
      expectedDraftVersion: 0,
      draft: {
        schemaVersion: 1,
        samples: [
          {
            key: "s1",
            body: ensureBlockIds("- 观察"),
            sourceMappings: [],
            references: [],
          },
        ],
        objectIntents: [],
        ambiguities: [],
      },
    });
    const source = await api("GET", `/data/${prepared.body.sourceDataId}`);
    const request = {
      attemptId: prepared.body.attempt.id,
      expectedVersion: saved.body.recordVersion,
      draftVersion: saved.body.draftVersion,
      draftHash: saved.body.draftHash,
      sourceDataVersion: source.body.version,
      commitFingerprint: saved.body.commitFingerprint,
    };
    const committed = await api("POST", `/sample-imports/${importId}/commit`, request);
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    // Same request, different transport idempotency header: still the receipt.
    const retried = await api(
      "POST",
      `/sample-imports/${importId}/commit`,
      request,
      { "idempotency-key": crypto.randomUUID() },
    );
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.receipt).toEqual(committed.body.receipt);
    for (const variation of [
      { attemptId: crypto.randomUUID() },
      { draftHash: "0".repeat(64) },
      { draftVersion: 99 },
      { sourceDataVersion: 9 },
      { expectedVersion: 77 },
    ]) {
      const conflict = await api("POST", `/sample-imports/${importId}/commit`, {
        ...request,
        ...variation,
      });
      expect(conflict.status, JSON.stringify({ variation, conflict })).toBe(409);
    }
    const samples = await api("GET", "/samples");
    expect(
      samples.body.filter((sample: any) => sample.id === committed.body.receipt.createdSampleIds[0]),
    ).toHaveLength(1);
    // The formal source Data, the sample mirror and the receipt agree.
    const data = await api("GET", `/data/${prepared.body.sourceDataId}`);
    expect(committed.body.receipt.sourceDataVersion).toBe(data.body.version);
    const sample = await api("GET", `/samples/${committed.body.receipt.createdSampleIds[0]}`);
    const binding = Object.values(sample.body.document.head.blocks).find(
      (item: any) => item.dataId === prepared.body.sourceDataId,
    ) as any;
    expect(binding.baseVersion).toBe(data.body.version);
  }, 40000);

  it("enforces the strict import schema and rejects unknown fields", async () => {
    const { PNG } = realImageFixtures();
    const attachment = await uploadImage(PNG, "schema.png", "image/png");
    const bad = await api("POST", "/sample-imports", {
      importId: crypto.randomUUID(),
      attachmentIds: [attachment.id],
      surprise: true,
    });
    expect(bad.status).toBe(400);
    const importId = crypto.randomUUID();
    const prepared = await api("POST", "/sample-imports", {
      importId,
      attachmentIds: [attachment.id],
    });
    const badDraft = await api("PUT", `/sample-imports/${importId}/draft`, {
      attemptId: prepared.body.attempt.id,
      expectedVersion: prepared.body.recordVersion,
      expectedDraftVersion: 0,
      draft: {
        schemaVersion: 1,
        samples: [
          {
            key: "s1",
            body: ensureBlockIds("- 观察"),
            sourceMappings: [],
            references: [],
            surprise: 1,
          },
        ],
        objectIntents: [],
        ambiguities: [],
      },
    });
    expect(badDraft.status).toBe(400);
    const missingVersion = await api("POST", `/sample-imports/${importId}/commit`, {
      attemptId: prepared.body.attempt.id,
      draftVersion: 1,
      draftHash: "0".repeat(64),
      sourceDataVersion: 1,
      commitFingerprint: "0".repeat(64),
    });
    expect(missingVersion.status).toBe(400);
  }, 40000);
});
