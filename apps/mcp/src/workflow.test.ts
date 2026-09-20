import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swb-mcp-'));
let serverProcess: ChildProcess, client: Client, transport: StdioClientTransport;
const token = crypto.randomUUID();
let base = '';
beforeAll(async () => {
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  base = `http://127.0.0.1:${port}/api/v1`;
  const env = { ...process.env, WORKBENCH_PORT: String(port), WORKBENCH_DATA_DIR: path.join(root, 'workspace'), WORKBENCH_API_TOKEN: token, NODE_ENV: 'production' };
  serverProcess = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../server/src/main.ts', import.meta.url))], { env, stdio: 'pipe' });
  let error = ''; serverProcess.stderr?.on('data', chunk => { error += chunk; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (serverProcess.exitCode !== null) throw new Error(`本机服务未启动：${error}`);
    if (await fetch(base + '/health').then(response => response.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', fileURLToPath(new URL('./main.ts', import.meta.url))], env: Object.fromEntries(Object.entries({ ...env, WORKBENCH_API: base }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), stderr: 'pipe' });
  client = new Client({ name: 'workbench-acceptance', version: '1' }); await client.connect(transport);
}, 20000);
afterAll(async () => {
  await client?.close(); await transport?.close();
  if (serverProcess && serverProcess.exitCode === null) { serverProcess.kill('SIGTERM'); await new Promise<void>(resolve => { serverProcess.once('exit', () => resolve()); setTimeout(() => { serverProcess.kill('SIGKILL'); resolve(); }, 3000).unref(); }); }
  fs.rmSync(root, { recursive: true, force: true });
});
async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).filter(item => item.type === 'text').map(item => item.text).join('');
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as T;
}
it('completes the scientific workflow through a real MCP stdio client, including conflicts, idempotency, evidence and backup', async () => {
  const catalogue = await client.listTools(); expect(catalogue.tools.length).toBeGreaterThan(40);
  await call('object_create', { canonicalName: 'MCP搅拌', role: 'process' });
  const args = { code: 'MCP-01', body: '- [MCP搅拌]\n  - [MCP搅拌]｜时间：30 min', idempotencyKey: 'sample-retry' };
  const sample = await call<{ id: string; contentVersion: number }>('sample_create', args);
  expect((await call<{ id: string }>('sample_create', args)).id).toBe(sample.id);
  await expect(call('sample_create', { ...args, code: 'DIFFERENT' })).rejects.toThrow('幂等键');
  await call('document_finalize', { id: sample.id });
  const document = await call<{ body: string; head: { contentVersion: number } }>('document_get', { id: sample.id });
  await expect(call('document_save', { id: sample.id, body: '- 不带版本' })).rejects.toThrow('expectedVersion');
  const saved = await call<{ contentVersion: number }>('document_save', { id: sample.id, body: document.body.replace('30 min', '60 min'), expectedVersion: document.head.contentVersion });
  await expect(call('document_save', { id: sample.id, body: '- 旧页面', expectedVersion: document.head.contentVersion })).rejects.toThrow('冲突');
  await call('document_finalize', { id: sample.id });
  const latest = await call<{ properties: { value_text: string }[] }>('sample_get', { id: sample.id });
  expect(latest.properties.map(property => property.value_text)).toEqual(['60 min']);
  expect(saved.contentVersion).toBeGreaterThan(document.head.contentVersion);
  const filename = path.join(root, '模拟数据.csv'); fs.writeFileSync(filename, 'x,y\n1,2\n');
  const file = await call<{ id: string }>('attachment_upload', { filePath: filename, mimeType: 'text/csv' });
  expect((await call<{ text: string }>('attachment_text_read', { id: file.id, offset: 0, length: 32 })).text).toBe('x,y\n1,2\n');
  const data = await call<{ id: string; version: number }>('data_create', { name: '模拟曲线', body: '- 模拟数据说明', aboutSampleIds: [sample.id] });
  const attached = await call<{ version: number }>('data_update', { id: data.id, expectedVersion: data.version, componentIds: [file.id] });
  const analysis = await call<{ id: string }>('analysis_create', { title: 'MCP流程分析', itemIds: [sample.id, data.id] });
  const context = await call<{ context: string; manifest: { entities: { id: string }[] } }>('analysis_export_context', { id: analysis.id });
  expect(context.context).toContain('60 min'); expect(context.context).toContain('模拟数据说明');
  const claim = await call<{ id: string; evidence: { content: string }[] }>('claim_create', { hostType: 'analysis', hostId: analysis.id, text: '模拟论点' });
  await call('data_update', { id: data.id, expectedVersion: attached.version, body: '- 新数据说明' });
  expect((await call<{ evidence: { content: string }[] }>('claim_get', { id: claim.id })).evidence).toEqual(claim.evidence);
  const page = await call<{ items: unknown[]; total: number }>('sample_list', { limit: 1, offset: 0 }); expect(page.items).toHaveLength(1);
  const resource = await client.readResource({ uri: `workbench://sample/${sample.id}/document` }); expect(JSON.stringify(resource.contents)).toContain('60 min');
  const backup = await call<{ jobId: string }>('backup_create');
  let job: { status: string; payload?: { result?: { file: string } }; error?: string } = { status: 'running' };
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(job.status); attempt++) { job = await call('job_get', { id: backup.jobId }); if (job.status === 'running') await new Promise(resolve => setTimeout(resolve, 50)); }
  expect(job.status, job.error).toBe('succeeded'); expect(fs.existsSync(job.payload!.result!.file)).toBe(true);
  await expect(call('backup_restore', { zipPath: job.payload!.result!.file, targetDir: path.join(root, 'restore-denied') })).rejects.toThrow('restore');
}, 30000);
it('serves the same agent knowledge through resources, tools and legacy syntax', async () => {
  const indexResource = await client.readResource({ uri: 'workbench://knowledge' });
  const index = JSON.parse((indexResource.contents[0] as { text: string }).text);
  expect(index.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(index.bundleHash).toHaveLength(64);
  expect(index.content.length).toBeGreaterThanOrEqual(6);
  const toolIndex = await call<{ bundleHash: string; content: { id: string }[] }>('knowledge_index', {});
  expect(toolIndex.bundleHash).toBe(index.bundleHash);
  const commonResource = await client.readResource({ uri: 'workbench://knowledge/protocol-common' });
  const commonText = (commonResource.contents[0] as { text: string }).text;
  const commonTool = await call<{ content: string; contentHash: string }>('knowledge_read', { id: 'protocol-common' });
  expect(commonTool.content).toBe(commonText);
  const syntax = await client.readResource({ uri: 'workbench://syntax' });
  const syntaxText = (syntax.contents[0] as { text: string }).text;
  const sample = await call<{ content: string }>('knowledge_read', { id: 'protocol-sample-document' });
  expect(syntaxText).toBe(sample.content);
  await expect(call('knowledge_read', { id: '../guide' })).rejects.toThrow();
}, 30000);
