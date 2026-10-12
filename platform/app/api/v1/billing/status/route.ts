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

  if (!reference) {
    return NextResponse.json(
      { success: false, error: 'Query parameter "reference" is required' },
      { status: 422 }
    );
  }

  const statusResult = await moteurService.getPaymentSessionStatus(reference);

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
