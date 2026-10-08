import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { recordSalonPayment, ensureUuidCompanyId } from '@/lib/salon';
import { hasModuleAccess } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { appointment_id, company_id: inputCompanyId, ...paymentData } = body;
  const companyId = ensureUuidCompanyId(inputCompanyId || session?.companyId || '');

  const hasAccess = await hasModuleAccess(companyId, 'salon-beauty');
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Module non activé pour cet établissement' }, { status: 403 });
  }

  if (!appointment_id) {
    return NextResponse.json({ success: false, error: 'appointment_id est obligatoire' }, { status: 422 });
  }

  const res = await recordSalonPayment(companyId, appointment_id, paymentData);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 201 });
}
