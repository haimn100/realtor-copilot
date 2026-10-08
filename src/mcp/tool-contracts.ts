import { z } from 'zod';
import { createClientSchema, findClientsSchema, clientContextSchema, rememberFactSchema, clientStatus } from '../domain/schemas.js';
import { savePropertySchema, propertyContextSchema, updateClientPropertySchema, clientPropertyHistorySchema } from '../domain/property-schemas.js';

// Describe existing response shapes; no tool arguments or business behavior change.
const text = z.string().nullable();
const number = z.number().nullable();
const identity = z.strictObject({ id: z.string(), display_name: z.string(), first_name: text,
  last_name: text, status: clientStatus, email: text, phone: text, notes: text });
const fact = z.strictObject({ key: z.string(), value: z.json(), confidence: z.number(), importance: z.string() });
const coverage = z.strictObject({ truncated_sections: z.array(z.string()), limits: z.record(z.string(), z.number().int().nonnegative()) });
const event = z.strictObject({ id: z.string(), relationship_id: z.string(), occurred_at: z.string(),
  event_type: text, previous_status: text, status: text, interest_level: text, notes: text, rejection_reason: text });
const relationship = z.strictObject({ id: z.string(), client_id: z.string(), property_id: z.string(),
  status: z.string(), interest_level: text, notes: text, rejection_reason: text,
  first_considered_at: z.string(), sent_at: text, viewed_at: text, updated_at: z.string() });
const property = z.strictObject({ id: z.string(), title: text, property_type: text, development_name: text,
  address: text, neighborhood: text, city: text, state: text, country: text,
  bedrooms: number, bathrooms: number, interior_m2: number, exterior_m2: number, total_m2: number,
  asking_price: number, currency: text, construction_status: text, delivery_date: text, notes: text,
  availability_status: text, availability_verified_at: text, availability_verified: z.boolean() });
const source = z.strictObject({ id: z.string(), source_name: text, url: text, external_id: text,
  asking_price: number, currency: text, listing_updated_at: text, accessed_at: z.string(),
  availability_status: text, availability_verified: z.boolean(), availability_verified_at: text });
const clientContext = z.strictObject({
  client: identity, requirements: z.array(fact), preferences: z.array(fact), dislikes: z.array(fact),
  context: z.array(fact), constraints: z.array(fact), other_facts: z.array(fact),
  properties: z.array(z.strictObject({ property_id: z.string(), status: z.string(), interest_level: text,
    notes: text, rejection_reason: text, viewed_at: text,
    details: z.strictObject({ id: z.string(), title: text, neighborhood: text, bedrooms: number,
      asking_price: number, currency: text, construction_status: text, availability_status: text }).nullable() })),
  recent_property_events: z.array(event.extend({ property_id: z.string() })),
  recent_interactions: z.array(z.strictObject({ id: z.string(), type: z.string(), channel: text, occurred_at: z.string(), summary: text })),
  open_tasks: z.array(z.strictObject({ id: z.string(), title: text, description: text, status: z.string(), priority: z.string(), due_at: text })),
  recent_searches: z.array(z.strictObject({ id: z.string(), query_text: text, status: z.string(), started_at: z.string() })),
  coverage,
});
// An object root is required by MCP. The two existing property-context branches
// remain unchanged and are checked at runtime as well as in contract tests.
const propertyContext = z.strictObject({
  ambiguous: z.literal(true).optional(),
  matches: z.array(z.strictObject({ property_id: z.string(), title: text, neighborhood: text, development_name: text })).optional(),
  has_more: z.boolean().optional(), property: property.optional(), sources: z.array(source).optional(),
  clients: z.array(relationship.extend({ client: z.strictObject({ id: z.string(), display_name: text }) })).optional(),
  recent_events: z.array(event).optional(),
  research: z.array(z.strictObject({ id: z.string(), title: text, summary: text, source_name: text,
    source_url: text, accessed_at: text, source_updated_at: text, confidence: number })).optional(), coverage: coverage.optional(),
}).superRefine((value, ctx) => {
  const required = value.ambiguous ? ['matches', 'has_more'] : ['property', 'sources', 'clients', 'recent_events', 'research', 'coverage'];
  const forbidden = value.ambiguous ? ['property', 'sources', 'clients', 'recent_events', 'research', 'coverage'] : ['matches', 'has_more'];
  for (const key of required) if (!(key in value)) ctx.addIssue({ code: 'custom', message: `Missing ${key}` });
  for (const key of forbidden) if (key in value) ctx.addIssue({ code: 'custom', message: `Unexpected ${key}` });
});

export const TOOL_CONTRACTS = {
  create_client: { inputSchema: createClientSchema, outputSchema: z.strictObject({ client: identity, initial_facts_count: z.number().int().nonnegative() }) },
  find_clients: { inputSchema: findClientsSchema, outputSchema: z.strictObject({ clients: z.array(identity), has_more: z.boolean() }) },
  get_client_context: { inputSchema: clientContextSchema, outputSchema: clientContext },
  remember_client_fact: { inputSchema: rememberFactSchema, outputSchema: z.strictObject({ fact, status: z.literal('current') }) },
  save_property: { inputSchema: savePropertySchema, outputSchema: z.strictObject({ property, source: source.nullable() }) },
  get_property_context: { inputSchema: propertyContextSchema, outputSchema: propertyContext },
  update_client_property: { inputSchema: updateClientPropertySchema, outputSchema: z.strictObject({ relationship }) },
  get_client_property_history: { inputSchema: clientPropertyHistorySchema, outputSchema: z.strictObject({
    client: z.strictObject({ id: z.string(), display_name: text }), property: z.strictObject({ id: z.string(), title: text }),
    current_state: relationship.nullable(), timeline: z.array(event),
    coverage: z.strictObject({ limit: z.number().int(), has_more: z.boolean(),
      next_cursor: z.strictObject({ occurred_at: z.string(), id: z.string() }).nullable() }),
  }) },
} as const;
export type ToolName = keyof typeof TOOL_CONTRACTS;

export function verifyToolDiscovery(tools: { name: string; inputSchema: object; outputSchema?: object }[]) {
  const expected = Object.keys(TOOL_CONTRACTS).sort();
  const actual = tools.map(tool => tool.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`MCP tool mismatch. Expected ${expected.join(', ')}; received ${actual.join(', ')}. Rebuild/restart the local server and refresh the connection.`);
  for (const tool of tools) {
    const contract = TOOL_CONTRACTS[tool.name as ToolName];
    for (const field of ['inputSchema', 'outputSchema'] as const) {
      const expectedSchema = z.toJSONSchema(contract[field], { target: 'draft-2020-12', io: field === 'inputSchema' ? 'input' : 'output' });
      // SDK adds/removes the dialect marker; the schema itself must agree.
      const normalize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
        return value;
      };
      if (JSON.stringify(normalize(tool[field])) !== JSON.stringify(normalize(expectedSchema)))
        throw new Error(`MCP schema mismatch for ${tool.name}.${field}. Rebuild/restart and refresh discovery.`);
    }
  }
}
