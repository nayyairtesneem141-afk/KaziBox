import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getGarageCustomers, createGarageCustomer } from '@/lib/garage';

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
  const search = searchParams.get('search') || undefined;

  const customers = await getGarageCustomers(companyId, search);
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
    requiredModuleId: 'garage-auto',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const result = await createGarageCustomer(companyId, body);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, customer: result.customer }, { status: 201 });
}
