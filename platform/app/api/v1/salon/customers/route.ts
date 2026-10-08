import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getSalonCustomers, createSalonCustomer, ensureUuidCompanyId } from '@/lib/salon';
import { hasModuleAccess } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuidCompanyId(searchParams.get('companyId') || session?.companyId || '');
  const search = searchParams.get('search') || undefined;

  const hasAccess = await hasModuleAccess(companyId, 'salon-beauty');
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Module non activé pour cet établissement' }, { status: 403 });
  }

  const customers = await getSalonCustomers(companyId, search);
  return NextResponse.json({ success: true, customers });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const companyId = ensureUuidCompanyId(body.company_id || session?.companyId || '');

  const hasAccess = await hasModuleAccess(companyId, 'salon-beauty');
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Module non activé pour cet établissement' }, { status: 403 });
  }

  const res = await createSalonCustomer(companyId, body);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 201 });
}
