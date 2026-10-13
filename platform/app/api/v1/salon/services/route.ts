import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getSalonServices, createSalonService, updateSalonServiceStatus } from '@/lib/salon';

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
  const status = (searchParams.get('status') as any) || undefined;

  const services = await getSalonServices(companyId, status);
  return NextResponse.json({ success: true, services });
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
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const res = await createSalonService(companyId, body);
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

  const { service_id, status } = body;
  if (!service_id || !status) {
    return NextResponse.json({ success: false, error: 'service_id et status sont obligatoires' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'salon-beauty',
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;
  const res = await updateSalonServiceStatus(companyId, service_id, status);
  if (!res.success) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json(res, { status: 200 });
}
