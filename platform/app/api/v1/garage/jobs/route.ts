import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import {
  getGarageJobs,
  getGarageJobById,
  createGarageJob,
  updateGarageJobStatus,
  addGarageJobItem,
} from '@/lib/garage';

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
  const jobId = searchParams.get('jobId');

  if (jobId) {
    const job = await getGarageJobById(companyId, jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: 'Ordre de réparation introuvable' }, { status: 404 });
    }
    return NextResponse.json({ success: true, job });
  }

  const filterStatus = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const jobs = await getGarageJobs(companyId, filterStatus, search);
  return NextResponse.json({ success: true, jobs });
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

  // Check if adding item to existing job or creating new job
  if (body.action === 'add_item' && body.job_id && body.item) {
    const itemResult = await addGarageJobItem(companyId, body.job_id, body.item);
    if (!itemResult.success) {
      return NextResponse.json({ success: false, error: itemResult.error }, { status: 422 });
    }
    const updatedJob = await getGarageJobById(companyId, body.job_id);
    return NextResponse.json({ success: true, item: itemResult.item, job: updatedJob });
  }

  const result = await createGarageJob(companyId, body);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, job: result.job }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { jobId, status } = body;
  if (!jobId || !status) {
    return NextResponse.json({ success: false, error: 'jobId et status sont obligatoires' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'garage-auto',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  const result = await updateGarageJobStatus(companyId, jobId, status);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
