import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { createClient as createJsClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config';

export function createServerClient(req?: any): SupabaseClient<any> | null {
  if (!isSupabaseConfigured() || typeof window !== 'undefined') {
    return null;
  }

  try {
    let cookieStore: any = null;
    try {
      // Dynamic require so Webpack doesn't include next/headers in client bundles
      const { cookies } = require('next/headers');
      cookieStore = cookies();
    } catch {
      // Server Component or route handler where cookies() might not be accessible
    }

    return createSsrServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          if (req?.cookies && typeof req.cookies.getAll === 'function') {
            return req.cookies.getAll();
          }
          if (cookieStore && typeof cookieStore.getAll === 'function') {
            return cookieStore.getAll();
          }
          return [];
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: any }>) {
          try {
            if (cookieStore) {
              cookiesToSet.forEach(({ name, value, options }) => {
                if (typeof cookieStore.set === 'function') {
                  cookieStore.set(name, value, options);
                }
              });
            }
          } catch {
            // Read-only server context
          }
        },
      },
    }) as any;
  } catch (err) {
    return createJsClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY) as any;
  }
}


