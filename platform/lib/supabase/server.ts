import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { createClient as createJsClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config';

export function createServerClient(): SupabaseClient<any> | null {
  if (!isSupabaseConfigured() || typeof window !== 'undefined') {
    return null;
  }

  try {
    // Dynamic require so Webpack doesn't include next/headers in client bundles
    const { cookies } = require('next/headers');
    const cookieStore = cookies();
    return createSsrServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Server Component
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Server Component
          }
        },
      },
    }) as any;
  } catch (err) {
    return createJsClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY) as any;
  }
}


