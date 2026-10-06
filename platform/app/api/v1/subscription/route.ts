import { NextRequest, NextResponse } from 'next/server';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { getSubscription } from '@/lib/billing';
import { hasModuleAccess } from '@/lib/modules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/subscription
 * Returns module subscription validity and access tier for the workspace.
 * Scope required: read:subscription
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateModuleApiKey(req, 'read:subscription');
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  const { auth } = authResult;
  const workspaceId = auth!.workspaceId;
  const moduleId = auth!.moduleId;

  const [hasAccess, subscription] = await Promise.all([
    hasModuleAccess(workspaceId, moduleId),
    getSubscription(workspaceId),
  ]);

  return NextResponse.json({
    workspaceId,
    moduleId,
    hasAccess,
    planId: subscription?.planId || null,
    status: subscription?.status || 'none',
    billingCycle: subscription?.billingCycle || 'monthly',
    validUntil: subscription?.renewAt || null,
    isTrial: false,
    allAccessActive: subscription?.planId === 'all_access',
  });
}
