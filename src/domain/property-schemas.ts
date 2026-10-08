import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const amount = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/);
const timestamp = z.iso.datetime({ offset: true });
export const relationshipStatus = z.enum(['discovered', 'considering', 'sent', 'interested', 'liked', 'rejected', 'viewing_scheduled', 'viewed', 'offer_considered', 'offer_made', 'closed']);
export const availabilityStatus = z.enum(['unknown', 'available', 'reserved', 'sold', 'unavailable']);
export const propertySourceSchema = z.strictObject({
  source_name: text(200),
  url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  external_id: text(200).optional(),
  listing_price: amount.optional(), currency: currency.optional(),
  listing_updated_at: timestamp.optional().describe('When the listing itself was updated, if known. Never substitute accessed_at.'),
  accessed_at: timestamp.optional().describe('When the listing was accessed. Defaults to the save time; does not verify availability.'),
  availability_status: availabilityStatus.optional().describe('Reported listing status, possibly unverified.'),
  availability_verified: z.boolean().optional().describe('True only if the realtor explicitly confirms availability was actually checked.'),
  availability_verified_at: timestamp.optional().describe('Time of actual verification. Defaults to save time only when verification is explicitly confirmed.'),
}).superRefine((source, ctx) => {
  if (source.listing_price !== undefined && !source.currency)
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Listing price requires explicit currency.' });
  if (source.availability_verified && (!source.availability_status || source.availability_status === 'unknown'))
    ctx.addIssue({ code: 'custom', path: ['availability_status'], message: 'Verified availability requires a known status.' });
  if (source.availability_verified_at && !source.availability_verified)
    ctx.addIssue({ code: 'custom', path: ['availability_verified_at'], message: 'A verification time requires actual verification.' });
});
export const savePropertySchema = z.strictObject({
  property_id: z.uuid().optional().describe('Existing saved property to amend or attach another source to. Omit to create a canonical property.'),
  title: text(200).optional(), property_type: text(80).optional(), development_name: text(200).optional(),
  address: text(500).optional(), neighborhood: text(200).optional(),
  city: text(200).optional(), state: text(200).optional(), country: text(100).optional(),
  bedrooms: z.number().int().min(0).max(100).optional(), bathrooms: z.number().min(0).max(100).optional(),
  interior_m2: amount.optional(), exterior_m2: amount.optional(), total_m2: amount.optional(),
  asking_price: amount.optional(), currency: currency.optional(),
  construction_status: text(80).optional(), delivery_date: z.iso.date().optional(), notes: text(2000).optional(),
  source: propertySourceSchema.optional(),
}).superRefine((property, ctx) => {
  if (!property.property_id && !property.title)
    ctx.addIssue({ code: 'custom', path: ['title'], message: 'A new saved property requires a meaningful title.' });
  if (property.asking_price !== undefined && !property.currency)
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Asking price requires explicit currency.' });
  if (property.property_id && Object.keys(property).length === 1)
    ctx.addIssue({ code: 'custom', message: 'Supply property details or a source to save.' });
});
export const propertyContextSchema = z.strictObject({
  property_id: z.uuid().optional(), name: text(200).optional().describe('Literal title/development/address substring among saved properties only. Ambiguous matches return IDs to choose from.'),
}).refine(input => Boolean(input.property_id) !== Boolean(input.name), { message: 'Supply exactly one of property_id or name.' });
export const updateClientPropertySchema = z.strictObject({
  client_id: z.uuid(), property_id: z.uuid(), status: relationshipStatus.optional(),
  interest_level: z.enum(['low', 'medium', 'high']).nullable().optional(),
  notes: text(2000).nullable().optional().describe('Current relationship notes. Changes are preserved in events; omitted fields remain unchanged.'),
  rejection_reason: text(1000).nullable().optional().describe('Reason for rejection. Omitted fields remain unchanged; use null to explicitly clear.'),
}).refine(input => ['status', 'interest_level', 'notes', 'rejection_reason'].some(key => key in input), { message: 'Supply at least one relationship change.' });
export const clientPropertyHistorySchema = z.strictObject({
  client_id: z.uuid(), property_id: z.uuid(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.strictObject({ occurred_at: timestamp, id: z.uuid() }).optional().describe('For older history, use coverage.next_cursor from the previous response.'),
});
export type SavePropertyInput = z.infer<typeof savePropertySchema>;
export type PropertyContextInput = z.infer<typeof propertyContextSchema>;
export type UpdateClientPropertyInput = z.infer<typeof updateClientPropertySchema>;
export type ClientPropertyHistoryInput = z.infer<typeof clientPropertyHistorySchema>;
