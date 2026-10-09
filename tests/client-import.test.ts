import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importFindingsSchema,importGuidance,ClientImportService,SupabaseImportStore} from '../src/import/client-import.js';
import type {ApplicationContext} from '../src/infrastructure/identity.js';
const input={import_key:'haim2',batch_key:'one',target_display_name:'חיים2',findings:[{key:'budget_old',kind:'fact',summary:'Historical budget.',evidence:'explicit',source_speaker:'Haim',source_date:'May 2024',source_quote:'USD 165000',fact:{category:'requirement',key:'budget_max',value:{amount:165000,currency:'USD'}}}]};
test('simple import accepts explicit new alias, date-only evidence and partial findings without source/coverage fields',()=>{
  assert.equal(importFindingsSchema.parse(input).target_display_name,'חיים2');
  for(const field of ['source_text','session_id','chunk_index','coverage','client_id']) assert.throws(()=>importFindingsSchema.parse({...input,[field]:'forbidden'}));
  assert(importGuidance().instructions.includes('Incomplete'));
  assert(!JSON.stringify(importGuidance().results_schema).includes('session_id'));
});
test('simple results validate typed money, prevent applicability promotion, bound payloads and preserve uncertain proposals',()=>{
  const finding=input.findings[0]!;
  assert.throws(()=>importFindingsSchema.parse({...input,findings:[{...finding,fact:{...finding.fact,value:'165k'}}]}));
  assert.throws(()=>importFindingsSchema.parse({...input,findings:[{...finding,fact:{...finding.fact,applicability:'confirmed_current'}}]}));
  assert.throws(()=>importFindingsSchema.parse({...input,findings:[finding,finding]}));
  assert.throws(()=>importFindingsSchema.parse({...input,findings:[{...finding,details:'x'.repeat(49000)}]}));
  assert.throws(()=>importFindingsSchema.parse({...input,findings:[{...finding,property_id:'11111111-1111-4111-8111-111111111111'}]}));
  assert(importFindingsSchema.safeParse({...input,findings:[{key:'visit',kind:'proposed_action',summary:'Perhaps visit Saturday.',evidence:'uncertain',uncertainty:['Not confirmed']}]}).success);
});
test('simple import validates before writing and repository binds only authenticated workspace',async()=>{
  let calls=0;
  const service=new ClientImportService({write:async()=>{calls++;throw Error('unused');}});
  await assert.rejects(service.import({...input,findings:[]}));
  assert.equal(calls,0);
  const repository=new SupabaseImportStore({workspaceId:'workspace',supabase:{rpc:async(name:string,args:any)=>{
    assert.equal(name,'import_client_findings');assert.equal(args.p_workspace_id,'workspace');assert.equal(args.p_request.target_display_name,'חיים2');
    return {data:null,error:{code:'PT409',message:'batch conflict'}};
  }}} as unknown as ApplicationContext);
  await assert.rejects(repository.write(importFindingsSchema.parse(input)),/batch conflict/);
});

test('guidance requires essential identity, compact summary and one evidence-based primary action plus two unobtrusive alternatives',()=>{
  const guidance=importGuidance().instructions;
  assert(guidance.includes('ask for it before creating the client'));
  assert(guidance.includes('never invent identity'));
  assert(guidance.includes('COMPACT, concise organized summary'));
  for(const topic of ['client card/identity','dated budgets','requirements','preferences','dislikes','discussed properties','negotiations/offers','interactions/viewings','proposed follow-ups']) assert(guidance.includes(topic));
  assert(guidance.includes('do NOT show a verification/confirmation button'));
  assert(guidance.includes('ONE prominent, evidence-based primary'));
  assert(guidance.includes('TWO secondary alternative actions displayed unobtrusively'));
  for(const signal of ['conversation recency','client lifecycle','possibly no longer active','data volume versus quality','currentness of requirements','last client request','blockers','open promises','deal stage']) assert(guidance.includes(signal));
  assert(guidance.includes('Do not use generic fixed CTAs'));
  assert(guidance.includes('separately confirmed-current knowledge'));
  assert(guidance.includes('Do not create tasks or promote historical facts without user approval'));
  assert.throws(()=>importFindingsSchema.parse({...input,target_display_name:''}));
  assert.throws(()=>importFindingsSchema.parse({...input,target_display_name:undefined}));
});
