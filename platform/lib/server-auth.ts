import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';
import { hasModuleAccess, getModuleEntitlement, ModuleEntitlement } from './modules';
import { getStore } from './storage';

export interface ServerUserSession {
  userId: string;
  companyId: string;
  role: 'owner' | 'manager' | 'worker' | 'platform_admin';
  name?: string;
  email?: string;
}

export type RequireAuthResult =
  | { session: ServerUserSession; errorResponse?: never }
  | { session?: never; errorResponse: NextResponse };

/**
 * Resolves the authenticated session from an incoming API route request.
 *
 * ── Trust model ──────────────────────────────────────────────────────────────
 * Primary path (Supabase configured):
 *   1. `createServerClient()` wires up @supabase/ssr which reads the Supabase
 *      JWT cookies set by the browser client (`sb-*-auth-token`).
 *   2. `supabase.auth.getUser()` verifies the JWT's cryptographic signature
 *      server-side via Supabase's token introspection endpoint. A forged or
 *      tampered token is always rejected here before any DB lookup.
 *   3. The authenticated user ID is then used to look up their `profiles` row
 *      with the service-role admin client.
 *   4. If `targetCompanyId` is requested:
 *      - If user is `platform_admin`: permitted with role `platform_admin`.
 *      - If user's primary company matches `targetCompanyId`: permitted with profile role.
 *      - Otherwise, `team_members` is queried to verify active membership in `targetCompanyId`.
 *        If verified, the session reflects `targetCompanyId` and the member's role in that workspace.
 *        If not a member, access to that company is rejected.
 *   5. If no `targetCompanyId` is requested:
 *      - Checks `kazibox_session` cookie. If it specifies a company different from profile,
 *        membership in that company is verified via `team_members`. If verified, that company
 *        and role are used; otherwise falls back to the profile's primary company.
 *
 * Demo / offline fallback (Supabase NOT configured):
 *   - Uses `kazibox_session` cookie and verifies user and company against local store.
 */
export async function getServerSession(
  req: NextRequest,
  targetCompanyId?: string | null
): Promise<ServerUserSession | null> {
  // ── Primary: Supabase JWT validation ────────────────────────────────────
  if (isSupabaseConfigured()) {
    const supabaseAnon = createServerClient(req);
    if (supabaseAnon) {
      // 1. Check for Bearer token in Authorization header first
      const authHeader = req.headers.get('authorization') || '';
      const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

      let user: any = null;
      if (bearerToken) {
        const { data: tokenUserData } = await (supabaseAnon as any).auth.getUser(bearerToken);
        if (tokenUserData?.user) {
          user = tokenUserData.user;
        }
      }

      // 2. If no valid bearer token, check session cookies via @supabase/ssr
      if (!user) {
        const { data: cookieUserData } = await (supabaseAnon as any).auth.getUser();
        if (cookieUserData?.user) {
          user = cookieUserData.user;
        }
      }

      if (user) {
        const adminClient = createAdminClient();
        const dbClient = adminClient || supabaseAnon;

        const { data: profile } = await (dbClient as any)
          .from('profiles')
          .select('id, role, email, name, company_id')
          .eq('id', user.id)
          .maybeSingle();

        if (!profile) {
          return null;
        }

        const userRole = (profile.role as ServerUserSession['role']) || 'worker';
        const userEmail = (profile.email as string) || user.email || '';
        const userName = (profile.name as string) || '';

        // Determine requested company
        let desiredCompanyId = targetCompanyId?.trim();
        if (!desiredCompanyId) {
          // Check active workspace cookie
          const sessionCookie = req.cookies.get('kazibox_session')?.value;
          if (sessionCookie) {
            try {
              const decoded = JSON.parse(decodeURIComponent(sessionCookie));
              if (decoded?.companyId) {
                desiredCompanyId = decoded.companyId;
              }
            } catch {
              // Ignore malformed cookie
            }
          }
        }

        // 1. If no specific target requested or target matches primary company
        if (!desiredCompanyId || desiredCompanyId === profile.company_id) {
          return {
            userId: profile.id as string,
            companyId: profile.company_id as string,
            role: userRole,
            email: userEmail,
            name: userName,
          };
        }

        // 2. Platform admin can access any workspace with platform_admin role
        if (userRole === 'platform_admin') {
          return {
            userId: profile.id as string,
            companyId: desiredCompanyId,
            role: 'platform_admin',
            email: userEmail,
            name: userName,
          };
        }

        // 3. User is requesting a different company: verify membership in team_members
        const { data: member } = await (dbClient as any)
          .from('team_members')
          .select('role, status')
          .eq('company_id', desiredCompanyId)
          .or(`user_id.eq.${user.id},email.eq.${userEmail}`)
          .eq('status', 'active')
          .maybeSingle();

        if (member) {
          return {
            userId: profile.id as string,
            companyId: desiredCompanyId,
            role: (member.role as ServerUserSession['role']) || 'worker',
            email: userEmail,
            name: userName,
          };
        }

        // If user specifically requested a company they don't belong to, return null
        // (Caller will reject as 403 Forbidden via requireServerAuth)
        return null;
      }
    }
  }

  // ── Fallback: demo/offline mode only ────────────────────────────────────
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

    const store = getStore();
    const user = store.users.find((u) => u.id === userId);
    const activeCompanyId = targetCompanyId?.trim() || companyId;

    // Check if user has membership in target company
    if (user) {
      if (user.role === 'platform_admin') {
        return {
          userId: user.id,
          companyId: activeCompanyId,
          role: 'platform_admin',
          email: user.email,
          name: user.name,
        };
      }

      if (user.company_id === activeCompanyId) {
        return {
          userId: user.id,
          companyId: activeCompanyId,
          role: user.role,
          email: user.email,
          name: user.name,
        };
      }

      const member = store.members.find(
        (m) =>
          (m.company_id === activeCompanyId) &&
          (m.user_id === user.id || m.email === user.email) &&
          m.status === 'active'
      );

      if (member) {
        return {
          userId: user.id,
          companyId: activeCompanyId,
          role: member.role,
          email: user.email,
          name: user.name,
        };
      }

      // If target company specifically requested but user is not member
      if (targetCompanyId && targetCompanyId !== user.company_id) {
        return null;
      }
    }

    return {
      userId,
      companyId: activeCompanyId,
      role: (user?.role as ServerUserSession['role']) || 'owner',
      email: user?.email || '',
      name: user?.name || '',
    };
  } catch {
    return null;
  }
}

/**
 * Robust guard that enforces authentication, tenant isolation, role authorization,
 * and module subscription entitlements in one unified call.
 */
export async function requireServerAuth(
  req: NextRequest,
  options?: {
    targetCompanyId?: string | null;
    requiredModuleId?: string;
    allowedRoles?: ServerUserSession['role'][];
    requireWriteAccess?: boolean;
    minEntitlement?: ModuleEntitlement;
  }
): Promise<RequireAuthResult> {
  const targetCompany = options?.targetCompanyId?.trim() || null;

  // 1. Authenticate user and validate company membership
  const session = await getServerSession(req, targetCompany);

  if (!session) {
    // Distinguish unauthenticated (no session at all) vs unauthorized for targetCompany
    const unauthenticatedSession = await getServerSession(req);
    if (!unauthenticatedSession) {
      return {
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Unauthorized',
            code: 'NOT_AUTHENTICATED',
            message: 'Veuillez vous connecter pour accéder à cette ressource.',
          },
          { status: 401 }
        ),
      };
    }

    // User is authenticated, but does not belong to the requested targetCompany
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          code: 'COMPANY_MISMATCH',
          message: 'Vous n’avez pas accès à cet espace de travail.',
        },
        { status: 403 }
      ),
    };
  }

  // 2. If targetCompanyId was supplied, ensure session is bound to it
  if (targetCompany && session.companyId !== targetCompany && session.role !== 'platform_admin') {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          code: 'COMPANY_MISMATCH',
          message: 'Vous ne pouvez pas effectuer d’opérations sur un autre espace de travail.',
        },
        { status: 403 }
      ),
    };
  }

  // 3. Enforce role permissions if specified
  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    if (!options.allowedRoles.includes(session.role)) {
      return {
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            code: 'INSUFFICIENT_ROLE',
            message: 'Permissions insuffisantes pour effectuer cette action.',
          },
          { status: 403 }
        ),
      };
    }
  }

  // 4. Enforce module entitlement and read-only mode if specified
  if (options?.requiredModuleId) {
    const entitlement = await getModuleEntitlement(session.companyId, options.requiredModuleId);

    if (entitlement === 'none') {
      return {
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            code: 'MODULE_NOT_ENTITLED',
            message: `Le module '${options.requiredModuleId}' n’est pas activé ou inclus dans l’abonnement de cet espace de travail.`,
          },
          { status: 403 }
        ),
      };
    }

    const isWriteMethod = req.method !== 'GET' && req.method !== 'HEAD';
    const writeRequired =
      options?.requireWriteAccess ?? (options?.minEntitlement === 'active' || isWriteMethod);

    if (entitlement === 'read_only' && writeRequired) {
      return {
        errorResponse: NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            code: 'SUBSCRIPTION_EXPIRED',
            message: `L’abonnement pour le module '${options.requiredModuleId}' a expiré. L’accès est en lecture seule. Veuillez renouveler votre abonnement pour effectuer des modifications.`,
          },
          { status: 403 }
        ),
      };
    }
  }

  return { session };
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
