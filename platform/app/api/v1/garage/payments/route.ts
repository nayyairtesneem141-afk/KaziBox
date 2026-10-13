import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { recordGaragePayment } from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { job_id, amount, payment_method, reference, notes, paid_at } = body;

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'garage-auto',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (!job_id) {
    return NextResponse.json({ success: false, error: 'job_id est obligatoire' }, { status: 422 });
  }
  if (!amount || Number(amount) <= 0) {
    return NextResponse.json({ success: false, error: 'Montant de paiement invalide (> 0).' }, { status: 422 });
  }

  const result = await recordGaragePayment(companyId, job_id, {
    amount: Number(amount),
    payment_method: payment_method || 'cash',
    reference: reference || null,
    notes: notes || null,
    paid_at: paid_at || new Date().toISOString(),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, payment: result.payment }, { status: 201 });
}
