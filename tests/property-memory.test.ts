import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { savePropertySchema, updateClientPropertySchema, propertyContextSchema, clientPropertyHistorySchema } from '../src/domain/property-schemas.js';
import { RealtorPropertyService, summarizeEvent, summarizeProperty } from '../src/application/property-service.js';
import type { PropertyRepository, SavedProperty, PropertyEvent, PropertyHistoryRows } from '../src/application/property-contracts.js';

const propertyId = randomUUID(), clientId = randomUUID();
const property: SavedProperty = {
  id: propertyId, title: 'Marbella Residence unit 104', property_type: 'condo', development_name: 'Marbella Residence',
  address: null, neighborhood: 'Coco Beach', city: 'Playa del Carmen', state: 'Quintana Roo', country: 'Mexico',
  bedrooms: 2, bathrooms: null, interior_m2: null, exterior_m2: null, total_m2: null,
  asking_price: 3800000, currency: 'MXN', construction_status: null, delivery_date: null, notes: null,
  availability_status: 'unknown', availability_verified_at: null,
};
test('saved properties require meaningful titles, explicit currencies and bounded structured details', () => {
  assert(savePropertySchema.safeParse({ title: property.title, bedrooms: 2, asking_price: 3800000, currency: 'MXN' }).success);
  for (const value of [{}, { title: ' ' }, { title: 'Condo', asking_price: 1 }, { title: 'Condo', bedrooms: -1 },
    { title: 'Condo', bedrooms: 1.2 }, { title: 'Condo', notes: 'N'.repeat(2001) }, { title: 'Condo', delivery_date: '2026-02-30' },
    { title: 'Condo', workspace_id: randomUUID() }, { property_id: propertyId }]) assert(!savePropertySchema.safeParse(value).success);
  assert(savePropertySchema.safeParse({ property_id: propertyId, source: { source_name: 'Broker' } }).success);
});
test('listing access and update times stay distinct and access never supplies verification', () => {
  const source = { source_name: 'Broker', accessed_at: '2026-10-07T12:00:00Z', listing_updated_at: '2026-10-01T12:00:00Z', availability_status: 'available' };
  const parsed = savePropertySchema.parse({ title: 'Condo', source });
  assert.equal(parsed.source?.accessed_at, source.accessed_at);
  assert.equal(parsed.source?.listing_updated_at, source.listing_updated_at);
  assert.equal(parsed.source?.availability_verified, undefined);
  assert.equal(parsed.source?.availability_verified_at, undefined);
  assert(!savePropertySchema.safeParse({ title: 'Condo', source: { source_name: 'Broker', listing_price: 1 } }).success);
  assert(!savePropertySchema.safeParse({ title: 'Condo', source: { ...source, availability_verified_at: source.accessed_at } }).success);
  assert(!savePropertySchema.safeParse({ title: 'Condo', source: { source_name: 'Broker', availability_verified: true } }).success);
  assert(!savePropertySchema.safeParse({ title: 'Condo', source: { source_name: 'Broker', url: 'file:///secret' } }).success);
  assert.equal(summarizeProperty(property).availability_verified, false);
});
test('relationship patches preserve omission, support explicit clearing and reject tenant control', () => {
  const base = { client_id: clientId, property_id: propertyId };
  assert.deepEqual(updateClientPropertySchema.parse({ ...base, notes: 'John likes the location.' }), { ...base, notes: 'John likes the location.' });
  assert(updateClientPropertySchema.safeParse({ ...base, status: 'rejected', rejection_reason: 'HOA too high' }).success);
  assert(updateClientPropertySchema.safeParse({ ...base, rejection_reason: null }).success);
  for (const extra of [{}, { status: 'search_result' }, { interest_level: 'extreme' }, { status: 'liked', workspace_id: randomUUID() }])
    assert(!updateClientPropertySchema.safeParse({ ...base, ...extra }).success);
});
test('saved property resolution requires exactly one locator; history cursor cannot inject filters', () => {
  assert(propertyContextSchema.safeParse({ name: 'Marbella' }).success);
  assert(!propertyContextSchema.safeParse({ property_id: propertyId, name: 'Marbella' }).success);
  assert(!propertyContextSchema.safeParse({}).success);
  assert(!clientPropertyHistorySchema.safeParse({ client_id: clientId, property_id: propertyId, limit: 51 }).success);
  assert(!clientPropertyHistorySchema.safeParse({ client_id: clientId, property_id: propertyId, cursor: { occurred_at: 'now),id.gt.0', id: randomUUID() } }).success);
});
test('event context projects structured snapshots and excludes arbitrary metadata', () => {
  const event: PropertyEvent = { id: randomUUID(), client_property_id: randomUUID(), event_type: 'rejected', notes: 'N'.repeat(2000),
    occurred_at: '2026-10-07T12:00:00Z', metadata: { previous_status: 'liked', status: 'rejected', rejection_reason: 'HOA too high', raw_transcript: 'SECRET RAW TRANSCRIPT', workspace_id: 'SECRET TENANT' } };
  const result = summarizeEvent(event);
  assert.equal(result.previous_status, 'liked');
  assert.equal(result.rejection_reason, 'HOA too high');
  assert.equal(result.notes?.length, 500);
  assert(!JSON.stringify(result).includes('SECRET'));
});
test('ambiguous saved names return concise choices without choosing or creating a property', async () => {
  const repository = { findSavedProperties: async () => ({ matches: [property, { ...property, id: randomUUID(), title: 'Marbella 105' }], has_more: false }) } as unknown as PropertyRepository;
  const result = await new RealtorPropertyService(repository).getPropertyContext({ name: 'Marbella' });
  assert('ambiguous' in result && result.ambiguous);
  assert.equal(result.matches?.length, 2);
  assert(!JSON.stringify(result).includes('asking_price'));
});
test('history presents chronological pages, current state and an explicit older-page cursor', async () => {
  const makeEvent = (status: string, time: string): PropertyEvent => ({ id: randomUUID(), client_property_id: randomUUID(), event_type: status,
    occurred_at: time, notes: null, metadata: { status, rejection_reason: status === 'rejected' ? 'HOA too high' : null } });
  const newest = makeEvent('rejected', '2026-10-10T12:00:00Z'), oldest = makeEvent('liked', '2026-10-08T12:00:00Z');
  const rows: PropertyHistoryRows = { client: { id: clientId, display_name: 'John' }, property, relationship: null, events: [newest, oldest], has_more: true };
  const repository = { loadClientPropertyHistory: async () => rows } as unknown as PropertyRepository;
  const result = await new RealtorPropertyService(repository).getClientPropertyHistory({ client_id: clientId, property_id: propertyId, limit: 2 });
  assert.deepEqual(result.timeline.map(e => e.status), ['liked', 'rejected']);
  assert.equal(result.timeline[1]?.rejection_reason, 'HOA too high');
  assert.deepEqual(result.coverage.next_cursor, { occurred_at: oldest.occurred_at, id: oldest.id });
});
