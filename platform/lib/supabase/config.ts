// Supabase configuration and env helpers

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function isSupabaseConfigured(): boolean {
  if (typeof globalThis !== 'undefined' && (globalThis as any).__kaziboxSupabaseAdminOverride) {
    return true;
  }
  const url = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_URL) || SUPABASE_URL;
  const anonKey = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY;
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || SUPABASE_SERVICE_ROLE_KEY;

  return typeof window !== 'undefined'
    ? Boolean(url && anonKey)
    : Boolean(url && (anonKey || serviceKey));
}
