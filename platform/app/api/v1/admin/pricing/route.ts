import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getPricingSettings, updatePricingSettings } from '@/lib/pricing-tiers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/pricing
 * Returns current configurable pricing settings and tiers.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Authorization: Platform Admin only
  if (session.role !== 'platform_admin') {
    return NextResponse.json(
      {
        success: false,
        error: 'FORBIDDEN',
        message: 'Only platform administrators can inspect platform pricing settings.',
      },
      { status: 403 }
    );
  }

  const settings = getPricingSettings();
  return NextResponse.json({
    success: true,
    settings,
  });
}

/**
 * PUT /api/v1/admin/pricing
 * Allows authorized administrators to manage tier thresholds, prices, and currency conversion settings.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Authorization: Platform Admin only
  if (session.role !== 'platform_admin') {
    return NextResponse.json(
      {
        success: false,
        error: 'FORBIDDEN',
        message: 'Only platform administrators can modify platform pricing tiers.',
      },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const updated = updatePricingSettings(body, session.userId);
    return NextResponse.json({
      success: true,
      message: 'Pricing settings successfully updated.',
      settings: updated,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: err.message || 'Failed to update pricing settings.',
      },
      { status: 422 }
    );
  }
}
