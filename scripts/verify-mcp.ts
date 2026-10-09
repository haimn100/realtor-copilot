import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ClientIdentity } from '../src/application/contracts.js';
import type { ClientContext } from '../src/application/client-service.js';
import { verifyToolDiscovery } from '../src/mcp/tool-contracts.js';

// Read-only smoke test: do not use demo.ts to verify retained client memory.
const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp');
assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp', 'Use an MCP URL ending in /mcp without credentials or query parameters.');
const client = new Client({ name: 'realtor-copilot-readonly-check', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url));
  console.log(`Streamable HTTP initialized: ${url.href} (${client.getServerVersion()?.name})`);
  const { tools } = await client.listTools();
  verifyToolDiscovery(tools);
  for (const tool of tools) assert(!JSON.stringify(tool.inputSchema).includes('workspace_id'));
  console.log(`Discovered all ${tools.length} tools; no workspace input.`);
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result.content));
    assert(result.structuredContent, 'Expected structured tool result.');
    assert(!JSON.stringify(result.structuredContent).includes('workspace_id'));
    return result.structuredContent as T;
  }
  const found = await call<{ clients: ClientIdentity[]; has_more: boolean }>('find_clients', { name: 'John', limit: 20 });
  console.log('find_clients:', JSON.stringify(found.clients.map(c => ({ id: c.id, display_name: c.display_name }))));
  const john = process.env.MCP_CLIENT_ID
    ? found.clients.find(c => c.id === process.env.MCP_CLIENT_ID)
    : found.clients.length === 1 && !found.has_more ? found.clients[0] : undefined;
  assert(john, 'John is missing or ambiguous. Set MCP_CLIENT_ID to the intended John ID returned above; do not create another client.');
  const context = await call<ClientContext>('get_client_context', { client_id: john.id });
  assert.deepEqual(context.requirements.find(f => f.key === 'budget_max')?.value, { amount: 4500000, currency: 'MXN' });
  assert.equal(context.requirements.find(f => f.key === 'bedrooms_min')?.value, 2);
  assert.equal(context.context.find(f => f.key === 'intended_use')?.value, 'investment');
  assert.equal(context.preferences.find(f => f.key === 'preferred_area')?.value, 'Coco Beach');
  console.log(`get_client_context: John ${john.id} has max budget 4.5M MXN, 2+ bedrooms, investment intent, Coco Beach preference.`);
  console.log('PASS: persisted context retrieved without writing data.');
} finally {
  await client.close();
}
