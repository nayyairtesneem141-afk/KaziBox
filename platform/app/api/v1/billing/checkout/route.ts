import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, sessionBelongsToCompany, isPrivilegedRole } from '@/lib/server-auth';
import { moteurService } from '@/lib/moteur/service';
import { getCountryConfig } from '@/lib/moteur/countries';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/billing/checkout
 *
 * Initiates a server-side checkout session with Moteur.
 *
 * Security Requirements:
 * - Requires authenticated session cookie.
 * - Caller must be 'owner' or 'platform_admin'.
 * - Company ID must match caller session.
 * - Session status starts as PENDING. Paid access is NEVER granted here.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  if (!isPrivilegedRole(session)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only workspace owners or platform administrators can initiate billing checkout.',
      },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload' },
      { status: 400 }
    );
  }

  const {
    companyId,
    planId,
    billingCycle,
    moduleIds,
    country = 'CI',
    amount,
    referralCode,
    customer,
  } = body;

  const targetCompanyId = session.role === 'platform_admin' && companyId ? companyId : session.companyId;

  if (session.role !== 'platform_admin' && companyId && companyId !== session.companyId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'COMPANY_MISMATCH' },
      { status: 403 }
    );
  }

  if (!planId || !billingCycle || !amount) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing required checkout fields (planId, billingCycle, amount)',
      },
      { status: 422 }
    );
  }

  const countryConfig = getCountryConfig(country);
  if (!countryConfig) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_COUNTRY',
        message: `Country ${country} is not supported. Supported target countries: CD, CM, SN, CI`,
      },
      { status: 422 }
    );
  }

  try {
    const result = await moteurService.createCheckoutSession({
      companyId: targetCompanyId,
      planId,
      billingCycle,
      moduleIds: Array.isArray(moduleIds) ? moduleIds : [],
      country: countryConfig.code,
      amount: Number(amount),
      customer: {
        id: session.userId,
        name: session.email,
        email: session.email,
        ...(customer || {}),
      },
      referralCode: referralCode || undefined,
    });

    return NextResponse.json({
      success: result.success,
      reference: result.reference,
      sessionId: result.sessionId,
      status: result.status,
      checkoutUrl: result.checkoutUrl,
      qrCodeUrl: result.qrCodeUrl,
      instructions: result.instructions,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'CHECKOUT_INITIALIZATION_FAILED',
        message: err.message || 'Failed to initialize checkout session with Moteur',
      },
      { status: 500 }
    );
  }
}
