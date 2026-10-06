import { NextRequest, NextResponse } from 'next/server';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { getSubscription } from '@/lib/billing';
import { getStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/context
 * Returns current tenant, active session context, and activated modules for the caller.
 * Scope required: read:context
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateModuleApiKey(req, 'read:context');
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  const { auth } = authResult;
  const store = getStore();
  const sub = await getSubscription(auth!.workspaceId);

  // Determine activated modules for this tenant
  let activatedModules: string[] = [];
  if (sub && (sub.status === 'active' || sub.status === 'expiring_soon')) {
    if (sub.planId === 'all_access') {
      activatedModules = store.modules.filter((m) => m.status === 'published').map((m) => m.id);
    } else {
      activatedModules = sub.includedModuleIds || [];
    }
  }

  // Resolve user (owner by default or passed via X-User-Id header)
  const requestedUserId = req.headers.get('x-user-id');
  const user = store.users.find((u) => u.id === requestedUserId && u.company_id === auth!.workspaceId) ||
    store.users.find((u) => u.company_id === auth!.workspaceId && u.role === 'owner') ||
    store.users[0];

  return NextResponse.json({
    workspace: {
      id: auth!.workspace.id,
      company_id: auth!.workspace.company_id,
      name: auth!.workspace.name,
      country: auth!.workspace.country,
      currency: auth!.workspace.currency || 'XOF',
      language: auth!.workspace.language || 'fr',
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    role: user.role,
    language: auth!.workspace.language || 'fr',
    currency: auth!.workspace.currency || 'XOF',
    activatedModules,
    callingModule: {
      id: auth!.module.id,
      slug: auth!.module.slug,
      name: auth!.module.name,
      version: auth!.module.version,
      accentColor: auth!.module.accentColor,
    },
  });
}
