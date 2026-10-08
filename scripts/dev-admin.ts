// Used only by explicit setup/live-test commands, never imported by src/.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/data/database.types.js';

export function developmentAdmin(projectRef: string) {
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('Invalid Supabase project reference.');
  const args = ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--reveal', '-o', 'json'];
  const raw = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'npx ' + args.join(' ')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const keys = JSON.parse(raw) as { name: string; api_key: string; type?: string }[];
  const secret = keys.find(k => k.api_key?.startsWith('sb_secret_')) ?? keys.find(k => k.name === 'service_role');
  const publishable = keys.find(k => k.api_key?.startsWith('sb_publishable_'));
  if (!secret || !publishable) throw new Error('Supabase secret and publishable keys are required for development setup.');
  return {
    publishableKey: publishable.api_key,
    admin: createClient<Database>(`https://${projectRef}.supabase.co`, secret.api_key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
