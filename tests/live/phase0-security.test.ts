import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { loadConfig } from '../../src/infrastructure/config.js';
import { DevelopmentIdentityProvider } from '../../src/infrastructure/identity.js';
import { developmentAdmin } from '../../scripts/dev-admin.js';

function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  assert.equal(result.error, null); assert.notEqual(result.data, null);
  return result.data as NonNullable<T>;
}

test('live Phase 0 fact immutability and tenant constraints with disposable fixtures', { timeout: 120_000 }, async t => {
  const config = loadConfig();
  const { admin } = developmentAdmin(new URL(config.SUPABASE_URL).hostname.split('.')[0]!);
  const identity = new DevelopmentIdentityProvider(config);
  const workspaces: string[] = [];
  try {
    await identity.initialize();
    const context = await identity.resolve({} as IncomingMessage), db = context.supabase;
    for (let i = 0; i < 2; i++) workspaces.push(must(await admin.from('workspaces').insert({ name: `phase0-security-${randomUUID()}` }).select('id').single()).id);
    const [workspaceA, workspaceB] = workspaces as [string, string];
    must(await admin.from('workspace_members').insert(workspaces.map(workspace_id => ({ workspace_id, user_id: context.userId }))).select('workspace_id'));
    const client = must(await db.rpc('create_client_with_facts', { p_workspace_id: workspaceA, p_client: { display_name: 'Phase 0 fixture' } }));
    const other = must(await db.rpc('create_client_with_facts', { p_workspace_id: workspaceA, p_client: { display_name: 'Other fixture client' } }));
    const foreign = must(await db.rpc('create_client_with_facts', { p_workspace_id: workspaceB, p_client: { display_name: 'Other fixture tenant' } }));
    const interaction = must(await admin.from('interactions').insert({ workspace_id: workspaceA, client_id: client.id, summary: 'Synthetic budget conversation' }).select('id').single());
    const initial = must(await db.rpc('remember_client_fact', { p_workspace_id: workspaceA, p_client_id: client.id,
      p_fact: { category: 'requirement', key: 'budget_max', value: { amount: 4000000, currency: 'MXN' }, source_interaction_id: interaction.id, source_ref: 'fixture call' } }));
    must(await db.rpc('remember_client_fact', { p_workspace_id: workspaceA, p_client_id: client.id,
      p_fact: { category: 'requirement', key: 'budget_max', value: { amount: 4500000, currency: 'MXN' } } }));
    const old = must(await admin.from('client_facts').select('*').eq('id', initial.id).single());
    await t.test('historical payload, attribution, sources, identity and timestamps cannot be changed', async () => {
      const patches = [
        { value_json: true }, { category: 'other' }, { key: 'rewrite' }, { confidence: 0.1 }, { importance: 'critical' },
        { workspace_id: workspaceB, client_id: foreign.id }, { client_id: other.id }, { source_type: 'forged' },
        { source_interaction_id: null }, { source_ref: 'forged' }, { created_by: null },
        { valid_from: '2020-01-01T00:00:00Z' }, { created_at: '2020-01-01T00:00:00Z' },
      ];
      for (const patch of patches) assert.equal((await db.from('client_facts').update(patch).eq('id', initial.id)).error?.code, '42501', JSON.stringify(patch));
      assert.deepEqual(must(await admin.from('client_facts').select('*').eq('id', initial.id).single()), old);
    });
    await t.test('historical lifecycle changes, deletion and fabricated historical inserts are denied', async () => {
      for (const patch of [{ status: 'current' }, { superseded_by_id: null }])
        assert.equal((await db.from('client_facts').update(patch).eq('id', initial.id)).error?.code, '42501');
      assert.equal((await db.from('client_facts').delete().eq('id', initial.id)).error?.code, '42501');
      assert.equal((await db.from('client_facts').insert({ workspace_id: workspaceA, client_id: client.id, category: 'context', key: 'fabricated', value_json: true, status: 'superseded', created_by: context.userId })).error?.code, '42501');
    });
    await t.test('incomplete direct supersession fails at commit and rolls back', async () => {
      const current = must(await db.from('client_facts').select('id').eq('client_id', client.id).eq('status', 'current').single());
      assert.equal((await db.from('client_facts').update({ status: 'superseded' }).eq('id', current.id)).error?.code, '23514');
      assert.equal(must(await db.from('client_facts').select('status').eq('id', current.id).single()).status, 'current');
    });
    await t.test('constraints protect tenant and source ownership even for administrative fixture writes', async () => {
      assert.equal((await admin.from('interactions').insert({ workspace_id: workspaceA, client_id: foreign.id })).error?.code, '23503');
      assert.equal((await admin.from('tasks').insert({ workspace_id: workspaceA, client_id: foreign.id, title: 'Invalid fixture parent' })).error?.code, '23503');
      assert.equal((await admin.from('client_facts').insert({ workspace_id: workspaceA, client_id: other.id, category: 'context', key: 'bad_source', value_json: true, source_interaction_id: interaction.id })).error?.code, '23503');
      assert.equal((await admin.from('client_facts').update({ superseded_by_id: randomUUID() }).eq('id', initial.id)).error?.code, '23503');
    });
    await t.test('legitimate RPC replacement still preserves the complete historical chain', async () => {
      must(await db.rpc('remember_client_fact', { p_workspace_id: workspaceA, p_client_id: client.id,
        p_fact: { category: 'constraint', key: 'budget_max', value: { amount: 4700000, currency: 'MXN' } } }));
      const history = must(await db.from('client_facts').select('id,status,superseded_by_id').eq('client_id', client.id));
      assert.equal(history.length, 3); assert.equal(history.filter(f => f.status === 'current').length, 1);
      assert.equal(history.filter(f => f.status === 'superseded' && f.superseded_by_id).length, 2);
      assert.deepEqual(must(await admin.from('client_facts').select('*').eq('id', initial.id).single()), old);
    });
  } finally {
    identity.close();
    if (workspaces.length) assert.equal((await admin.from('workspaces').delete().in('id', workspaces)).error, null, 'disposable security workspace cleanup');
  }
});
