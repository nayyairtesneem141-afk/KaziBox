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
  } = body || {};

  const session = await getServerSession(req, companyId);
  if (!session) {
    const unauthSession = await getServerSession(req);
    if (!unauthSession) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'COMPANY_MISMATCH',
        message: 'Vous n’avez pas accès à cet espace de travail pour initier la facturation.',
      },
      { status: 403 }
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

  const targetCompanyId = session.role === 'platform_admin' && companyId ? companyId : session.companyId;

  if (session.role !== 'platform_admin' && companyId && companyId !== session.companyId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'COMPANY_MISMATCH' },
      { status: 403 }
    );
  }

  // Sanitized audit log (never prints tokens or secrets)
  console.log(`[Billing Checkout] Initiated for company ${targetCompanyId.slice(0, 8)}... by user ${session.userId.slice(0, 8)}... (plan: ${planId}, cycle: ${billingCycle})`);

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

    if (!result.success) {
      const httpStatus =
        result.errorCode === 'INVALID_COUNTRY' || result.errorCode === 'VALIDATION_ERROR'
          ? 422
          : result.errorCode === 'UNAUTHORIZED'
          ? 401
          : result.errorCode?.startsWith('HTTP_4')
          ? 400
          : 502;

      console.warn(`[Billing Checkout] Session initialization rejected for company ${targetCompanyId.slice(0, 8)}...: httpStatus=${httpStatus}, errorCode=${result.errorCode}, message=${result.errorMessage}`);

      return NextResponse.json(
        {
          success: false,
          reference: result.reference,
          sessionId: result.sessionId,
          status: result.status,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        },
        { status: httpStatus }
      );
    }

    return NextResponse.json({
      success: true,
      reference: result.reference,
      sessionId: result.sessionId,
      status: result.status,
      checkoutUrl: result.checkoutUrl,
      qrCodeUrl: result.qrCodeUrl,
      instructions: result.instructions,
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
