import { NextRequest, NextResponse } from 'next/server';
import { getStore } from './storage';
import { ModuleManifest, Workspace } from '@kazibox/sdk';

/**
 * Rate Limiter (Token bucket / Sliding window in-memory placeholder)
 * In production, migrate this to Redis (e.g. Upstash Redis / Cloudflare KV)
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
 * Enforces:
 * 1. Bearer API key authentication (401)
 * 2. Rate limiting (429)
 * 3. Module registration check (404)
 * 4. Module published status check (403)
 * 5. Scope authorization check (403)
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

  // 3. Resolve API Key in Registry Storage
  const store = getStore();
  const computedHash = hashSecret(apiKey);

  // Check matching key record by hash, prefix or demo key
  const matchingKey = store.apiKeys.find(
    (k) =>
      k.hashedSecret === computedHash ||
      apiKey.startsWith(k.prefix.replace('...', '')) ||
      (apiKey.includes('demo') && k.moduleId === 'demo')
  );

  let targetModuleId = matchingKey?.moduleId;

  // Fallback for direct development testing with mock keys like kz_live_demo... or kz_live_hotel...
  if (!targetModuleId) {
    if (apiKey.includes('demo') || apiKey === 'kz_test_demo_key') {
      targetModuleId = 'demo';
    } else if (apiKey.includes('hotel') || apiKey === 'kz_test_hotel_key') {
      targetModuleId = 'hotel-property';
    } else if (apiKey.includes('garage')) {
      targetModuleId = 'garage';
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

  // 5. Check Module Status (Only 'published' modules can make API calls)
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

  // 7. Resolve Workspace Context (via X-Workspace-Id header, ?workspaceId= query param, or default workspace)
  const queryWsId = req.nextUrl?.searchParams?.get('workspaceId');
  const requestedWsId = req.headers.get('x-workspace-id') || queryWsId || 'ws-palmeraie-01';
  const workspace = store.workspaces.find((w) => w.id === requestedWsId || w.company_id === requestedWsId) || store.workspaces[0];

  return {
    auth: {
      moduleId: module.id,
      module,
      workspaceId: workspace.company_id || workspace.id,
      workspace,
    },
  };
}
