import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getModule } from '@/lib/modules';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { getServerSession } from '@/lib/server-auth';
import { getStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Dedicated Browser Redirect URI Validator.
 *
 * Rules:
 * - Accept ONLY exact registered entries in `manifest.redirectUris`.
 * - NO automatic fallback to entryUrl, webhookUrl, or summaryUrl.
 * - Accept only `https:` scheme (or `http://localhost` / `http://127.0.0.1` strictly in dev/test mode).
 * - Reject unsafe schemes (`javascript:`, `data:`, `file:`).
 */
export function validateBrowserRedirectUri(
  redirectUri: string,
  registeredUris?: string[]
): { valid: boolean; reason?: string } {
  if (!redirectUri || typeof redirectUri !== 'string') {
    return { valid: false, reason: 'redirect_uri parameter is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return { valid: false, reason: 'Malformed redirect_uri URL.' };
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isDevOrTest = process.env.NODE_ENV !== 'production';

  if (parsed.protocol !== 'https:' && !(isLocalhost && isDevOrTest)) {
    return { valid: false, reason: 'redirect_uri must use the secure https: protocol.' };
  }

  if (!Array.isArray(registeredUris) || registeredUris.length === 0) {
    return {
      valid: false,
      reason: 'Module has no registered redirectUris in its manifest.',
    };
  }

  // Exact registered match check (ignoring trailing slash differences)
  const cleanIncoming = redirectUri.replace(/\/+$/, '');
  const matched = registeredUris.some((reg) => {
    if (typeof reg !== 'string') return false;
    return reg.replace(/\/+$/, '') === cleanIncoming;
  });

  if (!matched) {
    return {
      valid: false,
      reason: `The provided redirect_uri '${redirectUri}' is not in the module's registered redirectUris allowlist.`,
    };
  }

  return { valid: true };
}

/**
 * In-memory fallback ticket store for test / offline environments.
 */
interface InMemoryTicket {
  codeHash: string;
  userId: string;
  companyId: string;
  moduleId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  consumed: boolean;
  expiresAt: number; // Unix ms
}

const memoryTicketStore = new Map<string, InMemoryTicket>();

export function getMemoryTicketStore() {
  return memoryTicketStore;
}

/**
 * GET /api/v1/auth/authorize
 *
 * Initiates the OAuth PKCE Authorization Code flow.
 *
 * Query Parameters:
 * - `module_id` (required): Registered SaaS module ID.
 * - `redirect_uri` (required): Exact match against module's `manifest.redirectUris`.
 * - `response_type` (required): Must be 'code'.
 * - `code_challenge` (required): PKCE S256 code challenge.
 * - `code_challenge_method` (required): Must be 'S256'.
 * - `state` (required): Random anti-CSRF state token from partner.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const moduleId = (searchParams.get('module_id') || '').trim().toLowerCase();
  const redirectUri = (searchParams.get('redirect_uri') || '').trim();
  const responseType = searchParams.get('response_type');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const state = searchParams.get('state');

  // 1. Validate required parameters
  if (!moduleId) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'module_id is required' },
      { status: 400 }
    );
  }

  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type', error_description: "response_type must be 'code'" },
      { status: 400 }
    );
  }

  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return NextResponse.json(
      {
        error: 'invalid_request',
        error_description: "PKCE is required. Provide 'code_challenge' with code_challenge_method='S256'",
      },
      { status: 400 }
    );
  }

  if (!state) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'state parameter is required for CSRF protection' },
      { status: 400 }
    );
  }

  // 2. Fetch module manifest & validate status
  const mod = await getModule(moduleId);
  if (!mod || mod.status !== 'published') {
    return NextResponse.json(
      {
        error: 'unauthorized_client',
        error_description: `Module '${moduleId}' is not a published application in KaziBox.`,
      },
      { status: 400 }
    );
  }

  // 3. Strict redirect_uri validation against manifest.redirectUris
  const redirectCheck = validateBrowserRedirectUri(redirectUri, mod.redirectUris);
  if (!redirectCheck.valid) {
    return NextResponse.json(
      {
        error: 'invalid_redirect_uri',
        error_description: redirectCheck.reason,
      },
      { status: 400 }
    );
  }

  // 4. Authenticate human user session
  // Checks session cookie via getServerSession or simulates user in dev/test via mock
  const session = await getServerSession(req);
  let authenticatedUser: { id: string; companyId: string } | null = null;

  if (session) {
    authenticatedUser = {
      id: session.userId,
      companyId: session.companyId,
    };
  } else {
    // Check if test override is present in query for automated integration testing
    const testUserId = searchParams.get('test_user_id');
    const testCompanyId = searchParams.get('test_company_id');
    if (process.env.NODE_ENV !== 'production' && testUserId && testCompanyId) {
      authenticatedUser = {
        id: testUserId,
        companyId: testCompanyId,
      };
    } else {
      // In production/staging browser access, redirect to KaziBox portal login with return URL
      const loginUrl = new URL('/auth/login', req.nextUrl.origin);
      loginUrl.searchParams.set('returnUrl', req.url);
      return NextResponse.redirect(loginUrl.toString());
    }
  }

  if (!authenticatedUser) {
    return NextResponse.json(
      { error: 'access_denied', error_description: 'User authentication required' },
      { status: 401 }
    );
  }

  // 5. Generate secure 60-second authorization code
  const rawCode = `kzac_${crypto.randomBytes(32).toString('hex')}`;
  const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 1000); // 60s TTL

  // 6. Store hashed ticket persistently in Supabase
  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Database connection unavailable' },
        { status: 503 }
      );
    }

    const { error: insertErr } = await (supabase as any)
      .from('auth_tickets')
      .insert({
        code_hash: codeHash,
        user_id: authenticatedUser.id,
        company_id: authenticatedUser.companyId,
        module_id: mod.id,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        consumed: false,
        expires_at: expiresAt.toISOString(),
      });

    if (insertErr) {
      // If table is not present, fail-closed in staging/production unless test fallback
      if (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_APP_ENV === 'staging') {
        return NextResponse.json(
          { error: 'server_error', error_description: `Failed to persist authorization ticket: ${insertErr.message}` },
          { status: 503 }
        );
      }
      // Offline fallback for unit tests
      memoryTicketStore.set(codeHash, {
        codeHash,
        userId: authenticatedUser.id,
        companyId: authenticatedUser.companyId,
        moduleId: mod.id,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: 'S256',
        consumed: false,
        expiresAt: expiresAt.getTime(),
      });
    }
  } else {
    // Offline memory store fallback
    memoryTicketStore.set(codeHash, {
      codeHash,
      userId: authenticatedUser.id,
      companyId: authenticatedUser.companyId,
      moduleId: mod.id,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: 'S256',
      consumed: false,
      expiresAt: expiresAt.getTime(),
    });
  }

  // 7. Issue 302 Redirect to exact redirect_uri with rawCode and state
  const targetUrl = new URL(redirectUri);
  targetUrl.searchParams.set('code', rawCode);
  targetUrl.searchParams.set('state', state);

  return NextResponse.redirect(targetUrl.toString(), 302);
}

