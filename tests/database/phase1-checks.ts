import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { SupabaseClientRepository } from '../../src/data/supabase-client-repository.js';
import { RealtorClientService } from '../../src/application/client-service.js';
import { RealtorPropertyService } from '../../src/application/property-service.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { verifyToolDiscovery } from '../../src/mcp/tool-contracts.js';
import type { ApplicationContext } from '../../src/infrastructure/identity.js';
import type { PropertyRepository } from '../../src/application/property-contracts.js';

// These IDs exist only in the native disposable cluster. No .env, admin API,
// production service or configured Supabase project is used by these checks.
const workspace = '20000000-0000-4000-8000-000000000001';
const foreignWorkspace = '20000000-0000-4000-8000-000000000002';
const forbiddenWorkspace = '20000000-0000-4000-8000-000000000003';
const clientId = '30000000-0000-4000-8000-000000000004';
const foreignClient = '30000000-0000-4000-8000-000000000002';
const user = '10000000-0000-4000-8000-000000000001';
const literal = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const authenticated = (query: string) => `begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${query}; commit;`;

export async function testPhase1Memory(t: TestContext, sql: (query: string) => string, run: (query: string) => Promise<string>) {
  const read = (query: string) => JSON.parse(sql(authenticated(query)));
  const write = (operation: string, payload: object, workspaceId = workspace, id = clientId) => read(
    `select public.write_client_memory('${workspaceId}','${id}','${operation}',${literal(payload)})`);
  const version = () => Number(sql(`select memory_version from public.clients where id='${clientId}'`));
  const history = (limit = 50, cursor: object | null = null, workspaceId = workspace, id = clientId) => read(
    `select public.get_client_history('${workspaceId}','${id}',${limit},${cursor ? literal(cursor) : 'null'})`);
  const snapshot = () => sql(`select jsonb_build_object(
    'client',(select to_jsonb(c) from public.clients c where id='${clientId}'),
    'facts',(select jsonb_agg(to_jsonb(f) order by id) from public.client_facts f where client_id='${clientId}'),
    'interactions',(select jsonb_agg(to_jsonb(i) order by id) from public.interactions i where client_id='${clientId}'),
    'tasks',(select jsonb_agg(to_jsonb(t) order by id) from public.tasks t where client_id='${clientId}'))`);
  let conversationMinute = 0;
  const call = (key: string, expected_version = version()) => ({ client_id: clientId, expected_version, idempotency_key: key,
    interaction_type: 'call', occurred_at: `2026-10-07T13:${String(conversationMinute++).padStart(2, '0')}:00-05:00`,
    summary: 'I spoke with John today. He increased his budget to 3.2M MXN, no longer wants preconstruction, and asked me to send him two completed apartments on Friday.',
    source_ref: 'agent phone conversation',
    facts: [
      { category: 'requirement', key: 'budget_max', value: { amount: 3200000, currency: 'MXN' }, strength: 'hard' },
      { category: 'constraint', key: 'preconstruction', value: false, strength: 'hard' },
    ],
    follow_ups: [{ title: 'Send two completed apartments', due_date: '2026-10-09', priority: 'high' }],
  });
  sql(`insert into public.clients(id,workspace_id,display_name,email,notes,created_at) values
    ('${clientId}','${workspace}','Phase 1 isolated John','fixture@example.invalid','Preserve these notes','2026-10-01T10:00:00Z')`);
  for (const fact of [
    { category: 'requirement', key: 'budget_max', value: { amount: 2800000, currency: 'MXN' } },
    { category: 'preference', key: 'preconstruction', value: true },
    { category: 'requirement', key: 'bedrooms_min', value: 2 },
    { category: 'preference', key: 'preferred_area', value: 'Coco Beach' },
  ]) read(`select to_jsonb(public.remember_client_fact('${workspace}','${clientId}',${literal({ ...fact, valid_from: '2026-10-01T10:00:00Z' })}))`);
  let request = call('acceptance');
  let accepted: ReturnType<typeof write>;

  await t.test('acceptance: one interaction, two changes, one task, unrelated knowledge and provenance retained', () => {
    accepted = write('record_interaction', request);
    assert.equal(accepted.facts.length, 2);
    assert.equal(accepted.follow_ups.length, 1);
    assert.equal(accepted.replayed, false);
    assert.equal(sql(`select count(*) from public.interactions where client_id='${clientId}'`), '1');
    assert.equal(sql(`select value_json from public.client_facts where client_id='${clientId}' and key='bedrooms_min' and status='current'`), '2');
    assert.equal(sql(`select value_json from public.client_facts where client_id='${clientId}' and key='preferred_area' and status='current'`), '"Coco Beach"');
    assert.equal(sql(`select notes from public.clients where id='${clientId}'`), 'Preserve these notes');
    for (const fact of accepted.facts) {
      assert.equal(fact.source_interaction_id, accepted.interaction_id);
      assert.equal(fact.source_type, 'interaction');
      assert.equal(fact.source_ref, 'agent phone conversation');
      assert.equal(fact.created_by, user);
      assert.equal(new Date(fact.valid_from).toISOString(), '2026-10-07T18:00:00.000Z');
      assert(new Date(fact.created_at) > new Date(fact.valid_from));
    }
    assert.equal(accepted.follow_ups[0].interaction_id, accepted.interaction_id);
    assert.equal(accepted.follow_ups[0].due_date, '2026-10-09');
    assert.equal(accepted.follow_ups[0].due_at, null);
    const old = history().timeline.filter((e: any) => e.kind === 'fact' && e.data.status === 'superseded');
    assert.equal(old.length, 2);
    assert(old.some((e: any) => e.data.value_json.amount === 2800000));
    assert(old.every((e: any) => accepted.facts.some((f: any) => f.id === e.data.superseded_by_id)));
    assert.equal(history().timeline.find((e: any) => e.kind === 'task').source_ref, 'agent phone conversation');
  });

  await t.test('identical retries replay the original result even after later writes; key reuse conflicts', () => {
    const before = snapshot();
    const retry = write('record_interaction', request);
    assert.deepEqual(retry, { ...accepted, replayed: true });
    assert.equal(snapshot(), before);
    assert.throws(() => write('record_interaction', { ...request, summary: 'Different request' }), /40001|Idempotency key/);
    assert.equal(snapshot(), before);
  });

  await t.test('invalid last fact or task rolls back interaction, all facts, version and receipt', () => {
    const before = snapshot();
    const invalidTask = { ...call('rollback-task'), follow_ups: [{ title: 'First valid follow-up' }, { title: 'Fails late', priority: 'invalid' }] };
    assert.throws(() => write('record_interaction', invalidTask), /priority|check constraint/);
    assert.equal(snapshot(), before);
    const invalidFact = { ...call('rollback-fact'), facts: [call('unused').facts[0], { category: 'requirement', key: 'bedrooms_min', value: -1 }] };
    assert.throws(() => write('record_interaction', invalidFact), /Bedrooms/);
    assert.equal(snapshot(), before);
    const recovered = write('record_interaction', { ...invalidTask, follow_ups: [{ title: 'Recovered' }] });
    assert.equal(recovered.replayed, false);
    assert.deepEqual(write('record_interaction', request), { ...accepted, replayed: true });
  });

  await t.test('stale client versions and changed fact IDs reject the entire write', () => {
    const before = snapshot();
    assert.throws(() => write('record_interaction', call('stale', request.expected_version)), /changed since it was read/);
    assert.throws(() => write('record_interaction', { ...call('stale-fact'), facts: [{ ...call('unused').facts[0], expected_fact_id: accepted.facts[0].id }] }), /Fact changed/);
    assert.equal(snapshot(), before);
  });

  await t.test('late information conflicts until explicitly corrected; original values/times remain immutable', () => {
    const current = read(`select to_jsonb(f) from public.client_facts f where client_id='${clientId}' and key='budget_max' and status='current'`);
    const olderFact = { category: 'requirement', key: 'budget_max', value: { amount: 3100000, currency: 'MXN' }, valid_from: '2026-10-02T12:00:00Z', source_ref: 'Correction: amount was misheard' };
    const before = snapshot();
    assert.throws(() => write('record_interaction', { ...call('late'), facts: [olderFact], follow_ups: [] }), /Older.*information/);
    assert.equal(snapshot(), before);
    const corrected = write('record_interaction', { ...call('correction'), facts: [{ ...olderFact, expected_fact_id: current.id }], follow_ups: [] });
    assert.equal(new Date(corrected.facts[0].valid_from).toISOString(), '2026-10-02T12:00:00.000Z');
    const prior = read(`select to_jsonb(f) from public.client_facts f where id='${current.id}'`);
    assert.deepEqual(prior, { ...current, status: 'superseded', superseded_by_id: corrected.facts[0].id });
    assert.throws(() => sql(authenticated(`update public.client_facts set value_json='false' where id='${current.id}'`)), /permission denied/);
  });

  await t.test('unknown, false, unrestricted, custom keys and multilingual summaries survive round-trip', () => {
    const result = write('record_interaction', { ...call('multilingual'), interaction_type: 'message', channel: 'WhatsApp',
      summary: 'Hablé con John: ya no quiere preventa. Prefiere Playa del Carmen. שוחחנו על תקציב. 不要期房。',
      facts: [
        { category: 'requirement', key: 'budget_min', value: { state: 'unknown' } },
        { category: 'preference', key: 'excluded_areas', value: { state: 'unrestricted' }, strength: 'soft' },
        { category: 'constraint', key: 'preconstruction', value: false, strength: 'hard' },
        { category: 'other', key: 'custom_language', value: ['Español', 'עברית', '中文'] },
      ], follow_ups: [{ title: 'Enviar dos departamentos terminados el viernes' }] });
    assert.equal(result.facts[0].value_json.state, 'unknown');
    assert.equal(result.facts[1].value_json.state, 'unrestricted');
    assert.equal(result.facts[2].value_json, false);
    assert.equal(result.facts[1].strength, 'soft');
    const event = history().timeline.find((e: any) => e.id === result.interaction_id);
    assert(event.data.summary.includes('שוחחנו'));
    assert(event.data.summary.includes('不要期房'));
  });

  await t.test('profile patches preserve omitted fields, explicitly clear nulls and audit before/after', () => {
    const patch = { client_id: clientId, expected_version: version(), idempotency_key: 'profile', patch: { status: 'active', phone: '+52 555 0100', notes: null }, source_ref: 'Client confirmation' };
    const result = write('update_client', patch);
    assert.equal(result.client.status, 'active');
    assert.equal(result.client.email, 'fixture@example.invalid');
    assert.equal(result.client.notes, null);
    const event = history().timeline.find((e: any) => e.kind === 'interaction' && e.data.interaction_type === 'profile_change');
    assert.equal(event.data.metadata.before.notes, 'Preserve these notes');
    assert.equal(event.data.metadata.after.notes, null);
    assert.equal(event.source_ref, 'Client confirmation');
    const before = snapshot();
    assert.deepEqual(write('update_client', patch), { ...result, replayed: true });
    assert.equal(snapshot(), before);
    assert.throws(() => write('update_client', { ...patch, idempotency_key: 'stale-profile' }), /changed since it was read/);
    assert.throws(() => write('update_client', { ...patch, expected_version: version(), idempotency_key: 'unknown-profile', patch: { workspace_id: foreignWorkspace } }), /Invalid client patch/);
    assert.equal(snapshot(), before);
  });

  await t.test('workspace isolation holds even for a user who belongs to both workspaces', () => {
    const before = snapshot();
    assert.throws(() => history(30, null, foreignWorkspace, clientId), /Client not found/);
    assert.throws(() => history(30, null, workspace, foreignClient), /Client not found/);
    assert.throws(() => history(30, null, forbiddenWorkspace), /Workspace access denied/);
    assert.throws(() => write('record_interaction', call('foreign'), foreignWorkspace), /Client not found/);
    assert.throws(() => write('update_client', { expected_version: version(), idempotency_key: 'foreign-profile', patch: { status: 'lost' } }, foreignWorkspace), /Client not found/);
    assert.throws(() => read(`select to_jsonb(public.remember_client_fact('${workspace}','${clientId}',${literal({ category: 'context', key: 'foreign_source', value: true, source_interaction_id: '40000000-0000-4000-8000-000000000002' })}))`), /Source interaction/);
    assert.throws(() => read(`select public.write_client_memory('${workspace}','${clientId}','record_interaction',${literal({ ...call('inject-workspace'), workspace_id: foreignWorkspace })})`), /Invalid interaction/);
    assert.equal(snapshot(), before);
    assert.throws(() => sql(`begin; set local role anon; select public.get_client_history('${workspace}','${clientId}'); commit;`), /permission denied/);
  });

  await t.test('no-op profile patches retain a retry receipt without new profile changes or version increments', () => {
    const current = read(`select to_jsonb(c) from public.clients c where id='${clientId}'`);
    const beforeHistory = history();
    const request = { client_id: clientId, expected_version: current.memory_version, idempotency_key: 'noop-profile', patch: { status: current.status } };
    const result = write('update_client', request);
    assert.equal(result.client.memory_version, current.memory_version);
    assert.deepEqual(history(), beforeHistory);
    assert.deepEqual(write('update_client', request), { ...result, replayed: true });
  });

  await t.test('an explicit missing-fact expectation rejects replacing an existing fact', () => {
    const before = snapshot();
    assert.throws(() => write('record_interaction', { ...call('expected-absent'), facts: [{ ...call('unused').facts[0], expected_fact_id: null }], follow_ups: [] }), /Fact changed/);
    assert.equal(snapshot(), before);
  });

  await t.test('keyset pagination has no gaps or duplicates with equal timestamps and mixed entry kinds', () => {
    const all = history().timeline;
    const collected: any[] = [];
    let cursor: object | null = null;
    for (let pages = 0; pages < 30; pages++) {
      const page = history(3, cursor);
      collected.unshift(...page.timeline);
      assert(page.timeline.length <= 3);
      if (!page.coverage.has_more) { assert.equal(page.coverage.next_cursor, null); break; }
      assert(page.coverage.next_cursor);
      cursor = page.coverage.next_cursor;
    }
    assert.deepEqual(collected, all);
    assert.equal(new Set(collected.map(e => `${e.kind}:${e.id}`)).size, all.length);
    assert(collected.some(e => e.kind === 'client'));
    assert(collected.some(e => e.kind === 'task'));
    assert.throws(() => history(0), /Invalid history page/);
    assert.throws(() => history(30, { id: clientId, kind: 'wrong', recorded_at: '2026-10-07T12:00:00Z' }), /Invalid history page/);
  });

  await t.test('concurrent requests serialize: one conflicting writer succeeds, identical retries create one interaction', async () => {
    const base = version();
    const concurrent = (payload: object) => run(authenticated(`select public.write_client_memory('${workspace}','${clientId}','record_interaction',${literal(payload)})`));
    const payload = { ...call('parallel-idempotency', base), facts: [], follow_ups: [] };
    const results = await Promise.all([concurrent(payload), concurrent(payload)]);
    assert.deepEqual(results.map(r => JSON.parse(r).replayed).sort(), [false, true]);
    assert.equal(sql(`select count(*) from public.interactions where client_id='${clientId}' and request_key='parallel-idempotency'`), '1');
    const updated = version();
    const outcomes = await Promise.allSettled(['parallel-a','parallel-b'].map(key => concurrent({ ...call(key, updated), facts: [], follow_ups: [] })));
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(r => r.status === 'rejected').length, 1);
    // Legacy first writes keep working with the new parent lock/version trigger.
    await Promise.all([1,2,3,4].map(value => run(authenticated(`select to_jsonb(public.remember_client_fact('${workspace}','${clientId}',
      ${literal({ category: 'context', key: 'legacy_concurrent', value })}))`))));
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${clientId}' and key='legacy_concurrent' and status='current'`), '1');
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${clientId}' and key='legacy_concurrent' and status='superseded' and superseded_by_id is not null`), '3');
  });

  await t.test('interaction history and receipts cannot be changed or left incomplete', () => {
    assert.throws(() => sql(authenticated(`update public.interactions set summary='Erased history' where id='${accepted.interaction_id}'`)), /permission denied/);
    assert.equal(sql(authenticated(`update public.interactions set response_json='{}' where id='${accepted.interaction_id}' returning id`)), '');
    assert.throws(() => sql(authenticated(`delete from public.interactions where id='${accepted.interaction_id}'`)), /permission denied/);
    assert.throws(() => sql(authenticated(`insert into public.interactions(workspace_id,client_id,created_by,request_key,request_payload) values
      ('${workspace}','${clientId}','${user}','incomplete','{}')`)), /must be complete/);
  });

  await t.test('MCP records and independently recalls persistent memory with production RPC repository and eleven contracts', async () => {
    // Only the Supabase transport is substituted: RPCs execute in the disposable
    // database as authenticated, with the production repository/error mapping.
    // Each HTTP request constructs a fresh service, just like the real server.
    const supabase = { rpc: async (name: string, args: Record<string, any>) => {
      try {
        const query = name === 'write_client_memory'
          ? `select public.write_client_memory('${args.p_workspace_id}','${args.p_client_id}','${args.p_operation}',${literal(args.p_request)})`
          : `select public.get_client_history('${args.p_workspace_id}','${args.p_client_id}',${args.p_limit},${args.p_cursor ? literal(args.p_cursor) : 'null'})`;
        return { data: JSON.parse(await run(authenticated(query))), error: null };
      } catch (error: any) {
        const message = String(error.stderr ?? error.message);
        const code = /changed since|Idempotency|Fact changed|Older information/.test(message) ? 'PT409'
          : /Client not found/.test(message) ? 'P0002' : /Workspace access denied/.test(message) ? '42501' : '22023';
        return { data: null, error: { code, message } };
      }
    } };
    const server = createServer(async (req, res) => {
      const repository = new SupabaseClientRepository({ workspaceId: workspace, supabase } as unknown as ApplicationContext);
      const mcp = createMcpServer(new RealtorClientService(repository), new RealtorPropertyService({} as PropertyRepository));
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      res.once('close', () => { void mcp.close(); });
      await transport.handleRequest(req, res);
    });
    const first = new Client({ name: 'phase1-conversation-A', version: '1' });
    const second = new Client({ name: 'phase1-independent-conversation-B', version: '1' });
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert(address && typeof address !== 'string');
      const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
      await first.connect(new StreamableHTTPClientTransport(url));
      const { tools } = await first.listTools(); verifyToolDiscovery(tools);
      const payload = { ...call('mcp-conversation'), facts: [], follow_ups: [{ title: 'Enviar dos apartamentos terminados' }] };
      const recorded = await first.callTool({ name: 'record_interaction', arguments: payload });
      assert(!recorded.isError, JSON.stringify(recorded.content));
      const saved = recorded.structuredContent as any;
      const replay = await first.callTool({ name: 'record_interaction', arguments: payload });
      assert.deepEqual(replay.structuredContent, { ...saved, replayed: true });
      const conflict = await first.callTool({ name: 'record_interaction', arguments: { ...payload, idempotency_key: 'mcp-stale' } });
      assert(conflict.isError);
      assert.equal(JSON.parse((conflict.content[0] as { text: string }).text).error.code, 'CONFLICT');
      const named = await first.callTool({ name: 'record_interaction', arguments: { ...payload, client_id: 'John' } });
      assert(named.isError);
      await first.close();
      await second.connect(new StreamableHTTPClientTransport(url));
      const recalled = await second.callTool({ name: 'get_client_history', arguments: { client_id: clientId, limit: 50 } });
      assert(!recalled.isError, JSON.stringify(recalled.content));
      const timeline = (recalled.structuredContent as any).timeline;
      assert(timeline.some((e: any) => e.id === saved.interaction_id));
      assert(timeline.some((e: any) => e.id === saved.follow_ups[0].id));
      assert(timeline.some((e: any) => e.data.value_json?.amount === 2800000 && e.data.status === 'superseded'));
      assert(!JSON.stringify(recalled.structuredContent).includes('workspace_id'));
    } finally {
      await first.close(); await second.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
