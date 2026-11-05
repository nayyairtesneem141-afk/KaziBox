import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { buildPharmaStockSummary } from '../../../../../../modules/pharmastock/src/index';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/pharmastock/summary
 *
 * Real-time operational telemetry for PharmaStock module.
 * Adheres strictly to the KaziBox ModuleSummary contract.
 *
 * Security:
 * - Supports either user session auth (bound to workspace)
 *   OR module API key authentication (read:context scope).
 * - Enforces companyId tenant isolation.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetCompanyId = searchParams.get('companyId') || req.headers.get('x-workspace-id');

  let effectiveCompanyId: string | undefined;

  // Try API key auth first
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const apiAuth = await authenticateModuleApiKey(req, 'read:context');
    if (apiAuth.errorResponse) {
      return apiAuth.errorResponse;
    }
    effectiveCompanyId = apiAuth.auth?.workspaceId;
  } else {
    // Session auth
    const sessionAuth = await requireServerAuth(req, {
      targetCompanyId,
      requiredModuleId: 'pharmastock',
    });
    if (sessionAuth.errorResponse) {
      return sessionAuth.errorResponse;
    }
    effectiveCompanyId = sessionAuth.session.companyId;
  }

  if (!effectiveCompanyId) {
    return NextResponse.json(
      { success: false, error: 'Target workspace companyId is required' },
      { status: 400 }
    );
  }

  const summary = await buildPharmaStockSummary(effectiveCompanyId);
  return NextResponse.json(summary);
}
