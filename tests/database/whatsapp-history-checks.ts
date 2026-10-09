import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { generateImportSql, validateManifest, sourceRef } from '../../src/import/whatsapp-history.js';
import { syntheticExport, syntheticManifest } from '../fixtures/whatsapp-history.js';
import { RealtorPropertyService } from '../../src/application/property-service.js';
import { SupabaseClientRepository } from '../../src/data/supabase-client-repository.js';
import { RealtorClientService, buildClientContext } from '../../src/application/client-service.js';
import { TOOL_CONTRACTS } from '../../src/mcp/tool-contracts.js';
import type { ApplicationContext } from '../../src/infrastructure/identity.js';
import type { PropertyRepository } from '../../src/application/property-contracts.js';
import { RELATIONSHIP_COLUMNS } from '../../src/data/supabase-property-repository.js';

const workspace = '20000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000001';
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export async function testWhatsAppHistory(t: TestContext, sql: (query: string) => string, run: (query: string) => Promise<string>) {
  const manifest = validateManifest(syntheticManifest(), syntheticExport);
  const generated = generateImportSql(manifest, workspace);
  const execute = `SET request.jwt.claim.sub=${q(user)}; ${generated}`;
  const read = (query: string) => JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${q(user)}; ${query}; COMMIT;`) || 'null');
  const johnBefore = sql(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c WHERE display_name ILIKE '%John%'`);
  const factsBefore = sql(`SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.client_facts f JOIN public.clients c ON c.id=f.client_id WHERE c.display_name ILIKE '%John%'`);
  let clientId: string, propertyId: string;
  const snapshot = () => sql(`SELECT jsonb_build_object(
    'clients',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c WHERE id=${q(clientId)}),
    'facts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.client_facts f WHERE client_id=${q(clientId)}),
    'interactions',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.interactions i WHERE client_id=${q(clientId)}),
    'links',(SELECT jsonb_agg(to_jsonb(cp) ORDER BY id) FROM public.client_properties cp WHERE client_id=${q(clientId)}),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.client_property_events e JOIN public.client_properties cp ON cp.id=e.client_property_id WHERE cp.client_id=${q(clientId)}),
    'properties',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.properties p WHERE id=${q(propertyId)}),
    'sources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.property_sources s WHERE property_id=${q(propertyId)}))`);

  await t.test('WhatsApp SQL executes with member RLS; repeat and concurrent executions create no duplicates', async () => {
    sql(execute);
    clientId = sql(`SELECT id FROM public.clients WHERE workspace_id=${q(workspace)} AND split_part(notes,';',1)='whatsapp-import:haim_isabel_history'`);
    propertyId = sql(`SELECT property_id FROM public.client_properties WHERE client_id=${q(clientId)}`);
    const before = snapshot();
    sql(execute);
    await Promise.all([run(execute), run(execute)]);
    assert.equal(snapshot(), before);
    assert.equal(sql(`SELECT count(*) FROM public.interactions WHERE client_id=${q(clientId)}`), '7');
    assert.equal(sql(`SELECT count(*) FROM public.client_property_events e JOIN public.client_properties cp ON cp.id=e.client_property_id WHERE cp.client_id=${q(clientId)}`), '5');
    assert.equal(sql(`SELECT count(*) FROM public.property_sources WHERE property_id=${q(propertyId)}`), '1');
  });
  await t.test('WhatsApp facts, historical prices, planned visits and follow-ups retain truthful semantics', () => {
    const current = read(`SELECT jsonb_agg(to_jsonb(f)) FROM public.client_facts f WHERE client_id=${q(clientId)} AND status='current' AND applicability='confirmed_current'`);
    assert.equal(current, null);
    const historic = read(`SELECT jsonb_agg(to_jsonb(f) ORDER BY valid_from) FROM public.client_facts f WHERE client_id=${q(clientId)} AND applicability='historical'`);
    assert.equal(historic.length, 2);
    assert.deepEqual(historic[0].value_json, { amount: 165000, currency: 'USD' });
    assert.deepEqual(historic[1].value_json, { amount: 2800000, currency: 'MXN' });
    assert.equal(historic[0].source_quote, 'Synthetic budget: USD 165000.');
    assert(historic.every((f: any) => f.source_interaction_id && f.superseded_by_id === null));
    assert.equal(sql(`SELECT count(*) FROM public.tasks WHERE client_id=${q(clientId)}`), '0');
    const property = read(`SELECT to_jsonb(p) FROM public.properties p WHERE id=${q(propertyId)}`);
    assert.equal(property.asking_price, null); assert.equal(property.availability_status, 'unknown');
    const source = read(`SELECT to_jsonb(s) FROM public.property_sources s WHERE property_id=${q(propertyId)}`);
    assert.equal(source.asking_price, 3688800); assert.equal(source.availability_verified, false);
    assert.equal(source.listing_updated_at, null); assert(source.source_name.includes('2026-10-05'));
    const relation = read(`SELECT to_jsonb(cp) FROM public.client_properties cp WHERE client_id=${q(clientId)}`);
    assert.equal(relation.status, 'interested'); assert.equal(relation.viewed_at, null);
    assert.equal(Date.parse(relation.sent_at), Date.parse('2026-10-05T17:00:00Z'));
  });
  await t.test('WhatsApp existing history/context tool implementations retrieve stored dates and provenance', async () => {
    const clientRepo = new SupabaseClientRepository({ workspaceId: workspace, supabase: {
      rpc: async (name: string, args: any) => {
        assert.equal(name, 'get_client_history');
        return { data: read(`SELECT public.get_client_history(${q(workspace)},${q(args.p_client_id)},${args.p_limit},${args.p_cursor ? q(JSON.stringify(args.p_cursor)) + '::jsonb' : 'null'})`), error: null };
      },
    } } as unknown as ApplicationContext);
    const clientService = new RealtorClientService(clientRepo);
    const all: any[] = [];
    let cursor;
    do {
      const page = await clientService.getClientHistory({ client_id: clientId, limit: 3, ...(cursor ? { cursor } : {}) });
      assert(TOOL_CONTRACTS.get_client_history.outputSchema.safeParse(page).success);
      all.push(...page.timeline); cursor = page.coverage.next_cursor ?? undefined;
    } while (cursor);
    assert.equal(new Set(all.map(e => e.kind + ':' + e.id)).size, all.length);
    const old = all.find(e => e.kind === 'fact' && e.data.value_json?.currency === 'USD');
    assert.equal(Date.parse(old.effective_at), Date.parse('2024-05-25T15:00:00Z'));
    assert(old.source_ref.startsWith(`wa:${manifest.source.sha256}:lines:1`));
    assert(old.data.source_interaction_id);
    const event = all.find(e => e.kind === 'property_event' && e.data.event_type === 'offer_considered');
    assert.equal(Date.parse(event.effective_at), Date.parse('2026-10-06T18:00:00Z'));
    assert.equal(event.data.metadata.source_ref, sourceRef(manifest, manifest.events[3]!.citations));
    const propertyRepo = {
      loadClientPropertyHistory: async () => ({
        client: read(`SELECT jsonb_build_object('id',id,'display_name',display_name) FROM public.clients WHERE id=${q(clientId)}`),
        property: read(`SELECT to_jsonb(p) FROM public.properties p WHERE id=${q(propertyId)}`),
        relationship: read(`SELECT to_jsonb(cp) FROM (SELECT ${RELATIONSHIP_COLUMNS} FROM public.client_properties WHERE client_id=${q(clientId)}) cp`),
        events: read(`SELECT jsonb_agg(to_jsonb(e) ORDER BY occurred_at DESC,e.id DESC) FROM public.client_property_events e WHERE client_property_id=(SELECT id FROM public.client_properties WHERE client_id=${q(clientId)})`), has_more: false,
      }),
    } as unknown as PropertyRepository;
    const propertyHistory = await new RealtorPropertyService(propertyRepo).getClientPropertyHistory({ client_id: clientId, property_id: propertyId });
    assert(TOOL_CONTRACTS.get_client_property_history.outputSchema.safeParse(propertyHistory).success);
    assert.equal(propertyHistory.current_state!.status, 'interested');
    assert(propertyHistory.timeline.some(e => e.event_type === 'offer_considered' && e.notes!.includes('2700000')));
    assert(propertyHistory.timeline.some(e => e.notes!.startsWith('Import snapshot only')));
    assert(propertyHistory.timeline.some(e => e.notes!.includes(`wa:${manifest.source.sha256}`)));
    const client = read(`SELECT jsonb_build_object('id',id,'display_name',display_name,'first_name',first_name,'last_name',last_name,'email',email,'phone',phone,'notes',notes,'status',status,'memory_version',memory_version) FROM public.clients WHERE id=${q(clientId)}`);
    const facts = read(`SELECT jsonb_agg(to_jsonb(f)) FROM public.client_facts f WHERE client_id=${q(clientId)}`);
    const context = buildClientContext({ client, facts, properties: [], interactions: [], tasks: [], searches: [], truncated: [] });
    assert.equal(context.requirements.length, 0);
    assert.equal(context.historical_context.length, 2);
  });
  await t.test('WhatsApp changed manifest and unauthorized workspace fail without changing imported memory', () => {
    const before = snapshot(), changed = syntheticManifest(); changed.events[0]!.summary += ' changed';
    assert.throws(() => sql(`SET request.jwt.claim.sub=${q(user)}; ${generateImportSql(validateManifest(changed, syntheticExport), workspace)}`));
    assert.equal(snapshot(), before);
    assert.throws(() => sql(`SET request.jwt.claim.sub=${q(user)}; ${generateImportSql(manifest, '20000000-0000-4000-8000-000000000003')}`));
    assert.equal(snapshot(), before);
  });
  await t.test('WhatsApp late failure rolls back client, facts, properties and receipt; John is unchanged', () => {
    const isolated = '20000000-0000-4000-8000-000000000099';
    sql(`INSERT INTO public.workspaces(id,name) VALUES('${isolated}','Synthetic WhatsApp rollback'); INSERT INTO public.workspace_members(workspace_id,user_id) VALUES('${isolated}','${user}');`);
    const broken = generateImportSql(manifest, isolated).replace("RAISE NOTICE 'Historical import complete';", "RAISE EXCEPTION 'synthetic late failure';");
    assert.throws(() => sql(`SET request.jwt.claim.sub=${q(user)}; ${broken}`));
    for (const table of ['clients','client_facts','properties','property_sources','client_properties','client_property_events','interactions','tasks'])
      assert.equal(sql(`SELECT count(*) FROM public.${table} WHERE workspace_id='${isolated}'`), '0');
    assert.equal(sql(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c WHERE display_name ILIKE '%John%'`), johnBefore);
    assert.equal(sql(`SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.client_facts f JOIN public.clients c ON c.id=f.client_id WHERE c.display_name ILIKE '%John%'`), factsBefore);
  });
}
