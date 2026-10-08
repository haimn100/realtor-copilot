import type { IncomingMessage } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../data/database.types.js';
import { AppError } from '../domain/errors.js';
import type { Config } from './config.js';

export interface ApplicationContext {
  readonly workspaceId: string;
  readonly userId: string;
  readonly supabase: SupabaseClient<Database>;
}
// Replace this adapter with verified OAuth identity + server-side workspace
// resolution. MCP parameters and headers must never select the workspace.
export interface IdentityProvider {
  resolve(request: IncomingMessage): Promise<ApplicationContext>;
}
export class DevelopmentIdentityProvider implements IdentityProvider {
  private readonly supabase: SupabaseClient<Database>;
  private userId?: string;
  constructor(private readonly config: Config) {
    if (config.NODE_ENV === 'production') throw new Error('Development identity is disabled in production.');
    this.supabase = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  async initialize(): Promise<void> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: this.config.DEV_SUPABASE_EMAIL, password: this.config.DEV_SUPABASE_PASSWORD,
    });
    if (error || !data.user) throw new AppError('UNAUTHENTICATED', 'Development user login failed. Check the local Supabase credentials.');
    this.userId = data.user.id;
    await this.assertMembership();
  }
  private async assertMembership() {
    const { data, error } = await this.supabase.from('workspace_members').select('workspace_id')
      .eq('workspace_id', this.config.DEV_WORKSPACE_ID).eq('user_id', this.userId!).maybeSingle();
    if (error || !data) throw new AppError('FORBIDDEN', 'Development user is not a member of the configured workspace.');
  }
  async resolve(_request: IncomingMessage): Promise<ApplicationContext> {
    if (!this.userId) throw new AppError('UNAUTHENTICATED', 'Identity provider is not initialized.');
    await this.assertMembership();
    return { workspaceId: this.config.DEV_WORKSPACE_ID, userId: this.userId, supabase: this.supabase };
  }
  close() { this.supabase.auth.stopAutoRefresh(); }
}
