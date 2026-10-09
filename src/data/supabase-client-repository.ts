import type { ClientRepository, ClientIdentity, ContextRows, FactRecord, MemoryWriteResult, ClientHistoryResult } from '../application/contracts.js';
import { CONTEXT_LIMITS } from '../application/client-service.js';
import type { CreateClientInput, FactInput, FindClientsInput, UpdateClientInput, RecordInteractionInput, ClientHistoryInput } from '../domain/schemas.js';
import { AppError } from '../domain/errors.js';
import type { ApplicationContext } from '../infrastructure/identity.js';
import { EVENT_COLUMNS } from './supabase-property-repository.js';

const CLIENT_COLUMNS = 'id,display_name,first_name,last_name,status,email,phone,notes,memory_version' as const;
const FACT_COLUMNS = 'id,category,key,value_json,status,confidence,importance,valid_from,created_at,created_by,source_type,source_ref,source_interaction_id,superseded_by_id,strength,applicability,source_at,valid_until,source_quote,source_date,evidence' as const;
function unwrap<T>(result: { data: T | null; error: { code?: string; message: string } | null }): NonNullable<T> {
  if (result.error) {
    const code = result.error.code;
    if (code === 'P0002') throw new AppError('NOT_FOUND', 'Client not found in this workspace. Use find_clients to resolve the client.');
    if (code === '42501') throw new AppError('FORBIDDEN', 'Workspace access denied. Check authenticated workspace membership.');
    if (code === 'PT409' || code === '40001') throw new AppError('CONFLICT', 'Client memory or request key conflicts with this update. Re-read context/history, reconcile the changes, and use a new key for a revised request. Retry an uncertain write with the identical key and arguments.');
    if (code && ['22023', '23514', '23503', '22P02', '22007', '22008'].includes(code)) throw new AppError('INVALID_INPUT', 'Invalid client or fact data. Check the values and source interaction.');
    if (code === 'PGRST202' || code === '42703') throw new AppError('DATA_ERROR', 'Client-memory schema is unavailable. Apply the pending client-memory migrations.');
    // Do not expose raw database errors, request details, or credentials.
    console.error('Supabase operation failed', { code: code ?? 'unknown' });
    throw new AppError('DATA_ERROR', 'Client memory operation failed. Retry or check server configuration.');
  }
  if (result.data === null) throw new AppError('NOT_FOUND', 'Client not found in this workspace. Use find_clients to resolve the client.');
  return result.data as NonNullable<T>;
}
function identity(row: ClientIdentity): ClientIdentity {
  const { id, display_name, first_name, last_name, status, email, phone, notes, memory_version } = row;
  return { id, display_name, first_name, last_name, status, email, phone, notes, memory_version };
}
export class SupabaseClientRepository implements ClientRepository {
  constructor(private readonly context: ApplicationContext) {}
  async createClient(input: CreateClientInput) {
    const { facts, ...client } = input;
    const result = await this.context.supabase.rpc('create_client_with_facts', {
      p_workspace_id: this.context.workspaceId, p_client: client, p_facts: facts ?? [],
    });
    const created = unwrap(result);
    return identity(unwrap(await this.context.supabase.from('clients').select(CLIENT_COLUMNS)
      .eq('workspace_id', this.context.workspaceId).eq('id', created.id).single()));
  }
  async findClients(input: FindClientsInput) {
    const limit = input.limit ?? 10;
    // Escape regex metacharacters, then quote the PostgREST value. imatch avoids
    // ILIKE's '*' wildcard alias and keeps every supplied name literal.
    const literalName = input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = JSON.stringify(literalName);
    let query = this.context.supabase.from('clients').select(CLIENT_COLUMNS)
      .eq('workspace_id', this.context.workspaceId)
      .or(['display_name', 'first_name', 'last_name'].map(column => `${column}.imatch.${pattern}`).join(','));
    if (input.status) query = query.eq('status', input.status);
    const rows = unwrap(await query.order('display_name').order('id').limit(limit + 1));
    return { clients: rows.slice(0, limit).map(c => ({ ...c, notes: null })), has_more: rows.length > limit };
  }
  async rememberFact(clientId: string, fact: FactInput): Promise<FactRecord> {
    return unwrap(await this.context.supabase.rpc('remember_client_fact', {
      p_workspace_id: this.context.workspaceId, p_client_id: clientId, p_fact: fact,
    }));
  }
  private async writeMemory(operation: 'update_client' | 'record_interaction', input: UpdateClientInput | RecordInteractionInput): Promise<MemoryWriteResult> {
    const result = unwrap(await this.context.supabase.rpc('write_client_memory', {
      p_workspace_id: this.context.workspaceId, p_client_id: input.client_id, p_operation: operation, p_request: input,
    }));
    return result as unknown as MemoryWriteResult;
  }
  updateClient(input: UpdateClientInput) { return this.writeMemory('update_client', input); }
  recordInteraction(input: RecordInteractionInput) { return this.writeMemory('record_interaction', input); }
  async loadHistory(input: ClientHistoryInput): Promise<ClientHistoryResult> {
    return unwrap(await this.context.supabase.rpc('get_client_history', {
      p_workspace_id: this.context.workspaceId, p_client_id: input.client_id, p_limit: input.limit ?? 30, p_cursor: input.cursor ?? null,
    })) as unknown as ClientHistoryResult;
  }
  async loadContext(clientId: string): Promise<ContextRows> {
    const db = this.context.supabase;
    const workspaceId = this.context.workspaceId;
    const client = unwrap(await db.from('clients').select(CLIENT_COLUMNS)
      .eq('workspace_id', workspaceId).eq('id', clientId).maybeSingle());
    const [factsResult, historicalResult, propertiesResult, interactionsResult, tasksResult, searchesResult] = await Promise.all([
      db.from('client_facts').select(FACT_COLUMNS).eq('workspace_id', workspaceId).eq('client_id', clientId)
        .eq('status', 'current').eq('applicability', 'confirmed_current')
        .lte('valid_from', new Date().toISOString()).or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`).order('confidence', { ascending: false }).order('valid_from', { ascending: false }).order('id')
        .limit(CONTEXT_LIMITS.facts + 1),
      db.from('client_facts').select(FACT_COLUMNS).eq('workspace_id', workspaceId).eq('client_id', clientId)
        .or('applicability.is.null,applicability.in.(historical,unconfirmed)').order('valid_from', { ascending: false }).order('created_at', { ascending: false }).order('id')
        .limit(CONTEXT_LIMITS.historical_facts + 1),
      db.from('client_properties').select('id,property_id,status,interest_level,notes,rejection_reason,viewed_at,updated_at')
        .eq('workspace_id', workspaceId).eq('client_id', clientId).order('updated_at', { ascending: false }).order('id')
        .limit(CONTEXT_LIMITS.properties + 1),
      db.from('interactions').select('id,interaction_type,channel,occurred_at,summary,content')
        .eq('workspace_id', workspaceId).eq('client_id', clientId).neq('interaction_type', 'profile_update').order('occurred_at', { ascending: false }).order('id')
        .limit(CONTEXT_LIMITS.interactions + 1),
      db.from('tasks').select('id,title,description,status,priority,due_at,due_date')
        .eq('workspace_id', workspaceId).eq('client_id', clientId).in('status', ['open', 'in_progress'])
        .order('due_at', { ascending: true, nullsFirst: false }).order('id').limit(CONTEXT_LIMITS.tasks + 1),
      db.from('search_runs').select('id,query_text,status,started_at')
        .eq('workspace_id', workspaceId).eq('client_id', clientId).order('started_at', { ascending: false }).order('id')
        .limit(CONTEXT_LIMITS.searches + 1),
    ]);
    const truncated: string[] = [];
    function bounded<T>(result: { data: T[] | null; error: { code?: string; message: string } | null }, section: keyof typeof CONTEXT_LIMITS) {
      const rows = unwrap(result);
      if (rows.length > CONTEXT_LIMITS[section]) truncated.push(section);
      return rows.slice(0, CONTEXT_LIMITS[section]);
    }
    const facts = bounded(factsResult, 'facts');
    const historicalFacts = bounded(historicalResult, 'historical_facts');
    const relations = bounded(propertiesResult, 'properties');
    const interactions = bounded(interactionsResult, 'interactions');
    const tasks = bounded(tasksResult, 'tasks');
    const searches = bounded(searchesResult, 'searches');
    const propertyIds = relations.map(p => p.property_id);
    const propertyRows = propertyIds.length ? unwrap(await db.from('properties')
      .select('id,title,neighborhood,bedrooms,asking_price,currency,construction_status,availability_status')
      .eq('workspace_id', workspaceId).in('id', propertyIds)) : [];
    const properties = relations.map(p => ({ ...p, property: propertyRows.find(detail => detail.id === p.property_id) ?? null }));
    const visibleRelations = properties.filter(p => p.property !== null);
    const eventRows = visibleRelations.length ? bounded(await db.from('client_property_events').select(EVENT_COLUMNS)
      .eq('workspace_id', workspaceId).in('client_property_id', visibleRelations.map(p => p.id))
      .order('occurred_at', { ascending: false }).order('id', { ascending: false })
      .limit(CONTEXT_LIMITS.property_events + 1), 'property_events') : [];
    const propertyEvents = eventRows.map(e => ({ ...e, property_id: visibleRelations.find(p => p.id === e.client_property_id)!.property_id }));
    return { client, facts, historicalFacts, properties, interactions, tasks, searches, truncated, propertyEvents };
  }
}
