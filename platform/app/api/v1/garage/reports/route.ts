import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getGarageReports, ensureUuidCompanyId } from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuidCompanyId(searchParams.get('companyId') || session?.companyId || '');

  const reports = await getGarageReports(companyId);
  return NextResponse.json({ success: true, reports });
}
