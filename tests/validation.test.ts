import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClientSchema, factSchema, rememberFactSchema, findClientsSchema } from '../src/domain/schemas.js';
import { parseConfig } from '../src/infrastructure/config.js';

test('all tool inputs reject workspace selection and unrecognized fields', () => {
  assert(!createClientSchema.safeParse({ display_name: 'John', workspace_id: 'chosen' }).success);
  assert(!rememberFactSchema.safeParse({ client_id: 'bad-id', fact: { category: 'requirement', key: 'budget_max', value: 4 } }).success);
  assert(!findClientsSchema.safeParse({ name: 'John', workspace_id: 'chosen' }).success);
});
test('durable fact validation requires explicit money units and bounded typed values', () => {
  assert(factSchema.safeParse({ category: 'requirement', key: 'budget_max', value: { amount: 4500000, currency: 'MXN' } }).success);
  assert(!factSchema.safeParse({ category: 'requirement', key: 'budget_max', value: 4500000 }).success);
  assert(!factSchema.safeParse({ category: 'requirement', key: 'bedrooms_min', value: -1 }).success);
  assert(!factSchema.safeParse({ category: 'context', key: 'intended_use', value: null }).success);
  assert(!factSchema.safeParse({ category: 'context', key: 'intended_use', value: 'x'.repeat(1001) }).success);
  assert(!factSchema.safeParse({ category: 'context', key: 'intended_use', value: 'investment', confidence: 2 }).success);
  assert(!factSchema.safeParse({ category: 'context', key: 'areas', value: Array(20).fill('🌴'.repeat(50)) }).success);
});
test('initial fact keys must be unique and identifiers are trimmed', () => {
  const f = { category: 'context', key: 'intended_use', value: 'investment' };
  assert(!createClientSchema.safeParse({ display_name: 'John', facts: [f, f] }).success);
  assert.equal(createClientSchema.parse({ display_name: ' John ' }).display_name, 'John');
});
test('development identity fails closed in production and cannot bind to public interfaces', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    DEV_WORKSPACE_ID: 'eb3a2d80-907b-459b-8a39-2a4d9fa42465', DEV_SUPABASE_EMAIL: 'test@example.invalid', DEV_SUPABASE_PASSWORD: 'a-long-test-password' };
  assert.throws(() => parseConfig({ ...env, NODE_ENV: 'production' }), /production/);
  assert.throws(() => parseConfig({ ...env, HOST: '0.0.0.0' }), /HOST/);
  assert.throws(() => parseConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_rejected' }), /publishable/);
  assert.throws(() => parseConfig({ ...env, AUTH_MODE: 'unknown' }), /AUTH_MODE/);
  const tunnel = 'https://realtor-test.ngrok-free.dev';
  assert.equal(parseConfig({ ...env, DEV_TUNNEL_URL: tunnel + '/' }).DEV_TUNNEL_URL, tunnel);
  assert.throws(() => parseConfig({ ...env, NODE_ENV: 'test', DEV_TUNNEL_URL: tunnel }), /development/);
  assert.throws(() => parseConfig({ ...env, NODE_ENV: 'production', DEV_TUNNEL_URL: tunnel }), /production/);
  for (const value of ['http://test.ngrok.dev', 'https://localhost', 'https://127.0.0.1',
    'https://[::1]', 'https://test.local', 'https://test.localhost', 'https://*.ngrok.dev',
    tunnel + '/mcp', tunnel + '?token=secret', tunnel + '#fragment', 'https://user:pass@test.ngrok.dev', tunnel + ':444']) {
    assert.throws(() => parseConfig({ ...env, DEV_TUNNEL_URL: value }), /DEV_TUNNEL_URL/);
  }
});
