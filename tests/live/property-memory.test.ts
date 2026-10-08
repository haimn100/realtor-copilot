import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createClient } from '@supabase/supabase-js';
import { developmentAdmin } from '../../scripts/dev-admin.js';
import { loadConfig } from '../../src/infrastructure/config.js';
import { DevelopmentIdentityProvider } from '../../src/infrastructure/identity.js';
import { createHttpServer } from '../../src/infrastructure/http-server.js';
import type { Database } from '../../src/data/database.types.js';
import type { ClientContext } from '../../src/application/client-service.js';
import type { RealtorPropertyService } from '../../src/application/property-service.js';

type Saved = Awaited<ReturnType<RealtorPropertyService['saveProperty']>>;
type History = Awaited<ReturnType<RealtorPropertyService['getClientPropertyHistory']>>;
type PropertyContext = Exclude<Awaited<ReturnType<RealtorPropertyService['getPropertyContext']>>, { ambiguous: true }>;
function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  assert.equal(result.error, null); assert.notEqual(result.data, null); return result.data as NonNullable<T>;
}
test('live property memory, history and workspace security over MCP', { timeout: 120_000 }, async t => {
  const config = loadConfig();
  const { admin } = developmentAdmin(new URL(config.SUPABASE_URL).hostname.split('.')[0]!);
  const identity = new DevelopmentIdentityProvider(config);
  const workspaces: string[] = [];
  const client = new Client({ name: 'property-memory-live-test', version: '1' });
  let server: ReturnType<typeof createHttpServer> | undefined;
  try {
    await identity.initialize();
    const original = await identity.resolve({} as IncomingMessage);
    for (const label of ['property-A', 'property-B', 'property-forbidden']) {
      workspaces.push(must(await admin.from('workspaces').insert({ name: `${label}-${randomUUID()}` }).select('id').single()).id);
    }
    const [workspaceA, workspaceB, forbidden] = workspaces as [string, string, string];
    must(await admin.from('workspace_members').insert([workspaceA, workspaceB].map(workspace_id => ({ workspace_id, user_id: original.userId, role: 'agent' }))).select('workspace_id'));
    const context = { ...original, workspaceId: workspaceA }, db = context.supabase;
    server = createHttpServer({ resolve: async () => context });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert(address && typeof address !== 'string');
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    await client.connect(new StreamableHTTPClientTransport(url));
    async function call<T>(name: string, args: Record<string, unknown>, connection = client): Promise<T> {
      const result = await connection.callTool({ name, arguments: args });
      assert(!result.isError, JSON.stringify(result.content)); assert(result.structuredContent);
      assert(!JSON.stringify(result.structuredContent).includes('workspace_id'));
      return result.structuredContent as T;
    }
    async function denied(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      assert(result.isError, `${name} must reject foreign workspace IDs`);
      assert(JSON.stringify(result.content).includes('NOT_FOUND'));
    }
    const john = await call<{ client: { id: string } }>('create_client', { display_name: 'John' });
    const clientId = john.client.id;
    let propertyId = '';
    await t.test('saves canonical structured details without inventing availability', async () => {
      const saved = await call<Saved>('save_property', { title: 'Marbella Residence unit 104', development_name: 'Marbella Residence',
        property_type: 'condo', neighborhood: 'Coco Beach', address: 'Unit 104', bedrooms: 2, bathrooms: 2.5,
        interior_m2: 90, exterior_m2: 12, total_m2: 102, asking_price: 3800000, currency: 'MXN',
        construction_status: 'completed', delivery_date: '2026-10-07', notes: 'Meaningful saved option' });
      propertyId = saved.property.id;
      assert.equal(saved.property.asking_price, 3800000); assert.equal(saved.property.bathrooms, 2.5);
      assert.equal(saved.property.total_m2, 102); assert.equal(saved.source, null);
      assert.equal(saved.property.availability_status, 'unknown'); assert.equal(saved.property.availability_verified, false);
      const row = must(await db.from('properties').select('title,created_by').eq('workspace_id', workspaceA).eq('id', propertyId).single());
      assert.equal(row.created_by, context.userId);
    });
    await t.test('creates property and source atomically; access and listing update remain separate', async () => {
      const saved = await call<Saved>('save_property', { title: 'Source fixture', source: { source_name: 'Broker A', external_id: 'A-104',
        url: 'https://example.com/listing/104', listing_price: 3900000, currency: 'MXN',
        listing_updated_at: '2026-10-01T12:00:00Z', accessed_at: '2026-10-07T12:00:00Z', availability_status: 'available' } });
      assert.equal(saved.source?.asking_price, 3900000);
      assert.equal(Date.parse(saved.source!.accessed_at), Date.parse('2026-10-07T12:00:00Z'));
      assert.equal(Date.parse(saved.source!.listing_updated_at!), Date.parse('2026-10-01T12:00:00Z'));
      assert.equal(saved.source?.availability_verified, false); assert.equal(saved.source?.availability_verified_at, null);
      assert.equal(saved.property.availability_status, 'unknown');
      const added = await call<Saved>('save_property', { property_id: propertyId, source: { source_name: 'Broker B', url: 'https://example.com/b/104' } });
      assert.equal(added.property.id, propertyId); assert.equal(added.source?.listing_updated_at, null);
      assert(added.source?.accessed_at); assert.equal(added.source?.availability_verified, false);
      const verified = await call<Saved>('save_property', { property_id: propertyId, source: { source_name: 'Developer', external_id: 'DEV-104',
        availability_status: 'reserved', availability_verified: true, availability_verified_at: '2026-10-06T12:00:00Z', accessed_at: '2026-10-07T12:00:00Z' } });
      assert.equal(verified.source?.availability_verified, true);
      assert.equal(Date.parse(verified.source!.availability_verified_at!), Date.parse('2026-10-06T12:00:00Z'));
      assert.equal(verified.property.availability_status, 'unknown', 'source is not canonical availability');
      const rollbackTitle = `source-rollback-${randomUUID()}`;
      const duplicate = await db.rpc('save_property', { p_workspace_id: workspaceA, p_property: { title: rollbackTitle }, p_source: { source_name: 'Broker A', external_id: 'A-104' } });
      assert.equal(duplicate.error?.code, '23505');
      assert.equal(must(await admin.from('properties').select('id').eq('workspace_id', workspaceA).eq('title', rollbackTitle)).length, 0);
      const updateRollback = await db.rpc('save_property', { p_workspace_id: workspaceA, p_property_id: propertyId,
        p_property: { title: 'SHOULD ROLL BACK' }, p_source: { source_name: 'Broker A', external_id: 'A-104' } });
      assert(updateRollback.error);
      assert.equal(must(await db.from('properties').select('title').eq('id', propertyId).single()).title, 'Marbella Residence unit 104');
    });
    await t.test('considering → sent → liked → rejected preserves reactions and rejection reason', async () => {
      const args = { client_id: clientId, property_id: propertyId };
      for (const status of ['considering', 'sent']) await call('update_client_property', { ...args, status });
      await call('update_client_property', { ...args, status: 'liked', interest_level: 'high', notes: 'John likes the location.' });
      await call('update_client_property', { ...args, status: 'rejected', interest_level: 'low', rejection_reason: 'HOA too high' });
      const history = await call<History>('get_client_property_history', args);
      assert.deepEqual(history.timeline.map(e => e.status), ['considering', 'sent', 'liked', 'rejected']);
      assert.equal(history.timeline[2]?.notes, 'John likes the location.');
      assert.equal(history.timeline[3]?.previous_status, 'liked');
      assert.equal(history.timeline[3]?.rejection_reason, 'HOA too high');
      assert.equal(history.current_state?.status, 'rejected'); assert(history.current_state?.sent_at);
      assert.equal(history.current_state?.notes, 'John likes the location.', 'omitted notes preserved');
      assert.equal(history.current_state?.rejection_reason, 'HOA too high');
      const context = await call<ClientContext>('get_client_context', { client_id: clientId });
      assert.equal(context.properties[0]?.details?.title, 'Marbella Residence unit 104');
      assert.equal(context.properties[0]?.status, 'rejected'); assert.equal(context.properties[0]?.rejection_reason, 'HOA too high');
      assert.equal(context.recent_property_events[0]?.previous_status, 'liked');
      assert.equal(context.recent_property_events[1]?.notes, 'John likes the location.');
    });
    await t.test('saved name resolution and a completely fresh MCP connection recall persisted history', async () => {
      const fresh = new Client({ name: 'independent-new-conversation', version: '1' });
      try {
        await fresh.connect(new StreamableHTTPClientTransport(url));
        const found = await call<{ clients: { id: string }[] }>('find_clients', { name: 'John' }, fresh);
        const property = await call<PropertyContext>('get_property_context', { name: 'Marbella' }, fresh);
        assert.equal(property.property.id, propertyId); assert.equal(property.clients[0]?.status, 'rejected');
        assert.equal(property.sources.length, 2);
        const history = await call<History>('get_client_property_history', { client_id: found.clients[0]!.id, property_id: property.property.id }, fresh);
        assert.deepEqual(history.timeline.map(e => e.status), ['considering', 'sent', 'liked', 'rejected']);
        assert.equal(history.current_state?.rejection_reason, 'HOA too high');
      } finally { await fresh.close(); }
    });
    await t.test('no-op writes do not duplicate events; notes-only changes and direct updates append history', async () => {
      const args = { client_id: clientId, property_id: propertyId };
      await call('update_client_property', { ...args, status: 'rejected', interest_level: 'low', rejection_reason: 'HOA too high' });
      assert.equal((await call<History>('get_client_property_history', args)).timeline.length, 4);
      await call('update_client_property', { ...args, notes: 'John likes the location, but the HOA rules it out.' });
      const relation = must(await db.from('client_properties').select('id').eq('client_id', clientId).eq('property_id', propertyId).single());
      must(await db.from('client_properties').update({ notes: 'Final discussion: HOA too high.' }).eq('id', relation.id).select('id'));
      const history = await call<History>('get_client_property_history', args);
      assert.equal(history.timeline.length, 6); assert.equal(history.timeline[5]?.event_type, 'relationship_updated');
      assert.equal(history.timeline[2]?.notes, 'John likes the location.');
      assert.equal(history.current_state?.rejection_reason, 'HOA too high');
      assert.equal((await db.from('client_property_events').update({ notes: 'Rewrite history' }).eq('client_property_id', relation.id)).error?.code, '42501');
      assert.equal((await db.from('client_property_events').delete().eq('client_property_id', relation.id)).error?.code, '42501');
    });
    await t.test('event insertion failure rolls back both existing relationship updates and first links', async () => {
      const bad = { status: 'liked', notes: 'X'.repeat(2001) };
      // The relationship row is written first. Its AFTER trigger then fails the
      // event-size constraint, proving rollback of the entire write transaction.
      const result = await db.rpc('update_client_property', { p_workspace_id: workspaceA, p_client_id: clientId, p_property_id: propertyId, p_changes: bad });
      assert.equal(result.error?.code, '23514');
      const history = await call<History>('get_client_property_history', { client_id: clientId, property_id: propertyId });
      assert.equal(history.current_state?.status, 'rejected'); assert.equal(history.timeline.length, 6);
      const other = await call<Saved>('save_property', { title: 'Unlinked rollback fixture' });
      const first = await db.rpc('update_client_property', { p_workspace_id: workspaceA, p_client_id: clientId, p_property_id: other.property.id, p_changes: bad });
      assert.equal(first.error?.code, '23514');
      const empty = await call<History>('get_client_property_history', { client_id: clientId, property_id: other.property.id });
      assert.equal(empty.current_state, null); assert.deepEqual(empty.timeline, []);
    });
    await t.test('concurrent first links and changes serialize into one relationship with a complete chain', async () => {
      const saved = await call<Saved>('save_property', { title: 'Concurrent fixture' });
      const states = ['considering', 'liked', 'rejected', 'viewed'];
      const results = await Promise.all(states.map(status => db.rpc('update_client_property', {
        p_workspace_id: workspaceA, p_client_id: clientId, p_property_id: saved.property.id, p_changes: { status },
      })));
      results.forEach(must);
      const history = await call<History>('get_client_property_history', { client_id: clientId, property_id: saved.property.id });
      assert.equal(history.timeline.length, 4); assert.equal(new Set(history.timeline.map(e => e.status)).size, 4);
      assert.equal(history.timeline[0]?.previous_status, null);
      history.timeline.slice(1).forEach((e, index) => assert.equal(e.previous_status, history.timeline[index]?.status));
      assert.equal(history.current_state?.status, history.timeline.at(-1)?.status);
      assert.equal(must(await db.from('client_properties').select('id').eq('client_id', clientId).eq('property_id', saved.property.id)).length, 1);
    });
    await t.test('bounded history pagination handles tied timestamps without missing or repeating events', async () => {
      const args = { client_id: clientId, property_id: propertyId };
      const full = await call<History>('get_client_property_history', args);
      must(await admin.from('client_property_events').update({ occurred_at: '2026-10-07T12:00:00Z' })
        .in('id', full.timeline.map(e => e.id)).select('id'));
      const seen = new Set<string>(); let cursor: History['coverage']['next_cursor'] = null;
      do {
        const page: History = await call<History>('get_client_property_history', { ...args, limit: 2, ...(cursor ? { cursor } : {}) });
        assert(page.timeline.length <= 2);
        page.timeline.forEach(e => { assert(!seen.has(e.id)); seen.add(e.id); });
        cursor = page.coverage.next_cursor;
      } while (cursor);
      assert.equal(seen.size, full.timeline.length);
    });
    await t.test('property context includes existing research summaries and bounds all sections', async () => {
      must(await admin.from('research_items').insert({ workspace_id: workspaceA, property_id: propertyId, subject_type: 'property',
        title: 'HOA research', summary: 'Monthly HOA is high.', findings: { raw: 'DO NOT DUMP FINDINGS' }, source_name: 'Realtor' }).select('id'));
      for (let i = 0; i < 9; i++) await call('update_client_property', { client_id: clientId, property_id: propertyId, notes: `Discussion ${i}` });
      for (let i = 0; i < 6; i++) await call('save_property', { property_id: propertyId, source: { source_name: `Extra source ${i}` } });
      const result = await call<PropertyContext>('get_property_context', { property_id: propertyId });
      assert.equal(result.research[0]?.summary, 'Monthly HOA is high.'); assert(!JSON.stringify(result).includes('DO NOT DUMP'));
      assert.equal(result.sources.length, 6); assert.equal(result.recent_events.length, 12);
      assert(result.coverage.truncated_sections.includes('sources')); assert(result.coverage.truncated_sections.includes('events'));
      const clientContext = await call<ClientContext>('get_client_context', { client_id: clientId });
      assert.equal(clientContext.recent_property_events.length, 8); assert(clientContext.coverage.truncated_sections.includes('property_events'));
    });
    await t.test('all tools and RLS enforce parent ownership, including workspaces the user also belongs to', async () => {
      const foreignProperty = must(await admin.from('properties').insert({ workspace_id: workspaceB, title: 'SECRET FOREIGN PROPERTY' }).select('id').single());
      const foreignClient = must(await admin.from('clients').insert({ workspace_id: workspaceB, display_name: 'SECRET FOREIGN CLIENT' }).select('id').single());
      await denied('get_property_context', { property_id: foreignProperty.id });
      await denied('save_property', { property_id: foreignProperty.id, notes: 'Wrong tenant' });
      for (const args of [{ client_id: clientId, property_id: foreignProperty.id }, { client_id: foreignClient.id, property_id: propertyId }]) {
        await denied('update_client_property', { ...args, status: 'liked' }); await denied('get_client_property_history', args);
      }
      const wrongSource = await db.from('property_sources').insert({ workspace_id: workspaceA, property_id: foreignProperty.id, source_name: 'Forged' });
      assert.equal(wrongSource.error?.code, '42501');
      const wrongLink = await db.from('client_properties').insert({ workspace_id: workspaceA, client_id: clientId, property_id: foreignProperty.id });
      assert.equal(wrongLink.error?.code, '42501');
      const wrongClient = await db.from('client_properties').insert({ workspace_id: workspaceA, client_id: foreignClient.id, property_id: propertyId });
      assert.equal(wrongClient.error?.code, '42501');
      const foreignRelation = must(await admin.from('client_properties').insert({ workspace_id: workspaceB, client_id: foreignClient.id, property_id: foreignProperty.id }).select('id').single());
      const wrongEvent = await db.from('client_property_events').insert({ workspace_id: workspaceA, client_property_id: foreignRelation.id, event_type: 'liked', created_by: context.userId });
      assert.equal(wrongEvent.error?.code, '42501');
      assert.equal((await admin.from('property_sources').insert({ workspace_id: workspaceB, property_id: propertyId, source_name: 'SECRET WRONG TENANT SOURCE' })).error?.code, '23503');
      assert.equal((await admin.from('research_items').insert({ workspace_id: workspaceB, property_id: propertyId, subject_type: 'property', summary: 'SECRET WRONG TENANT RESEARCH' })).error?.code, '23503');
      assert(!JSON.stringify(await call<PropertyContext>('get_property_context', { property_id: propertyId })).includes('SECRET'));
      const noMember = await db.rpc('save_property', { p_workspace_id: forbidden, p_property: { title: 'Denied' } });
      assert.equal(noMember.error?.code, '42501');
      assert.equal(must(await db.from('properties').select('id').eq('workspace_id', forbidden)).length, 0);
      const anonymous = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
      assert((await anonymous.rpc('save_property', { p_workspace_id: workspaceA, p_property: { title: 'Denied' } })).error);
      assert((await anonymous.rpc('update_client_property', { p_workspace_id: workspaceA, p_client_id: clientId, p_property_id: propertyId, p_changes: { status: 'liked' } })).error);
    });
  } finally {
    await client.close();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    identity.close();
    if (workspaces.length) assert.equal((await admin.from('workspaces').delete().in('id', workspaces)).error, null, 'disposable workspace cleanup');
  }
});
