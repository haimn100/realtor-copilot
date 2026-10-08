import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClientContext } from '../src/application/client-service.js';
import type { ContextRows, FactRecord } from '../src/application/contracts.js';

function fact(category: string, key: string, value: FactRecord['value_json'], status = 'current'): FactRecord {
  return { id: key, category, key, value_json: value, status, confidence: 0.9, importance: 'normal', valid_from: '2026-10-07T00:00:00Z' };
}
function rows(): ContextRows {
  return {
    client: { id: 'client', display_name: 'John', first_name: 'John', last_name: null, status: 'active', email: null, phone: null, notes: null },
    facts: [], properties: [], interactions: [], tasks: [], searches: [], truncated: [],
  };
}
test('context separates current facts and excludes superseded, disputed and retracted values', () => {
  const input = rows();
  input.facts = [
    fact('requirement', 'budget_max', { amount: 4000000, currency: 'MXN' }, 'superseded'),
    fact('requirement', 'budget_max', { amount: 4500000, currency: 'MXN' }),
    fact('requirement', 'bedrooms_min', 2), fact('preference', 'preferred_area', 'Coco Beach'),
    fact('dislike', 'preconstruction', 'disliked'), fact('context', 'intended_use', 'investment'),
    fact('constraint', 'closing_deadline', 'December'), fact('other', 'language', 'English'),
    fact('requirement', 'budget_min', 1, 'disputed'), fact('preference', 'pool', true, 'retracted'),
  ];
  const context = buildClientContext(input);
  assert.deepEqual(context.requirements.map(f => f.value), [{ amount: 4500000, currency: 'MXN' }, 2]);
  assert.equal(context.preferences[0]?.value, 'Coco Beach');
  assert.equal(context.dislikes[0]?.key, 'preconstruction');
  assert.equal(context.context[0]?.value, 'investment');
  assert.equal(context.constraints[0]?.value, 'December');
  assert.equal(context.other_facts[0]?.value, 'English');
  assert(!JSON.stringify(context).includes('4000000'));
});
test('context produces useful empty sections and identity for a new client', () => {
  const context = buildClientContext(rows());
  assert.equal(context.client.display_name, 'John');
  assert.deepEqual(context.requirements, []);
  assert.deepEqual(context.properties, []);
  assert.deepEqual(context.recent_interactions, []);
  assert.deepEqual(context.open_tasks, []);
  assert.deepEqual(context.recent_searches, []);
});
test('activity summaries are compact, use content fallback, retain rejection/viewing context and report truncation', () => {
  const input = rows();
  input.client.notes = 'N'.repeat(2000);
  input.interactions = [
    { id: '1', interaction_type: 'call', channel: 'phone', occurred_at: 'today', summary: 'Budget discussion', content: 'unnecessary transcript' },
    { id: '2', interaction_type: 'note', channel: null, occurred_at: 'today', summary: null, content: 'X'.repeat(1500) },
  ];
  input.properties = [{ id: 'relation', property_id: 'property', status: 'rejected', interest_level: 'low', notes: null,
    rejection_reason: 'Too noisy', viewed_at: 'today', updated_at: 'today', property: null }];
  input.tasks = [
    { id: 'open', title: 'Call John', description: null, status: 'open', priority: 'high', due_at: null },
    { id: 'done', title: 'Old task', description: null, status: 'done', priority: 'normal', due_at: null },
  ];
  input.searches = [{ id: 'search', query_text: 'Coco Beach two bedrooms', status: 'completed', started_at: 'today' }];
  input.truncated = ['interactions'];
  const context = buildClientContext(input);
  assert.equal(context.client.notes?.length, 1000);
  assert.equal(context.recent_interactions[0]?.summary, 'Budget discussion');
  assert.equal(context.recent_interactions[1]?.summary?.length, 500);
  assert(!JSON.stringify(context).includes('unnecessary transcript'));
  assert.equal(context.properties[0]?.rejection_reason, 'Too noisy');
  assert.equal(context.properties[0]?.viewed_at, 'today');
  assert.equal(context.open_tasks.length, 1);
  assert.equal(context.recent_searches[0]?.query_text, 'Coco Beach two bedrooms');
  assert.deepEqual(context.coverage.truncated_sections, ['interactions']);
});
test('client recall keeps bounded relationship snapshots and prior property reactions useful', () => {
  const input = rows();
  input.properties = [{ id: 'relation', property_id: 'property', status: 'rejected', interest_level: 'low', notes: 'Liked the location',
    rejection_reason: 'HOA too high', viewed_at: null, updated_at: 'today',
    property: { id: 'property', title: 'Marbella 104', neighborhood: 'Coco Beach', bedrooms: 2, asking_price: 3800000,
      currency: 'MXN', construction_status: 'completed', availability_status: 'unknown' } }];
  input.propertyEvents = [{ id: 'event', client_property_id: 'relation', property_id: 'property', event_type: 'rejected',
    occurred_at: 'today', notes: 'N'.repeat(2000), metadata: { previous_status: 'liked', status: 'rejected', rejection_reason: 'HOA too high', transcript: 'EXCLUDED TRANSCRIPT' } }];
  const context = buildClientContext(input);
  assert.equal(context.properties[0]?.details?.title, 'Marbella 104');
  assert.equal(context.properties[0]?.rejection_reason, 'HOA too high');
  assert.equal(context.recent_property_events[0]?.previous_status, 'liked');
  assert.equal(context.recent_property_events[0]?.property_id, 'property');
  assert.equal(context.recent_property_events[0]?.notes?.length, 500);
  assert.equal(context.coverage.limits.property_events, 8);
  assert(!JSON.stringify(context).includes('EXCLUDED TRANSCRIPT'));
});
