import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import type {IncomingMessage} from 'node:http';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {loadConfig} from '../src/infrastructure/config.js';
import {DevelopmentIdentityProvider} from '../src/infrastructure/identity.js';
import {verifyToolDiscovery} from '../src/mcp/tool-contracts.js';

const original='1c82c770-ce77-4eb6-9183-78f301cfb214',target='aeaa45c0-2ec0-49ed-a4fa-567d1015d6f8',receiptId='267b8152-9646-4063-995d-41fa759b8a0a';
const baselinePath='artifacts/fact-import-before.json',resultPath='artifacts/fact-import-verification.json';
const identity=new DevelopmentIdentityProvider(loadConfig()),clients:Client[]=[];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
  await identity.initialize();const context=await identity.resolve({} as IncomingMessage),db=context.supabase;
  assert.equal(new URL(loadConfig().SUPABASE_URL).hostname,'mcnhnxeayepgrstjefvg.supabase.co');
  async function rows(table:string,id:string){
    const r=await (db.from(table as any) as any).select('*').eq('workspace_id',context.workspaceId).eq(table==='clients'?'id':'client_id',id).order('id');
    assert.equal(r.error,null);return r.data as any[];
  }
  async function snapshot(id:string){
    const [client,facts,interactions,properties,tasks]=await Promise.all(['clients','client_facts','interactions','client_properties','tasks'].map(t=>rows(t,id)));
    assert.equal(client.length,1);
    // Compare old payloads across additive schema columns, without storing private data.
    const legacyFacts=facts.map(({source_date,evidence,...f})=>f);
    return {id,display_name:client[0].display_name,counts:{facts:facts.length,interactions:interactions.length,properties:properties.length,tasks:tasks.length},
      hashes:{client:hash(client),facts:hash(legacyFacts),interactions:hash(interactions),properties:hash(properties),tasks:hash(tasks)}};
  }
  if(process.argv.includes('--before')){
    const originalSnapshot=await snapshot(original),targetSnapshot=await snapshot(target);
    assert.deepEqual(originalSnapshot.counts,{facts:24,interactions:360,properties:7,tasks:0});
    assert.deepEqual(targetSnapshot.counts,{facts:0,interactions:1,properties:0,tasks:0});
    writeFileSync(baselinePath,JSON.stringify({original:originalSnapshot,target:targetSnapshot},null,2));
    console.log(JSON.stringify({baseline:'PASS',original:originalSnapshot.counts,target:targetSnapshot.counts}));
  }else{
    const before=JSON.parse(readFileSync(baselinePath,'utf8'));
    async function connect(url:string){
      const client=new Client({name:'historical-fact-fix-live',version:'1'});clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      verifyToolDiscovery((await client.listTools()).tools);return client;
    }
    async function call(client:Client,name:string,args:any){
      const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r.content));assert(r.structuredContent);return r.structuredContent as any;
    }
    const endpoint=process.env.MCP_URL??'https://parklike-uncriticizingly-johanne.ngrok-free.dev/mcp';
    const local=await connect('http://127.0.0.1:8787/mcp'),remote=await connect(endpoint);
    for(const client of [local,remote]){
      const guidance=await call(client,'get_client_import_guidance',{});
      for(const required of ['COMPACT, concise organized summary','ONE prominent, evidence-based primary','TWO secondary alternative actions displayed unobtrusively','Do not use generic fixed CTAs','do NOT show a verification/confirmation button','ask for it before creating the client'])assert(guidance.instructions.includes(required));
    }
    const receipt=(await rows('interactions',target)).find(r=>r.id===receiptId);assert(receipt);
    assert.equal(receipt.metadata.findings.length,29);assert.equal(receipt.metadata.findings.filter((f:any)=>f.kind==='fact').length,19);
    // Replay the exact stored request. No source file, new extraction, keys or receipt.
    const result=await call(remote,'import_client_findings',receipt.request_payload);
    assert(result.replayed);assert.equal(result.client_id,target);assert.equal(result.historical_facts_count,19);
    const factsAfterFirst=await rows('client_facts',target),firstHash=hash(factsAfterFirst);
    const retries=await Promise.all([call(remote,'import_client_findings',receipt.request_payload),call(local,'import_client_findings',receipt.request_payload)]);
    assert(retries.every(r=>r.replayed&&r.historical_facts_count===19));
    assert.equal(hash(await rows('client_facts',target)),firstHash);
    const fresh=await connect(endpoint),recalled=await call(fresh,'get_client_context',{client_id:target});
    assert.equal(recalled.historical_context.length,19);
    for(const key of ['requirements','preferences','dislikes','context','constraints','other_facts','properties','open_tasks'])assert.equal(recalled[key].length,0);
    assert(recalled.historical_context.every((f:any)=>f.applicability==='historical'&&f.source_at===null&&f.valid_from===null&&f.source_date&&f.evidence&&f.source_quote&&f.source_interaction_id===receiptId));
    const history=await call(fresh,'get_client_history',{client_id:target,limit:50});
    assert.equal(history.timeline.filter((f:any)=>f.kind==='fact').length,19);
    assert(history.timeline.filter((f:any)=>f.kind==='fact').every((f:any)=>f.effective_at===null));
    const originalAfter=await snapshot(original),targetAfter=await snapshot(target);
    assert.deepEqual(originalAfter,before.original);
    assert.equal(targetAfter.hashes.interactions,before.target.hashes.interactions);
    assert.deepEqual(targetAfter.counts,{facts:19,interactions:1,properties:0,tasks:0});
    const verification={status:'PASS',endpoint,before,after:{original:originalAfter,target:targetAfter},receipt:{id:receiptId,findings:29,facts:19,unchanged:true},
      checks:['fresh local/public discovery and updated guidance','existing-receipt backfill','concurrent exact retries without duplicates','fresh public context/history recall','19 date-only historical facts with evidence/provenance and null source/effective instants','zero active requirements/tasks/properties','original Haim rows unchanged']};
    writeFileSync(resultPath,JSON.stringify(verification,null,2));console.log(JSON.stringify(verification));
  }
}finally{await Promise.all(clients.map(c=>c.close()));identity.close();}
