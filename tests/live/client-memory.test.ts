import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request, type IncomingMessage } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createClient } from '@supabase/supabase-js';
import { developmentAdmin } from '../../scripts/dev-admin.js';
import { loadConfig } from '../../src/infrastructure/config.js';
import { DevelopmentIdentityProvider, type ApplicationContext } from '../../src/infrastructure/identity.js';
import { createHttpServer } from '../../src/infrastructure/http-server.js';
import type { ClientContext } from '../../src/application/client-service.js';
import type { ClientIdentity } from '../../src/application/contracts.js';
import type { Database } from '../../src/data/database.types.js';
import { SupabaseClientRepository } from '../../src/data/supabase-client-repository.js';
import { RealtorClientService } from '../../src/application/client-service.js';

function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  assert.equal(result.error, null);
  assert.notEqual(result.data, null);
  return result.data as NonNullable<T>;
}
const budget = (amount: number) => ({ category: 'requirement', key: 'budget_max', value: { amount, currency: 'MXN' } });

test('live Supabase client memory through Streamable HTTP', { timeout: 120_000 }, async t => {
  const config = loadConfig();
  const projectRef = new URL(config.SUPABASE_URL).hostname.split('.')[0]!;
  const { admin } = developmentAdmin(projectRef);
  const identity = new DevelopmentIdentityProvider(config);
  const fixtureWorkspaces: string[] = [];
  const client = new Client({ name: 'realtor-live-test', version: '0.1.0' });
  let server: ReturnType<typeof createHttpServer> | undefined;
  let context: ApplicationContext;
  try {
    await identity.initialize();
    const original = await identity.resolve({} as IncomingMessage);
    for (const name of ['memory-test-A', 'memory-test-B', 'memory-test-forbidden']) {
      const row = must(await admin.from('workspaces').insert({ name: `${name}-${randomUUID()}` }).select('id').single());
      fixtureWorkspaces.push(row.id);
    }
    const [workspaceA, workspaceB, forbiddenWorkspace] = fixtureWorkspaces as [string, string, string];
    must(await admin.from('workspace_members').insert([
      { workspace_id: workspaceA, user_id: original.userId, role: 'agent' },
      { workspace_id: workspaceB, user_id: original.userId, role: 'agent' },
    ]).select('workspace_id'));
    context = { ...original, workspaceId: workspaceA };
    server = createHttpServer({ resolve: async () => context });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/mcp`;
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(JSON.stringify(result.content));
      assert(result.structuredContent);
      return result.structuredContent as T;
    }
    let johnId = '';
    let firstBudgetId = '';
    let replacementBudgetId = '';
    await t.test('advertises all eleven business tools with no workspace input', async () => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(tool => tool.name).sort(), ['create_client', 'find_clients', 'get_client_context', 'get_client_history', 'get_client_property_history', 'get_property_context', 'record_interaction', 'remember_client_fact', 'save_property', 'update_client', 'update_client_property']);
      for (const tool of tools) assert(!JSON.stringify(tool.inputSchema).includes('workspace_id'));
      assert.equal(tools.find(tool => tool.name === 'get_client_context')?.annotations?.readOnlyHint, true);
      await assert.rejects(() => call('create_client', { display_name: 'Bad', workspace_id: workspaceB }));
    });
    await t.test('John milestone persists facts and links superseded budget history', async () => {
      const created = await call<{ client: ClientIdentity; initial_facts_count: number }>('create_client', {
        display_name: 'John', facts: [budget(4000000),
          { category: 'requirement', key: 'bedrooms_min', value: 2 },
          { category: 'context', key: 'intended_use', value: 'investment' },
          { category: 'preference', key: 'preferred_area', value: 'Coco Beach' },
        ],
      });
      johnId = created.client.id;
      assert.equal(created.initial_facts_count, 4);
      let before = await call<ClientContext>('get_client_context', { client_id: johnId });
      assert.deepEqual(before.requirements.find(f => f.key === 'budget_max')?.value, { amount: 4000000, currency: 'MXN' });
      assert.equal(before.requirements.find(f => f.key === 'bedrooms_min')?.value, 2);
      assert.equal(before.context.find(f => f.key === 'intended_use')?.value, 'investment');
      assert.equal(before.preferences.find(f => f.key === 'preferred_area')?.value, 'Coco Beach');
      await call('remember_client_fact', { client_id: johnId, fact: budget(4500000) });
      const after = await call<ClientContext>('get_client_context', { client_id: johnId });
      assert.deepEqual(after.requirements.find(f => f.key === 'budget_max')?.value, { amount: 4500000, currency: 'MXN' });
      assert(!JSON.stringify(after).includes('4000000'));
      const history = must(await admin.from('client_facts').select('id,status,value_json,superseded_by_id')
        .eq('workspace_id', workspaceA).eq('client_id', johnId).eq('key', 'budget_max'));
      assert.equal(history.length, 2);
      const old = history.find(f => f.status === 'superseded')!;
      const current = history.find(f => f.status === 'current')!;
      firstBudgetId = old.id;
      replacementBudgetId = current.id;
      assert.equal(old.superseded_by_id, current.id);
      assert.deepEqual(old.value_json, { amount: 4000000, currency: 'MXN' });
      assert.equal(current.superseded_by_id, null);
    });
    await t.test('failed replacement rolls back old status and link', async () => {
      // Invalid category reaches the database after the old fact UPDATE.
      const { error } = await context.supabase.rpc('remember_client_fact', {
        p_workspace_id: workspaceA, p_client_id: johnId,
        p_fact: { ...budget(1), category: 'invalid_category' },
      });
      assert(error);
      const history = must(await admin.from('client_facts').select('id,status,superseded_by_id')
        .eq('workspace_id', workspaceA).eq('client_id', johnId).eq('key', 'budget_max'));
      assert.equal(history.length, 2);
      assert.equal(history.find(f => f.id === replacementBudgetId)?.status, 'current');
      assert.equal(history.find(f => f.id === firstBudgetId)?.superseded_by_id, replacementBudgetId);
    });
    await t.test('client creation and initial facts roll back as a unit', async () => {
      const uniqueName = `rollback-${randomUUID()}`;
      const { error } = await context.supabase.rpc('create_client_with_facts', {
        p_workspace_id: workspaceA, p_client: { display_name: uniqueName },
        p_facts: [budget(4000000), { category: 'invalid', key: 'bad', value: true }],
      });
      assert(error);
      const rows = must(await admin.from('clients').select('id').eq('workspace_id', workspaceA).eq('display_name', uniqueName));
      assert.equal(rows.length, 0);
    });
    await t.test('concurrent updates leave one current fact and a complete historical chain', async () => {
      const results = await Promise.all([4600000, 4700000, 4800000, 4900000].map(amount => context.supabase.rpc('remember_client_fact', {
        p_workspace_id: workspaceA, p_client_id: johnId, p_fact: budget(amount),
      })));
      results.forEach(result => must(result));
      const history = must(await admin.from('client_facts').select('id,status,superseded_by_id')
        .eq('workspace_id', workspaceA).eq('client_id', johnId).eq('key', 'budget_max'));
      assert.equal(history.length, 6);
      assert.equal(history.filter(f => f.status === 'current').length, 1);
      const visited = new Set<string>();
      let cursor: string | null = firstBudgetId;
      while (cursor) {
        assert(!visited.has(cursor), 'supersession chain must not cycle');
        visited.add(cursor);
        const row = history.find(f => f.id === cursor);
        assert(row);
        if (row.status === 'current') assert.equal(row.superseded_by_id, null);
        else assert(row.superseded_by_id);
        cursor = row.superseded_by_id;
      }
      assert.equal(visited.size, history.length);
    });
    await t.test('category changes supersede the same logical key', async () => {
      await call('remember_client_fact', { client_id: johnId, fact: { category: 'preference', key: 'preconstruction', value: 'liked' } });
      await call('remember_client_fact', { client_id: johnId, fact: { category: 'dislike', key: 'preconstruction', value: 'disliked' } });
      const context = await call<ClientContext>('get_client_context', { client_id: johnId });
      assert(!context.preferences.some(f => f.key === 'preconstruction'));
      assert.equal(context.dislikes.find(f => f.key === 'preconstruction')?.value, 'disliked');
    });
    await t.test('concurrent first writes are serialized before a fact row exists', async () => {
      const results = await Promise.all(['March', 'April', 'May'].map(value => context.supabase.rpc('remember_client_fact', {
        p_workspace_id: workspaceA, p_client_id: johnId,
        p_fact: { category: 'context', key: 'arrival_month', value },
      })));
      results.forEach(result => must(result));
      const history = must(await admin.from('client_facts').select('id,status,superseded_by_id')
        .eq('workspace_id', workspaceA).eq('client_id', johnId).eq('key', 'arrival_month'));
      assert.equal(history.length, 3);
      assert.equal(history.filter(f => f.status === 'current').length, 1);
      assert.equal(history.filter(f => f.status === 'superseded' && f.superseded_by_id).length, 2);
    });
    await t.test('context assembles bounded relevant activity and property details from actual tables', async () => {
      const property = must(await admin.from('properties').insert({ workspace_id: workspaceA,
        title: 'Coco Beach investment condo', neighborhood: 'Coco Beach', bedrooms: 2, asking_price: 4300000, currency: 'MXN',
      }).select('id').single());
      must(await admin.from('client_properties').insert({ workspace_id: workspaceA, client_id: johnId,
        property_id: property.id, status: 'rejected', interest_level: 'low', rejection_reason: 'Too noisy', viewed_at: '2026-10-07T12:00:00Z',
      }).select('id'));
      must(await admin.from('interactions').insert(Array.from({ length: 10 }, (_, i) => ({
        workspace_id: workspaceA, client_id: johnId, interaction_type: 'call', summary: `Summary ${i}`,
        content: 'Long transcript excluded', occurred_at: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
      }))).select('id'));
      must(await admin.from('tasks').insert([
        { workspace_id: workspaceA, client_id: johnId, title: 'Send updated options', status: 'open' },
        { workspace_id: workspaceA, client_id: johnId, title: 'Completed task', status: 'done' },
      ]).select('id'));
      must(await admin.from('search_runs').insert({ workspace_id: workspaceA, client_id: johnId,
        query_text: 'Two-bedroom Coco Beach condos', status: 'completed', criteria_snapshot: { old_budget: 4000000 },
      }).select('id'));
      await call('remember_client_fact', { client_id: johnId, fact: { category: 'constraint', key: 'closing_deadline', value: 'December' } });
      const response = await call<ClientContext>('get_client_context', { client_id: johnId });
      assert.equal(response.properties[0]?.details?.title, 'Coco Beach investment condo');
      assert.equal(response.properties[0]?.rejection_reason, 'Too noisy');
      assert(response.properties[0]?.viewed_at);
      assert.equal(response.recent_interactions.length, 8);
      assert.equal(response.recent_interactions[0]?.summary, 'Summary 9');
      assert.deepEqual(response.coverage.truncated_sections, ['interactions']);
      assert.equal(response.open_tasks.length, 1);
      assert.equal(response.recent_searches[0]?.query_text, 'Two-bedroom Coco Beach condos');
      assert.equal(response.constraints[0]?.value, 'December');
      assert(!JSON.stringify(response).includes('Long transcript excluded'));
      assert(!JSON.stringify(response).includes('old_budget'));
      assert(!JSON.stringify(response).includes('workspace_id'));
    });
    await t.test('find supports status, literal wildcards, full names and pagination', async () => {
      await call('create_client', { display_name: 'John Smith', status: 'active' });
      await call('create_client', { display_name: 'John % VIP' });
      const found = await call<{ clients: ClientIdentity[]; has_more: boolean }>('find_clients', { name: 'john', limit: 1 });
      assert.equal(found.clients.length, 1);
      assert(found.has_more);
      const active = await call<{ clients: ClientIdentity[] }>('find_clients', { name: 'John Smith', status: 'active' });
      assert.equal(active.clients.length, 1);
      const percent = await call<{ clients: ClientIdentity[] }>('find_clients', { name: '%' });
      assert.equal(percent.clients.length, 1);
      assert.equal(percent.clients[0]?.display_name, 'John % VIP');
      await call('create_client', { display_name: 'Investor', first_name: 'Alice', last_name: 'Buyer' });
      const firstName = await call<{ clients: ClientIdentity[] }>('find_clients', { name: 'Alice' });
      assert.equal(firstName.clients[0]?.display_name, 'Investor');
      const lastName = await call<{ clients: ClientIdentity[] }>('find_clients', { name: 'Buyer' });
      assert.equal(lastName.clients[0]?.display_name, 'Investor');
      const literal = 'John",id.neq.00000000-0000-4000-8000-000000000000';
      await call('create_client', { display_name: literal });
      const escaped = await call<{ clients: ClientIdentity[] }>('find_clients', { name: literal });
      assert.equal(escaped.clients.length, 1);
      assert.equal(escaped.clients[0]?.display_name, literal);
      await call('create_client', { display_name: 'John * VIP' });
      const star = await call<{ clients: ClientIdentity[] }>('find_clients', { name: '*' });
      assert.equal(star.clients.length, 1);
      assert.equal(star.clients[0]?.display_name, 'John * VIP');
    });
    await t.test('application workspace scoping isolates clients even when actor belongs to both tenants', async () => {
      const foreignClient = must(await admin.from('clients').insert({ workspace_id: workspaceB, display_name: 'John foreign' }).select('id').single());
      await assert.rejects(() => call('get_client_context', { client_id: foreignClient.id }), /NOT_FOUND/);
      await assert.rejects(() => call('remember_client_fact', { client_id: foreignClient.id, fact: budget(1) }), /NOT_FOUND/);
      const found = await call<{ clients: ClientIdentity[] }>('find_clients', { name: 'John' });
      assert(!found.clients.some(c => c.id === foreignClient.id));
      const foreignProperty = must(await admin.from('properties').insert({ workspace_id: workspaceB, title: 'SECRET FOREIGN PROPERTY' }).select('id').single());
      // Milestone 2 now rejects new inconsistent associations at the database.
      const invalidLink = await admin.from('client_properties').insert({ workspace_id: workspaceA, client_id: johnId,
        property_id: foreignProperty.id, status: 'liked',
      }).select('id');
      assert.equal(invalidLink.error?.code, '23503', 'workspace-aware foreign key rejects the invalid parent before history insertion');
      const response = await call<ClientContext>('get_client_context', { client_id: johnId });
      assert(!JSON.stringify(response).includes('SECRET FOREIGN PROPERTY'));
      assert.equal(response.properties.find(p => p.property_id === foreignProperty.id), undefined);
    });
    await t.test('RLS denies non-members, forged parent links and anonymous RPC invocation', async () => {
      const foreign = must(await admin.from('clients').insert({ workspace_id: forbiddenWorkspace, display_name: 'Forbidden' }).select('id').single());
      const visible = must(await context.supabase.from('clients').select('id').eq('workspace_id', forbiddenWorkspace));
      assert.equal(visible.length, 0);
      const denied = await context.supabase.rpc('remember_client_fact', { p_workspace_id: forbiddenWorkspace, p_client_id: foreign.id, p_fact: budget(1) });
      assert.equal(denied.error?.code, '42501');
      const forged = await context.supabase.from('client_facts').insert({ workspace_id: workspaceA,
        client_id: foreign.id, category: 'context', key: 'forged', value_json: true, created_by: context.userId,
      });
      assert.equal(forged.error?.code, '42501');
      const anon = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
      const anonymousWrite = await anon.rpc('create_client_with_facts', { p_workspace_id: workspaceA, p_client: { display_name: 'Unauthorized' }, p_facts: [] });
      assert(anonymousWrite.error);
    });
    await t.test('source interactions must belong to the same workspace and client', async () => {
      const other = must(await admin.from('clients').insert({ workspace_id: workspaceA, display_name: 'Other client' }).select('id').single());
      const interaction = must(await admin.from('interactions').insert({ workspace_id: workspaceA, client_id: other.id, summary: 'Other private note' }).select('id').single());
      await assert.rejects(() => call('remember_client_fact', { client_id: johnId,
        fact: { category: 'context', key: 'invalid_source', value: 'test', source_interaction_id: interaction.id },
      }), /INVALID_INPUT/);
    });
    await t.test('fresh service instance reads persisted state and HTTP guards block untrusted origins', async () => {
      const fresh = new RealtorClientService(new SupabaseClientRepository(context));
      const persisted = await fresh.getClientContext(johnId);
      assert(persisted.requirements.some(f => f.key === 'budget_max'));
      assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
      const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(url, { method: 'POST', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
      });
      assert.equal(forgedHostStatus, 403);
      assert.equal((await fetch(url)).status, 405);
    });
  } finally {
    await client.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    identity.close();
    if (fixtureWorkspaces.length) {
      const { error } = await admin.from('workspaces').delete().in('id', fixtureWorkspaces);
      assert.equal(error, null, 'temporary workspace cleanup');
    }
  }
});
