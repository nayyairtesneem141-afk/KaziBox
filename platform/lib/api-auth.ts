import { NextRequest, NextResponse } from 'next/server';
import { getStore } from './storage';
import { getModule } from './modules';
import {
  computeSha256Hash,
  computeLegacyMockHash,
  parseStoredKeyHash,
  getRuntimeEnvironment,
} from './registry';
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
  keyScope?: 'platform' | 'workspace';
}

/**
 * Cryptographic SHA-256 hash helper for API keys.
 */
export function hashSecret(secret: string): string {
  return computeSha256Hash(secret);
}

/**
 * Authenticates module API requests against the persistent Module Registry.
 *
 * Security contract:
 *   - Keys are resolved from Supabase `module_api_keys` or the persistent server store
 *     by cryptographic SHA-256 hash (with backward compatibility for legacy mock hashes).
 *   - SSO and Webhook secrets are rejected if presented as Bearer API keys.
 *   - Workspace-scoped keys (`scope: 'workspace'`) are strictly bound to their `company_id`;
 *     any mismatched `X-Workspace-Id` is rejected with 403 WORKSPACE_MISMATCH.
 *   - Platform-scoped module keys (`scope: 'platform'`) provisioned by `platform_admin`
 *     allow a multi-tenant SaaS to target the active tenant workspace via `X-Workspace-Id`.
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

  // Reject SSO or Webhook secrets if accidentally used as Bearer tokens
  if (apiKey.startsWith('kz_sso_') || apiKey.startsWith('kz_whsec_')) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'INVALID_CREDENTIAL_TYPE',
          message: 'SSO and Webhook signing secrets cannot be used as Bearer API keys.',
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

  // 3. Reject test API keys in production environment
  const env = getRuntimeEnvironment();
  if (env === 'production' && apiKey.startsWith('kz_test_')) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'TEST_KEY_REJECTED_IN_PRODUCTION',
          message: 'Test API keys (kz_test_*) are strictly prohibited in the production environment.',
        },
        { status: 403 }
      ),
    };
  }

  // 4. Resolve API Key by cryptographic hash
  const store = getStore();
  const sha256Hash = computeSha256Hash(apiKey);
  const legacyHash = computeLegacyMockHash(apiKey);

  let targetModuleId: string | undefined;
  let targetCompanyId: string | undefined;
  let keyScope: 'platform' | 'workspace' = 'workspace';

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const prefixHint = apiKey.substring(0, 12);
      const { data: candidates } = await supabase
        .from('module_api_keys')
        .select('*')
        .or(`key_hash.ilike.%${sha256Hash}%,key_hash.eq.${legacyHash},key_prefix.ilike.${prefixHint}%`);

      if (Array.isArray(candidates)) {
        for (const row of candidates) {
          const parsed = parseStoredKeyHash(row.key_hash || '', row.key_prefix || '');
          if (parsed.type !== 'api_key') continue;
          if (
            parsed.sha256Hash === sha256Hash ||
            parsed.sha256Hash === legacyHash ||
            row.key_hash === sha256Hash ||
            row.key_hash === legacyHash
          ) {
            targetModuleId = row.module_id;
            targetCompanyId = row.company_id;
            keyScope = parsed.scope;
            break;
          }
        }
      }
    }
  }

  if (!targetModuleId) {
    const matchingKey = store.apiKeys.find((k) => {
      const parsed = parseStoredKeyHash(k.hashedSecret || '', k.prefix || '');
      const effectiveType = k.type || parsed.type;
      if (effectiveType !== 'api_key') return false;
      return (
        parsed.sha256Hash === sha256Hash ||
        parsed.sha256Hash === legacyHash ||
        k.hashedSecret === sha256Hash ||
        k.hashedSecret === legacyHash
      );
    });

    if (matchingKey) {
      const parsed = parseStoredKeyHash(matchingKey.hashedSecret || '', matchingKey.prefix || '');
      targetModuleId = matchingKey.moduleId;
      keyScope = matchingKey.scope || parsed.scope;
      if (!targetCompanyId) {
        targetCompanyId = matchingKey.companyId;
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

  // 4. Dynamically Resolve Module Manifest from Persistent Registry / Database
  const module = await getModule(targetModuleId);
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
  const scopes = Array.isArray(module.scopes) ? module.scopes : [];
  const hasScope =
    scopes.includes('*') ||
    scopes.includes(requiredScope) ||
    (requiredScope.startsWith('read:') && scopes.includes('read:*')) ||
    (requiredScope.startsWith('write:') && scopes.includes('write:*'));

  if (!hasScope) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'INSUFFICIENT_SCOPE',
          message: `Module '${module.id}' lacks required permission '${requiredScope}'. Granted scopes: [${scopes.join(', ')}].`,
        },
        { status: 403 }
      ),
    };
  }

  // 7. Resolve and Validate Workspace Context & Tenant Isolation
  const queryWsId = req.nextUrl?.searchParams?.get('workspaceId');
  const requestedWsId = (req.headers.get('x-workspace-id') || queryWsId || '').trim() || undefined;

  // Workspace-scoped keys cannot access any workspace other than their bound companyId
  if (keyScope === 'workspace' && requestedWsId && targetCompanyId && requestedWsId !== targetCompanyId) {
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

  const resolvedWsId =
    keyScope === 'platform'
      ? requestedWsId || targetCompanyId
      : targetCompanyId || requestedWsId;

  if (!resolvedWsId) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'WORKSPACE_UNKNOWN',
          message: 'Unable to determine workspace for this API key. Provide the X-Workspace-Id header.',
        },
        { status: 401 }
      ),
    };
  }

  let workspace = store.workspaces.find(
    (w) => w.id === resolvedWsId || w.company_id === resolvedWsId
  );

  if (!workspace && isSupabaseConfigured()) {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const { data: comp } = await supabase
        .from('companies')
        .select('*')
        .eq('id', resolvedWsId)
        .maybeSingle();
      if (comp) {
        workspace = {
          id: comp.id,
          company_id: comp.id,
          name: comp.name,
          country: comp.country || '',
          currency: comp.currency || 'XOF',
          language: comp.language || 'fr',
          logo_url: comp.logo_url || '',
          created_at: comp.created_at,
          plan: comp.plan || 'pro',
          status: comp.status || 'active',
        };
      }
    }
  }

  if (!workspace) {
    workspace = {
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
  }

  return {
    auth: {
      moduleId: module.id,
      module,
      workspaceId: workspace.company_id || workspace.id,
      workspace,
      keyScope,
    },
  };
}
