import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { generateImportSql, importPreview, parseWhatsApp, preliminaryPreview, validateManifest } from '../src/import/whatsapp-history.js';
import { syntheticExport, syntheticManifest } from './fixtures/whatsapp-history.js';

test('WhatsApp parser preserves timestamps, multiline content and line references; date order is explicit', () => {
  const messages = parseWhatsApp('\uFEFF[5/6/24, 1:02:03 PM] Haim: first\ncontinuation\n[5/6/24, 13:03:00] system notice\n[5/6/24, 13:04:00] Isabel: next', 'day-first', '-05:00');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.occurred_at, '2024-06-05T13:02:03-05:00');
  assert.equal(messages[0]!.body, 'first\ncontinuation');
  assert.equal(messages[0]!.line_end, 2);
  assert.equal(messages[1]!.line_start, 4);
  assert.equal(parseWhatsApp('5/6/2024, 1:02 PM - Haim: text', 'month-first', '+00:00')[0]!.occurred_at, '2024-05-06T13:02:00+00:00');
  assert.throws(() => parseWhatsApp('31/02/24, 10:00 - Haim: text', 'day-first', '-05:00'), /Invalid date/);
  assert.throws(() => parseWhatsApp('2024-05-25, 10:00 - Haim: text', 'day-first', '-05:00'), /Unsupported timestamp/);
  assert.throws(() => parseWhatsApp(syntheticExport.toString(), 'day-first', 'local'), /confirmed source timezone/);
  assert.throws(() => parseWhatsApp('# Preliminary review', 'day-first', '-05:00'), /Original export/);
});

test('manifest requires source, exact citations, chronology, buyer attribution and unique decisions', () => {
  const m = validateManifest(syntheticManifest(), syntheticExport);
  assert.equal(m.events.length, 6);
  assert.throws(() => validateManifest(m, Buffer.from('unrelated file')), /SHA-256/);
  const change = (mutate: (m: ReturnType<typeof syntheticManifest>) => void, pattern: RegExp) => {
    const copy = syntheticManifest(); mutate(copy); assert.throws(() => validateManifest(copy, syntheticExport), pattern);
  };
  change(m => { m.events[0]!.citations[0]!.quote = 'invented quote'; }, /Citation/);
  change(m => { m.events[0]!.occurred_at = '2026-09-09T11:00:00-05:00'; }, /timestamp/);
  change(m => { m.events.push(m.events[0]!); }, /Duplicate/);
  change(m => { m.events.push({ ...m.events[0]!, key: 'duplicate_different_key' }); }, /Duplicate/);
  change(m => { m.events[0]!.facts[0]!.evidence = 'inferred'; }, /Only explicit/);
  change(m => { m.source.client_speaker = 'Isabel'; }, /buyer/);
  change(m => { m.events[0]!.facts[0]!.current = false; m.events[1]!.facts[0]!.current = true; }, /older/);
  change(m => { m.properties[0]!.details.asking_price = 3688800; m.properties[0]!.details.currency = 'MXN'; }, /canonical price/);
  change(m => { m.properties[0]!.sources[0]!.source.availability_status = 'available'; }, /availability/);
  change(m => { m.events[5]!.status = 'viewed'; }, /narrative only/);
  change(m => { m.events[2]!.property_key = 'missing'; }, /property/);
  change(m => { m.properties[0]!.sources[0]!.source.url = 'https://example.invalid/uncited'; }, /URL/);
});

test('preview and SQL preserve historical ordering, unknown prices/availability, provenance and no tasks', () => {
  const m = validateManifest(syntheticManifest(), syntheticExport), preview = importPreview(m);
  assert.equal(preview.counts.open_tasks, 0);
  assert.equal(preview.counts.current_facts, 0);
  assert.equal(preview.events[0]!.key, 'budget_old');
  const sql = generateImportSql(m, '20000000-0000-4000-8000-000000000001');
  assert.equal(sql, generateImportSql(m, '20000000-0000-4000-8000-000000000001'));
  assert(sql.indexOf('wa:haim_isabel_history:budget_old') < sql.indexOf('wa:haim_isabel_history:budget_latest'));
  assert(sql.includes('pg_advisory_xact_lock'));
  assert(sql.includes('Import already complete; no rows written'));
  assert(sql.includes('\"applicability\":\"historical\"'));
  assert(!sql.includes('historical_fact')); 
  assert(sql.includes(`wa:${m.source.sha256}:lines:`));
  assert(!sql.includes('INSERT INTO public.tasks'));
  assert(!sql.includes('DISABLE TRIGGER'));
  assert(!sql.includes("'viewed'"));
  assert.throws(() => generateImportSql(m, 'John'), /UUID/);
});

test('SQL input quoting keeps apostrophes, backslashes and dollar body delimiters as data', () => {
  const m = syntheticManifest();
  m.events[0]!.summary = "O'Brien \\ path $wa_import$; DROP TABLE public.clients;";
  const sql = generateImportSql(validateManifest(m, syntheticExport), '20000000-0000-4000-8000-000000000001');
  assert(sql.includes("O''Brien")); assert(sql.includes('DO $wa_import_'));
  assert(sql.includes('$wa_import$; DROP TABLE'));
});

test('preliminary review yields provisional row counts, never an importable manifest', () => {
  const preview = preliminaryPreview('| Fact | Date(s) | Evidence | Status |\n|---|---|---|---|\n| Ambiguous 150 usd | Jun 2024 | review | unknown |\n\n| Date | Property / development | Detail |\n|---|---|---|\n| Oct | Marbella/Marsella | unsure |');
  assert.equal(preview.counts.client_fact_candidates, 1);
  assert.equal(preview.counts.property_discussion_rows, 1);
  assert.equal(preview.importable, false);
  assert.throws(() => validateManifest(preview, syntheticExport));
});

test('CLI refuses a live/apply mode and unknown arguments before accessing source or credentials', () => {
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-whatsapp-import.ts', '--apply'], { stdio: 'pipe' }),
    (error: any) => /Unknown option/.test(error.stderr.toString()));
});
