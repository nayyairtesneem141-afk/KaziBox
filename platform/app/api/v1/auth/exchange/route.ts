import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { signAsymmetricUserToken } from '@/lib/jwt';
import { getMemoryTicketStore } from '../authorize/route';
import { getStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/auth/exchange
 *
 * Exchanges a one-time PKCE authorization ticket for a scoped asymmetric RS256 User API token.
 *
 * Security Requirements:
 * 1. Module Authentication: Requires `Authorization: Bearer kz_live_...` with `auth:exchange` scope.
 * 2. PKCE Verification: `code_challenge === BASE64URL-SHA256(code_verifier)`.
 * 3. Atomic Single-Use Burn: Ticket is consumed immediately; second attempt fails closed.
 * 4. Workspace & Redirect URI Binding: Exact match against ticket's registered redirect_uri and module.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate caller module API key
  const authResult = await authenticateModuleApiKey(req, 'auth:exchange');
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  const { auth } = authResult;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Malformed JSON payload' },
      { status: 400 }
    );
  }

  const { code, codeVerifier, code_verifier, redirectUri, redirect_uri } = body || {};
  const effectiveCode = (code || '').trim();
  const effectiveVerifier = (codeVerifier || code_verifier || '').trim();
  const effectiveRedirectUri = (redirectUri || redirect_uri || '').trim();

  if (!effectiveCode || !effectiveVerifier || !effectiveRedirectUri) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        error_description: 'code, code_verifier, and redirect_uri are all required.',
      },
      { status: 400 }
    );
  }

  // 2. Hash incoming code
  const codeHash = crypto.createHash('sha256').update(effectiveCode).digest('hex');

  // 3. Atomically consume ticket from persistent Supabase or fallback memory store
  let ticketRecord: {
    userId: string;
    companyId: string;
    moduleId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  } | null = null;

  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Database connection unavailable' },
        { status: 503 }
      );
    }

    // Call atomic consumption RPC if available, or atomic UPDATE
    const { data: updatedRows, error: updateErr } = await (supabase as any)
      .from('auth_tickets')
      .update({
        consumed: true,
        consumed_at: new Date().toISOString(),
      })
      .eq('code_hash', codeHash)
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .select('user_id, company_id, module_id, redirect_uri, code_challenge, code_challenge_method');

    if (!updateErr && Array.isArray(updatedRows) && updatedRows.length > 0) {
      const row = updatedRows[0];
      ticketRecord = {
        userId: row.user_id,
        companyId: row.company_id,
        moduleId: row.module_id,
        redirectUri: row.redirect_uri,
        codeChallenge: row.code_challenge,
        codeChallengeMethod: row.code_challenge_method,
      };
    } else {
      // Check in-memory test fallback
      const memStore = getMemoryTicketStore();
      const memRecord = memStore.get(codeHash);
      if (memRecord && !memRecord.consumed && memRecord.expiresAt > Date.now()) {
        memRecord.consumed = true;
        ticketRecord = {
          userId: memRecord.userId,
          companyId: memRecord.companyId,
          moduleId: memRecord.moduleId,
          redirectUri: memRecord.redirectUri,
          codeChallenge: memRecord.codeChallenge,
          codeChallengeMethod: memRecord.codeChallengeMethod,
        };
      }
    }
  } else {
    // In-memory test store atomic burn
    const memStore = getMemoryTicketStore();
    const memRecord = memStore.get(codeHash);
    if (memRecord && !memRecord.consumed && memRecord.expiresAt > Date.now()) {
      memRecord.consumed = true;
      ticketRecord = {
        userId: memRecord.userId,
        companyId: memRecord.companyId,
        moduleId: memRecord.moduleId,
        redirectUri: memRecord.redirectUri,
        codeChallenge: memRecord.codeChallenge,
        codeChallengeMethod: memRecord.codeChallengeMethod,
      };
    }
  }

  if (!ticketRecord) {
    return NextResponse.json(
      {
        error: 'invalid_grant',
        error_description: 'Authorization ticket is invalid, expired, or has already been consumed.',
      },
      { status: 400 }
    );
  }

  // 4. Verify module identity match
  if (ticketRecord.moduleId !== auth!.moduleId) {
    return NextResponse.json(
      {
        error: 'invalid_client',
        error_description: `Ticket was issued for module '${ticketRecord.moduleId}', but caller is '${auth!.moduleId}'.`,
      },
      { status: 403 }
    );
  }

  // 5. Verify redirect_uri match
  if (ticketRecord.redirectUri !== effectiveRedirectUri) {
    return NextResponse.json(
      {
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match the URI used during authorization.',
      },
      { status: 400 }
    );
  }

  // 6. Verify PKCE code_verifier (S256: BASE64URL(SHA256(code_verifier)))
  const computedChallenge = crypto
    .createHash('sha256')
    .update(effectiveVerifier)
    .digest('base64url');

  if (computedChallenge !== ticketRecord.codeChallenge) {
    return NextResponse.json(
      {
        error: 'invalid_grant',
        error_description: 'PKCE code_verifier verification failed.',
      },
      { status: 400 }
    );
  }

  // 7. Resolve user profile and workspace details
  const store = getStore();
  let userProfile = store.users.find((u) => u.id === ticketRecord!.userId);
  let workspace = store.workspaces.find((w) => w.id === ticketRecord!.companyId || w.company_id === ticketRecord!.companyId);

  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    if (supabase) {
      const { data: prof } = await (supabase as any)
        .from('profiles')
        .select('*')
        .eq('id', ticketRecord.userId)
        .maybeSingle();
      if (prof) {
        userProfile = {
          id: prof.id,
          email: prof.email,
          name: prof.name,
          role: prof.role,
          company_id: prof.company_id,
          created_at: prof.created_at,
        };
      }
      const { data: comp } = await (supabase as any)
        .from('companies')
        .select('*')
        .eq('id', ticketRecord.companyId)
        .maybeSingle();
      if (comp) {
        workspace = {
          id: comp.id,
          company_id: comp.id,
          name: comp.name,
          currency: comp.currency || 'XOF',
          country: comp.country || 'CI',
          language: comp.language || 'fr',
          created_at: comp.created_at,
          plan: comp.plan || 'pro',
          status: comp.status || 'active',
        };
      }
    }
  }

  if (!userProfile) {
    userProfile = {
      id: ticketRecord.userId,
      email: 'user@kazibox.internal',
      name: 'KaziBox User',
      role: 'owner',
      company_id: ticketRecord.companyId,
      created_at: new Date().toISOString(),
    };
  }

  if (!workspace) {
    workspace = {
      id: ticketRecord.companyId,
      company_id: ticketRecord.companyId,
      name: 'KaziBox Workspace',
      currency: 'XOF',
      country: 'CI',
      language: 'fr',
      created_at: new Date().toISOString(),
      plan: 'pro',
      status: 'active',
    };
  }

  // 8. Sign asymmetric RS256 User API Token (Max 1 hour TTL)
  const { token, expiresIn } = signAsymmetricUserToken({
    userId: userProfile.id,
    email: userProfile.email,
    name: userProfile.name,
    role: userProfile.role,
    companyId: workspace.company_id || workspace.id,
    moduleId: auth!.moduleId,
    ttlSeconds: 3600,
  });

  return NextResponse.json({
    success: true,
    token_type: 'Bearer',
    access_token: token,
    expires_in: expiresIn,
    user: {
      id: userProfile.id,
      email: userProfile.email,
      name: userProfile.name,
      role: userProfile.role,
      companyId: workspace.company_id || workspace.id,
    },
    workspace: {
      id: workspace.company_id || workspace.id,
      name: workspace.name,
      currency: workspace.currency || 'XOF',
      country: workspace.country || 'CI',
    },
  });
}

