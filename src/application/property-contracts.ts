import type { Tables } from '../data/database.types.js';
import type { SavePropertyInput, UpdateClientPropertyInput, ClientPropertyHistoryInput } from '../domain/property-schemas.js';

export type SavedProperty = Pick<Tables<'properties'>, 'id' | 'title' | 'property_type' | 'development_name' | 'address' | 'neighborhood' | 'city' | 'state' | 'country' | 'bedrooms' | 'bathrooms' | 'interior_m2' | 'exterior_m2' | 'total_m2' | 'asking_price' | 'currency' | 'construction_status' | 'delivery_date' | 'notes' | 'availability_status' | 'availability_verified_at'>;
export type PropertySource = Pick<Tables<'property_sources'>, 'id' | 'source_name' | 'url' | 'external_id' | 'asking_price' | 'currency' | 'listing_updated_at' | 'accessed_at' | 'availability_status' | 'availability_verified' | 'availability_verified_at'>;
export type PropertyRelationship = Pick<Tables<'client_properties'>, 'id' | 'client_id' | 'property_id' | 'status' | 'interest_level' | 'notes' | 'rejection_reason' | 'first_considered_at' | 'sent_at' | 'viewed_at' | 'updated_at'>;
export type PropertyEvent = Pick<Tables<'client_property_events'>, 'id' | 'client_property_id' | 'event_type' | 'notes' | 'metadata' | 'occurred_at'>;
export type PropertyResearch = Pick<Tables<'research_items'>, 'id' | 'title' | 'summary' | 'source_name' | 'source_url' | 'accessed_at' | 'source_updated_at' | 'confidence'>;
export interface PropertyContextRows {
  property: SavedProperty; sources: PropertySource[];
  clients: (PropertyRelationship & { client: { id: string; display_name: string } })[];
  events: PropertyEvent[]; research: PropertyResearch[]; truncated: string[];
}
export interface PropertyHistoryRows {
  client: { id: string; display_name: string }; property: SavedProperty;
  relationship: PropertyRelationship | null; events: PropertyEvent[]; has_more: boolean;
}
export interface PropertyRepository {
  saveProperty(input: SavePropertyInput): Promise<{ property: SavedProperty; source: PropertySource | null }>;
  findSavedProperties(name: string): Promise<{ matches: SavedProperty[]; has_more: boolean }>;
  loadPropertyContext(propertyId: string): Promise<PropertyContextRows>;
  updateClientProperty(input: UpdateClientPropertyInput): Promise<PropertyRelationship>;
  loadClientPropertyHistory(input: ClientPropertyHistoryInput): Promise<PropertyHistoryRows>;
}
