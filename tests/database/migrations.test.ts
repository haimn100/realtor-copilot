import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

test('repository migrations recreate a database and preserve workflows under hardened security', { timeout: 120_000 }, async t => {
  // Native PostgreSQL, not a reset of any configured/local/live Supabase instance.
  // Requires initdb, pg_ctl and psql on PATH (or PG_BIN pointing at their directory).
  const bin = (name: string) => process.env.PG_BIN ? join(process.env.PG_BIN, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const directory = mkdtempSync(join(tmpdir(), 'realtor-copilot-phase0-'));
  const data = join(directory, 'data');
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address(); assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const options = { encoding: 'utf8' as const, windowsHide: true, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 };
  const psqlArgs = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
  const sql = (query: string) => execFileSync(bin('psql'), [...psqlArgs, '-c', query], options).trim();
  const file = (path: string) => execFileSync(bin('psql'), [...psqlArgs, '--single-transaction', '-f', path], options);
  let started = false;
  let stopped = false;
  try {
    execFileSync(bin('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], options);
    started = true;
    // Windows descendants otherwise keep execFileSync's pipe handles open.
    execFileSync(bin('pg_ctl'), ['start', '-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w'], { ...options, stdio: 'ignore' });
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
    const migrationDir = resolve('supabase/migrations');
    const migrations = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
    assert.equal(migrations[0], '20261007204914_initial_realtor_copilot_schema.sql');
    assert.equal(new Set(migrations.map(name => name.slice(0, 14))).size, migrations.length);
    assert.equal(migrations.length, 4);
    for (const migration of migrations.slice(0, 3)) file(join(migrationDir, migration));
    file(resolve('tests/database/fixtures.sql'));
    const snapshot = () => JSON.stringify(['clients', 'client_facts', 'properties', 'property_sources', 'client_properties', 'client_property_events', 'interactions', 'tasks'].map(table =>
      sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]') from public.${table} t`)));
    const before = snapshot();
    file(join(migrationDir, migrations[3]!));
    await t.test('upgrade does not rewrite existing fixture business data', () => assert.equal(snapshot(), before));
    await t.test('all thirteen tables have RLS and no anonymous or TRUNCATE access', () => {
      assert.equal(sql(`select count(*) from pg_tables where schemaname='public' and rowsecurity`), '13');
      assert.equal(sql(`select count(*) from pg_tables where schemaname='public' and (has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'TRUNCATE') or has_table_privilege('anon',format('%I.%I',schemaname,tablename),'TRUNCATE') or has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))`), '0');
    });
    await t.test('security, rollback, tenant references and existing client/property SQL workflows', () => { file(resolve('tests/database/security.sql')); });
    await t.test('concurrent fact replacements still serialize with a complete history chain', async () => {
      const run = promisify(execFile);
      await Promise.all([6, 7, 8, 9].map(value => run(bin('psql'), [...psqlArgs, '--single-transaction', '-c',
        `set role authenticated; set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
         select public.remember_client_fact('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
         '{"category":"requirement","key":"concurrent","value":${value}}');`], options)));
      assert.equal(sql(`select count(*) from public.client_facts where key='concurrent' and status='current'`), '1');
      assert.equal(sql(`select count(*) from public.client_facts where key='concurrent' and status='superseded' and superseded_by_id is not null`), '3');
    });
    await t.test('administrator fixture cleanup preserves cascade behavior', () => {
      sql(`delete from public.workspaces; set constraints all immediate;`);
      assert.equal(sql('select count(*) from public.client_facts'), '0');
      assert.equal(sql('select count(*) from public.client_property_events'), '0');
    });
    await t.test('migrations also replay into a completely empty application schema', () => {
      sql('drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role;');
      for (const migration of migrations) file(join(migrationDir, migration));
      assert.equal(sql(`select count(*) from pg_tables where schemaname='public' and rowsecurity`), '13');
      assert.equal(sql('select count(*) from public.clients'), '0');
    });
  } finally {
    if (started) {
      execFileSync(bin('pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w'], options);
      stopped = true;
    }
    if (!started || stopped) {
      // Delete only the exact temporary directory allocated by this test.
      const target = realpathSync(directory), root = realpathSync(tmpdir());
      const within = relative(root, target);
      assert(!isAbsolute(within) && !within.startsWith('..') && within.startsWith('realtor-copilot-phase0-'));
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});
