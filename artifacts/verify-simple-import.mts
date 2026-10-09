import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {verifyToolDiscovery} from '../src/mcp/tool-contracts.js';

const endpoint='https://parklike-uncriticizingly-johanne.ngrok-free.dev/mcp';
const clients:Client[]=[];
async function connect(url:string){
  const client=new Client({name:'simple-import-synthetic-smoke',version:'1'});
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const listed=await client.listTools();verifyToolDiscovery(listed.tools);
  assert.equal(listed.tools.length,13);
  console.log(`Fresh discovery: ${url}: 13 current tools and matching schemas.`);
  return client;
}
async function call(client:Client,name:string,args:Record<string,unknown>){
  const r=await client.callTool({name,arguments:args});
  assert(!r.isError,JSON.stringify(r.content));assert(r.structuredContent);
  return r.structuredContent as any;
}
try{
  await connect('http://127.0.0.1:8787/mcp');
  const client=await connect(endpoint),guidance=await call(client,'get_client_import_guidance',{});
  assert.equal(guidance.version,'ai-findings-v1');
  const token=randomUUID(),input={import_key:`smoke-${token}`,batch_key:'one',target_display_name:`חיים2 smoke ${token}`,
    source:{kind:'whatsapp_txt',name:'SYNTHETIC: no original transcript'},findings:[
      {key:'dated_budget',kind:'fact',summary:'Synthetic historical budget.',evidence:'explicit',source_speaker:'Haim',
        occurred_at:'2024-05-25T10:00:00-05:00',source_quote:'Synthetic budget USD 165000.',fact:{category:'requirement',key:'budget_max',value:{amount:165000,currency:'USD'}}},
      {key:'later_budget',kind:'fact',summary:'Date-only source budget; present applicability unconfirmed.',evidence:'uncertain',source_date:'September 2026',
        uncertainty:['No source timezone or exact instant.'],fact:{category:'requirement',key:'budget_max',value:{amount:2800000,currency:'MXN'}}},
      {key:'group_response',kind:'property_discussion',summary:'Synthetic ambiguous response to two offers.',evidence:'uncertain',
        details:{links:['https://example.test/one','https://example.test/two']},uncertainty:['No unit-specific attribution.']},
      {key:'reconfirm',kind:'proposed_action',summary:'Reconfirm synthetic client interest.',evidence:'inferred'}],
    limitations:['Partial synthetic extraction; no source coverage claim.']};
  const saved=await call(client,'import_client_findings',input);
  writeFileSync('artifacts/simple-import-live-result.json',JSON.stringify({endpoint,input,saved},null,2));
  assert.equal(saved.saved_findings_count,4);assert.equal(saved.historical_facts_count,1);assert.equal(saved.display_name,input.target_display_name);
  const retry=await call(client,'import_client_findings',input);assert(retry.replayed);assert.equal(retry.client_id,saved.client_id);
  const extra=await call(client,'import_client_findings',{...input,batch_key:'two',findings:[input.findings[2],
    {key:'additional',kind:'interaction',summary:'One further synthetic partial result.',evidence:'agent_reported'}]});
  assert.equal(extra.client_id,saved.client_id);assert.equal(extra.saved_findings_count,1);
  const context=await call(client,'get_client_context',{client_id:saved.client_id});
  assert.equal(context.requirements.length,0);assert.equal(context.open_tasks.length,0);assert.equal(context.historical_context.length,1);
  const fresh=await connect(endpoint),history=await call(fresh,'get_client_history',{client_id:saved.client_id,limit:50});
  const serialized=JSON.stringify(history);assert(serialized.includes('September 2026'));assert(serialized.includes('No unit-specific attribution.'));
  assert(serialized.includes('ai-findings-v1'));assert.equal(history.client.id,saved.client_id);
  console.log(JSON.stringify({status:'PASS',synthetic_client_id:saved.client_id,target_display_name:saved.display_name,checks:['partial compact results','source Haim/new alias','historical/date-only evidence','identical retry','bounded second batch/finding dedup','zero current requirements/tasks','fresh connection persisted recall']}));
}finally{await Promise.all(clients.map(c=>c.close()));}
