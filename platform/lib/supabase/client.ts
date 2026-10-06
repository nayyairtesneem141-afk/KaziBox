import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';
import { createClient as createJsClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config';

let clientInstance: SupabaseClient<any> | null = null;

export function createBrowserClient(): SupabaseClient<any> | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (clientInstance) return clientInstance;

  try {
    clientInstance = createSsrBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY) as any;
  } catch (err) {
    clientInstance = createJsClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY) as any;
  }
  return clientInstance;
}

