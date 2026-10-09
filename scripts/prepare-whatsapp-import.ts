import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateImportSql, importPreview, preliminaryPreview, validateManifest } from '../src/import/whatsapp-history.js';

// Intentionally no --apply flag. Preparation cannot contact a live database.
const { values } = parseArgs({ options: {
  preliminary: { type: 'string' }, source: { type: 'string' }, manifest: { type: 'string' },
  workspace: { type: 'string' }, output: { type: 'string' }, sql: { type: 'string' },
}, strict: true });
if (!values.output) throw new Error('Supply --output for the local JSON preview.');
if (values.preliminary) {
  if (values.source || values.manifest || values.workspace || values.sql) throw new Error('Preliminary review cannot generate executable import SQL.');
  writeFileSync(values.output, JSON.stringify(preliminaryPreview(readFileSync(values.preliminary, 'utf8')), null, 2) + '\n', { flag: 'wx' });
} else {
  if (!values.source || !values.manifest) throw new Error('Original --source export and reviewed --manifest required.');
  if (Boolean(values.sql) !== Boolean(values.workspace)) throw new Error('SQL preparation requires both --sql and --workspace.');
  const manifest = validateManifest(JSON.parse(readFileSync(values.manifest, 'utf8')), readFileSync(values.source));
  const sql = values.sql ? generateImportSql(manifest, values.workspace!) : undefined;
  writeFileSync(values.output, JSON.stringify(importPreview(manifest), null, 2) + '\n', { flag: 'wx' });
  if (sql) writeFileSync(values.sql!, sql, { flag: 'wx' });
}
console.log(`Local preview saved to ${values.output}. No database connection or writes performed.`);
