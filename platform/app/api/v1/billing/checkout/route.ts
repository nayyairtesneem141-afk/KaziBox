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
    planKey,
    plan_key,
    billingCycle,
    moduleIds,
    country = 'CI',
    amount,
    referralCode,
    customer,
    returnUrl,
    return_url,
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

  if (!planId || !billingCycle) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing required checkout fields (planId, billingCycle)',
      },
      { status: 422 }
    );
  }

  if (billingCycle !== 'monthly' && billingCycle !== 'yearly' && billingCycle !== 'flex') {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_BILLING_CYCLE',
        message: 'Billing cycle must be "flex", "monthly", or "yearly".',
      },
      { status: 422 }
    );
  }

  const validPlanIds = ['single', 'bundle', 'all_access', 'custom', 'starter', 'pro', 'flex'];
  if (!validPlanIds.includes(planId)) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_PLAN',
        message: `Plan "${planId}" is not a valid platform plan.`,
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

  const effectiveCurrency = body?.currency || countryConfig.defaultCurrency;
  if (!countryConfig.currencies.includes(effectiveCurrency as any)) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_CURRENCY',
        message: `Currency "${effectiveCurrency}" is not supported for country "${countryConfig.code}". Supported: ${countryConfig.currencies.join(', ')}`,
      },
      { status: 422 }
    );
  }

  const targetModuleIds = Array.isArray(moduleIds) ? moduleIds : [];

  // Deduplicate and filter out free tools (all 50 free utilities do not count toward paid SaaS limits)
  const { sanitizePaidModuleSelection, resolveApplicableTierPrice, calculateFlexDuration } = await import('@/lib/pricing-tiers');
  const { getModules } = await import('@/lib/modules');
  const catalog = await getModules();
  const { paidModuleIds, freeModuleIds } = sanitizePaidModuleSelection(targetModuleIds, catalog);

  // Reject selections with zero paid SaaS applications (free tools cannot form a paid subscription)
  if (paidModuleIds.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'NO_PAID_MODULES_SELECTED',
        message: 'At least one paid SaaS application must be selected for a subscription. Free tools do not require a paid plan.',
      },
      { status: 422 }
    );
  }

  // Plan module constraints validation based on approved client tiers:
  // Tier 1 (Single): 1 app. Tier 2 (Bundle): 2–4 apps.
  if ((planId === 'single' || planId === 'starter') && paidModuleIds.length > 1) {
    return NextResponse.json(
      {
        success: false,
        error: 'PLAN_MODULE_LIMIT_EXCEEDED',
        message: 'Plan "single" (Tier 1) allows at most 1 paid SaaS application. For 2–4 applications, please select Tier 2 (Bundle).',
      },
      { status: 422 }
    );
  }

  if ((planId === 'bundle' || planId === 'pro') && paidModuleIds.length > 4) {
    return NextResponse.json(
      {
        success: false,
        error: 'PLAN_MODULE_LIMIT_EXCEEDED',
        message: 'Plan "bundle" (Tier 2) allows at most 4 paid SaaS applications. For 5 or more applications, please select Tier 3 or Flex.',
      },
      { status: 422 }
    );
  }

  let trustedAmount: number;
  let netSubscriptionAmount: number;
  let feeAmount: number = Number(body?.feeAmount || body?.fee_amount || 0);
  let durationSeconds: number | undefined;
  let monthlyReferencePrice: number | undefined;
  let pricingSnapshot: any = undefined;

  if (billingCycle === 'flex') {
    // KaziBox Flex Pay-As-You-Can Flow
    const requestedNet = body?.netAmount ?? body?.net_amount ?? body?.amount;
    netSubscriptionAmount = Number(requestedNet);

    if (isNaN(netSubscriptionAmount) || netSubscriptionAmount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_NET_AMOUNT',
          message: 'KaziBox Flex subscription net amount must be greater than zero.',
        },
        { status: 422 }
      );
    }

    const snapshot = resolveApplicableTierPrice(
      paidModuleIds.length,
      effectiveCurrency,
      paidModuleIds,
      freeModuleIds
    );

    // If currency price is unconfigured, fail closed and block checkout
    if (!snapshot.available) {
      return NextResponse.json(
        {
          success: false,
          error: snapshot.error || 'CURRENCY_PRICE_NOT_CONFIGURED',
          message: snapshot.message || `Pricing for currency "${effectiveCurrency}" has not been approved and configured.`,
        },
        { status: 422 }
      );
    }

    pricingSnapshot = snapshot;
    monthlyReferencePrice = snapshot.effectiveMonthlyPrice;

    const flexDuration = calculateFlexDuration(netSubscriptionAmount, monthlyReferencePrice);
    durationSeconds = flexDuration.durationSeconds;

    // Fees are strictly isolated from duration calculation and ambassador commissions
    trustedAmount = netSubscriptionAmount + feeAmount;
  } else {
    // Legacy fixed Monthly / Yearly flow: Server-authoritative plan pricing calculation
    const { calculatePlanPrice } = await import('@/lib/billing');
    let authoritativePrice: { amount: number; currency: string };
    try {
      authoritativePrice = calculatePlanPrice(
        planId,
        billingCycle,
        paidModuleIds.length,
        effectiveCurrency
      );
    } catch (priceErr: any) {
      return NextResponse.json(
        {
          success: false,
          error: 'UNSUPPORTED_PLAN_CURRENCY',
          message: priceErr.message || `Pricing is not verified for currency "${effectiveCurrency}".`,
        },
        { status: 422 }
      );
    }
    trustedAmount = authoritativePrice.amount;
    netSubscriptionAmount = trustedAmount;
  }

  try {
    const defaultReturnUrl = `${req.nextUrl.origin}/billing`;
    const resolvedReturnUrl = returnUrl || return_url || defaultReturnUrl;

    const rawPlanKey = planKey || plan_key || planId;
    const resolvedPlanKey =
      rawPlanKey === 'single'
        ? 'starter'
        : rawPlanKey === 'bundle'
        ? 'pro'
        : rawPlanKey || 'starter';

    const cleanPhone = customer?.phone ? String(customer.phone).replace(/[^\d+]/g, '') : undefined;

    const result = await moteurService.createCheckoutSession({
      companyId: targetCompanyId,
      planId: resolvedPlanKey,
      planKey: resolvedPlanKey,
      billingCycle,
      moduleIds: targetModuleIds,
      country: countryConfig.code,
      amount: trustedAmount,
      currency: effectiveCurrency,
      customer: {
        id: session.userId,
        name: customer?.name || session.email || 'Client KaziBox',
        email: customer?.email || session.email || undefined,
        ...(customer || {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      },
      referralCode: referralCode || undefined,
      returnUrl: resolvedReturnUrl,
      netAmount: netSubscriptionAmount,
      feeAmount,
      durationSeconds,
      monthlyReferencePrice,
      pricingSnapshot,
    });

    if (!result.success) {
      const httpStatus =
        result.errorCode === 'PENDING_PAYMENT_PERSISTENCE_FAILED'
          ? 500
          : result.errorCode === 'INVALID_COUNTRY' || result.errorCode === 'VALIDATION_ERROR'
          ? 422
          : result.errorCode === 'UNAUTHORIZED'
          ? 401
          : result.errorCode?.startsWith('HTTP_4')
          ? 400
          : 502;

      console.warn(`[Billing Checkout] Session initialization rejected for company ${targetCompanyId.slice(0, 8)}...: httpStatus=${httpStatus}, errorCode=${result.errorCode}, message=${result.errorMessage}, raw=${JSON.stringify(result.raw)}`);

      return NextResponse.json(
        {
          success: false,
          reference: result.reference,
          sessionId: result.sessionId,
          status: result.status,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          raw: result.raw,
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
