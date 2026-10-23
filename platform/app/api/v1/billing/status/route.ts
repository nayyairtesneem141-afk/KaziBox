import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { moteurService } from '@/lib/moteur/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/billing/status?reference=...
 *
 * Checks payment session lifecycle status.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const reference = searchParams.get('reference');
  const checkoutId = searchParams.get('checkoutId') || searchParams.get('checkout_id') || searchParams.get('sessionId') || searchParams.get('session_id') || undefined;
  const planId = searchParams.get('planId') || undefined;
  const moduleIdsParam = searchParams.get('moduleIds') || searchParams.get('module_ids') || undefined;
  const moduleIds = moduleIdsParam ? moduleIdsParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const returnStatus = searchParams.get('returnStatus') || searchParams.get('status') || undefined;
  const provider = searchParams.get('provider') || undefined;

  const targetRef = reference || checkoutId;

  if (!targetRef) {
    return NextResponse.json(
      { success: false, error: 'Query parameter "reference" or "checkoutId" is required' },
      { status: 422 }
    );
  }

  const statusResult = await moteurService.getPaymentSessionStatus(targetRef, {
    companyId: session.companyId,
    sessionId: checkoutId,
    planId,
    moduleIds,
    returnStatus,
    provider,
  });

  // Tenant isolation: caller cannot inspect sessions of other workspaces (unless platform_admin)
  if (
    statusResult.companyId &&
    session.role !== 'platform_admin' &&
    statusResult.companyId !== session.companyId
  ) {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'COMPANY_MISMATCH' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    ...statusResult,
  });
}
