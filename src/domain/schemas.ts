import { z } from 'zod';

export const clientStatus = z.enum(['lead', 'active', 'paused', 'won', 'lost', 'archived']);
export const factCategory = z.enum(['requirement', 'preference', 'dislike', 'context', 'constraint', 'other']);
const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.strictObject({ amount: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/) });
// Small canonical vocabulary, with custom snake_case keys still supported.
export const CANONICAL_FACTS = {
  budget_min: 'Money with explicit currency', budget_max: 'Money with explicit currency',
  preferred_area: 'Location string or list', excluded_areas: 'Location string or list',
  bedrooms_min: 'Nonnegative integer', bedrooms_max: 'Nonnegative integer',
  construction_status: 'completed, under_construction, preconstruction (string or list)',
  preconstruction: 'Boolean: false means client excludes preconstruction',
  intended_use: 'investment, residence, vacation, mixed, or client wording',
  preferences: 'String or list of desired features', exclusions: 'String or list of excluded features',
} as const;
export const factState = z.strictObject({ state: z.enum(['unknown', 'unrestricted']) });
export const factValue = z.union([text(1000), z.number().finite(), z.boolean(), z.array(text(200)).min(1).max(20), money, factState]);
export const factSchema = z.strictObject({
  category: factCategory,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).describe(`Stable snake_case concept. Reuse the same key to replace prior knowledge, including category changes. Lists represent multiple values. Custom keys are supported. Canonical vocabulary: ${JSON.stringify(CANONICAL_FACTS)}`),
  value: factValue.describe('Budget values use {amount:4500000,currency:"MXN"}; bedrooms use numbers; other values use strings, booleans, or lists.'),
  applicability: z.enum(['confirmed_current', 'historical', 'unconfirmed']).optional().describe('Separate from revision status. Historical imports must use historical, even for the latest source statement. Only explicitly confirmed current knowledge is active; omitted on ordinary new writes retains legacy current-write behavior.'),
  source_at: z.iso.datetime({ offset: true }).optional().describe('Source statement time; defaults to linked interaction occurred_at, otherwise recording time.'),
  valid_until: z.iso.datetime({ offset: true }).optional().describe('Exclusive end of applicability; independent of supersession.'),
  source_quote: text(1000).optional().describe('Exact source wording, especially for ambiguous values; never replace typed value with prose.'),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  source_interaction_id: z.uuid().optional(),
  source_ref: text(300).optional(),
  strength: z.enum(['hard', 'soft', 'unspecified']).optional().describe('Hard = must have/must exclude; soft = negotiable. Existing categories remain valid.'),
  valid_from: z.iso.datetime({ offset: true }).optional().describe('When information became true; defaults to interaction occurred_at, otherwise recording time.'),
  expected_fact_id: z.uuid().nullable().optional().describe('Compare against the current fact ID; null requires no existing value. Required to correct older effective information.'),
}).superRefine((fact, ctx) => {
  if (Buffer.byteLength(JSON.stringify(fact), 'utf8') > 3500)
    ctx.addIssue({ code: 'custom', message: 'Durable facts must fit within 3500 UTF-8 bytes. Store compact knowledge, not transcripts.' });
  if (fact.valid_from && fact.valid_until && Date.parse(fact.valid_until) <= Date.parse(fact.valid_from))
    ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'End must follow effective start.' });
  if (fact.key === 'view_before_offer' && typeof fact.value !== 'boolean' && !factState.safeParse(fact.value).success)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'view_before_offer requires a boolean or explicit state.' });
  const state = factState.safeParse(fact.value).success;
  if (!state && /^budget_(min|max)$/.test(fact.key) && !money.safeParse(fact.value).success)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Budget requires amount and currency.' });
  if (!state && /^bedrooms_(min|max)$/.test(fact.key) && (typeof fact.value !== 'number' || !Number.isInteger(fact.value) || fact.value < 0))
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Bedrooms must be a nonnegative integer.' });
});
export const createClientSchema = z.strictObject({
  display_name: text(200), first_name: text(100).optional(), last_name: text(100).optional(),
  email: z.email().max(254).optional(), phone: text(50).optional(),
  status: clientStatus.optional(), notes: text(2000).optional(),
  facts: z.array(factSchema).max(40).optional(),
}).superRefine((client, ctx) => {
  const keys = client.facts?.map(f => f.key) ?? [];
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['facts'], message: 'Initial fact keys must be unique.' });
});
export const findClientsSchema = z.strictObject({ name: text(200), status: clientStatus.optional(), limit: z.number().int().min(1).max(20).optional() });
export const clientContextSchema = z.strictObject({ client_id: z.uuid().describe('Resolve names using find_clients first; do not guess IDs.') });
export const rememberFactSchema = z.strictObject({ client_id: z.uuid(), fact: factSchema });
export type FactInput = z.infer<typeof factSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type FindClientsInput = z.infer<typeof findClientsSchema>;

export const clientPatchSchema = z.strictObject({
  display_name: text(200).optional(), first_name: text(100).nullable().optional(), last_name: text(100).nullable().optional(),
  email: z.email().max(254).nullable().optional(), phone: text(50).nullable().optional(),
  status: clientStatus.optional(), notes: text(2000).nullable().optional(),
}).refine(patch => Object.keys(patch).length > 0, 'Supply at least one profile field.');
const writeIdentity = {
  client_id: z.uuid().describe('Use find_clients and disambiguate before writing. Names are never accepted for writes.'),
  expected_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).describe('memory_version from get_client_context; stale writes fail. Re-read and reconcile on CONFLICT.'),
  idempotency_key: text(100).describe('Unique key for this operation; reuse the same key and identical arguments for retries.'),
};
export const updateClientSchema = z.strictObject({ ...writeIdentity, patch: clientPatchSchema, source_ref: text(300).optional() });
export const followUpSchema = z.strictObject({
  title: text(200), description: text(2000).optional(),
  due_at: z.iso.datetime({ offset: true }).optional().describe('Use only when a deadline time is known, with an explicit offset. For Friday without a time use due_date.'),
  due_date: z.iso.date().optional().describe('Date-only deadline in the user local calendar, e.g. Friday 2026-10-09; do not invent a time. Use due_date or due_at, not both.'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
}).refine(task => !(task.due_at && task.due_date), 'Supply due_at or due_date, not both.');
export const recordInteractionSchema = z.strictObject({
  ...writeIdentity,
  interaction_type: z.enum(['call', 'meeting', 'message', 'note']),
  occurred_at: z.iso.datetime({ offset: true }).describe('Actual conversation time with timezone offset, separate from recording time.'),
  summary: text(2000), content: text(12000).optional(), channel: text(100).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(), source_ref: text(300).optional(),
  facts: z.array(factSchema).max(40).optional(), follow_ups: z.array(followUpSchema).max(20).optional(),
}).superRefine((input, ctx) => {
  const keys = input.facts?.map(f => f.key) ?? [];
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['facts'], message: 'Fact keys must be unique within an interaction.' });
  if (input.facts?.some(f => f.source_interaction_id !== undefined)) ctx.addIssue({ code: 'custom', path: ['facts'], message: 'Facts are attributed to the new interaction automatically; omit source_interaction_id.' });
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 48000) ctx.addIssue({ code: 'custom', message: 'Interaction must fit within 48000 UTF-8 bytes.' });
});
export const clientHistorySchema = z.strictObject({
  client_id: z.uuid(), limit: z.number().int().min(1).max(50).optional(),
  cursor: z.strictObject({ recorded_at: z.iso.datetime({ offset: true }), kind: z.enum(['client', 'fact', 'interaction', 'task', 'property_event']), id: z.uuid() }).optional(),
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type RecordInteractionInput = z.infer<typeof recordInteractionSchema>;
export type ClientHistoryInput = z.infer<typeof clientHistorySchema>;
