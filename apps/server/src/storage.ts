import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  createCompleteBackup,
  restoreCompleteBackup,
  hashFile,
} from "./backup";
import { pipeline } from "node:stream/promises";
import type { Attachment, RemoteAttachmentLocation } from "@workbench/core";
import { WorkbenchStore } from "./store";
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  keepLocal: boolean;
  thresholdBytes: number;
  minAgeDays: number;
  enabled: boolean;
  credentialId?: string;
}
const defaultConfig: S3Config = {
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "scientific-workbench",
  forcePathStyle: true,
  keepLocal: true,
  thresholdBytes: 100000000,
  minAgeDays: 15,
  enabled: false,
};
export class StorageService {
  private timer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private scanning?: Promise<{ uploaded: number; skipped: number }>;
  private stopped = false;
  private readonly reading = new Map<string, number>();
  private readonly downloading = new Map<string, Promise<string>>();
  constructor(
    private readonly store: WorkbenchStore,
    private readonly clock: () => number = Date.now,
    private readonly cacheLimit = 2000000000,
  ) {}
  config(): S3Config {
    const {
      accessKeyId: _access,
      secretAccessKey: _secret,
      ...publicConfig
    } = this.rawConfig();
    return publicConfig;
  }
  configure(input: Partial<S3Config>) {
    const { accessKeyId, secretAccessKey, ...publicInput } = input;
    const next = { ...this.rawConfig(), ...publicInput };
    if (
      !Number.isFinite(next.thresholdBytes) ||
      next.thresholdBytes < 0 ||
      !Number.isFinite(next.minAgeDays) ||
      next.minAgeDays < 0
    )
      throw new Error("大小阈值和保存天数必须为非负数");
    if (next.endpoint && !/^https?:\/\//.test(next.endpoint))
      throw new Error("S3 endpoint 必须使用 HTTP 或 HTTPS");
    if (accessKeyId || secretAccessKey) {
      if (!accessKeyId || !secretAccessKey)
        throw new Error("请同时填写 access key 和 secret key");
      next.credentialId = crypto.randomUUID();
      const file = path.join(
        this.store.dataDir,
        "private",
        `s3-${next.credentialId}.json`,
      );
      fs.writeFileSync(file, JSON.stringify({ accessKeyId, secretAccessKey }), {
        flag: "wx",
        mode: 0o600,
      });
    }
    delete next.accessKeyId;
    delete next.secretAccessKey;
    this.store.saveSetting("s3", next);
    return this.config();
  }
  private rawConfig(): S3Config {
    return {
      ...defaultConfig,
      ...this.store.setting<Partial<S3Config>>("s3", {}),
    };
  }
  private client(location?: RemoteAttachmentLocation) {
    const config = location
      ? { ...this.rawConfig(), ...location }
      : this.rawConfig();
    if ((!location && !config.enabled) || !config.bucket)
      throw new Error("S3 尚未启用或缺少 bucket");
    if (!config.credentialId || !/^[a-f0-9-]+$/.test(config.credentialId))
      throw new Error("S3 凭据尚未配置");
    const credentials = JSON.parse(
      fs.readFileSync(
        path.join(
          this.store.dataDir,
          "private",
          `s3-${config.credentialId}.json`,
        ),
        "utf8",
      ),
    ) as { accessKeyId: string; secretAccessKey: string };
    return {
      config,
      client: new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials,
      }),
    };
  }
  async testConnection() {
    const { client, config } = this.client();
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { ok: true, bucket: config.bucket };
    } finally {
      client.destroy();
    }
  }
  startScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.stopped = false;
    for (const job of this.store.listJobs())
      if (job.type === "s3-upload" && job.status === "running")
        this.store.updateJob(job.id, "queued", {
          ...job.payload,
          nextAttemptAt: this.clock(),
        });
    const run = () => {
      void this.scanDue().catch((error) => {
        const job = this.store.createJob("storage-scan", {});
        this.store.updateJob(job.id, "failed", {}, String(error));
      });
    };
    run();
    this.timer = setInterval(run, 60 * 60 * 1000);
    this.timer.unref();
  }
  async stopScheduler() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    await this.scanning;
  }
  scanDue() {
    if (this.scanning) return this.scanning;
    this.scanning = this.processDue().finally(() => {
      this.scanning = undefined;
    });
    return this.scanning;
  }
  async retryJob(id: string) {
    const job = this.store
      .listJobs()
      .find((job) => job.id === id && job.type === "s3-upload");
    if (!job || job.status === "running")
      throw new Error("任务不存在或仍在执行");
    this.store.updateJob(id, "queued", {
      ...job.payload,
      nextAttemptAt: this.clock(),
    });
    return this.scanDue();
  }
  private async processDue() {
    const config = this.rawConfig();
    if (!config.enabled || this.stopped) return { uploaded: 0, skipped: 0 };
    const cutoff = this.clock() - config.minAgeDays * 86400000;
    const attachments = this.store.db
      .prepare(
        "SELECT id FROM attachments WHERE remote_key IS NULL AND size_bytes>? AND created_at<=? ORDER BY created_at",
      )
      .all(config.thresholdBytes, new Date(cutoff).toISOString()) as {
      id: string;
    }[];
    const existing = this.store
      .listJobs()
      .filter((job) => job.type === "s3-upload");
    for (const { id } of attachments)
      if (!existing.some((job) => job.payload.attachmentId === id))
        this.store.createJob("s3-upload", {
          attachmentId: id,
          attempts: 0,
          nextAttemptAt: this.clock(),
        });
    const due = this.store
      .listJobs()
      .filter(
        (job) =>
          job.type === "s3-upload" &&
          ["queued", "failed"].includes(job.status) &&
          Number(job.payload.nextAttemptAt || 0) <= this.clock(),
      );
    let uploaded = 0,
      skipped = 0;
    const worker = async () => {
      while (due.length && !this.stopped) {
        const job = due.shift()!,
          attempts = Number(job.payload.attempts || 0) + 1;
        this.store.updateJob(job.id, "running", { ...job.payload, attempts });
        try {
          const attachment = this.store.getAttachment(
            String(job.payload.attachmentId),
          );
          if (!attachment.remoteLocation) await this.upload(attachment);
          this.store.updateJob(job.id, "succeeded", {
            ...job.payload,
            attempts,
          });
          uploaded++;
        } catch (error) {
          const delay = [60000, 300000, 1800000, 21600000][
            Math.min(attempts - 1, 3)
          ];
          this.store.updateJob(
            job.id,
            "failed",
            { ...job.payload, attempts, nextAttemptAt: this.clock() + delay },
            String(error),
          );
          skipped++;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    clearTimeout(this.retryTimer);
    const pending = this.store
      .listJobs()
      .filter(
        (job) =>
          job.type === "s3-upload" && ["queued", "failed"].includes(job.status),
      );
    if (pending.length && !this.stopped) {
      const wait = Math.max(
        1000,
        Math.min(
          ...pending.map((job) =>
            Number(job.payload.nextAttemptAt || this.clock()),
          ),
        ) - this.clock(),
      );
      this.retryTimer = setTimeout(() => {
        void this.scanDue().catch((error) => {
          const job = this.store.createJob("storage-scan", {});
          this.store.updateJob(job.id, "failed", {}, String(error));
        });
      }, wait);
      this.retryTimer.unref();
    }
    return { uploaded, skipped };
  }
  async upload(attachment: Attachment) {
    const { client, config } = this.client();
    const location: RemoteAttachmentLocation = {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      forcePathStyle: config.forcePathStyle,
      credentialId: config.credentialId!,
      key: `${config.prefix}/attachments/${attachment.id}-${attachment.sha256}`,
    };
    try {
      if (!fs.existsSync(attachment.localPath))
        throw new Error("附件本地副本不存在");
      await new Upload({
        client,
        params: {
          Bucket: location.bucket,
          Key: location.key,
          Body: fs.createReadStream(attachment.localPath),
          ContentType: attachment.mimeType,
        },
      }).done();
      const response = await client.send(
        new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
      );
      if (!response.Body) throw new Error("S3 回读没有内容");
      const hash = crypto.createHash("sha256");
      let size = 0;
      for await (const chunk of response.Body as NodeJS.ReadableStream) {
        hash.update(chunk);
        size += Buffer.byteLength(chunk);
      }
      if (
        hash.digest("hex") !== attachment.sha256 ||
        size !== attachment.sizeBytes
      )
        throw new Error("S3 回读校验失败");
      this.store.locateAttachment(attachment.id, location, !config.keepLocal);
      if (!config.keepLocal) fs.unlinkSync(attachment.localPath);
      return { id: attachment.id, key: location.key };
    } finally {
      client.destroy();
    }
  }
  async presigned(attachment: Attachment, expiresIn = 900) {
    if (!attachment.remoteLocation)
      throw new Error("附件缺少稳定远端位置，请重新关联");
    const { client } = this.client(attachment.remoteLocation);
    try {
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: attachment.remoteLocation.bucket,
            Key: attachment.remoteLocation.key,
          }),
          { expiresIn },
        ),
        expiresIn,
      };
    } finally {
      client.destroy();
    }
  }
  async cleanupAttachments(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new Error("请选择要永久清理的附件");
    const attachments = unique.map((id) => this.store.getAttachment(id));
    for (const attachment of attachments) {
      const id = attachment.id;
      const references = this.store.attachmentReferences(id);
      if (references.length) {
        throw Object.assign(
          new Error(`附件「${attachment.originalName}」仍被引用，未执行清理`),
          { code: "CONFLICT", references },
        );
      }
    }
    for (const attachment of attachments) {
      if (attachment.remoteLocation) {
        const { client } = this.client(attachment.remoteLocation);
        try {
          await client.send(
            new DeleteObjectCommand({
              Bucket: attachment.remoteLocation.bucket,
              Key: attachment.remoteLocation.key,
            }),
          );
        } finally {
          client.destroy();
        }
      }
    }
    const deleted = attachments.map((attachment) => {
      this.store.deleteUnreferencedAttachment(attachment.id);
      return attachment.id;
    });
    return { deleted };
  }
  async acquireAttachment(attachment: Attachment) {
    const key = attachment.sha256;
    this.reading.set(key, (this.reading.get(key) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = (this.reading.get(key) || 1) - 1;
      if (count) this.reading.set(key, count);
      else this.reading.delete(key);
      this.trimCache();
    };
    try {
      return { path: await this.attachmentPath(attachment), release };
    } catch (error) {
      release();
      throw error;
    }
  }
  trimCache() {
    const root = path.join(this.store.dataDir, "cache");
    const files = fs
      .readdirSync(root)
      .filter((name) => /^[a-f0-9]{64}$/.test(name))
      .map((name) => ({ name, stat: fs.statSync(path.join(root, name)) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    let bytes = files.reduce((total, file) => total + file.stat.size, 0);
    for (const file of files) {
      if (bytes <= this.cacheLimit) break;
      if (this.reading.has(file.name) || this.downloading.has(file.name))
        continue;
      fs.unlinkSync(path.join(root, file.name));
      bytes -= file.stat.size;
    }
  }
  attachmentPath(attachment: Attachment): Promise<string> {
    const local = path.isAbsolute(attachment.localPath)
      ? attachment.localPath
      : path.join(this.store.dataDir, attachment.localPath);
    if (fs.existsSync(local)) return Promise.resolve(local);
    const pending = this.downloading.get(attachment.sha256);
    if (pending) return pending;
    const download = this.downloadAttachment(attachment).finally(() => {
      this.downloading.delete(attachment.sha256);
    });
    this.downloading.set(attachment.sha256, download);
    return download;
  }
  private async downloadAttachment(attachment: Attachment) {
    if (!attachment.remoteLocation)
      throw new Error(`附件缺失或缺少稳定远端位置：${attachment.originalName}`);
    const cache = path.join(this.store.dataDir, "cache", attachment.sha256);
    if (fs.existsSync(cache)) {
      const existing = await hashFile(cache);
      if (
        existing.sha256 === attachment.sha256 &&
        existing.size === attachment.sizeBytes
      ) {
        fs.utimesSync(cache, new Date(), new Date());
        return cache;
      }
    }
    const { client } = this.client(attachment.remoteLocation);
    const pending = cache + "." + crypto.randomUUID() + ".partial";
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: attachment.remoteLocation.bucket,
          Key: attachment.remoteLocation.key,
        }),
      );
      if (!response.Body) throw new Error("S3 返回空响应");
      await pipeline(
        response.Body as NodeJS.ReadableStream,
        fs.createWriteStream(pending, { flags: "wx", mode: 0o600 }),
      );
      const actual = await hashFile(pending);
      if (
        actual.sha256 !== attachment.sha256 ||
        actual.size !== attachment.sizeBytes
      )
        throw new Error("远端附件回读校验失败");
      fs.renameSync(pending, cache);
      return cache;
    } catch (error) {
      fs.rmSync(pending, { force: true });
      throw error;
    } finally {
      client.destroy();
    }
  }
  async createBackup(target: "local" | "s3" = "local", signal?: AbortSignal) {
    const leases: { release: () => void }[] = [];
    let result: Awaited<ReturnType<typeof createCompleteBackup>>;
    try {
      result = await createCompleteBackup(
        this.store,
        async (attachment) => {
          const lease = await this.acquireAttachment(attachment);
          leases.push(lease);
          return lease.path;
        },
        signal,
      );
    } finally {
      for (const lease of leases) lease.release();
    }
    if (target === "s3") {
      if (signal?.aborted)
        throw Object.assign(new Error("备份已取消"), { code: "CANCELED" });
      const { client, config } = this.client();
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await new Upload({
          client,
          abortController,
          params: {
            Bucket: config.bucket,
            Key: `${config.prefix}/backups/${path.basename(result.file)}`,
            Body: fs.createReadStream(result.file),
            ContentType: "application/zip",
          },
        }).done();
      } finally {
        signal?.removeEventListener("abort", abort);
        client.destroy();
      }
    }
    return { ...result, target };
  }
  async restoreBackup(zipPath: string, targetDir: string) {
    if (!zipPath || !targetDir) throw new Error("需要 zipPath 和 targetDir");
    return restoreCompleteBackup(zipPath, targetDir, this.store.dataDir);
  }
}
