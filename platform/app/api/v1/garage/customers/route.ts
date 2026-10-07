import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { getGarageCustomers, createGarageCustomer, ensureUuidCompanyId } from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuidCompanyId(searchParams.get('companyId') || session?.companyId || '');
  const search = searchParams.get('search') || undefined;

  const customers = await getGarageCustomers(companyId, search);
  return NextResponse.json({ success: true, customers });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const companyId = ensureUuidCompanyId(body.company_id || session?.companyId || '');
  const result = await createGarageCustomer(companyId, body);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, customer: result.customer });
}
