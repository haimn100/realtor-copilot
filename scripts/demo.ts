import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'realtor-copilot-demo', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp')));
try {
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    console.log(name, JSON.stringify(result.structuredContent, null, 2));
    return result.structuredContent as Record<string, unknown>;
  }
  const created = await call('create_client', { display_name: 'John', facts: [
    { category: 'context', key: 'intended_use', value: 'investment' },
    { category: 'requirement', key: 'bedrooms_min', value: 2 },
    { category: 'requirement', key: 'budget_max', value: { amount: 4000000, currency: 'MXN' } },
    { category: 'preference', key: 'preferred_area', value: 'Coco Beach' },
  ] });
  const clientId = (created.client as { id: string }).id;
  await call('find_clients', { name: 'John' });
  await call('get_client_context', { client_id: clientId });
  await call('remember_client_fact', { client_id: clientId, fact: {
    category: 'requirement', key: 'budget_max', value: { amount: 4500000, currency: 'MXN' },
  } });
  await call('get_client_context', { client_id: clientId });
  console.log(`John retained in Supabase. Client ID: ${clientId}`);
} finally { await client.close(); }
