import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileLink } from "@workbench/core/attachments";
import { WorkbenchStore } from "../apps/server/src/store";

const destination = path.resolve(
  process.env.WORKBENCH_DEMO_DIR ?? "demo/workspace",
);
if (fs.existsSync(destination))
  throw new Error(
    `演示目录已存在，未覆盖：${destination}\n请指定一个全新 WORKBENCH_DEMO_DIR。`,
  );

const store = new WorkbenchStore({ dataDir: destination });
try {
  const objectInputs = [
    ["聚乙烯醇", "material"],
    ["水", "material"],
    ["乙二醇", "material"],
    ["磁力搅拌器", "equipment"],
    ["FTIR Spectrometer Alpha", "equipment"],
    ["搅拌", "process"],
    ["加热", "process"],
    ["冻结", "process"],
    ["解冻", "process"],
    ["红外测试", "process"],
  ] as const;
  const objects = new Map(
    objectInputs.map(([canonicalName, role]) => {
      const object = store.createObject({ canonicalName, role });
      return [canonicalName, object];
    }),
  );
  const properties = [
    ["添加量", undefined, "g"],
    ["温度", "temperature", "℃"],
    ["时间", "time", "min"],
    ["转速", undefined, "rpm"],
    ["循环序号", undefined, "次"],
    ["范围", undefined, "cm⁻¹"],
    ["分辨率", undefined, "cm⁻¹"],
  ] as const;
  for (const [canonicalName, dimension, recommendedUnit] of properties)
    store.createProperty({ canonicalName, dimension, recommendedUnit });

  const mix = (extra = "") =>
    `- 使用 [磁力搅拌器] 将 [聚乙烯醇] 加入 [水]，进行 [加热] 和 [搅拌]${extra}\n  - [聚乙烯醇]｜添加量：10 g\n  - [水]｜添加量：90 g｜温度：95 ℃\n  - [磁力搅拌器]｜转速：500 rpm｜时间：120 min`;
  const cycle = (index: number) =>
    `- 第 ${index} 次使用 [冻结] 处理样品\n  - [冻结]｜温度：-18 ℃｜时间：12 h｜循环序号：${index} 次\n- 第 ${index} 次使用 [解冻] 处理样品\n  - [解冻]｜温度：25 ℃｜时间：4 h｜循环序号：${index} 次`;
  const measure = (name: string) =>
    `- 使用 [FTIR Spectrometer Alpha] 进行 [红外测试]\n  - [FTIR Spectrometer Alpha]｜范围：400–4000 cm⁻¹｜分辨率：4 cm⁻¹\n  - [数据] ${name}\n    - 模拟 FTIR 结果，仅用于软件流程验收。`;

  const pva01 = store.createSample({
    code: "PVA-01",
    title: "PVA 水凝胶，一次冻融",
    body: [mix(), cycle(1), measure("PVA-01 FTIR")].join("\n"),
  });
  const pva03 = store.createSample({
    code: "PVA-03",
    title: "PVA 水凝胶，三次冻融",
    body: [mix(), cycle(1), cycle(2), cycle(3), measure("PVA-03 FTIR")].join(
      "\n",
    ),
  });
  const pvaEg = store.createSample({
    code: "PVA-EG",
    title: "含乙二醇配方",
    body: `${mix("，同时加入 [乙二醇]")}\n  - [乙二醇]｜添加量：5 g\n${cycle(1)}\n${measure("PVA-EG FTIR")}`,
  });
  const draft = store.createSample({
    code: "Draft-01",
    title: "语法与待绑定边界",
    body: [
      "- [水】｜添加量：5 g",
      "  - [未登记原料]｜添加量：2 g",
      "  - [水]｜只有属性名",
      "- [论点] 这里只作为文本保存，不创建正式论点。",
    ].join("\n"),
  });
  for (const sample of [pva01, pva03, pvaEg, draft])
    store.finalizeDocument(sample.id);

  const csv = store.saveAttachment(
    Buffer.from(
      "# SIMULATED DATA — not measured\nwavenumber,intensity\n3300,0.82\n1650,0.41\n",
      "utf8",
    ),
    "PVA 冻融比较 FTIR 模拟数据.csv",
    "text/csv",
  );
  const note = store.saveAttachment(
    Buffer.from(
      "本文件和全部数值仅用于科研工作台的软件测试，不是论文或真实实验数据。\n",
      "utf8",
    ),
    "模拟数据说明（请勿作为实验结果）.txt",
    "text/plain",
  );
  const png = store.saveAttachment(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    "PVA-FTIR-overlay-模拟曲线.png",
    "image/png",
  );
  const imported = store.createData({
    name: "Import-01",
    description:
      "独立导入并关联两个样品的模拟 FTIR Data；不代表公开论文的测量结果。",
    aboutSampleIds: [pva01.id, pva03.id],
    body: [
      "模拟数据用途与限制见附件。",
      fileLink(csv.id, csv.originalName),
      fileLink(note.id, note.originalName),
    ].join("\n"),
    components: [
      {
        id: crypto.randomUUID(),
        kind: "file",
        name: csv.originalName,
        role: "raw",
        creator: "human",
        provenance: "独立导入的模拟验收数据",
        createdAt: csv.createdAt,
        derivedFrom: [],
        attachmentId: csv.id,
      },
      {
        id: crypto.randomUUID(),
        kind: "file",
        name: note.originalName,
        role: "documentation",
        creator: "human",
        provenance: "模拟数据声明",
        createdAt: note.createdAt,
        derivedFrom: [],
        attachmentId: note.id,
      },
    ],
  });
  const analysis = store.createAnalysis({
    title: "Analysis-01 · PVA 冻融次数比较",
    question: "组织并比较一次与三次冻融样品的记录和模拟 FTIR Data。",
    body: "- 比较各次冻结、解冻操作及其来源位置。\n- [论点] 应从本分析页正式创建，并固定当前证据版本。",
    itemIds: [pva01.id, pva03.id, pvaEg.id, imported.id],
    attachmentIds: [png.id],
  });
  const claim = store.createClaim({
    hostType: "analysis",
    hostId: analysis.id,
    text: "PVA-03 的文档记录了三次彼此独立的冻结和解冻操作。\n- 状态：待人工核对\n- 作者来源：演示生成器",
  });
  const exportBundle = store.exportContext("analysis", analysis.id);
  const exportDir = path.join(destination, "exports", analysis.id);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(path.join(exportDir, "context.md"), exportBundle.context);
  fs.writeFileSync(
    path.join(exportDir, "manifest.json"),
    JSON.stringify(exportBundle.manifest, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        dataDir: destination,
        samples: [pva01, pva03, pvaEg, draft].map((sample) => sample.code),
        data: imported.id,
        analysis: analysis.id,
        claim: claim.id,
        objects: objects.size,
        simulatedAttachments: [csv.id, note.id, png.id],
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
