import type { ClientRepository, ContextRows, FactRecord, MemoryWriteResult } from './contracts.js';
import { summarizeEvent } from './property-service.js';
import { createClientSchema, findClientsSchema, rememberFactSchema, clientContextSchema, updateClientSchema, recordInteractionSchema, clientHistorySchema, type CreateClientInput, type FindClientsInput, type FactInput, type UpdateClientInput, type RecordInteractionInput, type ClientHistoryInput } from '../domain/schemas.js';

export const CONTEXT_LIMITS = { facts: 60, historical_facts: 30, properties: 12, property_events: 8, interactions: 8, tasks: 12, searches: 5 } as const;
const clip = (value: string | null, max = 500) => value && value.length > max ? value.slice(0, max - 1) + '…' : value;
function factSummary(fact: FactRecord) {
  return { id: fact.id, key: fact.key, value: fact.value_json, confidence: fact.confidence, importance: fact.importance,
    strength: fact.strength, valid_from: fact.valid_from, recorded_at: fact.created_at, created_by: fact.created_by,
    source_type: fact.source_type, source_ref: fact.source_ref, source_interaction_id: fact.source_interaction_id,
    superseded_by_id: fact.superseded_by_id, applicability: fact.applicability ?? 'unclassified',
    source_at: fact.source_at ?? null, valid_until: fact.valid_until ?? null, source_quote: fact.source_quote ?? null,
    source_date: fact.source_date ?? null, evidence: fact.evidence ?? null };
}
export function buildClientContext(rows: ContextRows, now = new Date()) {
  const current = rows.facts.filter(f => f.status === 'current' && f.applicability === 'confirmed_current'
    && f.valid_from !== null && Date.parse(f.valid_from) <= now.getTime() && (!f.valid_until || Date.parse(f.valid_until) > now.getTime()));
  const group = (category: string) => current.filter(f => f.category === category).map(factSummary);
  return {
    client: { ...rows.client, notes: clip(rows.client.notes, 1000) },
    historical_context: (rows.historicalFacts ?? rows.facts.filter(f => f.applicability !== 'confirmed_current')).map(f => ({ ...factSummary(f), category: f.category, status: f.status })),
    requirements: group('requirement'), preferences: group('preference'), dislikes: group('dislike'),
    context: group('context'), constraints: group('constraint'), other_facts: group('other'),
    properties: rows.properties.map(p => ({
      property_id: p.property_id, status: p.status, interest_level: p.interest_level,
      notes: clip(p.notes), rejection_reason: clip(p.rejection_reason), viewed_at: p.viewed_at,
      details: p.property ? { ...p.property, title: clip(p.property.title, 200), neighborhood: clip(p.property.neighborhood, 200) } : null,
    })),
    recent_property_events: (rows.propertyEvents ?? []).map(e => ({ ...summarizeEvent(e), property_id: e.property_id })),
    recent_interactions: rows.interactions.map(i => ({
      id: i.id, type: i.interaction_type, channel: i.channel, occurred_at: i.occurred_at,
      summary: clip(i.summary || i.content),
    })),
    open_tasks: rows.tasks.filter(t => ['open', 'in_progress'].includes(t.status)).map(t => ({
      ...t, title: clip(t.title, 200), description: clip(t.description),
    })),
    recent_searches: rows.searches.map(s => ({ ...s, query_text: clip(s.query_text) })),
    coverage: { truncated_sections: rows.truncated, limits: CONTEXT_LIMITS },
  };
}
export type ClientContext = ReturnType<typeof buildClientContext>;
function writeSummary(result: MemoryWriteResult) {
  return { client: result.client, interaction_id: result.interaction_id, replayed: result.replayed,
    facts: result.facts.map(f => ({ ...factSummary(f), category: f.category, status: f.status })),
    follow_ups: result.follow_ups.map(t => ({ id: t.id, title: t.title, description: t.description,
      status: t.status, priority: t.priority, due_at: t.due_at, due_date: t.due_date, interaction_id: t.interaction_id })),
  };
}
export interface ClientService {
  createClient(input: CreateClientInput): Promise<{ client: ContextRows['client']; initial_facts_count: number }>;
  findClients(input: FindClientsInput): ReturnType<ClientRepository['findClients']>;
  getClientContext(clientId: string): Promise<ClientContext>;
  rememberClientFact(clientId: string, fact: FactInput): Promise<{ fact: ReturnType<typeof factSummary>; status: string }>;
  updateClient(input: UpdateClientInput): Promise<ReturnType<typeof writeSummary>>;
  recordInteraction(input: RecordInteractionInput): Promise<ReturnType<typeof writeSummary>>;
  getClientHistory(input: ClientHistoryInput): ReturnType<ClientRepository['loadHistory']>;
}
export class RealtorClientService implements ClientService {
  constructor(private readonly repository: ClientRepository) {}
  async createClient(input: CreateClientInput) {
    const parsed = createClientSchema.parse(input);
    return { client: await this.repository.createClient(parsed), initial_facts_count: parsed.facts?.length ?? 0 };
  }
  findClients(input: FindClientsInput) { return this.repository.findClients(findClientsSchema.parse(input)); }
  async updateClient(input: UpdateClientInput) { return writeSummary(await this.repository.updateClient(updateClientSchema.parse(input))); }
  async recordInteraction(input: RecordInteractionInput) { return writeSummary(await this.repository.recordInteraction(recordInteractionSchema.parse(input))); }
  getClientHistory(input: ClientHistoryInput) { return this.repository.loadHistory(clientHistorySchema.parse(input)); }
  async getClientContext(clientId: string) {
    const { client_id } = clientContextSchema.parse({ client_id: clientId });
    return buildClientContext(await this.repository.loadContext(client_id));
  }
  async rememberClientFact(clientId: string, fact: FactInput) {
    const parsed = rememberFactSchema.parse({ client_id: clientId, fact });
    const saved = await this.repository.rememberFact(parsed.client_id, parsed.fact);
    return { fact: factSummary(saved), status: saved.status };
  }
}
