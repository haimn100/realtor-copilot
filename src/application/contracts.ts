import type { Tables } from '../data/database.types.js';
import type { CreateClientInput, FactInput, FindClientsInput, UpdateClientInput, RecordInteractionInput, ClientHistoryInput } from '../domain/schemas.js';
import type { PropertyEvent } from './property-contracts.js';

export type ClientIdentity = Pick<Tables<'clients'>, 'id' | 'display_name' | 'first_name' | 'last_name' | 'status' | 'email' | 'phone' | 'notes' | 'memory_version'>;
export type FactRecord = Pick<Tables<'client_facts'>, 'id' | 'category' | 'key' | 'value_json' | 'status' | 'confidence' | 'importance' | 'valid_from' | 'created_at' | 'created_by' | 'source_type' | 'source_ref' | 'source_interaction_id' | 'superseded_by_id' | 'strength' | 'applicability' | 'source_at' | 'valid_until' | 'source_quote'> & Partial<Pick<Tables<'client_facts'>, 'source_date' | 'evidence'>>;
export type PropertyRecord = Pick<Tables<'properties'>, 'id' | 'title' | 'neighborhood' | 'bedrooms' | 'asking_price' | 'currency' | 'construction_status' | 'availability_status'>;
export type ConsideredProperty = Pick<Tables<'client_properties'>, 'id' | 'property_id' | 'status' | 'interest_level' | 'notes' | 'rejection_reason' | 'viewed_at' | 'updated_at'> & { property: PropertyRecord | null };
export type InteractionRecord = Pick<Tables<'interactions'>, 'id' | 'interaction_type' | 'channel' | 'occurred_at' | 'summary' | 'content'>;
export type TaskRecord = Pick<Tables<'tasks'>, 'id' | 'title' | 'description' | 'status' | 'priority' | 'due_at' | 'due_date'>;
export type SearchRecord = Pick<Tables<'search_runs'>, 'id' | 'query_text' | 'status' | 'started_at'>;
export interface MemoryWriteResult {
  client: ClientIdentity; interaction_id: string;
  facts: FactRecord[]; follow_ups: (TaskRecord & { interaction_id: string | null })[]; replayed: boolean;
}
export interface ClientHistoryResult {
  client: ClientIdentity;
  timeline: { id: string; kind: 'client' | 'fact' | 'interaction' | 'task' | 'property_event'; recorded_at: string; effective_at: string | null;
    created_by: string | null; source_interaction_id: string | null; source_ref: string | null; data: Tables<'client_facts'>['value_json'] }[];
  coverage: { limit: number; has_more: boolean; next_cursor: NonNullable<ClientHistoryInput['cursor']> | null };
}
export interface ContextRows {
  client: ClientIdentity; facts: FactRecord[]; properties: ConsideredProperty[];
  interactions: InteractionRecord[]; tasks: TaskRecord[]; searches: SearchRecord[];
  truncated: string[];
  historicalFacts?: FactRecord[];
  propertyEvents?: (PropertyEvent & { property_id: string })[];
}
// A repository instance is bound to authenticated workspace context. No service
// caller can choose a workspace for an individual business operation.
export interface ClientRepository {
  createClient(input: CreateClientInput): Promise<ClientIdentity>;
  findClients(input: FindClientsInput): Promise<{ clients: ClientIdentity[]; has_more: boolean }>;
  rememberFact(clientId: string, fact: FactInput): Promise<FactRecord>;
  loadContext(clientId: string): Promise<ContextRows>;
  updateClient(input: UpdateClientInput): Promise<MemoryWriteResult>;
  recordInteraction(input: RecordInteractionInput): Promise<MemoryWriteResult>;
  loadHistory(input: ClientHistoryInput): Promise<ClientHistoryResult>;
}
