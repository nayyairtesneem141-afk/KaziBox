import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getModules } from '@/lib/modules';
import { registerOrSaveModule } from '@/lib/registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/modules/register
 * Returns the full authoritative catalog of registered SaaS modules from the persistent registry.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }
  if (session.role !== 'platform_admin') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only platform administrators can access the SaaS registry endpoint.',
      },
      { status: 403 }
    );
  }

  const modules = await getModules();
  return NextResponse.json({
    success: true,
    modules,
  });
}

/**
 * POST /api/v1/modules/register
 *
 * SaaS Module Registration & Onboarding Endpoint.
 *
 * Requirements:
 * 1. Validates standard ModuleManifest schema & required onboarding fields.
 * 2. Rejects duplicate slugs unless allowOverwrite is explicitly true.
 * 3. Runs the mandatory 6-point PWA compliance audit.
 * 4. Enforces platform_admin authorization.
 * 5. Persists module in Supabase `public.modules` (with all required columns) and persistent store.
 * 6. Generates and returns initial API Key, SSO Secret, and Webhook Signing Secret ONCE.
 */
export async function POST(req: NextRequest) {
  // ── 1. Authentication & Authorization ────────────────────────────────────
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  if (session.role !== 'platform_admin') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only platform administrators can register new SaaS modules in the catalog.',
      },
      { status: 403 }
    );
  }

  // ── 2. Parse Payload ─────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload', code: 'INVALID_JSON' },
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Invalid payload object', code: 'INVALID_PAYLOAD' },
      { status: 400 }
    );
  }

  // ── 3. Validate, Persist & Provision Credentials ─────────────────────────
  const result = await registerOrSaveModule(body, {
    allowOverwrite: Boolean(body.allowOverwrite),
    companyId: session.companyId,
    provisionCredentials: true,
  });

  if (!result.success || !result.module || !result.credentials) {
    return NextResponse.json(
      {
        success: false,
        error: result.error || 'Module registration failed',
        code: result.code || 'REGISTRATION_FAILED',
        details: result.details,
      },
      { status: result.statusCode || 422 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      module: result.module,
      pwaCompliance: result.pwaCompliance,
      credentials: {
        keyId: result.credentials.keyId,
        apiKey: result.credentials.apiKey,
        prefix: result.credentials.apiKeyPrefix,
        ssoSecret: result.credentials.ssoSecret,
        ssoSecretPrefix: result.credentials.ssoSecretPrefix,
        webhookSecret: result.credentials.webhookSecret,
        webhookSecretPrefix: result.credentials.webhookSecretPrefix,
        createdAt: result.credentials.createdAt,
      },
    },
    { status: 201 }
  );
}
