import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getSalonReports } from '@/lib/salon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetCompanyId = searchParams.get('companyId');

  const auth = await requireServerAuth(req, {
    targetCompanyId,
    requiredModuleId: 'salon-beauty',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const reports = await getSalonReports(companyId);
  return NextResponse.json({ success: true, reports });
}
