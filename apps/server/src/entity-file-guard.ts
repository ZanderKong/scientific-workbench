import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { sha256 } from "@workbench/core";
import type { FileRepository } from "./file-repository";

/** Rebuildable baselines for independent entity files, inside the same index transaction. */
export class EntityFileGuard {
  constructor(
    private db: Database.Database,
    private files: FileRepository,
    private root: string,
  ) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS entity_file_state (id TEXT PRIMARY KEY, file_hash TEXT NOT NULL)",
    );
  }
  reset() {
    this.db.exec("DELETE FROM entity_file_state");
  }
  accept(id: string, content: string) {
    this.db
      .prepare(
        "INSERT INTO entity_file_state(id,file_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET file_hash=excluded.file_hash",
      )
      .run(id, sha256(content));
  }
  check(id: string, filePath: string) {
    const baseline = this.db
      .prepare("SELECT file_hash FROM entity_file_state WHERE id=?")
      .get(id) as { file_hash: string } | undefined;
    const relative = path.relative(this.root, filePath);
    if (!baseline && !fs.existsSync(filePath)) return;
    let current: string;
    try {
      current = this.files.read(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw Object.assign(new Error("磁盘文件已被移除，未覆盖当前正文"), {
        code: "EXTERNAL_CHANGE",
      });
    }
    if (!baseline || baseline.file_hash !== sha256(current))
      throw Object.assign(
        new Error("磁盘文件已被外部修改，请复制草稿并重新加载文件"),
        { code: "EXTERNAL_CHANGE" },
      );
  }
}
