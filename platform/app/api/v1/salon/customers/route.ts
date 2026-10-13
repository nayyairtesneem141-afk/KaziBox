import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getSalonCustomers, createSalonCustomer } from '@/lib/salon';

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
  const search = searchParams.get('search') || undefined;

  const customers = await getSalonCustomers(companyId, search);
  return NextResponse.json({ success: true, customers });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'salon-beauty',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const res = await createSalonCustomer(companyId, body);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 201 });
}
