import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { z } from 'zod';
import { developmentAdmin } from './dev-admin.js';
import { loadConfig } from '../src/infrastructure/config.js';
import { TOOL_CONTRACTS, verifyToolDiscovery, type ToolName } from '../src/mcp/tool-contracts.js';

// Explicit live acceptance command. Writes only UUID-labelled synthetic fixtures
// through the selected running MCP endpoint, then removes those exact fixtures.
const config = loadConfig();
const url = new URL(process.env.MCP_URL ?? `http://127.0.0.1:${config.PORT}/mcp`);
assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp');
const { admin } = developmentAdmin(new URL(config.SUPABASE_URL).hostname.split('.')[0]!);
const marker = `SYNTHETIC Phase1 ${randomUUID()}`;
const connections: Client[] = [];
const exercised = new Set<ToolName>();
const conflictDurations: number[] = [];
let clientId: string | undefined;
let propertyId: string | undefined;
type Output<N extends ToolName> = z.infer<(typeof TOOL_CONTRACTS)[N]['outputSchema']>;
async function connect() {
  const connection = new Client({ name: 'realtor-phase1-synthetic-acceptance', version: '1' });
  connections.push(connection);
  await connection.connect(new StreamableHTTPClientTransport(url));
  verifyToolDiscovery((await connection.listTools()).tools);
  return connection;
}
async function call<N extends ToolName>(connection: Client, name: N, args: Record<string, unknown>): Promise<Output<N>> {
  const result = await connection.callTool({ name, arguments: args });
  assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  const parsed = TOOL_CONTRACTS[name].outputSchema.parse(result.structuredContent);
  assert(!JSON.stringify(parsed).includes('workspace_id'));
  exercised.add(name);
  return parsed as Output<N>;
}
async function conflict(connection: Client, name: ToolName, args: Record<string, unknown>) {
  const started = performance.now();
  const result = await connection.callTool({ name, arguments: args }, { timeout: 10_000 });
  assert(result.isError, `${name} must reject a conflicting request`);
  assert(JSON.stringify(result.content).includes('CONFLICT'));
  conflictDurations.push(Math.round(performance.now() - started));
}
try {
  const first = await connect();
  const created = await call(first, 'create_client', {
    display_name: marker, email: 'phase1@example.invalid', notes: 'Synthetic acceptance fixture; safe to remove',
    facts: [
      { category: 'requirement', key: 'budget_max', value: { amount: 4000000, currency: 'MXN' }, valid_from: '2026-10-06T12:00:00-05:00' },
      { category: 'requirement', key: 'bedrooms_min', value: 2 },
      { category: 'context', key: 'intended_use', value: 'investment' },
      { category: 'preference', key: 'preferred_area', value: 'Coco Beach' },
    ],
  });
  clientId = created.client.id;
  const found = await call(first, 'find_clients', { name: marker });
  assert.equal(found.has_more, false);
  assert.deepEqual(found.clients.map(c => c.id), [clientId]);
  const initial = await call(first, 'get_client_context', { client_id: clientId });
  const oldBudget = initial.requirements.find(f => f.key === 'budget_max')!;
  await call(first, 'remember_client_fact', { client_id: clientId,
    fact: { category: 'preference', key: 'outdoor_space', value: true, strength: 'soft' } });
  const before = await call(first, 'get_client_context', { client_id: clientId });
  const request = {
    client_id: clientId, expected_version: before.client.memory_version, idempotency_key: randomUUID(),
    interaction_type: 'call', occurred_at: '2026-10-07T13:00:00-05:00', channel: 'phone', direction: 'inbound',
    summary: 'SYNTHETIC John changed budget to 3.2M MXN, excludes preconstruction, wants two completed apartments Friday.',
    content: 'Synthetic transcript intentionally excluded from compact retrieval.', source_ref: 'Synthetic acceptance phone conversation',
    facts: [
      { category: 'requirement', key: 'budget_max', value: { amount: 3200000, currency: 'MXN' }, expected_fact_id: oldBudget.id },
      { category: 'constraint', key: 'preconstruction', value: false, strength: 'hard' },
    ],
    follow_ups: [{ title: 'SYNTHETIC Send two completed apartments', due_date: '2026-10-09' }],
  };
  const recorded = await call(first, 'record_interaction', request);
  assert.equal(recorded.replayed, false);
  assert.equal(recorded.follow_ups[0]?.interaction_id, recorded.interaction_id);
  assert.equal(recorded.follow_ups[0]?.due_date, '2026-10-09');
  assert.equal(recorded.follow_ups[0]?.due_at, null);
  assert(recorded.facts.every(f => f.source_interaction_id === recorded.interaction_id));
  assert(recorded.facts.every(f => f.valid_from !== null && Date.parse(f.valid_from) === Date.parse(request.occurred_at)));
  assert(recorded.facts.every(f => f.strength === 'hard'));
  const replay = await call(first, 'record_interaction', request);
  assert.deepEqual(replay, { ...recorded, replayed: true });
  await conflict(first, 'record_interaction', { ...request, summary: 'Changed payload with reused key' });
  await conflict(first, 'record_interaction', { ...request, idempotency_key: randomUUID() });

  const patch = { client_id: clientId, expected_version: recorded.client.memory_version,
    idempotency_key: randomUUID(), patch: { phone: 'SYNTHETIC-no-phone', email: null, status: 'active' }, source_ref: 'Synthetic profile correction' };
  const updated = await call(first, 'update_client', patch);
  assert.equal(updated.client.email, null);
  assert.equal(updated.client.phone, 'SYNTHETIC-no-phone');
  assert.equal(updated.client.notes, created.client.notes);
  assert.deepEqual(await call(first, 'update_client', patch), { ...updated, replayed: true });
  const changed = await call(first, 'record_interaction', {
    client_id: clientId, expected_version: updated.client.memory_version, idempotency_key: randomUUID(),
    interaction_type: 'message', occurred_at: '2026-10-08T09:00:00-05:00', direction: 'inbound',
    summary: 'SYNTHETIC Prefiere Centro; fecha de llegada desconocida; sin límite de dormitorios máximos.',
    source_ref: 'Synthetic multilingual preference change', facts: [
      { category: 'preference', key: 'preferred_area', value: ['Centro', 'Calle 38'], strength: 'soft' },
      { category: 'context', key: 'arrival_date', value: { state: 'unknown' } },
      { category: 'requirement', key: 'bedrooms_max', value: { state: 'unrestricted' } },
    ],
  });
  assert(changed.client.memory_version > updated.client.memory_version);
  assert.deepEqual(await call(first, 'record_interaction', request), { ...recorded, replayed: true });
  const beforeFailure = await call(first, 'get_client_context', { client_id: clientId });
  const rollbackRequest = {
    client_id: clientId, expected_version: beforeFailure.client.memory_version, idempotency_key: randomUUID(),
    interaction_type: 'note', occurred_at: '2026-10-05T12:00:00-05:00', summary: 'SYNTHETIC late information must roll back',
    facts: [
      { category: 'context', key: 'must_rollback', value: true },
      { category: 'requirement', key: 'budget_max', value: { amount: 1, currency: 'MXN' } },
    ], follow_ups: [{ title: 'SYNTHETIC must not exist' }],
  };
  await conflict(first, 'record_interaction', rollbackRequest);
  assert.deepEqual(await call(first, 'get_client_context', { client_id: clientId }), beforeFailure);

  const saved = await call(first, 'save_property', { title: `${marker} apartment`, asking_price: 3000000,
    currency: 'MXN', bedrooms: 2, construction_status: 'completed', source: {
      source_name: 'Synthetic source', url: 'https://example.invalid/phase1', external_id: marker,
      listing_price: 3000000, currency: 'MXN', availability_status: 'available',
    } });
  propertyId = saved.property.id;
  for (const status of ['considering', 'liked', 'rejected']) {
    await call(first, 'update_client_property', { client_id: clientId, property_id: propertyId, status,
      ...(status === 'liked' ? { notes: 'SYNTHETIC likes location' } : {}),
      ...(status === 'rejected' ? { rejection_reason: 'SYNTHETIC HOA too high' } : {}) });
  }
  await first.close();
  const fresh = await connect();
  const recalled = await call(fresh, 'get_client_context', { client_id: clientId });
  assert.deepEqual(recalled.requirements.find(f => f.key === 'budget_max')?.value, { amount: 3200000, currency: 'MXN' });
  assert.equal(recalled.requirements.find(f => f.key === 'bedrooms_min')?.value, 2);
  assert.equal(recalled.context.find(f => f.key === 'intended_use')?.value, 'investment');
  assert.deepEqual(recalled.preferences.find(f => f.key === 'preferred_area')?.value, ['Centro', 'Calle 38']);
  assert.equal(recalled.preferences.find(f => f.key === 'outdoor_space')?.value, true);
  assert.equal(recalled.constraints.find(f => f.key === 'preconstruction')?.value, false);
  assert.deepEqual(recalled.context.find(f => f.key === 'arrival_date')?.value, { state: 'unknown' });
  assert.deepEqual(recalled.requirements.find(f => f.key === 'bedrooms_max')?.value, { state: 'unrestricted' });
  assert.equal(recalled.open_tasks.length, 1);
  const propertyContext = await call(fresh, 'get_property_context', { property_id: propertyId });
  assert.equal(propertyContext.property?.id, propertyId);
  assert.equal(propertyContext.sources?.[0]?.availability_verified, false);
  const relationship = await call(fresh, 'get_client_property_history', { client_id: clientId, property_id: propertyId });
  assert.deepEqual(relationship.timeline.map(e => e.status), ['considering', 'liked', 'rejected']);

  const timeline: Output<'get_client_history'>['timeline'] = [];
  let cursor: NonNullable<Output<'get_client_history'>['coverage']['next_cursor']> | undefined;
  let pages = 0;
  do {
    assert(++pages <= 30, 'history must terminate within the fixture bound');
    const page: Output<'get_client_history'> = await call(fresh, 'get_client_history', { client_id: clientId, limit: 3, ...(cursor ? { cursor } : {}) });
    assert(page.timeline.length <= 3);
    timeline.unshift(...page.timeline);
    assert.equal(page.coverage.has_more, page.coverage.next_cursor !== null);
    cursor = page.coverage.next_cursor ?? undefined;
  } while (cursor);
  assert(pages > 1);
  assert.equal(new Set(timeline.map(e => `${e.kind}:${e.id}`)).size, timeline.length);
  const full = await call(fresh, 'get_client_history', { client_id: clientId, limit: 50 });
  assert.equal(full.coverage.has_more, false);
  assert.deepEqual(timeline, full.timeline);
  assert.deepEqual([...new Set(timeline.map(e => e.kind))].sort(), ['client', 'fact', 'interaction', 'property_event', 'task']);
  const originalBudget = timeline.find(e => e.id === oldBudget.id)!;
  assert.equal((originalBudget.data as { status: string }).status, 'superseded');
  assert.deepEqual((originalBudget.data as { value_json: unknown }).value_json, { amount: 4000000, currency: 'MXN' });
  assert.equal((originalBudget.data as { superseded_by_id: string }).superseded_by_id, recorded.facts.find(f => f.key === 'budget_max')?.id);
  const profileEvent = timeline.find(e => (e.data as { interaction_type?: string }).interaction_type === 'profile_change')!;
  assert.equal(profileEvent.source_ref, patch.source_ref);
  assert(!JSON.stringify(timeline).includes('Synthetic transcript intentionally'));
  assert(!JSON.stringify(timeline).includes('request_payload'));
  const receipt = await admin.from('interactions').select('id').eq('workspace_id', config.DEV_WORKSPACE_ID)
    .eq('client_id', clientId).eq('request_key', rollbackRequest.idempotency_key);
  assert.equal(receipt.error, null); assert.equal(receipt.data?.length, 0);
  assert.deepEqual([...exercised].sort(), Object.keys(TOOL_CONTRACTS).sort());
  console.log(JSON.stringify({ endpoint: url.href, tools: exercised.size, fresh_connections: 2,
    history_entries: timeline.length, history_pages: pages, conflict_response_ms: conflictDurations,
    checks: 'preferences, profile audit, attribution, date-only follow-up, idempotency, conflicts, atomic rollback, property history, independent recall' }));
} finally {
  await Promise.allSettled(connections.map(connection => connection.close()));
  // Exact generated IDs plus configured workspace and marker protect business rows.
  // Also find by the unique marker if a creation response was lost in transport.
  for (const [table, id] of [['clients', clientId], ['properties', propertyId]] as const) {
    let query = table === 'clients'
      ? admin.from('clients').delete().eq('workspace_id', config.DEV_WORKSPACE_ID).eq('display_name', marker)
      : admin.from('properties').delete().eq('workspace_id', config.DEV_WORKSPACE_ID).eq('title', `${marker} apartment`);
    if (id) query = query.eq('id', id);
    const result = await query;
    assert.equal(result.error, null, `synthetic ${table} cleanup`);
    const remaining = table === 'clients'
      ? await admin.from('clients').select('id').eq('workspace_id', config.DEV_WORKSPACE_ID).eq('display_name', marker)
      : await admin.from('properties').select('id').eq('workspace_id', config.DEV_WORKSPACE_ID).eq('title', `${marker} apartment`);
    assert.equal(remaining.error, null); assert.equal(remaining.data?.length, 0);
  }
  console.log('PASS: exact synthetic fixtures removed; business fixtures were never targeted.');
}
