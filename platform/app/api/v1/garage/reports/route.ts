import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getGarageReports } from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetCompanyId = searchParams.get('companyId');

  const auth = await requireServerAuth(req, {
    targetCompanyId,
    requiredModuleId: 'garage-auto',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const reports = await getGarageReports(companyId);
  return NextResponse.json({ success: true, reports });
}
