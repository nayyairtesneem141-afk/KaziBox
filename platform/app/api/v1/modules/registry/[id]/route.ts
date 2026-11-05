import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getModule } from '@/lib/modules';
import {
  runPwaChecks,
  getApiKeysForModule,
  updateModuleStatus,
  updateModuleManifest,
  provisionModuleCredentials,
} from '@/lib/registry';
import { dispatchWebhookEvent } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

async function requirePlatformAdmin(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
        { status: 401 }
      ),
    };
  }
  if (session.role !== 'platform_admin') {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          code: 'INSUFFICIENT_ROLE',
          message: 'Only platform administrators can manage the SaaS module registry.',
        },
        { status: 403 }
      ),
    };
  }
  return { session };
}

/**
 * GET /api/v1/modules/registry/[id]
 * Returns module configuration, PWA compliance audit, and masked credential metadata.
 * Never exposes plaintext secrets.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePlatformAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const id = params?.id?.trim().toLowerCase();
  const mod = await getModule(id);
  if (!mod) {
    return NextResponse.json(
      { success: false, error: 'Module introuvable', code: 'MODULE_NOT_FOUND' },
      { status: 404 }
    );
  }

  const pwaCompliance = runPwaChecks(mod);
  const allCredentials = await getApiKeysForModule(mod.id);

  // Strip hashedSecret & encryptedSecret before returning metadata to client
  const credentialsMetadata = allCredentials.map((c) => ({
    id: c.id,
    moduleId: c.moduleId,
    type: c.type || 'api_key',
    scope: c.scope || 'platform',
    prefix: c.prefix,
    createdAt: c.createdAt,
  }));

  return NextResponse.json({
    success: true,
    module: mod,
    pwaCompliance,
    credentialsMetadata,
  });
}

/**
 * PUT /api/v1/modules/registry/[id]
 * Updates structured module settings and manifest in the persistent registry & database.
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePlatformAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const id = params?.id?.trim().toLowerCase();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload', code: 'INVALID_JSON' },
      { status: 400 }
    );
  }

  const res = await updateModuleManifest(id, body);
  if (!res.success || !res.module) {
    const status = res.error === 'Module introuvable' ? 404 : 422;
    return NextResponse.json(
      { success: false, error: res.error || 'Failed to update module', code: 'UPDATE_FAILED' },
      { status }
    );
  }

  return NextResponse.json({
    success: true,
    module: res.module,
    pwaCompliance: runPwaChecks(res.module),
  });
}

/**
 * PATCH /api/v1/modules/registry/[id]
 * Updates module status ('draft' | 'review' | 'published' | 'suspended').
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePlatformAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const id = params?.id?.trim().toLowerCase();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload', code: 'INVALID_JSON' },
      { status: 400 }
    );
  }

  const newStatus = body?.status;
  if (!['draft', 'review', 'published', 'suspended'].includes(newStatus)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid status. Expected draft, review, published, or suspended.',
        code: 'INVALID_STATUS',
      },
      { status: 422 }
    );
  }

  const res = await updateModuleStatus(id, newStatus);
  if (!res.success || !res.module) {
    const status = res.error === 'Module introuvable' ? 404 : 422;
    return NextResponse.json(
      { success: false, error: res.error || 'Status transition failed', code: 'STATUS_UPDATE_FAILED' },
      { status }
    );
  }

  return NextResponse.json({
    success: true,
    module: res.module,
    pwaCompliance: runPwaChecks(res.module),
  });
}

/**
 * POST /api/v1/modules/registry/[id]
 * Provisions / rotates credentials (one-time secret reveal) or dispatches a test webhook.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePlatformAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const id = params?.id?.trim().toLowerCase();
  const mod = await getModule(id);
  if (!mod) {
    return NextResponse.json(
      { success: false, error: 'Module introuvable', code: 'MODULE_NOT_FOUND' },
      { status: 404 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const action = body?.action || 'provision_credentials';

  if (action === 'test_webhook') {
    const deliveries = await dispatchWebhookEvent(
      body.event || 'module.activated',
      {
        workspaceId: auth.session.companyId,
        companyId: auth.session.companyId,
        moduleId: mod.id,
        testDelivery: true,
        triggeredBy: auth.session.userId,
      },
      mod.id
    );
    return NextResponse.json({
      success: true,
      delivery: deliveries[0] || null,
    });
  }

  const credentialType = body?.credentialType || 'api_key';
  if (!['api_key', 'sso_secret', 'webhook_secret', 'all'].includes(credentialType)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid credentialType. Expected api_key, sso_secret, webhook_secret, or all.',
        code: 'INVALID_CREDENTIAL_TYPE',
      },
      { status: 422 }
    );
  }

  const credentials = await provisionModuleCredentials(mod.id, auth.session.companyId, {
    credentialType,
    scope: body?.scope === 'workspace' ? 'workspace' : 'platform',
  });

  return NextResponse.json(
    {
      success: true,
      moduleId: mod.id,
      credentials,
    },
    { status: 201 }
  );
}
