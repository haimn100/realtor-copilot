import { z } from 'zod';

export const clientStatus = z.enum(['lead', 'active', 'paused', 'won', 'lost', 'archived']);
export const factCategory = z.enum(['requirement', 'preference', 'dislike', 'context', 'constraint', 'other']);
const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.strictObject({ amount: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/) });
export const factValue = z.union([text(1000), z.number().finite(), z.boolean(), z.array(text(200)).min(1).max(20), money]);
export const factSchema = z.strictObject({
  category: factCategory,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).describe('Stable snake_case concept, e.g. budget_max, bedrooms_min, preferred_area, preconstruction, intended_use. Reuse the same key to replace prior knowledge. Use a list for multiple areas.'),
  value: factValue.describe('Budget values use {amount:4500000,currency:"MXN"}; bedrooms use numbers; other values use strings, booleans, or lists.'),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  source_interaction_id: z.uuid().optional(),
  source_ref: text(300).optional(),
}).superRefine((fact, ctx) => {
  if (Buffer.byteLength(JSON.stringify(fact), 'utf8') > 3500)
    ctx.addIssue({ code: 'custom', message: 'Durable facts must fit within 3500 UTF-8 bytes. Store compact knowledge, not transcripts.' });
  if (/^budget_(min|max)$/.test(fact.key) && !money.safeParse(fact.value).success)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Budget requires amount and currency.' });
  if (/^bedrooms_(min|max)$/.test(fact.key) && (typeof fact.value !== 'number' || !Number.isInteger(fact.value) || fact.value < 0))
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
