import { createHash } from 'node:crypto';
import { z } from 'zod';
import { factSchema, recordInteractionSchema } from '../domain/schemas.js';
import { savePropertySchema, propertySourceSchema, relationshipStatus } from '../domain/property-schemas.js';

export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = (max: number) => z.string().trim().min(1).max(max);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const timestamp = z.iso.datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export interface WhatsAppMessage {
  line_start: number; line_end: number; speaker: string; occurred_at: string; body: string;
}

// Local, explicit format selection. No semantic extraction or personal-message persistence.
export function parseWhatsApp(raw: string, dateOrder: 'day-first' | 'month-first', offset: string): WhatsAppMessage[] {
  if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) throw new Error('Supply a confirmed source timezone offset.');
  const messages: WhatsAppMessage[] = [];
  let current: WhatsAppMessage | undefined;
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [index, original] of lines.entries()) {
    const line = original.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    const match = line.match(/^(?:\[)?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?(?:\]\s*|\s+-\s+)(.*)$/i);
    if (match) {
      current = undefined;
      const [, first, second, yearText, hourText, minuteText, secondsText, meridiem, payload] = match;
      const speaker = payload!.match(/^([^:]{1,200}):\s?(.*)$/);
      // System notices and omitted-media messages are never independent business events.
      if (!speaker) continue;
      const month = Number(dateOrder === 'day-first' ? second : first);
      const day = Number(dateOrder === 'day-first' ? first : second);
      const year = Number(yearText) + (yearText!.length === 2 ? 2000 : 0);
      let hour = Number(hourText);
      if (meridiem) {
        if (hour < 1 || hour > 12) throw new Error(`Invalid clock at source line ${index + 1}.`);
        hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
      }
      const minute = Number(minuteText), seconds = Number(secondsText ?? '0');
      const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, seconds));
      if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || seconds > 59)
        throw new Error(`Invalid date at source line ${index + 1}.`);
      const pad = (n: number) => String(n).padStart(2, '0');
      current = { line_start: index + 1, line_end: index + 1, speaker: speaker[1]!.trim(),
        occurred_at: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(seconds)}${offset}`, body: speaker[2]! };
      messages.push(current);
    } else if (/^\[?\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}.*\d{1,2}:\d{2}/.test(line)) {
      throw new Error(`Unsupported timestamp format at source line ${index + 1}; do not guess dates.`);
    } else if (current) {
      current.body += '\n' + line;
      current.line_end = index + 1;
    }
  }
  if (!messages.length) throw new Error('No WhatsApp messages parsed. Original export required.');
  return messages;
}

const citation = z.strictObject({ line_start: z.number().int().positive(), speaker: text(200), quote: text(1000) });
const importFact = z.strictObject({ fact: factSchema, evidence: z.enum(['explicit', 'agent_reported', 'inferred']),
  current: z.boolean(), citations: z.array(citation).min(1) });
const source = z.strictObject({ key, event_key: key, source: propertySourceSchema });
const property = z.strictObject({ key, details: savePropertySchema, citations: z.array(citation).min(1), sources: z.array(source) });
const event = z.strictObject({ key, occurred_at: timestamp, summary: text(1200), citations: z.array(citation).min(1),
  facts: z.array(importFact).max(40), property_key: key.optional(), status: relationshipStatus.optional(),
  rejection_reason: text(1000).optional(), evidence: z.enum(['explicit', 'agent_reported', 'inferred']),
  follow_up_status: z.enum(['proposed', 'planned', 'done', 'cancelled', 'unknown', 'still_open']).optional() });
export const historyManifestSchema = z.strictObject({
  format: z.literal('realtor-whatsapp-history-v1'), import_key: z.literal('haim_isabel_history'),
  source: z.strictObject({ kind: z.literal('original_whatsapp_export'), sha256: hash,
    date_order: z.enum(['day-first', 'month-first']), timezone_offset: z.string(), client_speaker: text(200) }),
  review: z.strictObject({ business_only: z.literal(true), source_verified: z.literal(true),
    reviewer: text(200), as_of: timestamp }),
  client: z.strictObject({ display_name: z.literal('Haim') }),
  properties: z.array(property), events: z.array(event).min(1), ambiguities: z.array(text(1000)),
});
export type HistoryManifest = z.infer<typeof historyManifestSchema>;

export function validateManifest(input: unknown, original: Buffer): HistoryManifest {
  const manifest = historyManifestSchema.parse(input);
  if (sha256(original) !== manifest.source.sha256) throw new Error('Original source SHA-256 mismatch.');
  const messages = parseWhatsApp(original.toString('utf8'), manifest.source.date_order, manifest.source.timezone_offset);
  const byLine = new Map(messages.map(m => [m.line_start, m]));
  const verify = (citations: z.infer<typeof citation>[], occurredAt?: string) => {
    for (const cite of citations) {
      const message = byLine.get(cite.line_start);
      if (!message || message.speaker !== cite.speaker || !message.body.includes(cite.quote)) throw new Error(`Citation does not match source line ${cite.line_start}.`);
    }
    if (occurredAt && !citations.some(c => Date.parse(byLine.get(c.line_start)!.occurred_at) === Date.parse(occurredAt)))
      throw new Error('Event timestamp must match a cited message; split multi-day events.');
  };
  const unique = (keys: string[]) => { if (new Set(keys).size !== keys.length) throw new Error('Duplicate entity/event/source keys.'); };
  unique(manifest.properties.map(p => p.key)); unique(manifest.events.map(e => e.key));
  unique(manifest.events.map(e => JSON.stringify([e.occurred_at, e.property_key, e.status, e.summary, e.citations])));
  unique(manifest.properties.flatMap(p => p.sources.map(s => s.key)));
  unique(manifest.properties.flatMap(p => p.sources.map(s => JSON.stringify([p.key, s.event_key, s.source.url, s.source.listing_price, s.source.currency]))));
  const propertyKeys = new Set(manifest.properties.map(p => p.key));
  const events = new Map(manifest.events.map(e => [e.key, e]));
  const urls = new Map<string, string>();
  const currentKeys = new Set<string>();
  for (const p of manifest.properties) {
    verify(p.citations);
    const d = p.details;
    if (d.property_id || d.source || d.asking_price !== undefined || d.currency !== undefined || !d.title || !d.city || !d.state || !d.country)
      throw new Error('New property requires reviewed location; canonical price, existing IDs and embedded sources are forbidden.');
    for (const s of p.sources) {
      const e = events.get(s.event_key);
      if (!e || e.property_key !== p.key) throw new Error('Listing source must reference an event for this property.');
      if (s.source.availability_verified || s.source.availability_verified_at || s.source.availability_status && s.source.availability_status !== 'unknown' || s.source.listing_updated_at || s.source.accessed_at)
        throw new Error('Historical sources cannot imply current availability or fabricated website access/update times.');
      if (s.source.external_id) throw new Error('Source IDs are generated from the import key; use URLs for listing identity.');
      if (s.source.url) {
        const url = new URL(s.source.url); url.hash = '';
        const owner = urls.get(url.href);
        if (owner && owner !== p.key) throw new Error('A listing URL maps to multiple properties; resolve the duplicate.');
        urls.set(url.href, p.key);
        if (!e.citations.some(c => byLine.get(c.line_start)!.body.includes(s.source.url!))) throw new Error('Source URL must occur in a cited message.');
      }
    }
  }
  for (const e of manifest.events) {
    verify(e.citations, e.occurred_at);
    if (Date.parse(e.occurred_at) > Date.parse(manifest.review.as_of)) throw new Error('Event occurs after review cutoff.');
    if (e.property_key && !propertyKeys.has(e.property_key) || e.status && !e.property_key || e.rejection_reason && e.status !== 'rejected') throw new Error('Invalid property decision association.');
    if (e.status && e.evidence !== 'explicit') throw new Error('Inferred/agent-reported decisions remain narrative only.');
    const keys = e.facts.map(f => f.fact.key); unique(keys);
    for (const f of e.facts) {
      verify(f.citations, e.occurred_at);
      if (f.fact.source_ref || f.fact.source_interaction_id || f.fact.expected_fact_id !== undefined || f.fact.valid_from || f.fact.source_at || f.fact.valid_until || f.fact.applicability)
        throw new Error('Fact provenance and effective time are derived from the cited event.');
      if (f.current) {
        if (f.evidence !== 'explicit') throw new Error('Only explicit client statements can become current requirements/preferences.');
        if (!f.citations.some(c => c.speaker === manifest.source.client_speaker)) throw new Error('Current fact must cite the buyer, not only the realtor.');
        if (currentKeys.has(f.fact.key)) throw new Error('Select only one current fact per key.');
        currentKeys.add(f.fact.key);
      }
    }
  }
  // A selected current value cannot predate a later explicit value for the same key.
  for (const e of manifest.events) for (const f of e.facts.filter(f => f.current)) {
    if (manifest.events.some(later => Date.parse(later.occurred_at) > Date.parse(e.occurred_at) && later.facts.some(other => other.fact.key === f.fact.key && other.evidence === 'explicit')))
      throw new Error('Current fact selection is older than a later explicit statement.');
  }
  return manifest;
}

function sortedEvents(m: HistoryManifest) {
  return [...m.events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.citations[0]!.line_start - b.citations[0]!.line_start || a.key.localeCompare(b.key));
}
export function sourceRef(m: HistoryManifest, citations: z.infer<typeof citation>[]) {
  return `wa:${m.source.sha256}:lines:${citations.map(c => c.line_start).join(',')}`;
}
export function importPreview(m: HistoryManifest) {
  return { status: 'reviewed_local_preview', source_sha256: m.source.sha256, as_of: m.review.as_of,
    counts: { clients: 1, properties: m.properties.length, sources: m.properties.reduce((n, p) => n + p.sources.length, 0),
      business_interactions: m.events.length, historical_property_events: m.events.filter(e => e.property_key).length,
      facts: m.events.reduce((n, e) => n + e.facts.length, 0), current_facts: 0, latest_source_facts: m.events.flatMap(e => e.facts).filter(f => f.current).length,
      historical_facts: m.events.flatMap(e => e.facts).length, historical_fact_notes: 0, import_receipts: 1,
      open_tasks: 0, import_snapshot_events: m.properties.length },
    ambiguities: m.ambiguities, events: sortedEvents(m), properties: m.properties,
    limitations: ['Current means latest explicitly selected statement as of export/review, not confirmation today.',
      'All imported facts retain typed values with historical applicability; latest-source selection never confirms present applicability.',
      'Property links generate one clearly labelled import-time snapshot in addition to dated historical events.',
      'All follow-up statuses remain historical narrative; no task is created.',
      'Source accessed_at is import recording time for the WhatsApp evidence, never website verification.',
      'Compact contexts truncate; paginate both history tools for complete recall.'] };
}

const sqlString = (s: string) => "E'" + s.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const json = (value: unknown) => sqlString(JSON.stringify(value)) + '::jsonb';

// Produces an artifact only. No database connection, credentials, env load or execution.
export function generateImportSql(m: HistoryManifest, workspaceId: string): string {
  historyManifestSchema.parse(m);
  z.uuid().parse(workspaceId);
  const digest = sha256(JSON.stringify(m));
  const delimiter = `$wa_import_${digest}$`;
  if (JSON.stringify(m).includes(delimiter)) throw new Error('Unsafe SQL body delimiter.');
  const marker = `whatsapp-import:${m.import_key}`;
  const receipt = `wa:${m.import_key}:complete`;
  const lines = [
    '-- LOCAL GENERATED PREVIEW. Execute only after explicit approval of the reviewed manifest and target workspace.',
    '-- Requires an authenticated PostgreSQL session with auth.uid() set to a member of this workspace.',
    'BEGIN;', 'SET LOCAL ROLE authenticated;', `DO ${delimiter}`,
    'DECLARE v_client public.clients; v_property jsonb; v_result jsonb; v_relationship uuid; v_properties jsonb := \'{}\'; v_interactions jsonb := \'{}\';',
    `v_workspace uuid := ${sqlString(workspaceId)}::uuid; v_digest text := ${sqlString(digest)};`,
    'BEGIN',
    "IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=v_workspace AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Workspace access denied'; END IF;",
    `PERFORM pg_advisory_xact_lock(hashtextextended(v_workspace::text || ${sqlString(marker)},0));`,
    `IF (SELECT count(*) FROM public.clients WHERE workspace_id=v_workspace AND split_part(notes,';',1) = ${sqlString(marker)}) > 1 THEN RAISE EXCEPTION 'Duplicate import profiles'; END IF;`,
    `SELECT * INTO v_client FROM public.clients WHERE workspace_id=v_workspace AND split_part(notes,';',1) = ${sqlString(marker)} FOR UPDATE;`,
    'IF FOUND THEN',
    `IF v_client.display_name <> 'Haim' OR NOT EXISTS (SELECT 1 FROM public.interactions WHERE workspace_id=v_workspace AND client_id=v_client.id AND request_key=${sqlString(receipt)} AND summary=v_digest AND response_json IS NOT NULL) THEN RAISE EXCEPTION 'Import profile or manifest conflict; stop for review'; END IF;`,
    "RAISE NOTICE 'Import already complete; no rows written'; RETURN; END IF;",
    `SELECT * INTO v_client FROM public.create_client_with_facts(v_workspace,${json({ display_name: 'Haim', notes: `${marker}; source=${m.source.sha256}; as_of=${m.review.as_of}; latest statements are historical, not confirmation today.` })},'[]'::jsonb);`,
  ];
  for (const p of [...m.properties].sort((a, b) => a.key.localeCompare(b.key))) {
    const details = { ...p.details, notes: `Historical WhatsApp candidate. Availability and current price unknown. ${sourceRef(m, p.citations)}${p.details.notes ? '; ' + p.details.notes : ''}` };
    if (details.notes.length > 2000) throw new Error('Property notes too long after provenance.');
    lines.push(`v_property := public.save_property(v_workspace,${json(details)});`,
      `v_properties := v_properties || jsonb_build_object(${sqlString(p.key)},v_property->'property'->'id');`);
  }
  for (const e of sortedEvents(m)) {
    const ref = sourceRef(m, e.citations);
    const annotations = `[${e.evidence}${e.follow_up_status ? '; follow-up=' + e.follow_up_status : ''}]`;
    const summary = `${annotations} ${e.summary}`;
    const request = { client_id: '11111111-1111-4111-8111-111111111111', expected_version: 0,
      idempotency_key: `wa:${m.import_key}:${e.key}`, interaction_type: 'message' as const,
      occurred_at: e.occurred_at, summary, channel: 'whatsapp_history', source_ref: ref,
      content: JSON.stringify({ business_evidence: e.citations }),
      facts: e.facts.map(f => ({ ...f.fact, applicability: 'historical' as const, source_quote: f.citations.map(c => c.quote).join('\n'), source_ref: sourceRef(m, f.citations), source_at: e.occurred_at, valid_from: e.occurred_at })),
    };
    recordInteractionSchema.parse(request);
    const { client_id: _id, expected_version: _version, ...payload } = request;
    lines.push(`SELECT * INTO v_client FROM public.clients WHERE id=v_client.id AND workspace_id=v_workspace;`,
      `v_result := public.write_client_memory(v_workspace,v_client.id,'record_interaction',${json(payload)} || jsonb_build_object('client_id',v_client.id,'expected_version',v_client.memory_version));`,
      `v_interactions := v_interactions || jsonb_build_object(${sqlString(e.key)},v_result->'interaction_id');`);

  }
  for (const p of m.properties) {
    const events = sortedEvents(m).filter(e => e.property_key === p.key);
    if (!events.length) throw new Error('Each property needs at least one dated discussion event.');
    const lastDecision = events.filter(e => e.status).at(-1);
    const sent = events.find(e => e.status === 'sent'), viewed = events.filter(e => e.status === 'viewed').at(-1);
    const last = events.at(-1)!;
    const snapshot = `Import snapshot only; historical status as of ${last.occurred_at}: ${last.summary}. ${sourceRef(m, last.citations)}`;
    lines.push(`INSERT INTO public.client_properties(workspace_id,client_id,property_id,status,notes,rejection_reason,first_considered_at,sent_at,viewed_at)
VALUES(v_workspace,v_client.id,(v_properties->>${sqlString(p.key)})::uuid,${sqlString(lastDecision?.status ?? 'discovered')},${sqlString(snapshot)},${lastDecision?.rejection_reason ? sqlString(lastDecision.rejection_reason) : 'NULL'},${sqlString(events[0]!.occurred_at)}::timestamptz,${sent ? sqlString(sent.occurred_at) + '::timestamptz' : 'NULL'},${viewed ? sqlString(viewed.occurred_at) + '::timestamptz' : 'NULL'}) RETURNING id INTO v_relationship;`);
    let previousStatus: string | null = null;
    for (const e of events) {
      const ref = sourceRef(m, e.citations);
      const notes = `[${e.evidence}${e.follow_up_status ? '; follow-up=' + e.follow_up_status : ''}] ${e.summary} ${ref}`;
      const metadata = { status: e.status ?? previousStatus, previous_status: previousStatus, rejection_reason: e.rejection_reason ?? null,
        source_ref: ref, evidence: e.evidence, citations: e.citations, follow_up_status: e.follow_up_status ?? null };
      lines.push(`INSERT INTO public.client_property_events(workspace_id,client_property_id,event_type,notes,metadata,interaction_id,occurred_at,created_by)
VALUES(v_workspace,v_relationship,${sqlString(e.status ?? 'historical_discussion')},${sqlString(notes)},${json(metadata)},(v_interactions->>${sqlString(e.key)})::uuid,${sqlString(e.occurred_at)}::timestamptz,auth.uid());`);
      previousStatus = e.status ?? previousStatus;
    }
    for (const s of p.sources) {
      const e = m.events.find(e => e.key === s.event_key)!;
      const sInput = { ...s.source, source_name: `WhatsApp ${e.occurred_at} ${s.source.source_name}`,
        external_id: `${m.import_key}:${s.key}`, availability_status: 'unknown', availability_verified: false };
      propertySourceSchema.parse(sInput);
      lines.push(`PERFORM public.save_property(v_workspace,'{}'::jsonb,(v_properties->>${sqlString(p.key)})::uuid,${json(sInput)});`);
    }
  }
  lines.push('SELECT * INTO v_client FROM public.clients WHERE id=v_client.id AND workspace_id=v_workspace;',
    `PERFORM public.write_client_memory(v_workspace,v_client.id,'record_interaction',${json({ idempotency_key: receipt, interaction_type: 'note', occurred_at: m.review.as_of, summary: digest, channel: 'whatsapp_import_receipt', source_ref: `wa:${m.source.sha256}` })} || jsonb_build_object('client_id',v_client.id,'expected_version',v_client.memory_version));`,
    "RAISE NOTICE 'Historical import complete';", 'END;', `${delimiter};`, 'COMMIT;', '');
  return lines.join('\n');
}

// Preliminary extraction stays a review artifact: never passed to the manifest importer.
export function preliminaryPreview(markdown: string) {
  const groups: Record<string, { line: number; cells: string[] }[]> = { client_fact_candidates: [], property_discussion_rows: [], business_interaction_rows: [] };
  let group: string | undefined;
  for (const [i, line] of markdown.split(/\r?\n/).entries()) {
    if (line.startsWith('| Fact |')) group = 'client_fact_candidates';
    else if (line.startsWith('| Date | Property')) group = 'property_discussion_rows';
    else if (line.startsWith('| Date | Interaction')) group = 'business_interaction_rows';
    else if (!line.startsWith('|')) group = undefined;
    else if (group && !/^\|[-\s|]+$/.test(line)) groups[group]!.push({ line: i + 1, cells: line.split('|').slice(1, -1).map(s => s.trim()) });
  }
  return { status: 'blocked_missing_original_export', importable: false, authority: 'preliminary_review_aid_only',
    counts: Object.fromEntries(Object.entries(groups).map(([k, rows]) => [k, rows.length])),
    counts_are: 'Review table rows, not deduplicated entities or verified events. Groups overlap.',
    proposed_clients: 1, proposed_open_tasks: 0, verified_entities: 0, verified_events: 0, candidates: groups };
}
