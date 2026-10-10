import { NextRequest } from 'next/server';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

export interface ServerUserSession {
  userId: string;
  companyId: string;
  role: 'owner' | 'manager' | 'worker' | 'platform_admin';
  name?: string;
  email?: string;
}

/**
 * Resolves the authenticated session from an incoming API route request.
 *
 * ── Trust model ──────────────────────────────────────────────────────────────
 * Primary path (Supabase configured):
 *   1. `createServerClient()` wires up @supabase/ssr which reads the Supabase
 *      JWT cookies set by the browser client (`sb-*-auth-token`).
 *   2. `supabase.auth.getUser()` verifies the JWT's cryptographic signature
 *      server-side via Supabase's token introspection endpoint.  A forged or
 *      tampered token is always rejected here before any DB lookup.
 *   3. The authenticated user ID is then used to look up their `profiles` row
 *      with the service-role admin client (bypasses RLS — safe because the
 *      user has already been verified by Supabase Auth above).
 *   4. The profile's `company_id` is the authoritative tenant boundary.
 *      It is never read from any request header or from the plain-JSON
 *      `kazibox_session` cookie.
 *
 * Demo / offline fallback (Supabase NOT configured):
 *   - Falls back to the plain-JSON `kazibox_session` cookie so the local demo
 *     mode keeps working without breaking the UI.  This path is explicitly NOT
 *     safe against forgery and MUST NOT be reached in a production deployment
 *     that has Supabase configured.
 *
 * Headers `x-user-id`, `x-company-id`, and `x-workspace-id` are NEVER read.
 */
export async function getServerSession(req: NextRequest): Promise<ServerUserSession | null> {
  // ── Primary: Supabase JWT validation ────────────────────────────────────
  if (isSupabaseConfigured()) {
    // createServerClient() uses @supabase/ssr which wires next/headers cookies
    // so it picks up the Supabase JWT session written during login.
    const supabaseAnon = createServerClient();
    if (supabaseAnon) {
      const { data: { user }, error } = await (supabaseAnon as any).auth.getUser();

      // getUser() returns null user (not an error) for anonymous/invalid sessions.
      // Only proceed if we have a cryptographically verified user.
      if (error || !user) {
        return null;
      }

      // Use the admin client to fetch the profile — bypasses RLS safely
      // because the identity has already been verified by Supabase Auth above.
      const adminClient = createAdminClient();
      if (!adminClient) {
        // No service-role key available; cannot verify company membership.
        return null;
      }

      const { data: profile } = await (adminClient as any)
        .from('profiles')
        .select('id, role, email, name, company_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) {
        // Authenticated Supabase user exists but has no profile row yet.
        // This can happen during sign-up race conditions; treat as unauthorised.
        return null;
      }

      return {
        userId: profile.id as string,
        companyId: profile.company_id as string,
        role: (profile.role as ServerUserSession['role']) || 'worker',
        email: (profile.email as string) || user.email || '',
        name: (profile.name as string) || '',
      };
    }
  }

  // ── Fallback: demo/offline mode only ────────────────────────────────────
  // Supabase is not configured (local demo).  The plain-JSON kazibox_session
  // cookie is used solely to keep the local demo UI functional.
  // THIS PATH MUST NOT BE REACHED IN A PRODUCTION DEPLOYMENT.
  const sessionCookie = req.cookies.get('kazibox_session')?.value;
  if (!sessionCookie) {
    return null;
  }
  try {
    const decoded = JSON.parse(decodeURIComponent(sessionCookie));
    const { userId, companyId } = decoded as { userId?: string; companyId?: string };
    if (!userId || !companyId) {
      return null;
    }
    // In demo mode we have no Supabase, so we cannot verify the role from a DB.
    // Default to 'owner' here only because the local demo store always has
    // a single owner user and Supabase is not present to verify anything anyway.
    return { userId, companyId, role: 'owner', email: '', name: '' };
  } catch {
    return null;
  }
}

/**
 * Convenience guard: returns true only if session exists and the caller
 * belongs to the specified company.
 */
export function sessionBelongsToCompany(
  session: ServerUserSession | null,
  companyId: string
): session is ServerUserSession {
  return !!session && session.companyId === companyId;
}

/**
 * Returns true for privileged roles that may perform sensitive admin writes.
 */
export function isPrivilegedRole(
  roleOrSession: ServerUserSession | ServerUserSession['role'] | null
): boolean {
  if (!roleOrSession) return false;
  const role =
    typeof roleOrSession === 'string' ? roleOrSession : roleOrSession.role;
  return role === 'owner' || role === 'platform_admin';
}
