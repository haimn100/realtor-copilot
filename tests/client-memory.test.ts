import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factSchema, recordInteractionSchema, updateClientSchema, clientHistorySchema } from '../src/domain/schemas.js';
import { RealtorClientService } from '../src/application/client-service.js';
import { SupabaseClientRepository } from '../src/data/supabase-client-repository.js';
import type { ClientRepository } from '../src/application/contracts.js';
import type { ApplicationContext } from '../src/infrastructure/identity.js';

const clientId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const call = { client_id: clientId, expected_version: 4, idempotency_key: 'conversation-1', interaction_type: 'call' as const,
  occurred_at: '2026-10-07T13:00:00-05:00', summary: 'Hablé con John. שיחה עם ג׳ון. 与John交谈。' };

test('canonical facts distinguish unknown, false and unrestricted without breaking legacy keys/values', () => {
  for (const state of ['unknown', 'unrestricted']) {
    assert(factSchema.safeParse({ category: 'requirement', key: 'budget_max', value: { state } }).success);
    assert(factSchema.safeParse({ category: 'requirement', key: 'bedrooms_min', value: { state } }).success);
  }
  assert(factSchema.safeParse({ category: 'constraint', key: 'preconstruction', value: false, strength: 'hard' }).success);
  assert(factSchema.safeParse({ category: 'dislike', key: 'preconstruction', value: 'disliked' }).success);
  assert(factSchema.safeParse({ category: 'preference', key: 'custom_feature', value: ['Piscina', 'בריכה'], strength: 'soft' }).success);
  assert(!factSchema.safeParse({ category: 'requirement', key: 'budget_max', value: false }).success);
  assert(!factSchema.safeParse({ category: 'requirement', key: 'budget_max', value: { state: 'unknown', amount: 4 } }).success);
  assert(factSchema.safeParse({ category: 'context', key: 'custom', value: true, expected_fact_id: null }).success);
});

test('conversations require resolved identity, optimistic version, retry key and explicit timezone', () => {
  assert(recordInteractionSchema.safeParse(call).success);
  for (const patch of [{ client_id: 'John' }, { expected_version: undefined }, { expected_version: 1.5 }, { idempotency_key: undefined },
    { occurred_at: 'today' }, { occurred_at: '2026-10-07T13:00:00' }, { workspace_id: workspaceId }]) {
    assert(!recordInteractionSchema.safeParse({ ...call, ...patch }).success, JSON.stringify(patch));
  }
  const fact = { category: 'constraint', key: 'preconstruction', value: false };
  assert(!recordInteractionSchema.safeParse({ ...call, facts: [fact, fact] }).success);
  assert(!recordInteractionSchema.safeParse({ ...call, facts: [{ ...fact, source_interaction_id: clientId }] }).success);
  assert(!recordInteractionSchema.safeParse({ ...call, follow_ups: [{ title: 'Send apartments', due_at: 'Friday' }] }).success);
  assert(recordInteractionSchema.safeParse({ ...call, follow_ups: [{ title: 'Send apartments', due_date: '2026-10-09' }] }).success);
  assert(!recordInteractionSchema.safeParse({ ...call, follow_ups: [{ title: 'Send apartments', due_date: '2026-10-09', due_at: '2026-10-09T09:00:00-05:00' }] }).success);
  assert(!recordInteractionSchema.safeParse({ ...call, follow_ups: [{ title: 'Send apartments', due_date: '2026-02-30' }] }).success);
  assert(!recordInteractionSchema.safeParse({ ...call, content: 'x'.repeat(12001) }).success);
});

test('profile patches preserve explicit null and reject identity reassignment, empty patches and ambiguous names', () => {
  const update = { client_id: clientId, expected_version: 4, idempotency_key: 'profile-1', patch: { notes: null, email: null, status: 'active' } };
  assert.deepEqual(updateClientSchema.parse(update).patch, update.patch);
  for (const patch of [{}, { workspace_id: workspaceId }, { id: workspaceId }, { created_by: workspaceId }, { display_name: null }, { status: null }]) {
    assert(!updateClientSchema.safeParse({ ...update, patch }).success, JSON.stringify(patch));
  }
  assert(!updateClientSchema.safeParse({ ...update, client_id: 'John' }).success);
  assert(!clientHistorySchema.safeParse({ client_id: clientId, cursor: { recorded_at: '2026-10-07T13:00:00Z', kind: 'fact', id: 'filter-injection' } }).success);
});

test('invalid conversation is rejected before reaching a write repository', async () => {
  let writes = 0;
  const service = new RealtorClientService({ recordInteraction: async () => { writes++; throw new Error('should not write'); } } as unknown as ClientRepository);
  await assert.rejects(() => service.recordInteraction({ ...call, client_id: 'John' }));
  await assert.rejects(() => service.recordInteraction({ ...call, facts: [{ category: 'requirement', key: 'budget_max', value: 3200000 }] }));
  assert.equal(writes, 0);
});

test('production repository binds every new RPC to authenticated workspace and sanitizes conflicts', async () => {
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = { rpc: async (name: string, args: Record<string, unknown>) => {
    requests.push({ name, args });
    return { data: { marker: 'result' }, error: null };
  } };
  const repository = new SupabaseClientRepository({ workspaceId, supabase } as unknown as ApplicationContext);
  await repository.recordInteraction(call);
  await repository.updateClient({ client_id: clientId, expected_version: 4, idempotency_key: 'patch', patch: { notes: null } });
  await repository.loadHistory({ client_id: clientId, limit: 3 });
  for (const request of requests) {
    assert.equal(request.args.p_workspace_id, workspaceId);
    assert.equal(request.args.p_client_id, clientId);
  }
  assert.deepEqual(requests.map(r => r.name), ['write_client_memory', 'write_client_memory', 'get_client_history']);
  assert.equal(requests[1]!.args.p_operation, 'update_client');
  assert.equal((requests[1]!.args.p_request as any).patch.notes, null);
  for (const code of ['PT409', '40001']) {
    const failing = new SupabaseClientRepository({ workspaceId, supabase: { rpc: async () => ({ data: null,
      error: { code, message: 'PRIVATE CLIENT DATA SHOULD NOT APPEAR' } }) } } as unknown as ApplicationContext);
    await assert.rejects(() => failing.recordInteraction(call), (error: any) => error.code === 'CONFLICT' && !error.message.includes('PRIVATE CLIENT DATA'));
  }
});
