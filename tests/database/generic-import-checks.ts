import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createHttpServer} from '../../src/infrastructure/http-server.js';
import {verifyToolDiscovery} from '../../src/mcp/tool-contracts.js';
import type {ApplicationContext} from '../../src/infrastructure/identity.js';
import {findings29} from '../fixtures/import-findings.js';
const workspace='20000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000001';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export async function testGenericImport(t:TestContext,sql:(s:string)=>string,run:(s:string)=>Promise<string>){
  const query=(request:object,w=workspace)=>`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';select public.import_client_findings('${w}',${q(JSON.stringify(request))}::jsonb);commit;`;
  const call=(request:object,w=workspace)=>JSON.parse(sql(query(request,w)));
  const readHistory=(id:string)=>sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';select public.get_client_history('${workspace}','${id}',50,null);commit;`);
  const input={import_key:'distinct_haim2',batch_key:'one',target_display_name:'חיים2',source:{kind:'whatsapp_txt',name:'synthetic chat'},
    findings:[{key:'budget_old',kind:'fact',summary:'Historical source budget.',evidence:'explicit',source_speaker:'Haim',source_quote:'Budget USD 165000.',occurred_at:'2024-05-25T10:00:00-05:00',
      fact:{category:'requirement',key:'budget_max',value:{amount:165000,currency:'USD'}}},
      {key:'budget_date_only',kind:'fact',summary:'Later source budget; present budget unconfirmed.',evidence:'explicit',source_date:'September 2026',
        fact:{category:'requirement',key:'budget_max',value:{amount:2800000,currency:'MXN'}}},
      {key:'group_response',kind:'property_discussion',summary:'Ambiguous reaction to multiple links.',evidence:'uncertain',uncertainty:['No unit-specific attribution'],details:{links:['https://example.test/a','https://example.test/b']}},
      {key:'proposal',kind:'proposed_action',summary:'Reconfirm whether viewing is wanted.',evidence:'inferred'}],
    limitations:['Partial AI extraction; source not independently verified.']};
  const original=()=>sql(`select jsonb_build_object('clients',(select jsonb_agg(to_jsonb(c) order by id) from public.clients c where display_name='Haim'),
    'facts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.client_facts f join public.clients c on c.id=f.client_id where c.display_name='Haim'),
    'interactions',(select jsonb_agg(to_jsonb(i) order by i.id) from public.interactions i join public.clients c on c.id=i.client_id where c.display_name='Haim'),
    'properties',(select jsonb_agg(to_jsonb(p) order by p.id) from public.client_properties p join public.clients c on c.id=p.client_id where c.display_name='Haim'))`);
  const before=original();let clientId:string;
  await t.test('simple findings create distinct חיים2 from source Haim; original client stays unchanged',()=>{
    const result=call(input);clientId=result.client_id;
    assert.equal(result.saved_findings_count,4);assert.equal(result.historical_facts_count,2);
    assert.equal(sql(`select count(*) from public.clients where display_name='חיים2'`),'1');
    assert.equal(original(),before);
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${clientId}' and applicability='historical'`),'2');
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${clientId}' and applicability='confirmed_current'`),'0');
    assert.equal(sql(`select count(*) from public.tasks where client_id='${clientId}'`),'0');
    const history=readHistory(clientId);
    assert(history.includes('September 2026'));assert(history.includes('No unit-specific attribution'));
    assert.equal(sql("select to_regclass('import_private.sessions') is null"),'t');
  });
  await t.test('simple import retries and concurrent batches reuse one new client; conflicting batch/name refuses',async()=>{
    assert(call(input).replayed);
    await Promise.all([run(query(input)),run(query(input))]);
    assert.equal(sql(`select count(*) from public.interactions where client_id='${clientId}' and channel='client_import'`),'1');
    assert.throws(()=>call({...input,limitations:['changed']}),/Batch key reused/);
    assert.throws(()=>call({...input,target_display_name:'Haim'}),/another target name/);
    assert.throws(()=>call({...input,import_key:'new_key',target_display_name:'Haim'}),/exact target name/);
    const extra={...input,batch_key:'two',findings:[{key:'new_note',kind:'interaction',summary:'A further partial finding.',evidence:'agent_reported'}]};
    assert.equal(call(extra).client_id,clientId);
    assert.equal(call({...input,batch_key:'three'}).saved_findings_count,0);
    assert.equal(original(),before);
  });
  await t.test('invalid late dated fact and cross-workspace references fail atomically',()=>{
    const bad={...input,import_key:'rollback',target_display_name:'Rollback Simple',findings:[input.findings[0],{...input.findings[0],key:'bad_fact',fact:{category:'requirement',key:'budget_max',value:'invalid'}}]};
    assert.throws(()=>call(bad),/Budget requires/);
    assert.equal(sql("select count(*) from public.clients where display_name='Rollback Simple'"),'0');
    assert.throws(()=>call(input,'20000000-0000-4000-8000-000000000003'),/access denied/);
    assert.throws(()=>call({...input,batch_key:'foreign',findings:[{key:'property',kind:'property_discussion',summary:'foreign property',evidence:'explicit',occurred_at:'2026-10-09T10:00:00-05:00',property_id:'50000000-0000-4000-8000-000000000002'}]}),/Property not found/);
  });
  await t.test('29 findings project all 19 facts with dates/evidence; repeated and concurrent batches preserve verified existing memory',async()=>{
    await Promise.all([run(query(findings29)),run(query(findings29))]);
    const result=call(findings29),id=result.client_id;
    assert(result.replayed);assert.equal(result.saved_findings_count,29);assert.equal(result.historical_facts_count,19);
    const facts=JSON.parse(sql(`select jsonb_agg(to_jsonb(f) order by source_ref) from public.client_facts f where client_id='${id}'`));
    assert.equal(facts.length,19);assert(facts.every((f:any)=>f.applicability==='historical'&&f.status==='current'&&f.source_interaction_id&&f.source_ref&&f.evidence));
    assert.equal(facts.filter((f:any)=>f.source_at===null&&f.valid_from===null).length,18);
    assert.equal(facts.find((f:any)=>f.source_ref.endsWith(':budget_early')).source_date,'May 2024');
    const ambiguous=facts.find((f:any)=>f.source_ref.endsWith(':budget_ambiguous'));
    assert.deepEqual(ambiguous.value_json,{state:'unknown'});assert.equal(ambiguous.source_quote,'2.8');assert.equal(ambiguous.confidence,0.357);assert.equal(ambiguous.evidence,'uncertain');
    assert.equal(sql(`select metadata->'findings'->1->>'confidence' from public.interactions where client_id='${id}'`),'0.35678');
    assert.equal(sql(`select count(*) from public.interactions where client_id='${id}'`),'1');
    assert.equal(sql(`select jsonb_array_length(metadata->'findings') from public.interactions where client_id='${id}'`),'29');
    assert.equal(sql(`select count(*) from public.client_properties where client_id='${id}'`),'0');
    assert.equal(sql(`select count(*) from public.tasks where client_id='${id}'`),'0');
    const current=JSON.parse(sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';select to_jsonb(public.remember_client_fact('${workspace}','${id}',
      '{"category":"requirement","key":"budget_max","value":{"amount":4000000,"currency":"MXN"},"applicability":"confirmed_current","valid_from":"2026-10-01T10:00:00Z"}'));commit;`));
    const unchanged=()=>sql(`select to_jsonb(f) from public.client_facts f where id='${current.id}'`),currentBefore=unchanged();
    assert.equal(call(findings29).historical_facts_count,19);
    assert.equal(call({...findings29,batch_key:'two'}).historical_facts_count,0);
    const additional={...findings29,batch_key:'three',findings:[{...findings29.findings[0],key:'another_historical_budget'}]};
    assert.equal(call(additional).historical_facts_count,1);
    assert.equal(unchanged(),currentBefore);
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${id}' and applicability='confirmed_current' and status='current'`),'1');
    assert.equal(sql(`select count(*) from public.client_facts where client_id='${id}' and applicability='historical'`),'20');
    assert.throws(()=>call({...additional,batch_key:'changed',findings:[{...additional.findings[0],source_quote:'different evidence'}]}),/different evidence/);
    assert.throws(()=>call({...findings29,import_key:'colliding_existing',target_display_name:findings29.target_display_name}),/exact target name/);
    assert.throws(()=>sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';select public.remember_client_fact('${workspace}','${id}',
      '{"category":"preference","key":"activate_import","value":true,"applicability":"confirmed_current","source_interaction_id":"${ambiguous.source_interaction_id}"}');commit;`),/Invalid applicability/);
    assert(readHistory(id).includes('"effective_at": null'));
    assert.equal(original(),before);
  });
  await t.test('fresh MCP exposes thirteen tools, guidance and immediate findings write/recall',async()=>{
    const context={workspaceId:workspace,userId:user,supabase:{rpc:async(name:string,args:any)=>{
      if(name==='import_client_findings')return {data:call(args.p_request),error:null};
      return {data:JSON.parse(readHistory(args.p_client_id)),error:null};
    }}} as unknown as ApplicationContext;
    const server=createHttpServer({resolve:async()=>context}),client=new Client({name:'simple-import-acceptance',version:'1'});
    try{
      await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert(a&&typeof a!=='string');
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${a.port}/mcp`)));
      const tools=await client.listTools();verifyToolDiscovery(tools.tools);assert.equal(tools.tools.length,13);
      assert(!tools.tools.some(t=>['start_client_import','submit_import_batch','finalize_client_import'].includes(t.name)));
      const guidance=await client.callTool({name:'get_client_import_guidance',arguments:{}});assert(!guidance.isError);
      const written=await client.callTool({name:'import_client_findings',arguments:{...input,import_key:'latin_target',target_display_name:'Haim2'}});
      assert(!written.isError,JSON.stringify(written.content));
      const history=await client.callTool({name:'get_client_history',arguments:{client_id:(written.structuredContent as any).client_id}});
      assert(!history.isError);assert(JSON.stringify(history.structuredContent).includes('ai-findings-v1'));
      assert.equal(original(),before);
    }finally{await client.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  });
}
