import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { recordGaragePayment, ensureUuidCompanyId } from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const { company_id: inputCompanyId, job_id, amount, payment_method, reference, notes, paid_at } = body;
  const companyId = ensureUuidCompanyId(inputCompanyId || session?.companyId || '');

  if (!job_id) {
    return NextResponse.json({ success: false, error: 'job_id is required' }, { status: 422 });
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

  return NextResponse.json({ success: true, payment: result.payment });
}
