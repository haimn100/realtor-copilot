import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { importStartOutputSchema, importProgressSchema } from '../src/import/client-import.js';
import { verifyToolDiscovery } from '../src/mcp/tool-contracts.js';

const marker = `Import Smoke ${randomUUID()}`;
const sourceName = `${marker}.txt`;
const endpoint = 'https://parklike-uncriticizingly-johanne.ngrok-free.dev/mcp';
const client = new Client({ name: 'targeted-hosted-import-smoke', version: '1' });
async function call(name: string, args: object) {
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
  assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent;
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const listed = await client.listTools(); verifyToolDiscovery(listed.tools);
  const start = importStartOutputSchema.parse(await call('start_client_import', {
    source_text: `09/10/2026, 10:00 - ${marker}: Budget MXN 1000000.\n09/10/2026, 10:01 - Smoke Realtor: Noted.`,
    source_name: sourceName, date_order: 'day-first', timezone_offset: '-05:00',
  }));
  const buyer = start.messages[0]!, realtor = start.messages[1]!;
  const citations = [{ message_id: buyer.message_id, quote: 'Budget MXN 1000000.' }];
  const finalize = { session_id: start.session_id, version: start.version,
    identity: { client_speaker: marker, agent_speakers: [realtor.speaker], display_name: marker, citations } };
  const premature = await client.callTool({ name: 'finalize_client_import', arguments: finalize }); assert(premature.isError);
  const batch = { session_id: start.session_id, version: start.version, chunk_index: 0,
    dispositions: start.messages.map(m => ({ message_id: m.message_id, classification: 'business' })),
    events: [{ key: 'smoke_budget', anchor_message_id: buyer.message_id, summary: 'Synthetic historical budget smoke check.',
      evidence: 'explicit', confidence: 1, uncertainty: [], citations,
      facts: [{ fact: { category: 'requirement', key: 'budget_max', value: { amount: 1000000, currency: 'MXN' } }, evidence: 'explicit', citations }],
      property_claims: [], proposed_next_actions: [] }],
  };
  await call('submit_import_batch', batch);
  assert(importProgressSchema.parse(await call('submit_import_batch', batch)).replayed);
  const completed = importProgressSchema.parse(await call('finalize_client_import', finalize));
  assert.equal(completed.status, 'completed'); assert.deepEqual(completed.missing_chunks, []);
  assert(importProgressSchema.parse(await call('finalize_client_import', finalize)).replayed);
  const history = JSON.stringify(await call('get_client_history', { client_id: completed.client_id }));
  assert(history.includes('historical')); assert(history.includes('client-import-v1')); assert(history.includes('Budget MXN 1000000.'));
  const result = { endpoint, tools: listed.tools.length, marker, source_name: sourceName,
    session_id: start.session_id, client_id: completed.client_id, result: completed.result,
    checks: ['premature completion refused', 'batch retry replayed', 'completion retry replayed', 'persisted historical evidence recalled'] };
  writeFileSync('artifacts/client-import-live-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await client.close(); }
