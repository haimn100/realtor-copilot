import type { ClientRepository, ContextRows, FactRecord } from './contracts.js';
import { summarizeEvent } from './property-service.js';
import { createClientSchema, findClientsSchema, rememberFactSchema, clientContextSchema, type CreateClientInput, type FindClientsInput, type FactInput } from '../domain/schemas.js';

export const CONTEXT_LIMITS = { facts: 60, properties: 12, property_events: 8, interactions: 8, tasks: 12, searches: 5 } as const;
const clip = (value: string | null, max = 500) => value && value.length > max ? value.slice(0, max - 1) + '…' : value;
function factSummary(fact: FactRecord) {
  return { key: fact.key, value: fact.value_json, confidence: fact.confidence, importance: fact.importance };
}
export function buildClientContext(rows: ContextRows) {
  const current = rows.facts.filter(f => f.status === 'current');
  const group = (category: string) => current.filter(f => f.category === category).map(factSummary);
  return {
    client: { ...rows.client, notes: clip(rows.client.notes, 1000) },
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
export interface ClientService {
  createClient(input: CreateClientInput): Promise<{ client: ContextRows['client']; initial_facts_count: number }>;
  findClients(input: FindClientsInput): ReturnType<ClientRepository['findClients']>;
  getClientContext(clientId: string): Promise<ClientContext>;
  rememberClientFact(clientId: string, fact: FactInput): Promise<{ fact: ReturnType<typeof factSummary>; status: 'current' }>;
}
export class RealtorClientService implements ClientService {
  constructor(private readonly repository: ClientRepository) {}
  async createClient(input: CreateClientInput) {
    const parsed = createClientSchema.parse(input);
    return { client: await this.repository.createClient(parsed), initial_facts_count: parsed.facts?.length ?? 0 };
  }
  findClients(input: FindClientsInput) { return this.repository.findClients(findClientsSchema.parse(input)); }
  async getClientContext(clientId: string) {
    const { client_id } = clientContextSchema.parse({ client_id: clientId });
    return buildClientContext(await this.repository.loadContext(client_id));
  }
  async rememberClientFact(clientId: string, fact: FactInput) {
    const parsed = rememberFactSchema.parse({ client_id: clientId, fact });
    return { fact: factSummary(await this.repository.rememberFact(parsed.client_id, parsed.fact)), status: 'current' as const };
  }
}
