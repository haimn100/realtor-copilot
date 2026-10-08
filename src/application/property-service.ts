import type { PropertyRepository, SavedProperty, PropertyRelationship, PropertyEvent, PropertySource } from './property-contracts.js';
import { savePropertySchema, propertyContextSchema, updateClientPropertySchema, clientPropertyHistorySchema, type SavePropertyInput, type PropertyContextInput, type UpdateClientPropertyInput, type ClientPropertyHistoryInput } from '../domain/property-schemas.js';
import { AppError } from '../domain/errors.js';

export const PROPERTY_CONTEXT_LIMITS = { sources: 6, clients: 12, events: 12, research: 5 } as const;
export const clip = (value: string | null, max = 500) => value && value.length > max ? value.slice(0, max - 1) + '…' : value;
export function summarizeProperty(p: SavedProperty) {
  return { ...p, title: clip(p.title, 200), development_name: clip(p.development_name, 200),
    address: clip(p.address), neighborhood: clip(p.neighborhood, 200), city: clip(p.city, 200),
    state: clip(p.state, 200), country: clip(p.country, 100), property_type: clip(p.property_type, 80),
    construction_status: clip(p.construction_status, 80), notes: clip(p.notes),
    availability_verified: p.availability_verified_at !== null };
}
export function summarizeRelationship(p: PropertyRelationship) {
  return { ...p, notes: clip(p.notes), rejection_reason: clip(p.rejection_reason) };
}
function summarizeSource(s: PropertySource) {
  return { ...s, source_name: clip(s.source_name, 200), url: clip(s.url, 2000), external_id: clip(s.external_id, 200),
    availability_status: clip(s.availability_status, 80) };
}
export function summarizeEvent(event: PropertyEvent) {
  const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
  const string = (key: string) => typeof metadata[key] === 'string' ? clip(metadata[key] as string) : null;
  return { id: event.id, relationship_id: event.client_property_id, occurred_at: event.occurred_at,
    event_type: clip(event.event_type, 80), previous_status: string('previous_status'),
    status: string('status'), interest_level: string('interest_level'), notes: clip(event.notes),
    rejection_reason: string('rejection_reason') };
}
export class RealtorPropertyService {
  constructor(private readonly repository: PropertyRepository) {}
  async saveProperty(input: SavePropertyInput) {
    const result = await this.repository.saveProperty(savePropertySchema.parse(input));
    return { property: summarizeProperty(result.property), source: result.source ? summarizeSource(result.source) : null };
  }
  async getPropertyContext(input: PropertyContextInput) {
    const parsed = propertyContextSchema.parse(input);
    let propertyId = parsed.property_id;
    if (!propertyId) {
      const result = await this.repository.findSavedProperties(parsed.name!);
      if (!result.matches.length) throw new AppError('NOT_FOUND', 'No saved property matches this name in this workspace.');
      if (result.matches.length > 1 || result.has_more) return { ambiguous: true as const,
        matches: result.matches.map(p => ({ property_id: p.id, title: clip(p.title, 200), neighborhood: clip(p.neighborhood, 200), development_name: clip(p.development_name, 200) })), has_more: result.has_more };
      propertyId = result.matches[0]!.id;
    }
    const rows = await this.repository.loadPropertyContext(propertyId);
    return { property: summarizeProperty(rows.property), sources: rows.sources.map(summarizeSource),
      clients: rows.clients.map(p => ({ ...summarizeRelationship(p), client: { id: p.client.id, display_name: clip(p.client.display_name, 200) } })),
      recent_events: rows.events.map(summarizeEvent),
      research: rows.research.map(r => ({ ...r, title: clip(r.title, 200), summary: clip(r.summary), source_name: clip(r.source_name, 200), source_url: clip(r.source_url, 2000) })),
      coverage: { truncated_sections: rows.truncated, limits: PROPERTY_CONTEXT_LIMITS } };
  }
  async updateClientProperty(input: UpdateClientPropertyInput) {
    return { relationship: summarizeRelationship(await this.repository.updateClientProperty(updateClientPropertySchema.parse(input))) };
  }
  async getClientPropertyHistory(input: ClientPropertyHistoryInput) {
    const parsed = clientPropertyHistorySchema.parse(input);
    const rows = await this.repository.loadClientPropertyHistory(parsed);
    // Repository reads newest first; each returned page is presented chronologically.
    const oldest = rows.events.at(-1);
    return { client: { ...rows.client, display_name: clip(rows.client.display_name, 200) }, property: { id: rows.property.id, title: clip(rows.property.title, 200) },
      current_state: rows.relationship ? summarizeRelationship(rows.relationship) : null,
      timeline: [...rows.events].reverse().map(summarizeEvent),
      coverage: { limit: parsed.limit ?? 30, has_more: rows.has_more,
        next_cursor: rows.has_more && oldest ? { occurred_at: oldest.occurred_at, id: oldest.id } : null } };
  }
}
