import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'pnpm', args: ['--filter', '@workbench/mcp', 'start'], env: { ...process.env, WORKBENCH_API: process.env.WORKBENCH_API ?? 'http://127.0.0.1:4317/api/v1' } });
const client = new Client({ name: 'workbench-smoke', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);
const tools = await client.listTools();
if (!tools.tools.some((t) => t.name === 'workspace_status')) throw new Error('MCP 工具列表不完整');
const result = await client.callTool({ name: 'workspace_status', arguments: {} });
console.log(JSON.stringify(result));
await transport.close();
