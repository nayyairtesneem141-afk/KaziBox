import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import {
  getSalonAppointments,
  createSalonAppointment,
  updateSalonAppointmentStatus,
} from '@/lib/salon';

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
  const date = searchParams.get('date') || undefined;
  const staffId = searchParams.get('staffId') || undefined;
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const appointments = await getSalonAppointments(companyId, date, staffId, status, search);
  return NextResponse.json({ success: true, appointments });
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
  const res = await createSalonAppointment(companyId, body);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { appointment_id, status } = body;
  if (!appointment_id || !status) {
    return NextResponse.json({ success: false, error: 'appointment_id et status sont obligatoires' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'salon-beauty',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const res = await updateSalonAppointmentStatus(companyId, appointment_id, status);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 200 });
}
