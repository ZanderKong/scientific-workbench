/**
 * Artifact minimisation. Every case uses the real image bytes, a real
 * credential-shaped secret and the real draft/OCR text a model would produce,
 * so the check is proven to be content-based instead of trusting JSON field
 * names, and every incomplete capture is proven to stay NOT VERIFIED.
 */
import { expect, it } from "vitest";
import { checkLeakage, type ArtifactEvidence, type VisionSpikeReport } from "./vision-spike";
import { realImageFixtures } from "./test-images";

const RUN_ID = "run-leak-0001";
const CHECKS = [
  "isolation",
  "runtimeIdentityAndModel",
  "asyncSubmission",
  "correlatedImageAnswer",
  "restrictedAllow",
  "restrictedDeny",
  "noSensitiveWorkbenchLeakage",
] as const;
const SESSION_ID = "ses_leak_1";
const JOB_ID = "job-1";
const DATA_DIR = "/private/tmp/swb-leak-workspace";
const CREDENTIAL = "sk-live-credential-9d3f4c2b7a1e";
const OCR_TEXT = "第 3 行：称取 7.5 g 氢氧化钠，加入 30 mL 去离子水";
const DRAFT_BODY = "- 记录：加入 2.5 g 原料，80 °C 搅拌 30 min";

function report(overrides: Partial<VisionSpikeReport> = {}): VisionSpikeReport {
  return {
    schema: "swb.vision-spike/2",
    startedAt: new Date().toISOString(),
    runId: RUN_ID,
    optIn: true,
    isolation: {
      directorySeparated: true,
      dataDirLabel: "scientific-data",
      executionDirLabel: "agent-execution",
      sessionDirectoryMatches: true,
    },
    runtime: {
      version: "1.18.31",
      flavor: "v1",
      model: "deepseek/deepseek-v4-flash-vision-exp",
      models: 16,
    },
    images: [],
    image: { width: 16, height: 16, bytes: 100, mime: "image/png" },
    checks: Object.fromEntries(
      CHECKS.map((name) => [name, { status: "NOT VERIFIED", detail: "" }]),
    ) as VisionSpikeReport["checks"],
    conclusion: "NOT VERIFIED",
    reason: "",
    ...overrides,
  };
}

function item(
  scope: "job" | "log" | "notice",
  text: string,
  overrides: Partial<ArtifactEvidence["items"][number]> = {},
): ArtifactEvidence["items"][number] {
  return {
    label: `${scope}-sample`,
    scope,
    text,
    runId: RUN_ID,
    jobId: JOB_ID,
    sessionId: SESSION_ID,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function evidence(
  items: ArtifactEvidence["items"],
  overrides: Partial<ArtifactEvidence> = {},
): ArtifactEvidence {
  return {
    source: "real-workbench-child",
    runId: RUN_ID,
    collectedAt: new Date().toISOString(),
    scope: ["job", "log", "notice"],
    items,
    ...overrides,
  };
}

const cleanJob = JSON.stringify({
  id: JOB_ID,
  type: "sample-import",
  status: "succeeded",
  payload: { importId: "11111111-1111-4111-8111-111111111111", phase: "completed" },
  error: null,
});

async function leakage(
  artifacts: ArtifactEvidence,
  options: { secrets?: string[]; startedMs?: number } = {},
) {
  const images = [{ png: realImageFixtures().PNG, count: 3 }];
  return checkLeakage(
    {
      dataDir: DATA_DIR,
      executionDir: `${DATA_DIR}-import-agent/exec`,
      allowRealCalls: false,
      images,
      secrets: options.secrets ?? [CREDENTIAL, "workbench-token-value"],
      artifactScan: async () => artifacts,
    },
    report(),
    RUN_ID,
    options.startedMs ?? Date.now() - 1_000,
    SESSION_ID,
  );
}

it("passes only for a complete capture of this run's job, log and notice", async () => {
  const result = await leakage(
    evidence([
      item("job", cleanJob),
      item("log", `import dispatched runId=${RUN_ID} session=${SESSION_ID} status=204`),
      item("notice", JSON.stringify({ id: JOB_ID, kind: "completed", action: "refresh-samples" })),
    ]),
  );
  expect(result.status).toBe("PASS");
  expect(result.detail).toContain("3 个产物");
});

it("detects real image bytes, inline payloads, credentials and workspace paths", async () => {
  const png = realImageFixtures().PNG;
  const cases: [string, string, string][] = [
    [
      "图片字节",
      `raw=${png.subarray(0, 48).toString("base64")}`,
      "图片字节",
    ],
    [
      "内联图片载荷",
      `part={"type":"file","url":"data:image/png;base64,${png.toString("base64")}"}`,
      "内联图片载荷",
    ],
    ["凭据", `authorization=Bearer ${CREDENTIAL}`, "凭据"],
    ["工作区路径", `attachment=${DATA_DIR}/attachments/abc.png`, "工作区路径"],
  ];
  for (const [, text, expected] of cases) {
    const result = await leakage(
      evidence([
        item("job", cleanJob),
        item("log", text),
        item("notice", JSON.stringify({ id: JOB_ID, kind: "completed" })),
      ]),
    );
    expect(result.status).toBe("FAIL");
    expect(result.detail).toContain(expected);
    // The failure never echoes the sensitive text back into the report.
    expect(result.detail).not.toContain(CREDENTIAL);
    expect(result.detail).not.toContain(png.toString("base64").slice(0, 48));
  }
});

it("detects the model's own draft and OCR text, not just the field names", async () => {
  for (const payload of [
    JSON.stringify({ draft: { samples: [{ body: DRAFT_BODY }] } }),
    JSON.stringify({ transcription: OCR_TEXT }),
    JSON.stringify({ ocr: OCR_TEXT }),
    JSON.stringify({ prompt: `请读取 ${OCR_TEXT}` }),
    JSON.stringify({ images: [{ filename: "page-3.jpg" }] }),
  ]) {
    const result = await leakage(
      evidence([
        item("job", cleanJob),
        item("log", payload),
        item("notice", JSON.stringify({ id: JOB_ID, kind: "completed" })),
      ]),
    );
    expect(result.status).toBe("FAIL");
    expect(result.detail).toContain("完整科研或模型输入字段");
  }
});

it("stays NOT VERIFIED when the capture is incomplete, stale or foreign", async () => {
  const good = evidence([
    item("job", cleanJob),
    item("log", "dispatch ok"),
    item("notice", JSON.stringify({ id: JOB_ID, kind: "completed" })),
  ]);
  const cases: [string, ArtifactEvidence | undefined, string][] = [
    ["no capture", undefined, "未采集"],
    ["missing scope", evidence([item("job", cleanJob)], { scope: ["job"] }), "覆盖范围不足"],
    ["zero items", evidence([], { scope: ["job", "log", "notice"] }), "0 个产物"],
    [
      "truncated",
      evidence([
        item("job", cleanJob, { truncated: true }),
        item("log", "dispatch ok"),
        item("notice", "{}"),
      ]),
      "未完整读取",
    ],
    [
      "foreign run",
      evidence(
        [
          item("job", cleanJob, { runId: "other-run" }),
          item("log", "dispatch ok", { runId: "other-run" }),
          item("notice", "{}", { runId: "other-run" }),
        ],
        { runId: "other-run" },
      ),
      "不属于本次 run",
    ],
    [
      "stale collection",
      evidence(
        [
          item("job", cleanJob, { observedAt: "2000-01-01T00:00:00.000Z" }),
          item("log", "dispatch ok", { observedAt: "2000-01-01T00:00:00.000Z" }),
          item("notice", "{}", { observedAt: "2000-01-01T00:00:00.000Z" }),
        ],
        { collectedAt: "2000-01-01T00:00:01.000Z" },
      ),
      "采集时间",
    ],
    [
      "foreign session",
      evidence([
        item("job", cleanJob, { sessionId: "ses_other" }),
        item("log", "dispatch ok"),
        item("notice", "{}"),
      ]),
      "逐项身份",
    ],
    ["empty text", evidence([
      item("job", "   "),
      item("log", "dispatch ok"),
      item("notice", "{}"),
    ]), "逐项身份"],
  ];
  for (const [label, artifacts, expected] of cases) {
    const result = await leakage(
      artifacts ?? evidence([], { scope: [] }),
      { startedMs: Date.now() - 1_000 },
    );
    if (label === "no capture") {
      const none = await checkLeakage(
        {
          dataDir: DATA_DIR,
          executionDir: DATA_DIR,
          allowRealCalls: false,
          images: [{ png: realImageFixtures().PNG, count: 3 }],
          secrets: [CREDENTIAL],
        },
        report(),
        RUN_ID,
        Date.now() - 1_000,
        SESSION_ID,
      );
      expect(none.status).toBe("NOT VERIFIED");
      expect(none.detail).toContain(expected);
      continue;
    }
    expect(result.status).toBe("NOT VERIFIED");
    expect(result.detail).toContain(expected);
  }
});

it("fails on a report that still carries a credential or image payload", async () => {
  const images = [{ png: realImageFixtures().PNG, count: 3 }];
  const check = (text: string) =>
    checkLeakage(
      {
        dataDir: DATA_DIR,
        executionDir: `${DATA_DIR}-import-agent`,
        allowRealCalls: false,
        images,
        secrets: [CREDENTIAL],
      },
      report({ reason: text }),
      RUN_ID,
      Date.now() - 1_000,
      SESSION_ID,
    );
  expect((await check(`deepseek/x ${CREDENTIAL}`)).status).toBe("FAIL");
  expect(
    (await check(`deepseek/x ${realImageFixtures().PNG.subarray(0, 48).toString("base64")}`))
      .status,
  ).toBe("FAIL");
});
