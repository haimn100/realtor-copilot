import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

// Repair the pre-existing missing helper import with meaningful regression checks.
export async function testFactApplicability(t: TestContext, sql: (query: string) => string, _run: (query: string) => Promise<string>) {
  const workspace = '20000000-0000-4000-8000-000000000001', client = '30000000-0000-4000-8000-000000000003';
  const call = (fact: object) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
    select to_jsonb(public.remember_client_fact('${workspace}','${client}','${JSON.stringify(fact).replaceAll("'", "''")}'::jsonb)); commit;`);
  await t.test('historical applicability retains typed chronological assertions without activating or superseding current memory', () => {
    const current = JSON.parse(call({ category:'requirement', key:'budget_max', value:{amount:4000000,currency:'MXN'}, applicability:'confirmed_current', valid_from:'2026-10-01T10:00:00Z' }));
    for (const [amount, year] of [[165000,2024],[2800000,2025]] as const) call({ category:'requirement',key:'budget_max',value:{amount,currency:year===2024?'USD':'MXN'},applicability:'historical',valid_from:`${year}-01-01T10:00:00Z`,source_quote:'dated fixture' });
    assert.equal(sql(`select status from public.client_facts where id='${current.id}'`),'current');
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${client}' and applicability='historical'`),'2');
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${client}' and applicability='confirmed_current'`),'1');
    assert.throws(() => call({ category:'requirement',key:'budget_max',value:'Historical only',applicability:'historical' }), /Budget requires/);
  });
}
