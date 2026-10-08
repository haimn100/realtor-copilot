import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  AUTH_MODE: z.literal('development').default('development'),
  DEV_TUNNEL_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && url.pathname === '/' && !url.search && !url.hash
      && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)
      && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local')
      && !/^[\d.]+$/.test(url.hostname);
  }, 'Use one public HTTPS tunnel origin without credentials, port, path, query, or fragment.').transform(value => new URL(value).origin).optional(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).refine(k => k.startsWith('sb_publishable_'), 'Use a modern Supabase publishable key.'),
  DEV_WORKSPACE_ID: z.uuid(),
  DEV_SUPABASE_EMAIL: z.email(),
  DEV_SUPABASE_PASSWORD: z.string().min(8),
});
export type Config = z.infer<typeof configSchema>;
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration: ' + result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (result.data.NODE_ENV === 'production') throw new Error('Development identity cannot run in production. Supply an OAuth identity provider before deployment.');
  if (result.data.DEV_TUNNEL_URL && result.data.NODE_ENV !== 'development') throw new Error('DEV_TUNNEL_URL is only allowed with NODE_ENV=development.');
  return result.data;
}
export function loadConfig(): Config {
  if (existsSync('.env')) loadEnvFile('.env');
  return parseConfig(process.env);
}
