import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { recordSalonPayment } from '@/lib/salon';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { appointment_id, ...paymentData } = body;
  if (!appointment_id) {
    return NextResponse.json({ success: false, error: 'appointment_id est obligatoire' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'salon-beauty',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  const res = await recordSalonPayment(companyId, appointment_id, paymentData);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 201 });
}
