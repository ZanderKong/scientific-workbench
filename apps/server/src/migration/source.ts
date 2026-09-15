import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashFile } from "../backup";

export type LegacyRow = Record<string, unknown>;
export const text = (row: LegacyRow, key: string, fallback = ""): string => {
  const value = row[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`旧字段 ${key} 应为文本`);
  return value;
};
export const number = (row: LegacyRow, key: string, fallback = 1): number => {
  const value = row[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`旧字段 ${key} 应为数值`);
  return value;
};
export function array<T>(row: LegacyRow, key: string): T[] {
  const value = JSON.parse(text(row, key, "[]")) as unknown;
  if (!Array.isArray(value)) throw new Error(`旧字段 ${key} 应为数组`);
  return value as T[];
}
export function safeId(id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error("旧实体ID不能安全映射为文件名");
  return id;
}
export function safeFile(root: string, relative: string) {
  if (
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => part === "..")
  )
    throw new Error("旧文件路径越界");
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error("旧文件路径越界");
  let current = resolved;
  while (current !== root) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error("转换不读取符号链接");
    current = path.dirname(current);
  }
  return resolved;
}

/** Copies only a snapshot of the legacy index. The source is never opened by SQLite. */
export class LegacySource {
  readonly files = new Map<string, { sha256: string; size: number }>();
  private database?: Database.Database;
  private directories = new Map<string, string[]>();
  directory(relative: string) {
    const folder = safeFile(this.root, relative);
    const entries = fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
    this.directories.set(relative, entries);
    return entries;
  }
  constructor(readonly root: string) {}
  async track(relative: string) {
    const file = safeFile(this.root, relative);
    const digest = await hashFile(file);
    this.files.set(relative, digest);
    return file;
  }
  async openIndex(stage: string) {
    const relative = "index/workbench.sqlite";
    if (!fs.existsSync(safeFile(this.root, relative))) return;
    const target = path.join(stage, "jobs", "legacy-source.sqlite");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const suffix of ["", "-wal"]) {
      if (!fs.existsSync(safeFile(this.root, relative + suffix))) continue;
      fs.copyFileSync(await this.track(relative + suffix), target + suffix);
      fs.chmodSync(target + suffix, 0o600);
    }
    this.database = new Database(target); // Recovery, if needed, changes only the private staging copy.
  }
  rows(table: string): LegacyRow[] {
    if (!/^[a-z_]+$/.test(table)) throw new Error("旧索引表名无效");
    if (
      !this.database
        ?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      return [];
    return this.database.prepare(`SELECT * FROM ${table}`).all() as LegacyRow[];
  }
  async allFiles(directory: string): Promise<string[]> {
    const results: string[] = [];
    for (const name of this.directory(directory)) {
      const relative = directory + "/" + name;
      const file = safeFile(this.root, relative);
      if (fs.lstatSync(file).isDirectory())
        results.push(...(await this.allFiles(relative)));
      else {
        await this.track(relative);
        results.push(relative);
      }
    }
    return results;
  }
  async jsonFiles(
    directory: string,
  ): Promise<{ relative: string; row: LegacyRow }[]> {
    const results: { relative: string; row: LegacyRow }[] = [];
    for (const name of this.directory(directory)) {
      const relative = directory + "/" + name;
      const file = safeFile(this.root, relative);
      if (fs.lstatSync(file).isDirectory())
        results.push(...(await this.jsonFiles(relative)));
      else {
        if (!name.endsWith(".json"))
          throw new Error(`旧历史或证据包含未识别文件：${relative}`);
        await this.track(relative);
        const row: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error(`旧历史或证据格式无效：${relative}`);
        results.push({ relative, row: row as LegacyRow });
      }
    }
    return results;
  }
  async unchanged() {
    for (const [relative, expected] of this.directories) {
      const folder = safeFile(this.root, relative);
      const actual = fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
      if (JSON.stringify(expected) !== JSON.stringify(actual))
        throw new Error("转换期间来源目录发生变化，请关闭旧服务后重试");
    }
    for (const [relative, expected] of this.files) {
      const file = safeFile(this.root, relative);
      if (!fs.existsSync(file))
        throw new Error("转换期间来源文件被删除，请关闭旧服务后重试");
      const actual = await hashFile(file);
      if (actual.sha256 !== expected.sha256 || actual.size !== expected.size)
        throw new Error("转换期间来源发生变化，请关闭旧服务后重试");
    }
    const wal = "index/workbench.sqlite-wal";
    if (!this.files.has(wal) && fs.existsSync(safeFile(this.root, wal)))
      throw new Error("转换期间旧数据库仍在写入，请关闭旧服务后重试");
  }
  close() {
    this.database?.close();
    this.database = undefined;
  }
}
