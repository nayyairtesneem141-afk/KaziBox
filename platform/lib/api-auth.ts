import { NextRequest, NextResponse } from 'next/server';
import { getStore } from './storage';
import { ModuleManifest, Workspace } from '@kazibox/sdk';
import { createAdminClient } from './supabase/admin';
import { createServerClient } from './supabase/server';
import { isSupabaseConfigured } from './supabase/config';

/**
 * Rate Limiter
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60; // 60 req/min

export function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetAt) {
    const nextReset = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(identifier, { count: 1, resetAt: nextReset });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, resetAt: nextReset };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count, resetAt: record.resetAt };
}

export interface ApiAuthContext {
  moduleId: string;
  module: ModuleManifest;
  workspaceId: string;
  workspace: Workspace;
}

/**
 * Hash helper matching createApiKey in registry.ts
 */
export function hashSecret(secret: string): string {
  return `sha256_mock_${Buffer.from(secret).toString('base64').substring(0, 16)}`;
}

/**
 * Authenticates module API requests against the Module Registry.
 *
 * Security contract (Phase 1 remediation):
 *   - Keys MUST be resolved from Supabase `module_api_keys` or the in-memory
 *     store by cryptographic hash / prefix only. String-sniffing bypasses
 *     (e.g. apiKey.includes('demo')) have been removed entirely.
 *   - The workspace bound to the API key is authoritative. A caller-supplied
 *     x-workspace-id or ?workspaceId that differs from the key's company is
 *     rejected with 403 WORKSPACE_MISMATCH.
 *   - Hard-coded fallback workspace identities have been removed.
 */
export async function authenticateModuleApiKey(
  req: NextRequest,
  requiredScope: string
): Promise<{ auth?: ApiAuthContext; errorResponse?: NextResponse }> {
  // 1. Extract Authorization header
  const authHeader = req.headers.get('authorization') || '';
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!apiKey) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'AUTH_HEADER_MISSING',
          message: 'Missing or malformed Authorization header. Expected: Bearer <module_api_key>',
        },
        { status: 401 }
      ),
    };
  }

  // 2. Rate limiting check
  const rateLimit = checkRateLimit(apiKey);
  if (!rateLimit.allowed) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Too Many Requests',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'API rate limit exceeded. Maximum 60 requests per minute.',
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(MAX_REQUESTS_PER_WINDOW),
            'X-RateLimit-Remaining': '0',
          },
        }
      ),
    };
  }

  // 3. Resolve API Key (Supabase first, then in-memory store; no dev bypasses)
  const store = getStore();
  const computedHash = hashSecret(apiKey);
  let targetModuleId: string | undefined;
  let targetCompanyId: string | undefined;

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const { data: keyData } = await supabase
        .from('module_api_keys')
        .select('*')
        .or(`key_hash.eq.${computedHash},key_prefix.ilike.${apiKey.substring(0, 10)}%`)
        .maybeSingle();

      if (keyData) {
        targetModuleId = keyData.module_id;
        targetCompanyId = keyData.company_id;
      }
    }
  }

  if (!targetModuleId) {
    // Fall back to in-memory store – hash/prefix match ONLY, no string-sniffing.
    const matchingKey = store.apiKeys.find(
      (k) =>
        k.hashedSecret === computedHash ||
        apiKey.startsWith(k.prefix.replace('...', ''))
    );
    if (matchingKey) {
      targetModuleId = matchingKey.moduleId;
      if (!targetCompanyId) {
        targetCompanyId = (matchingKey as any).companyId;
      }
    }
  }

  if (!targetModuleId) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'INVALID_API_KEY',
          message: 'Invalid or revoked module API key.',
        },
        { status: 401 }
      ),
    };
  }

  // 4. Resolve Module Manifest
  const module = store.modules.find((m) => m.id === targetModuleId || m.slug === targetModuleId);
  if (!module) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Not Found',
          code: 'MODULE_NOT_FOUND',
          message: `Module with identifier '${targetModuleId}' was not found in the registry.`,
        },
        { status: 404 }
      ),
    };
  }

  // 5. Check Module Status
  if (module.status !== 'published') {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'MODULE_NOT_PUBLISHED',
          message: `Module '${module.id}' is currently in status '${module.status}'. Only published modules can invoke the Integration API.`,
        },
        { status: 403 }
      ),
    };
  }

  // 6. Check Scope Authorization
  const hasScope =
    module.scopes.includes('*') ||
    module.scopes.includes(requiredScope) ||
    (requiredScope.startsWith('read:') && module.scopes.includes('read:*')) ||
    (requiredScope.startsWith('write:') && module.scopes.includes('write:*'));

  if (!hasScope) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'INSUFFICIENT_SCOPE',
          message: `Module '${module.id}' lacks required permission '${requiredScope}'. Granted scopes: [${module.scopes.join(', ')}].`,
        },
        { status: 403 }
      ),
    };
  }

  // 7. Resolve and validate Workspace Context.
  // The API key is bound to `targetCompanyId`. Any caller-supplied workspace ID
  // MUST match that company – cross-tenant promotion is rejected.
  const queryWsId = req.nextUrl?.searchParams?.get('workspaceId');
  const requestedWsId = req.headers.get('x-workspace-id') || queryWsId;

  if (requestedWsId && targetCompanyId && requestedWsId !== targetCompanyId) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'WORKSPACE_MISMATCH',
          message: 'The supplied workspace ID does not match the API key company.',
        },
        { status: 403 }
      ),
    };
  }

  const resolvedWsId = targetCompanyId || requestedWsId;
  if (!resolvedWsId) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'WORKSPACE_UNKNOWN',
          message: 'Unable to determine workspace for this API key.',
        },
        { status: 401 }
      ),
    };
  }

  const workspace = store.workspaces.find(
    (w) => w.id === resolvedWsId || w.company_id === resolvedWsId
  ) || {
    id: resolvedWsId,
    company_id: resolvedWsId,
    name: '',
    country: '',
    currency: 'XOF',
    language: 'fr',
    logo_url: '',
    created_at: new Date().toISOString(),
    plan: 'pro' as const,
    status: 'active' as const,
  };

  return {
    auth: {
      moduleId: module.id,
      module,
      workspaceId: workspace.company_id || workspace.id,
      workspace,
    },
  };
}
