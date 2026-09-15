import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import archiver from "archiver";
import unzipper from "unzipper";
import type { Attachment } from "@workbench/core";
import { WorkbenchStore } from "./store";

const businessDirectories = new Set([
  "samples",
  "data",
  "analyses",
  "claims",
  "registry",
  "attachments",
  "history",
  "evidence",
]);
interface Entry {
  path: string;
  size: number;
  sha256: string;
}
interface Manifest {
  schema: "swb.backup/2";
  createdAt: string;
  files: Entry[];
}
function safeRelative(name: string) {
  if (
    !name ||
    name.includes("\\") ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..") ||
    !businessDirectories.has(name.split("/")[0])
  )
    throw new Error(`备份路径非法：${name}`);
  return name;
}
export async function hashFile(file: string, signal?: AbortSignal) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    if (signal?.aborted) {
      throw Object.assign(new Error("备份已取消"), { code: "CANCELED" });
    }
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}
function filesUnder(root: string, relative: string): string[] {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`备份不接受符号链接：${relative}`);
  if (stat.isFile()) return [safeRelative(relative)];
  if (!stat.isDirectory()) throw new Error(`备份文件类型不支持：${relative}`);
  return fs
    .readdirSync(absolute)
    .sort()
    .flatMap((name) => filesUnder(root, `${relative}/${name}`));
}
/** Capture immutable inodes synchronously, before yielding to further application writes. */
export async function createCompleteBackup(
  store: WorkbenchStore,
  resolveAttachment: (attachment: Attachment) => Promise<string>,
  signal?: AbortSignal,
) {
  const assertActive = () => {
    if (signal?.aborted) {
      throw Object.assign(new Error("备份已取消"), { code: "CANCELED" });
    }
  };
  const root = path.join(store.dataDir, "backups");
  fs.mkdirSync(root, { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, ".capture-"));
  const target = path.join(
    root,
    `workbench-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.zip`,
  );
  const pending = target + ".partial";
  try {
    assertActive();
    const captured = [...businessDirectories].flatMap((directory) =>
      filesUnder(store.dataDir, directory),
    );
    for (const relative of captured) {
      assertActive();
      const destination = path.join(stage, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.linkSync(path.join(store.dataDir, relative), destination);
    }
    const attachmentsPath = path.join(stage, "attachments/manifest.json");
    const registry: { schema: string; records: Attachment[] } = fs.existsSync(
      attachmentsPath,
    )
      ? JSON.parse(fs.readFileSync(attachmentsPath, "utf8"))
      : { schema: "swb.registry/2", records: [] };
    for (const attachment of registry.records) {
      assertActive();
      const relative = safeRelative(attachment.localPath);
      if (
        !relative.startsWith("attachments/") ||
        relative === "attachments/manifest.json"
      )
        throw new Error("附件路径无效");
      const destination = path.join(stage, relative);
      if (!fs.existsSync(destination)) {
        const fetched = await resolveAttachment(attachment);
        assertActive();
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(fetched, destination, fs.constants.COPYFILE_EXCL);
      }
      const actual = await hashFile(destination, signal);
      if (
        actual.sha256 !== attachment.sha256 ||
        actual.size !== attachment.sizeBytes
      )
        throw new Error(`完整备份附件校验失败：${attachment.originalName}`);
      attachment.remoteOnly = false;
    }
    // Replace the linked manifest inode; never mutate the live workspace's captured inode.
    if (fs.existsSync(attachmentsPath)) {
      fs.writeFileSync(attachmentsPath + ".new", JSON.stringify(registry));
      fs.renameSync(attachmentsPath + ".new", attachmentsPath);
    }
    const entries = [...businessDirectories].flatMap((directory) =>
      filesUnder(stage, directory),
    );
    const manifest: Manifest = {
      schema: "swb.backup/2",
      createdAt: new Date().toISOString(),
      files: [],
    };
    for (const relative of entries)
      manifest.files.push({
        path: relative,
        ...(await hashFile(path.join(stage, relative), signal)),
      });
    assertActive();
    const archive = archiver("zip", { forceZip64: true, zlib: { level: 6 } });
    const output = fs.createWriteStream(pending, { flags: "wx", mode: 0o600 });
    const abort = () => {
      archive.abort();
      output.destroy(
        Object.assign(new Error("备份已取消"), { code: "CANCELED" }),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    const done = pipeline(archive, output);
    archive.append(JSON.stringify(manifest, null, 2), {
      name: "manifest.json",
    });
    for (const entry of manifest.files)
      archive.file(path.join(stage, entry.path), { name: entry.path });
    try {
      await Promise.all([archive.finalize(), done]);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    assertActive();
    const fd = fs.openSync(pending, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(pending, target);
    return {
      file: target,
      files: manifest.files.length,
      verified: true as const,
    };
  } catch (error) {
    fs.rmSync(pending, { force: true });
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export async function restoreCompleteBackup(
  zipPath: string,
  targetDir: string,
  sourceDir: string,
) {
  const target = path.resolve(targetDir),
    source = path.resolve(sourceDir);
  if (
    target === source ||
    target.startsWith(source + path.sep) ||
    source.startsWith(target + path.sep) ||
    fs.existsSync(target)
  )
    throw new Error("恢复目标必须是工作区之外尚不存在的新目录");
  const directory = await unzipper.Open.file(zipPath);
  const names = directory.files.map((entry) => entry.path);
  if (new Set(names).size !== names.length) throw new Error("备份包含重复路径");
  const manifestEntry = directory.files.find(
    (entry) => entry.path === "manifest.json",
  );
  if (!manifestEntry || manifestEntry.uncompressedSize > 32 * 1024 * 1024)
    throw new Error("备份清单缺失或过大");
  const manifest = JSON.parse(
    (await manifestEntry.buffer()).toString("utf8"),
  ) as Manifest;
  if (manifest.schema !== "swb.backup/2" || !Array.isArray(manifest.files))
    throw new Error("备份格式无效");
  const expected = new Map<string, Entry>();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    if (
      expected.has(entry.path) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    )
      throw new Error("备份清单条目无效");
    expected.set(entry.path, entry);
  }
  if (!expected.has("registry/workspace.json"))
    throw new Error("备份缺少工作区登记");
  if (directory.files.length !== expected.size + 1)
    throw new Error("备份文件与清单不一致");
  for (const entry of directory.files) {
    if (entry.path === "manifest.json") continue;
    safeRelative(entry.path);
    if (
      entry.type !== "File" ||
      !expected.has(entry.path) ||
      entry.uncompressedSize !== expected.get(entry.path)!.size
    )
      throw new Error(`备份条目不匹配：${entry.path}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(
    path.join(path.dirname(target), ".swb-restore-"),
  );
  try {
    for (const entry of directory.files) {
      if (entry.path === "manifest.json") continue;
      const wanted = expected.get(entry.path)!;
      const destination = path.join(stage, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const hash = crypto.createHash("sha256");
      let size = 0;
      const validate = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > wanted.size) {
            callback(new Error("解包大小超出清单"));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        entry.stream(),
        validate,
        fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
      if (size !== wanted.size || hash.digest("hex") !== wanted.sha256)
        throw new Error(`备份校验失败：${entry.path}`);
    }
    const settingFile = path.join(stage, "registry/settings.json");
    if (fs.existsSync(settingFile)) {
      const settings = JSON.parse(fs.readFileSync(settingFile, "utf8"));
      if (settings.values?.s3)
        settings.values.s3 = {
          ...settings.values.s3,
          enabled: false,
          credentialId: undefined,
        };
      fs.writeFileSync(settingFile, JSON.stringify(settings), { mode: 0o600 });
    }
    // No credentials or index are in this set. Rebuild independently before publishing the target.
    const restored = new WorkbenchStore({ dataDir: stage });
    try {
      const attachmentIds = restored.db
        .prepare("SELECT id FROM attachments")
        .all() as { id: string }[];
      for (const { id } of attachmentIds) {
        const attachment = restored.getAttachment(id),
          actual = await hashFile(attachment.localPath);
        if (
          actual.sha256 !== attachment.sha256 ||
          actual.size !== attachment.sizeBytes ||
          attachment.remoteOnly
        )
          throw new Error(`恢复附件校验失败：${id}`);
      }
    } finally {
      restored.close();
    }
    fs.renameSync(stage, target);
    return {
      targetDir: target,
      verified: true as const,
      files: manifest.files.length,
    };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
