import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getModule } from '@/lib/modules';
import { getModuleRuntimeSecrets } from '@/lib/registry';
import { getStore } from '@/lib/storage';
import { issueSsoToken } from '@kazibox/sdk';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    slug: string;
  };
}

/**
 * POST / GET /api/v1/modules/[slug]/launch
 *
 * Secure 5-Minute Single Sign-On (SSO) handoff endpoint.
 *
 * Security:
 * - Requires authenticated session cookie or bearer token.
 * - Enforces workspace company isolation and active module entitlement.
 * - Issues a cryptographically signed HMAC-SHA256 SSO token with 300-second (5 min) TTL.
 * - Module identity, user identity, active tenant ID and role are strictly scoped.
 */
async function handleLaunch(req: NextRequest, { params }: RouteContext) {
  const slug = params?.slug?.toLowerCase();
  if (!slug) {
    return NextResponse.json(
      { success: false, error: 'Module identifier required', code: 'MODULE_ID_REQUIRED' },
      { status: 400 }
    );
  }

  // 1. Authorize session & entitlement
  const auth = await requireServerAuth(req, {
    requiredModuleId: slug,
  });
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { session } = auth;

  // 2. Fetch module manifest
  const mod = await getModule(slug);
  if (!mod) {
    return NextResponse.json(
      { success: false, error: 'Module not found', code: 'MODULE_NOT_FOUND' },
      { status: 404 }
    );
  }

  // 3. Resolve workspace metadata
  const store = getStore();
  const workspace = store.workspaces.find((w) => w.id === session.companyId || w.company_id === session.companyId);
  const workspaceName = workspace?.name || 'KaziBox Workspace';
  const workspaceCurrency = workspace?.currency || 'XOF';

  // 4. Issue cryptographic 5-minute SSO token using module's provisioned SSO secret
  const { ssoSecret } = await getModuleRuntimeSecrets(mod.id);

  const token = issueSsoToken(
    {
      user: {
        id: session.userId,
        name: session.name || session.email || 'Utilisateur',
        email: session.email || '',
        role: session.role,
      },
      workspace: {
        id: session.companyId,
        company_id: session.companyId,
        name: workspaceName,
        currency: workspaceCurrency,
      },
      moduleId: mod.id,
      language: workspace?.language || 'fr',
      ttlSeconds: 300, // 5-minute TTL
    },
    ssoSecret
  );

  // 5. Construct launch target URL
  const baseEntryUrl = mod.entryUrl || `/modules/${mod.slug || mod.id}`;
  const separator = baseEntryUrl.includes('?') ? '&' : '?';
  const launchUrl = `${baseEntryUrl}${separator}token=${encodeURIComponent(token)}`;

  // Optional: check if caller wants HTTP 302 redirect directly
  const { searchParams } = new URL(req.url);
  const shouldRedirect = searchParams.get('redirect') === 'true' || searchParams.get('redirect') === '1';

  if (shouldRedirect) {
    return NextResponse.redirect(new URL(launchUrl, req.url));
  }

  return NextResponse.json({
    success: true,
    moduleId: mod.id,
    workspaceId: session.companyId,
    token,
    expiresIn: 300,
    launchUrl,
    module: {
      id: mod.id,
      name: mod.name,
      entryUrl: mod.entryUrl,
      kind: mod.kind,
    },
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  return handleLaunch(req, context);
}

export async function GET(req: NextRequest, context: RouteContext) {
  return handleLaunch(req, context);
}
