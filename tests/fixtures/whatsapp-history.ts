import type { HistoryManifest } from '../../src/import/whatsapp-history.js';
import { sha256 } from '../../src/import/whatsapp-history.js';

// Entirely synthetic. These statements are NOT evidence about the real conversation.
export const syntheticExport = Buffer.from([
  '[25/05/2024, 10:00:00] Haim: Synthetic budget: USD 165000.',
  '[10/09/2026, 11:00:00] Haim: Synthetic budget: MXN 2800000.',
  '[05/10/2026, 12:00:00] Isabel: Synthetic candidate https://example.invalid/unit asking MXN 3688800.',
  '[06/10/2026, 13:00:00] Haim: Synthetic target offer MXN 2700000; no offer submitted.',
  '[07/10/2026, 14:00:00] Haim: Synthetic candidate looks interesting.',
  '[08/10/2026, 15:00:00] Isabel: Synthetic viewing planned; completion unknown.',
].join('\n'));
const cite = (line: number, speaker: string, quote: string) => [{ line_start: line, speaker, quote }];
export function syntheticManifest(): HistoryManifest {
  return {
    format: 'realtor-whatsapp-history-v1', import_key: 'haim_isabel_history',
    source: { kind: 'original_whatsapp_export', sha256: sha256(syntheticExport), date_order: 'day-first', timezone_offset: '-05:00', client_speaker: 'Haim' },
    review: { business_only: true, source_verified: true, reviewer: 'Synthetic offline test', as_of: '2026-10-08T16:00:00-05:00' },
    client: { display_name: 'Haim' }, ambiguities: ['Synthetic appointment has no completion evidence.'],
    properties: [{ key: 'synthetic_candidate', details: { title: 'Synthetic history candidate', city: 'Playa del Carmen', state: 'Quintana Roo', country: 'Mexico' },
      citations: cite(3, 'Isabel', 'Synthetic candidate'),
      sources: [{ key: 'synthetic_quote', event_key: 'candidate_sent', source: { source_name: 'agent-reported asking price', url: 'https://example.invalid/unit', listing_price: 3688800, currency: 'MXN' } }] }],
    // Deliberately out of order to test the chronological preparation step.
    events: [
      { key: 'budget_latest', occurred_at: '2026-09-10T11:00:00-05:00', summary: 'Synthetic budget MXN 2800000.', evidence: 'explicit',
        citations: cite(2, 'Haim', 'Synthetic budget: MXN 2800000.'), facts: [{ evidence: 'explicit', current: true,
          citations: cite(2, 'Haim', 'Synthetic budget: MXN 2800000.'), fact: { category: 'requirement', key: 'budget_max', value: { amount: 2800000, currency: 'MXN' } } }] },
      { key: 'budget_old', occurred_at: '2024-05-25T10:00:00-05:00', summary: 'Synthetic old budget USD 165000.', evidence: 'explicit',
        citations: cite(1, 'Haim', 'Synthetic budget: USD 165000.'), facts: [{ evidence: 'explicit', current: false,
          citations: cite(1, 'Haim', 'Synthetic budget: USD 165000.'), fact: { category: 'requirement', key: 'budget_max', value: { amount: 165000, currency: 'USD' } } }] },
      { key: 'candidate_sent', occurred_at: '2026-10-05T12:00:00-05:00', summary: 'Synthetic candidate sent; reported historical asking price MXN 3688800.', evidence: 'explicit',
        citations: cite(3, 'Isabel', 'Synthetic candidate'), facts: [], property_key: 'synthetic_candidate', status: 'sent' },
      { key: 'target_offer', occurred_at: '2026-10-06T13:00:00-05:00', summary: 'Synthetic target offer MXN 2700000, not submitted or accepted.', evidence: 'explicit',
        citations: cite(4, 'Haim', 'Synthetic target offer MXN 2700000; no offer submitted.'), facts: [], property_key: 'synthetic_candidate', status: 'offer_considered' },
      { key: 'interest', occurred_at: '2026-10-07T14:00:00-05:00', summary: 'Synthetic candidate looks interesting.', evidence: 'explicit',
        citations: cite(5, 'Haim', 'Synthetic candidate looks interesting.'), facts: [], property_key: 'synthetic_candidate', status: 'interested' },
      { key: 'viewing_plan', occurred_at: '2026-10-08T15:00:00-05:00', summary: 'Synthetic viewing planned; completion unknown.', evidence: 'agent_reported', follow_up_status: 'planned',
        citations: cite(6, 'Isabel', 'Synthetic viewing planned; completion unknown.'), facts: [], property_key: 'synthetic_candidate' },
    ],
  };
}
