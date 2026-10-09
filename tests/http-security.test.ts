import assert from 'node:assert/strict';
import { request, type Server, type OutgoingHttpHeaders } from 'node:http';
import { test } from 'node:test';
import { createHttpServer } from '../src/infrastructure/http-server.js';
import type { ApplicationContext } from '../src/infrastructure/identity.js';

const tunnel = 'https://realtor-test.ngrok-free.dev';
const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'security-test', version: '1' },
} });
async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
function send(port: number, headers: OutgoingHttpHeaders = {}, body = initialize, method = 'POST', path = '/mcp') {
  return new Promise<{ status: number | undefined; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers,
    } }, res => {
      let result = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { result += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: result, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('local-only defaults reject public hosts and forwarded-header spoofing before resolving identity', async () => {
  let resolutions = 0;
  const server = createHttpServer({ resolve: async () => { resolutions++; throw new Error('must not resolve'); } });
  const port = await listen(server);
  try {
    for (const headers of [
      { Host: new URL(tunnel).hostname },
      { Host: 'evil.example', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'https' },
      { Origin: tunnel },
      { Origin: 'https://chatgpt.com' },
    ]) assert.equal((await send(port, headers)).status, 403);
    assert.equal(resolutions, 0);
    assert.equal((await send(port, {}, '', 'GET', '/health')).status, 200);
  } finally { await close(server); }
});

test('tunnel allows only the configured host and exact HTTPS origin, retaining stateless HTTP limits', async () => {
  let resolutions = 0;
  const server = createHttpServer({ resolve: async () => {
    resolutions++;
    // Initialization and tool discovery never access the repository.
    return {} as ApplicationContext;
  } }, { NODE_ENV: 'development', DEV_TUNNEL_URL: tunnel });
  const port = await listen(server);
  const Host = new URL(tunnel).hostname;
  try {
    for (const headers of [
      { Host: 'evil.example' },
      { Host: `evil.${Host}` },
      { Host: 'other.ngrok-free.dev' },
      { Host: 'evil.example', 'X-Forwarded-Host': Host, 'X-Forwarded-Proto': 'https' },
      { Host, Origin: 'https://evil.example', 'X-Forwarded-Host': Host },
      { Host, Origin: `http://${Host}` },
      { Host, Origin: `${tunnel}:444` },
      { Host, Origin: `${tunnel}/mcp` },
      { Host, Origin: 'null' },
      { Host, Origin: 'invalid' },
    ]) assert.equal((await send(port, headers)).status, 403, JSON.stringify(headers));
    assert.equal(resolutions, 0);
    for (const headers of [{}, { Host }, { Host, Origin: tunnel }, { Host, Origin: 'http://localhost:3000' }]) {
      const response = await send(port, headers);
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).result.serverInfo.name, 'realtor-copilot');
      assert.equal(response.headers['mcp-session-id'], undefined);
    }
    const listed = await send(port, { Host }, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    assert.equal(listed.status, 200);
    const tools = JSON.parse(listed.body).result.tools as { name: string; inputSchema: object }[];
    assert.deepEqual(tools.map(t => t.name).sort(), ['create_client', 'find_clients', 'get_client_context', 'get_client_history', 'get_client_import_guidance', 'get_client_property_history', 'get_property_context', 'import_client_findings', 'record_interaction', 'remember_client_fact', 'save_property', 'update_client', 'update_client_property']);
    assert(!JSON.stringify(tools.map(t => t.inputSchema)).includes('workspace_id'));
    assert.equal((await send(port, { Host }, '', 'GET')).status, 405);
    assert.equal((await send(port, { Host }, '', 'DELETE')).status, 405);
    assert.equal((await send(port, { Host }, '', 'POST', '/unknown')).status, 404);
    assert.equal((await send(port, { Host }, 'x'.repeat(65 * 1024))).status, 413);
  } finally { await close(server); }
});
