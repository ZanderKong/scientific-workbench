import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { WorkbenchStore } from './store';
import { StorageService } from './storage';
import { restoreCompleteBackup } from './backup';

const enabled = process.env.WORKBENCH_S3_INTEGRATION === '1';
describe.skipIf(!enabled)('real isolated MinIO S3 compatibility', () => {
  const container = `swb-s3-${crypto.randomUUID()}`;
  let root = '';
  const credential = { accessKeyId: 'workbench-test', secretAccessKey: crypto.randomUUID() };
  const image = 'quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e';
  let endpoint = '', direct = '', corruptRead = false, multipart = 0;
  let client: S3Client, proxy: http.Server;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-s3-integration-'));
    execFileSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', container, '-p', '127.0.0.1::9000', '-e', `MINIO_ROOT_USER=${credential.accessKeyId}`, '-e', `MINIO_ROOT_PASSWORD=${credential.secretAccessKey}`, image, 'server', '/data'], { stdio: 'pipe', timeout: 30000 });
    const address = execFileSync('docker', ['port', container, '9000/tcp'], { encoding: 'utf8', timeout: 10000 }).trim(); direct = `http://${address}`;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await fetch(`${direct}/minio/health/live`).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    client = new S3Client({ endpoint: direct, region: 'us-east-1', forcePathStyle: true, credentials: credential });
    for (const Bucket of ['workbench-a', 'workbench-b']) await client.send(new CreateBucketCommand({ Bucket }));
    proxy = http.createServer((request, response) => {
      if (request.method === 'POST' && request.url?.includes('uploads')) multipart++;
      if (corruptRead && request.method === 'GET' && request.url?.includes('/attachments/')) { response.end('corrupted read-back'); return; }
      const upstream = http.request(direct + request.url, { method: request.method, headers: request.headers }, incoming => { response.writeHead(incoming.statusCode || 500, incoming.headers); incoming.pipe(response); });
      upstream.on('error', error => { response.writeHead(502); response.end(error.message); }); request.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
  }, 45000);
  afterAll(async () => {
    client?.destroy(); if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
    try { execFileSync('docker', ['rm', '-f', container], { stdio: 'pipe', timeout: 15000 }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('uploads multipart, follows saved location after config change, and restores remote-only bytes without the original workspace', async () => {
    const source = path.join(root, 'source'); const store = new WorkbenchStore({ dataDir: source });
    const file = store.saveAttachment(crypto.randomBytes(12 * 1024 * 1024), '模拟大附件-长文件名.bin', 'application/octet-stream');
    const service = new StorageService(store, () => Date.parse(file.createdAt) + 15 * 86400000, 1024);
    try {
      service.configure({ enabled: true, endpoint, bucket: 'workbench-a', thresholdBytes: 10, keepLocal: false, ...credential });
      expect(await service.testConnection()).toMatchObject({ ok: true });
      expect(await service.scanDue()).toEqual({ uploaded: 1, skipped: 0 });
      expect(multipart).toBeGreaterThan(0); expect(fs.existsSync(file.localPath)).toBe(false);
      const remote = store.getAttachment(file.id); expect(remote.remoteLocation?.bucket).toBe('workbench-a');
      service.configure({ bucket: 'workbench-b', prefix: 'changed' });
      const lease = await service.acquireAttachment(remote);
      service.trimCache(); expect(fs.existsSync(lease.path)).toBe(true);
      lease.release(); expect(fs.existsSync(lease.path)).toBe(false);
      const backup = await service.createBackup();
      const archive = path.join(root, 'complete.zip'); fs.copyFileSync(backup.file, archive);
      await service.stopScheduler(); store.close(); fs.renameSync(source, path.join(root, 'source-unavailable'));
      const restoredPath = path.join(root, 'restored'); await restoreCompleteBackup(archive, restoredPath, source);
      const recovered = new WorkbenchStore({ dataDir: restoredPath });
      try {
        const recoveredFile = recovered.getAttachment(file.id);
        expect(crypto.createHash('sha256').update(fs.readFileSync(recoveredFile.localPath)).digest('hex')).toBe(file.sha256);
        expect(recoveredFile.remoteOnly).toBe(false);
        expect(fs.readdirSync(path.join(restoredPath, 'private'))).toEqual([]);
        expect(new StorageService(recovered).config().enabled).toBe(false);
      } finally { recovered.close(); }
    } finally { await service.stopScheduler(); if (store.db.open) store.close(); }
  }, 45000);
  it('keeps local bytes and records a failed task when S3 read-back is corrupted', async () => {
    const store = new WorkbenchStore({ dataDir: path.join(root, 'corruption') });
    const file = store.saveAttachment(Buffer.from('original bytes'), '原件.txt', 'text/plain');
    const service = new StorageService(store, () => Date.parse(file.createdAt) + 15 * 86400000);
    try {
      service.configure({ enabled: true, endpoint, bucket: 'workbench-a', thresholdBytes: 0, keepLocal: false, ...credential });
      corruptRead = true;
      expect(await service.scanDue()).toEqual({ uploaded: 0, skipped: 1 });
      expect(store.listJobs()[0].error).toContain('回读校验失败');
      expect(store.getAttachment(file.id).remoteLocation).toBeUndefined();
      expect(fs.readFileSync(file.localPath, 'utf8')).toBe('original bytes');
    } finally { corruptRead = false; await service.stopScheduler(); store.close(); }
  });
});
