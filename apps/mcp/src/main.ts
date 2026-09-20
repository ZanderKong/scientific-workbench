import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { operations, operationRequest } from '@workbench/core';

const base = process.env.WORKBENCH_API ?? 'http://127.0.0.1:4317/api/v1';
const token = process.env.WORKBENCH_API_TOKEN;
async function request(route: string, init: RequestInit = {}) {
  const response = await fetch(base + route, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status });
  return response;
}
const server = new Server({ name: 'scientific-workbench', version: '0.2.0' }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  ...operations.map(operation => ({ name: operation.name, description: operation.description, inputSchema: operation.input })),
  { name: 'attachment_upload', description: '流式上传客户端本地文件。先获得附件ID，再加入Data组件；不在工具JSON内传二进制。', inputSchema: { type: 'object' as const, properties: { filePath: { type: 'string' }, mimeType: { type: 'string' } }, required: ['filePath'] } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments ?? {};
    if (params.name === 'attachment_upload') {
      if (typeof args.filePath !== 'string' || !path.isAbsolute(args.filePath)) throw new Error('需要绝对文件路径');
      const file = fs.realpathSync(args.filePath);
      const allowed = process.env.WORKBENCH_UPLOAD_ROOT && fs.realpathSync(process.env.WORKBENCH_UPLOAD_ROOT);
      if (allowed && !file.startsWith(allowed + path.sep)) throw new Error('文件超出配置的上传目录');
      if (!fs.statSync(file).isFile()) throw new Error('只能上传普通文件');
      const body = new FormData(); body.append('file', await fs.openAsBlob(file, { type: typeof args.mimeType === 'string' ? args.mimeType : 'application/octet-stream' }), path.basename(file));
      const result = await (await request('/attachments/stream', { method: 'POST', body })).json();
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    const operation = operations.find(operation => operation.name === params.name);
    if (!operation) throw new Error('未知操作');
    const mapped = operationRequest(operation, args);
    const result = await (await request(mapped.path, { method: operation.method, ...(operation.method !== 'GET' ? { body: JSON.stringify(mapped.body) } : {}), headers: typeof args.idempotencyKey === 'string' ? { 'Idempotency-Key': args.idempotencyKey } : {} })).json();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
  }
});
const KNOWLEDGE_ID = /^[a-z][a-z0-9-]*$/;
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
  { uri: 'workbench://syntax', name: '规范文档语法', mimeType: 'text/markdown' },
  { uri: 'workbench://knowledge', name: 'Agent 知识索引', mimeType: 'application/json' },
  { uri: 'workbench://operations', name: 'API与MCP操作规范', mimeType: 'application/json' },
  { uri: 'workbench://dictionary/objects', name: '对象字典', mimeType: 'application/json' },
  { uri: 'workbench://dictionary/properties', name: '属性字典', mimeType: 'application/json' },
] }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [
  { uriTemplate: 'workbench://sample/{id}/document', name: '样品实际正文', mimeType: 'text/markdown' },
  { uriTemplate: 'workbench://data/{id}', name: 'Data实际正文', mimeType: 'text/markdown' },
  { uriTemplate: 'workbench://analysis/{id}/context', name: '分析上下文', mimeType: 'text/markdown' },
  { uriTemplate: 'workbench://attachment/{id}', name: '图片资源或附件下载入口' },
  { uriTemplate: 'workbench://knowledge/{id}', name: 'Agent 知识内容', mimeType: 'text/markdown' },
] }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params: { uri } }) => {
  let text: string, mimeType = 'text/markdown';
  if (uri === 'workbench://syntax') text = (await (await request('/knowledge/protocol-sample-document')).json()).content;
  else if (uri === 'workbench://knowledge') { text = await (await request('/knowledge')).text(); mimeType = 'application/json'; }
  else if (/^workbench:\/\/knowledge\//.test(uri)) {
    const id = uri.slice('workbench://knowledge/'.length);
    if (!KNOWLEDGE_ID.test(id)) throw new Error('知识内容 ID 无效');
    text = (await (await request(`/knowledge/${encodeURIComponent(id)}`)).json()).content;
  }
  else if (uri === 'workbench://operations') { text = JSON.stringify(operations); mimeType = 'application/json'; }
  else if (/^workbench:\/\/dictionary\/(objects|properties)$/.test(uri)) { text = await (await request('/' + uri.split('/').at(-1))).text(); mimeType = 'application/json'; }
  else {
    const sample = uri.match(/^workbench:\/\/sample\/([^/]+)\/document$/), data = uri.match(/^workbench:\/\/data\/([^/]+)$/), analysis = uri.match(/^workbench:\/\/analysis\/([^/]+)\/context$/), attachment = uri.match(/^workbench:\/\/attachment\/([^/]+)$/);
    if (sample) text = (await (await request(`/samples/${encodeURIComponent(sample[1])}?latest=true`)).json()).document.body;
    else if (data) text = (await (await request(`/data/${encodeURIComponent(data[1])}`)).json()).body;
    else if (analysis) text = (await (await request(`/analyses/${encodeURIComponent(analysis[1])}/export`)).json()).context;
    else if (attachment) {
      const id = encodeURIComponent(attachment[1]), metadata = await (await request(`/attachments/${id}`)).json();
      if (/^image\/(png|jpeg|webp|gif)$/.test(metadata.mimeType) && metadata.sizeBytes <= 10 * 1024 * 1024) return { contents: [{ uri, mimeType: metadata.mimeType, blob: Buffer.from(await (await request(`/attachments/${id}/content`)).arrayBuffer()).toString('base64') }] };
      text = JSON.stringify({ ...metadata, download: `${base}/attachments/${id}/content`, authentication: '使用配置的Bearer token；不要把token放入URL' }); mimeType = 'application/json';
    } else throw new Error('资源不存在');
  }
  return { contents: [{ uri, mimeType, text }] };
});
await server.connect(new StdioServerTransport());
