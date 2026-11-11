import { NextRequest, NextResponse } from 'next/server';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { verifyAsymmetricUserToken } from '@/lib/jwt';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/introspect
 *
 * RFC 7662 compliant token introspection endpoint.
 * Allows partner SaaS backends to verify an asymmetric User API Token directly with KaziBox.
 *
 * Security:
 * - Requires caller to authenticate via Module API Key.
 * - Performs real-time account status and workspace membership checks in Supabase.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate caller module
  const authResult = await authenticateModuleApiKey(req, 'read:context');
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  const { auth } = authResult;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ active: false }, { status: 400 });
  }

  const token = (body?.token || body?.accessToken || '').trim();
  if (!token) {
    return NextResponse.json({ active: false }, { status: 200 });
  }

  // 2. Verify asymmetric signature, expiry, and issuer
  const verification = verifyAsymmetricUserToken(token, {
    expectedAudience: auth!.moduleId,
  });

  if (!verification.valid || !verification.claims) {
    return NextResponse.json(
      {
        active: false,
        error: verification.error,
        code: verification.code,
      },
      { status: 200 }
    );
  }

  const { claims } = verification;

  // 3. Real-time active status check in Supabase if configured
  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    if (supabase) {
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('id, role, company_id')
        .eq('id', claims.sub)
        .maybeSingle();

      if (!profile || profile.company_id !== claims.company_id) {
        return NextResponse.json(
          {
            active: false,
            error: 'User account has been deactivated or removed from workspace',
            code: 'USER_DEACTIVATED',
          },
          { status: 200 }
        );
      }
    }
  }

  return NextResponse.json({
    active: true,
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    role: claims.role,
    company_id: claims.company_id,
    workspace_id: claims.workspace_id,
    aud: claims.aud,
    iss: claims.iss,
    token_use: claims.token_use,
    scopes: claims.scopes,
    iat: claims.iat,
    exp: claims.exp,
  });
}

