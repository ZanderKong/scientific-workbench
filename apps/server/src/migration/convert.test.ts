import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { createHead, serializeDocument, sha256 } from "@workbench/core";
import { WorkbenchStore } from "../store";
import { convertLegacyWorkspace } from "./convert";

function fixture(root: string) {
  fs.mkdirSync(path.join(root, "index"), { recursive: true });
  for (const dir of [
    "samples",
    "data",
    "analyses",
    "claims",
    "attachments",
    "private",
  ])
    fs.mkdirSync(path.join(root, dir));
  const db = new Database(path.join(root, "index/workbench.sqlite"));
  db.exec(`CREATE TABLE objects(id TEXT, canonical_name TEXT, role TEXT, lifecycle TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE object_aliases(object_id TEXT, alias TEXT);
    CREATE TABLE properties(id TEXT,canonical_name TEXT,recommended_unit TEXT,usage_count INTEGER);
    CREATE TABLE property_aliases(property_id TEXT,alias TEXT);
    CREATE TABLE samples(id TEXT,code TEXT,title TEXT,document_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE data_records(id TEXT,name TEXT,description TEXT,version INTEGER,about_sample_ids TEXT,source_document_id TEXT,source_block_id TEXT,component_ids TEXT,body TEXT,updated_at TEXT);
    CREATE TABLE analyses(id TEXT,title TEXT,question TEXT,item_ids TEXT,body TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE claims(id TEXT,host_type TEXT,host_id TEXT,text TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE claim_evidence(id TEXT,claim_id TEXT,entity_type TEXT,entity_id TEXT,version INTEGER,body_hash TEXT,content TEXT,attachment_ids TEXT,captured_at TEXT);
    CREATE TABLE snapshots(id TEXT,entity_id TEXT,entity_type TEXT,body_hash TEXT,body TEXT,created_at TEXT);
    CREATE TABLE settings(key TEXT,value TEXT);`);
  const date = "2026-09-01T00:00:00.000Z";
  db.prepare("INSERT INTO objects VALUES(?,?,?,?,?,?)").run(
    "water",
    "水",
    "material",
    "active",
    date,
    date,
  );
  db.prepare("INSERT INTO object_aliases VALUES(?,?)").run("water", "去离子水");
  db.prepare("INSERT INTO properties VALUES(?,?,?,?)").run(
    "amount",
    "添加量",
    "g",
    1,
  );
  db.prepare("INSERT INTO property_aliases VALUES(?,?)").run("amount", "用量");
  db.prepare("INSERT INTO samples VALUES(?,?,?,?,?,?)").run(
    "sample",
    "S260901-03",
    "旧样品",
    "old-document",
    date,
    date,
  );
  const sampleBody =
    '<!-- swb:block id="op" -->\n- 添加 [水]\n  <!-- swb:block id="prop" -->\n  - [水]｜添加量：5 g\n  <!-- swb:block id="data-line" -->\n  - [数据] 光谱\n    <!-- swb:block id="mirror" -->\n    - 原始光谱';
  const dataBody = '<!-- swb:block id="canonical" -->\n- 原始光谱';
  db.prepare("INSERT INTO data_records VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "data",
    "光谱",
    "",
    2,
    JSON.stringify(["sample"]),
    "old-document",
    "data-line",
    JSON.stringify(["file"]),
    dataBody,
    date,
  );
  db.prepare("INSERT INTO analyses VALUES(?,?,?,?,?,?,?)").run(
    "analysis",
    "旧分析",
    "原问题",
    JSON.stringify(["sample", "data"]),
    "旧分析正文",
    date,
    date,
  );
  db.prepare("INSERT INTO claims VALUES(?,?,?,?,?,?)").run(
    "claim",
    "analysis",
    "analysis",
    "旧论点",
    date,
    date,
  );
  db.prepare("INSERT INTO claim_evidence VALUES(?,?,?,?,?,?,?,?,?)").run(
    "evidence",
    "claim",
    "analysis",
    "analysis",
    1,
    sha256("当时留下的证据"),
    "当时留下的证据",
    JSON.stringify(["file"]),
    date,
  );
  db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,?)").run(
    "snapshot",
    "old-document",
    "sample",
    sha256("过去正文"),
    "过去正文",
    date,
  );
  db.prepare("INSERT INTO settings VALUES(?,?)").run(
    "s3",
    "DO-NOT-COPY-SECRET",
  );
  const bytes = Buffer.from("模拟旧附件"),
    hash = sha256(bytes);
  fs.writeFileSync(path.join(root, "attachments", hash), bytes);
  db.exec(
    "CREATE TABLE attachments(id TEXT,sha256 TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,local_path TEXT,created_at TEXT)",
  );
  db.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)").run(
    "file",
    hash,
    "旧光谱.csv",
    "text/csv",
    bytes.length,
    path.join(root, "attachments", hash),
    date,
  );
  db.close();
  for (const [type, id, body] of [
    ["sample", "old-document", sampleBody],
    ["data", "data", dataBody],
    ["analysis", "analysis", "旧分析正文"],
    ["claim", "claim", "旧论点"],
  ] as const) {
    const head = createHead(type, id, body);
    head.schema = `swb.${type}/1`;
    head.contentVersion = type === "data" ? 2 : 1;
    if (type === "sample") {
      head.code = "S260901-03";
      head.blocks = { "data-line": { kind: "data", dataId: "data" } };
    }
    fs.writeFileSync(
      path.join(
        root,
        type === "analysis"
          ? "analyses"
          : type === "data"
            ? "data"
            : type + "s",
        id + ".md",
      ),
      serializeDocument({ head, body }),
    );
  }
  fs.writeFileSync(
    path.join(root, "private", "credential"),
    "DO-NOT-COPY-SECRET",
  );
  return { hash, sampleBody, dataBody };
}
function tree(root: string, relative = ""): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .flatMap((entry) => {
        const key = path.join(relative, entry.name);
        return entry.isDirectory()
          ? Object.entries(tree(root, key))
          : [[key, sha256(fs.readFileSync(path.join(root, key)))]];
      }),
  );
}

it("converts complete legacy facts without source writes; new files rebuild when the source and index are unavailable", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "swb-migrate-")),
    source = path.join(parent, "old"),
    target = path.join(parent, "new");
  const { hash, dataBody } = fixture(source),
    before = tree(source);
  try {
    const result = await convertLegacyWorkspace(source, target);
    expect(result.report.errors).toEqual([]);
    expect(result.report.status).toBe("verified");
    expect(tree(source)).toEqual(before);
    expect(result.report.idMappings).toContainEqual({
      type: "document",
      from: "old-document",
      to: "sample",
    });
    fs.renameSync(source, source + "-unavailable");
    fs.rmSync(path.join(target, "index"), { recursive: true });
    const store = new WorkbenchStore({ dataDir: target });
    try {
      expect(store.getSample("sample").properties[0].value_text).toBe("5 g");
      expect(store.getData("data").body).toBe(dataBody);
      expect(store.getData("data").sourceDocumentId).toBe("sample");
      expect(store.getAnalysis("analysis").itemIds).toEqual(["sample", "data"]);
      expect(store.getClaim("claim").legacyEvidenceWarning).toContain(
        "旧格式证据不完整",
      );
      expect(store.getClaim("claim").evidence[0].content).toBe(
        "当时留下的证据",
      );
      expect(store.getClaim("claim").evidence[0].manifest).toBeUndefined();
      expect(store.listSnapshots("sample")[0].body).toBe("过去正文");
      expect(
        fs.readFileSync(store.getAttachment("file").localPath).toString(),
      ).toBe("模拟旧附件");
      expect(store.getAttachment("file").sha256).toBe(hash);
      store.finalizeDocument("sample");
      expect(store.listData()).toHaveLength(1);
      expect(store.getData("data").version).toBe(2);
      store.updateClaim("claim", "修改论点", 1);
      expect(store.getClaim("claim").legacyEvidenceWarning).toBeTruthy();
    } finally {
      store.close();
    }
    expect(fs.readdirSync(path.join(target, "private"))).toEqual([]);
    for (const file of Object.keys(tree(target)).filter(
      (file) => !file.startsWith("index/") && !file.startsWith("jobs/"),
    ))
      expect(
        fs
          .readFileSync(path.join(target, file))
          .includes(Buffer.from("DO-NOT-COPY-SECRET")),
      ).toBe(false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

it("fails with a missing-attachment report and never publishes or overwrites a destination", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "swb-migrate-missing-")),
    source = path.join(parent, "old"),
    target = path.join(parent, "new");
  const { hash } = fixture(source);
  fs.unlinkSync(path.join(source, "attachments", hash));
  try {
    const result = await convertLegacyWorkspace(source, target);
    expect(result.report.status).toBe("failed");
    expect(result.report.errors.join()).toContain("附件字节缺失");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(result.reportPath)).toBe(true);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep"), "用户数据");
    await expect(convertLegacyWorkspace(source, target)).rejects.toThrow(
      "尚不存在",
    );
    expect(fs.readFileSync(path.join(target, "keep"), "utf8")).toBe("用户数据");
    await expect(
      convertLegacyWorkspace(source, path.join(source, "inside")),
    ).rejects.toThrow("旧工作区之外");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

it("retains file-only history, original evidence files and unregistered attachment bytes", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "swb-migrate-files-")),
    source = path.join(parent, "old"),
    target = path.join(parent, "new");
  fixture(source);
  fs.mkdirSync(path.join(source, "history", "old-document"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(source, "history", "old-document", "file-history.json"),
    JSON.stringify({
      id: "file-history",
      entityId: "old-document",
      entityType: "sample",
      body: "只有文件中的过去正文",
      bodyHash: sha256("只有文件中的过去正文"),
      createdAt: "2026-08-30T00:00:00.000Z",
    }),
  );
  fs.mkdirSync(path.join(source, "evidence", "claim"), { recursive: true });
  fs.writeFileSync(
    path.join(source, "evidence", "claim", "file-evidence.json"),
    JSON.stringify({
      id: "file-evidence",
      entityId: "analysis",
      entityType: "analysis",
      version: 1,
      content: "只有文件中的证据",
      bodyHash: sha256("只有文件中的证据"),
      attachmentIds: [],
      capturedAt: "2026-08-30T00:00:00.000Z",
    }),
  );
  fs.writeFileSync(
    path.join(source, "attachments", "unregistered.csv"),
    "未登记字节",
  );
  try {
    const result = await convertLegacyWorkspace(source, target);
    expect(result.report.errors).toEqual([]);
    const store = new WorkbenchStore({ dataDir: target });
    try {
      expect(store.listSnapshots("sample").map((row) => row.body)).toContain(
        "只有文件中的过去正文",
      );
      expect(
        store.getClaim("claim").evidence.map((item) => item.content),
      ).toContain("只有文件中的证据");
    } finally {
      store.close();
    }
    expect(
      fs.readFileSync(
        path.join(target, "attachments/unregistered/unregistered.csv"),
        "utf8",
      ),
    ).toBe("未登记字节");
    expect(result.report.warnings.join()).toContain("未登记附件");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
