import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getSalonModuleSummary, ensureUuidCompanyId } from '@/lib/salon';
import { hasModuleAccess } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuidCompanyId(searchParams.get('companyId') || session?.companyId || '');

  const hasAccess = await hasModuleAccess(companyId, 'salon-beauty');
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Module non activé pour cet établissement' }, { status: 403 });
  }

  const summary = await getSalonModuleSummary(companyId);
  return NextResponse.json(summary);
}
