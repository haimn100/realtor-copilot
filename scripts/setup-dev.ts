import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
import { developmentAdmin } from './dev-admin.js';

const hadEnv = existsSync('.env');
if (hadEnv) loadEnvFile('.env');
const identityFields = ['DEV_WORKSPACE_ID', 'DEV_SUPABASE_EMAIL', 'DEV_SUPABASE_PASSWORD'] as const;
if (identityFields.every(key => process.env[key])) {
  console.log('.env already exists. Existing development identity retained.');
} else {
  if (identityFields.some(key => process.env[key])) throw new Error('Development identity is partly configured. Complete DEV_WORKSPACE_ID, DEV_SUPABASE_EMAIL and DEV_SUPABASE_PASSWORD in .env.');
  const projectRef = 'mcnhnxeayepgrstjefvg';
  const { admin, publishableKey } = developmentAdmin(projectRef);
  const email = `realtor-dev-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !userData.user) throw new Error('Could not create development auth user.');
  const { data: workspace, error: workspaceError } = await admin.from('workspaces')
    .insert({ name: 'Realtor Copilot development', created_by: userData.user.id }).select('id').single();
  if (workspaceError || !workspace) throw new Error('Could not create development workspace.');
  const { error: memberError } = await admin.from('workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userData.user.id, role: 'owner' });
  if (memberError) throw new Error('Could not assign development membership.');
  const envLines = [
    'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=8787', 'AUTH_MODE=development',
    `SUPABASE_URL=https://${projectRef}.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    `DEV_WORKSPACE_ID=${workspace.id}`, `DEV_SUPABASE_EMAIL=${email}`, `DEV_SUPABASE_PASSWORD=${password}`, '',
  ].filter(line => !line || !process.env[line.split('=')[0]!]).join('\n');
  if (hadEnv) appendFileSync('.env', '\n' + envLines);
  else writeFileSync('.env', envLines, { mode: 0o600, flag: 'wx' });
  console.log('Dedicated development user and workspace created; credentials saved only in gitignored .env.');
}
