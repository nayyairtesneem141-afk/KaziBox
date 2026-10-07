import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import {
  getGarageJobs,
  createGarageJob,
  updateGarageJobStatus,
  addGarageJobItem,
  ensureUuidCompanyId,
} from '@/lib/garage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuidCompanyId(searchParams.get('companyId') || session?.companyId || '');
  const filterStatus = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const jobs = await getGarageJobs(companyId, filterStatus, search);
  return NextResponse.json({ success: true, jobs });
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

  // Check if adding item to existing job or creating new job
  if (body.action === 'add_item' && body.job_id && body.item) {
    const itemResult = await addGarageJobItem(companyId, body.job_id, body.item);
    if (!itemResult.success) {
      return NextResponse.json({ success: false, error: itemResult.error }, { status: 422 });
    }
    return NextResponse.json({ success: true, item: itemResult.item });
  }

  const result = await createGarageJob(companyId, body);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, job: result.job });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const { companyId: inputCompanyId, jobId, status } = body;
  const companyId = ensureUuidCompanyId(inputCompanyId || session?.companyId || '');

  if (!jobId || !status) {
    return NextResponse.json({ success: false, error: 'jobId and status are required' }, { status: 422 });
  }

  const result = await updateGarageJobStatus(companyId, jobId, status);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
