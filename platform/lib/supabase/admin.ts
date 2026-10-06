import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config';

let adminClient: SupabaseClient<Database> | null = null;

export function createAdminClient(): SupabaseClient<Database> | null {
  if (typeof window !== 'undefined') {
    return null;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!adminClient) {
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

