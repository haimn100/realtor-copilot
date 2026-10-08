import type { PropertyRepository, SavedProperty, PropertySource, PropertyRelationship, PropertyContextRows, PropertyHistoryRows } from '../application/property-contracts.js';
import { PROPERTY_CONTEXT_LIMITS } from '../application/property-service.js';
import type { SavePropertyInput, UpdateClientPropertyInput, ClientPropertyHistoryInput } from '../domain/property-schemas.js';
import { AppError } from '../domain/errors.js';
import type { ApplicationContext } from '../infrastructure/identity.js';

export const PROPERTY_COLUMNS = 'id,title,property_type,development_name,address,neighborhood,city,state,country,bedrooms,bathrooms,interior_m2,exterior_m2,total_m2,asking_price,currency,construction_status,delivery_date,notes,availability_status,availability_verified_at' as const;
export const SOURCE_COLUMNS = 'id,source_name,url,external_id,asking_price,currency,listing_updated_at,accessed_at,availability_status,availability_verified,availability_verified_at' as const;
export const RELATIONSHIP_COLUMNS = 'id,client_id,property_id,status,interest_level,notes,rejection_reason,first_considered_at,sent_at,viewed_at,updated_at' as const;
export const EVENT_COLUMNS = 'id,client_property_id,event_type,notes,metadata,occurred_at' as const;
function unwrap<T>(result: { data: T | null; error: { code?: string } | null }): NonNullable<T> {
  if (result.error) {
    const code = result.error.code;
    if (code === 'P0002') throw new AppError('NOT_FOUND', 'Client or saved property not found in this workspace. Resolve IDs using find_clients and get_property_context.');
    if (code === '42501') throw new AppError('FORBIDDEN', 'Workspace access denied.');
    if (['22023', '23514', '23505', '22P02', '22007', '22008'].includes(code ?? ''))
      throw new AppError('INVALID_INPUT', 'Invalid property or relationship data, or a source already belongs to a saved property.');
    if (code === 'PGRST202') throw new AppError('DATA_ERROR', 'Property-memory RPC is unavailable. Apply the property_memory migration.');
    console.error('Supabase property operation failed', { code: code ?? 'unknown' });
    throw new AppError('DATA_ERROR', 'Property memory operation failed. Retry or check server configuration.');
  }
  if (result.data === null) throw new AppError('NOT_FOUND', 'Client or saved property not found in this workspace.');
  return result.data as NonNullable<T>;
}
// Explicit projections also remove server-owned fields from composite RPC results.
function project<T>(row: unknown, columns: string): T {
  const value = row as Record<string, unknown>;
  return Object.fromEntries(columns.split(',').map(key => [key, value[key]])) as T;
}
export class SupabasePropertyRepository implements PropertyRepository {
  constructor(private readonly context: ApplicationContext) {}
  async saveProperty(input: SavePropertyInput) {
    const { property_id, source, ...property } = input;
    const result = unwrap(await this.context.supabase.rpc('save_property', {
      p_workspace_id: this.context.workspaceId, p_property_id: property_id,
      p_property: property, p_source: source,
    })) as unknown as { property: unknown; source: unknown | null };
    return { property: project<SavedProperty>(result.property, PROPERTY_COLUMNS),
      source: result.source ? project<PropertySource>(result.source, SOURCE_COLUMNS) : null };
  }
  async findSavedProperties(name: string) {
    const pattern = JSON.stringify(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rows = unwrap(await this.context.supabase.from('properties').select(PROPERTY_COLUMNS)
      .eq('workspace_id', this.context.workspaceId)
      .or(['title', 'development_name', 'address'].map(column => `${column}.imatch.${pattern}`).join(','))
      .order('title').order('id').limit(7));
    return { matches: rows.slice(0, 6), has_more: rows.length > 6 };
  }
  private async property(propertyId: string) {
    return unwrap(await this.context.supabase.from('properties').select(PROPERTY_COLUMNS)
      .eq('workspace_id', this.context.workspaceId).eq('id', propertyId).maybeSingle());
  }
  private async client(clientId: string) {
    return unwrap(await this.context.supabase.from('clients').select('id,display_name')
      .eq('workspace_id', this.context.workspaceId).eq('id', clientId).maybeSingle());
  }
  async loadPropertyContext(propertyId: string): Promise<PropertyContextRows> {
    const property = await this.property(propertyId);
    const db = this.context.supabase, workspaceId = this.context.workspaceId;
    const [sourceResult, relationResult, researchResult] = await Promise.all([
      db.from('property_sources').select(SOURCE_COLUMNS).eq('workspace_id', workspaceId).eq('property_id', propertyId)
        .order('accessed_at', { ascending: false }).order('id').limit(PROPERTY_CONTEXT_LIMITS.sources + 1),
      db.from('client_properties').select(RELATIONSHIP_COLUMNS).eq('workspace_id', workspaceId).eq('property_id', propertyId)
        .order('updated_at', { ascending: false }).order('id').limit(PROPERTY_CONTEXT_LIMITS.clients + 1),
      db.from('research_items').select('id,title,summary,source_name,source_url,accessed_at,source_updated_at,confidence')
        .eq('workspace_id', workspaceId).eq('property_id', propertyId)
        .order('updated_at', { ascending: false }).order('id').limit(PROPERTY_CONTEXT_LIMITS.research + 1),
    ]);
    const truncated: string[] = [];
    function bounded<T>(rows: T[], key: keyof typeof PROPERTY_CONTEXT_LIMITS) {
      if (rows.length > PROPERTY_CONTEXT_LIMITS[key]) truncated.push(key);
      return rows.slice(0, PROPERTY_CONTEXT_LIMITS[key]);
    }
    const relations = bounded(unwrap(relationResult), 'clients');
    const clientRows = relations.length ? unwrap(await db.from('clients').select('id,display_name')
      .eq('workspace_id', workspaceId).in('id', relations.map(p => p.client_id))) : [];
    const clients = relations.flatMap(p => {
      const client = clientRows.find(c => c.id === p.client_id);
      return client ? [{ ...p, client }] : [];
    });
    const events = clients.length ? unwrap(await db.from('client_property_events').select(EVENT_COLUMNS)
      .eq('workspace_id', workspaceId).in('client_property_id', clients.map(p => p.id))
      .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(PROPERTY_CONTEXT_LIMITS.events + 1)) : [];
    return { property, sources: bounded(unwrap(sourceResult), 'sources'), clients,
      events: bounded(events, 'events'), research: bounded(unwrap(researchResult), 'research'), truncated };
  }
  async updateClientProperty(input: UpdateClientPropertyInput) {
    const { client_id, property_id, ...changes } = input;
    const row = unwrap(await this.context.supabase.rpc('update_client_property', {
      p_workspace_id: this.context.workspaceId, p_client_id: client_id, p_property_id: property_id, p_changes: changes,
    }));
    return project<PropertyRelationship>(row, RELATIONSHIP_COLUMNS);
  }
  async loadClientPropertyHistory(input: ClientPropertyHistoryInput): Promise<PropertyHistoryRows> {
    const [client, property] = await Promise.all([this.client(input.client_id), this.property(input.property_id)]);
    const db = this.context.supabase, workspaceId = this.context.workspaceId;
    const result = await db.from('client_properties').select(RELATIONSHIP_COLUMNS)
      .eq('workspace_id', workspaceId).eq('client_id', input.client_id).eq('property_id', input.property_id).maybeSingle();
    if (result.error) unwrap(result);
    const relationship = result.data;
    if (!relationship) return { client, property, relationship: null, events: [], has_more: false };
    let query = db.from('client_property_events').select(EVENT_COLUMNS)
      .eq('workspace_id', workspaceId).eq('client_property_id', relationship.id);
    if (input.cursor) {
      // Cursor is validated ISO time + UUID, never arbitrary PostgREST syntax.
      const time = input.cursor.occurred_at, id = input.cursor.id;
      query = query.or(`occurred_at.lt.${time},and(occurred_at.eq.${time},id.lt.${id})`);
    }
    const limit = input.limit ?? 30;
    const events = unwrap(await query.order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1));
    return { client, property, relationship, events: events.slice(0, limit), has_more: events.length > limit };
  }
}
