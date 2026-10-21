import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config';

let adminClient: SupabaseClient<Database> | null = null;

export function createAdminClient(): SupabaseClient<Database> | null {
  if (typeof window !== 'undefined') {
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return null;
  }
  if (!adminClient) {
    adminClient = createClient<Database>(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

