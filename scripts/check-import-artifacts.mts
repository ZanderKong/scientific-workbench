/** Offline assessment of producer-captured S2 artifacts; makes no model calls. */
import fs from "node:fs";
import path from "node:path";
import {
  checkLeakage,
  countRegionsInPng,
  type ArtifactEvidence,
  type VisionSpikeReport,
} from "../apps/server/src/vision-spike.ts";
import { importPolicyHash } from "../apps/server/src/sample-import-agent.ts";
import { readPrivateCredentials } from "./spike-opencode-vision.mts";
import { WorkbenchStore } from "../apps/server/src/store.ts";
import { knowledgeBundleHash } from "../apps/server/src/knowledge.ts";

const [root, proofFile] = process.argv.slice(2);
if (!root || !proofFile)
  throw new Error(
    "Provide the producer output directory and real profile proof",
  );
const evidence = JSON.parse(
  fs.readFileSync(path.join(root, "evidence.json"), "utf8"),
) as ArtifactEvidence;
const job = JSON.parse(
  evidence.items.find((item) => item.scope === "job")!.text,
);
const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
const dataDir = path.join(root, "workspace");
const profilePath = path.join(
  root,
  "workspace-import-agent",
  job.payload.importId,
  job.payload.attemptId,
  "execution",
  "opencode.jsonc",
);
const profileText = fs.readFileSync(profilePath, "utf8");
if (
  proof.policyHash !== importPolicyHash(profileText) ||
  proof.bundleHash !== knowledgeBundleHash
)
  throw new Error("Evidence strategy or knowledge bundle changed");
const manifest = JSON.parse(
  fs.readFileSync(path.join(dataDir, "attachments/manifest.json"), "utf8"),
);
const images = await Promise.all(
  manifest.records.map(async (item: { localPath: string }) => {
    const file = path.resolve(dataDir, item.localPath);
    if (!file.startsWith(path.resolve(dataDir) + path.sep))
      throw new Error("Invalid attachment path");
    const png = fs.readFileSync(file);
    return { png, count: await countRegionsInPng(png) };
  }),
);
const jobCreatedAt = job.createdAt ?? job.created_at;
const report: VisionSpikeReport = {
  ...proof,
  runId: evidence.runId,
  startedAt: jobCreatedAt,
  conclusion: "NOT VERIFIED",
  reason: "",
};
const result = await checkLeakage(
  {
    dataDir,
    executionDir: path.dirname(profilePath),
    allowRealCalls: false,
    images,
    secrets: [
      readPrivateCredentials().password ?? "",
      JSON.parse(profileText).mcp["scientific-workbench"].environment
        .WORKBENCH_API_TOKEN,
    ],
    artifactScan: async () => evidence,
  },
  report,
  evidence.runId,
  Date.parse(jobCreatedAt),
  job.payload.sessionId,
);
report.checks.noSensitiveWorkbenchLeakage = result;
const store = new WorkbenchStore({ dataDir });
try {
  const imported = store.getSampleImport(job.payload.importId);
  if (imported.status !== "committed" || !imported.receipt)
    throw new Error("No actual committed receipt");
  const data = store.getData(imported.sourceDataId);
  if (data.version !== imported.receipt.sourceDataVersion)
    throw new Error("Source version mismatch");
  const samples = imported.receipt.createdSampleIds.map((id) =>
    store.getSample(id),
  );
  console.log(
    JSON.stringify({
      pixelCounts: images.map((image) => image.count),
      samples: samples.map((sample) => ({
        id: sample.id,
        title: sample.title,
      })),
      sourceVersion: data.version,
      receiptVersion: imported.receipt.sourceDataVersion,
    }),
  );
  const complete = Object.values(report.checks).every(
    (check) => check.status === "PASS",
  );
  report.conclusion = complete ? "PASS" : "NOT VERIFIED";
  report.reason =
    "Profile evidence and real Job/log/notice capture assessed separately for the same strategy";
  fs.writeFileSync(
    path.join(root, "assessment.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  if (complete)
    fs.writeFileSync(
      path.join(root, "verified-capability.json"),
      JSON.stringify(
        {
          schema: "swb.import-capability/2",
          flavor: "v1",
          version: "1.18.31",
          model: "deepseek/deepseek-v4-flash-vision-exp",
          transport: "/session/:id/prompt_async",
          profileHash: proof.policyHash,
          bundleHash: knowledgeBundleHash,
          checks: Object.fromEntries(
            Object.keys(report.checks).map((key) => [key, "PASS"]),
          ),
          verifiedAt: new Date().toISOString(),
          evidence: `${proof.runId};${evidence.runId}`,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  console.log(
    JSON.stringify({
      conclusion: report.conclusion,
      leakage: result,
      profileRun: proof.runId,
      artifactRun: evidence.runId,
    }),
  );
} finally {
  store.close();
}
