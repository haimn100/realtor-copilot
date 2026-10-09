import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createHttpServer } from '../src/infrastructure/http-server.js';
import { createMcpServer } from '../src/mcp/server.js';
import { TOOL_CONTRACTS, verifyToolDiscovery, type ToolName } from '../src/mcp/tool-contracts.js';
import { RealtorClientService } from '../src/application/client-service.js';
import { RealtorPropertyService } from '../src/application/property-service.js';
import type { ApplicationContext } from '../src/infrastructure/identity.js';
import type { ClientRepository } from '../src/application/contracts.js';
import type { PropertyRepository, SavedProperty, PropertyRelationship } from '../src/application/property-contracts.js';

test('source and production HTTP endpoints expose every registered input/output contract', async () => {
  // A missing/stale compiled module fails this test. npm test builds first.
  const compiled = await import(pathToFileURL(resolve('dist/src/infrastructure/http-server.js')).href);
  const identity = { resolve: async () => ({} as ApplicationContext) };
  for (const factory of [createHttpServer, compiled.createHttpServer as typeof createHttpServer]) {
    const server = factory(identity);
    const client = new Client({ name: 'contract-test', version: '1' });
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert(address && typeof address !== 'string');
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      const { tools } = await client.listTools();
      verifyToolDiscovery(tools);
      assert.equal(tools.length, 13);
      for (const name of ['create_client','find_clients','get_client_context','remember_client_fact','save_property','get_property_context','update_client_property','get_client_property_history'])
        assert(tools.some(tool => tool.name === name));
      assert(!JSON.stringify(tools.map(t => t.inputSchema)).includes('workspace_id'));
      assert.throws(() => verifyToolDiscovery(tools.slice(0, 4)), /MCP tool mismatch/);
      assert.throws(() => verifyToolDiscovery(tools.map((t, i) => i ? t : { ...t, outputSchema: undefined })), /schema mismatch/);
    } finally {
      await client.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test('all eleven handlers retain existing fields and validate new memory contracts and property-context branches', async () => {
  const clientId = '11111111-1111-4111-8111-111111111111';
  const propertyId = '22222222-2222-4222-8222-222222222222';
  const timestamp = '2026-10-07T12:00:00Z';
  const identity = { id: clientId, display_name: 'John', first_name: null, last_name: null, status: 'lead', email: null, phone: null, notes: null, memory_version: 0 };
  const fact = { id: 'fact', category: 'requirement', key: 'bedrooms_min', value_json: 2, status: 'current', confidence: 1, importance: 'normal', valid_from: timestamp,
    created_at: timestamp, created_by: null, source_type: 'manual', source_ref: null, source_interaction_id: null, superseded_by_id: null, applicability: 'confirmed_current', source_at: null, valid_until: null, source_quote: null, strength: 'hard' };
  const property: SavedProperty = { id: propertyId, title: 'Marbella', property_type: null, development_name: null,
    address: null, neighborhood: 'Coco Beach', city: 'Playa del Carmen', state: 'Quintana Roo', country: 'Mexico',
    bedrooms: 2, bathrooms: null, interior_m2: null, exterior_m2: null, total_m2: null, asking_price: 3800000,
    currency: 'MXN', construction_status: null, delivery_date: null, notes: null, availability_status: 'unknown', availability_verified_at: null };
  const relationship: PropertyRelationship = { id: 'relationship', client_id: clientId, property_id: propertyId,
    status: 'considering', interest_level: null, notes: null, rejection_reason: null, first_considered_at: timestamp,
    sent_at: null, viewed_at: null, updated_at: timestamp };
  const clientRepository: ClientRepository = {
    createClient: async () => identity, findClients: async () => ({ clients: [identity], has_more: false }),
    rememberFact: async () => fact,
    loadContext: async () => ({ client: identity, facts: [fact], properties: [], propertyEvents: [], interactions: [], tasks: [], searches: [], truncated: [] }),
    updateClient: async () => ({ client: identity, interaction_id: clientId, facts: [], follow_ups: [], replayed: false }),
    recordInteraction: async () => ({ client: identity, interaction_id: clientId, facts: [fact], follow_ups: [], replayed: false }),
    loadHistory: async () => ({ client: identity, timeline: [], coverage: { limit: 30, has_more: false, next_cursor: null } }),
  };
  const propertyRepository: PropertyRepository = {
    saveProperty: async () => ({ property, source: null }), updateClientProperty: async () => relationship,
    findSavedProperties: async () => ({ matches: [property, { ...property, id: clientId }], has_more: false }),
    loadPropertyContext: async () => ({ property, sources: [], clients: [], events: [], research: [], truncated: [] }),
    loadClientPropertyHistory: async () => ({ client: { id: clientId, display_name: 'John' }, property, relationship, events: [], has_more: false }),
  };
  const server = createServer(async (req, res) => {
    const mcp = createMcpServer(new RealtorClientService(clientRepository), new RealtorPropertyService(propertyRepository));
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await mcp.connect(transport);
    res.once('close', () => { void mcp.close(); });
    await transport.handleRequest(req, res);
  });
  const client = new Client({ name: 'handler-contract-test', version: '1' });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert(address && typeof address !== 'string');
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    const cases: [ToolName, Record<string, unknown>][] = [
      ['create_client', { display_name: 'John' }], ['find_clients', { name: 'John' }],
      ['get_client_context', { client_id: clientId }],
      ['remember_client_fact', { client_id: clientId, fact: { category: 'requirement', key: 'bedrooms_min', value: 2 } }],
      ['save_property', { title: 'Marbella' }], ['get_property_context', { property_id: propertyId }],
      ['update_client_property', { client_id: clientId, property_id: propertyId, status: 'considering' }],
      ['get_client_property_history', { client_id: clientId, property_id: propertyId }],
      ['get_property_context', { name: 'Marbella' }],
      ['update_client', { client_id: clientId, expected_version: 0, idempotency_key: 'profile', patch: { status: 'active' } }],
      ['record_interaction', { client_id: clientId, expected_version: 0, idempotency_key: 'call', interaction_type: 'call', occurred_at: timestamp, summary: 'Budget changed' }],
      ['get_client_history', { client_id: clientId }],
    ];
    for (const [name, args] of cases) {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
      assert(TOOL_CONTRACTS[name].outputSchema.safeParse(result.structuredContent).success, name);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
    }
    const invalid = await client.callTool({ name: 'find_clients', arguments: { name: 'John', workspace_id: clientId } });
    assert(invalid.isError);
  } finally {
    await client.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
