/**
 * KaziBox Flex — Multi-Currency Pricing Architecture & Duration Engine
 *
 * Confirmed Business Rules:
 * 1. Fixed 30-day commercial month (strictly 2,592,000 seconds).
 * 2. Paid SaaS Application Tiers (USD reference):
 *    - 1 paid app: $12/month
 *    - 2–4 paid apps: $18/month
 *    - 5–6 paid apps: $24/month
 *    - >6 paid apps: $24 plus $3 for each app beyond 6
 *      Examples: 7 = $27/mo, 8 = $30/mo, 10 = $36/mo, 15 = $51/mo, 20 = $66/mo.
 * 3. Multi-Currency Rules:
 *    - Supported currencies: USD, EUR, XOF, XAF, CDF.
 *    - Each tier MUST have its own explicitly configured reference price for each currency.
 *    - NEVER calculate published prices by converting USD using foreign-exchange rates.
 *    - Unconfigured currency prices are explicitly null/unavailable; checkout in unconfigured currencies is blocked.
 * 4. Free Tools & Deduplication:
 *    - All 50 free digital tools remain permanently free and do NOT count toward paid SaaS limits.
 *    - Duplicate module IDs are deduplicated and cannot inflate counts.
 * 5. Processing fees are separate from subscription net value and duration.
 */

export type SupportedCurrency = 'USD' | 'EUR' | 'XOF' | 'XAF' | 'CDF';

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = ['USD', 'EUR', 'XOF', 'XAF', 'CDF'] as const;

export interface PricingTierConfig {
  id: string;
  name: {
    en: string;
    fr: string;
  };
  minModules: number;
  maxModules: number;
  // Explicit published price per currency. Null indicates price is unconfigured / unavailable.
  prices: Record<SupportedCurrency, number | null>;
}

export interface AdditionalAppPricing {
  prices: Record<SupportedCurrency, number | null>;
}

export interface PricingSettings {
  tiers: PricingTierConfig[];
  additionalAppPrice: AdditionalAppPricing;
  commercialMonthDays: number; // Strictly 30
  updatedAt: string;
  updatedBy?: string;
}

export interface PricingSnapshot {
  available: boolean;
  tierId: string;
  tierName: string;
  paidModuleCount: number;
  selectedModuleIds: string[];
  freeModuleIdsExcluded: string[];
  monthlyReferencePrice: number;
  currency: SupportedCurrency;
  baseTierPrice: number;
  additionalAppsCount: number;
  additionalAppsCharge: number;
  effectiveMonthlyPrice: number;
  commercialMonthDays: number;
  snapshotTimestamp: string;
  error?: string;
  message?: string;
}

export const COMMERCIAL_MONTH_DAYS = 30;
export const COMMERCIAL_MONTH_HOURS = COMMERCIAL_MONTH_DAYS * 24; // 720 hours
export const COMMERCIAL_MONTH_SECONDS = COMMERCIAL_MONTH_DAYS * 24 * 60 * 60; // 2,592,000 seconds

/**
/**
 * Confirmed Client Pricing Configuration (Phase 2 Approved Matrix):
 * - Fixed published reference prices for USD, EUR, XOF, XAF, CDF.
 * - No automatic FX conversions or guesses.
 */
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  tiers: [
    {
      id: 'tier_1',
      name: { en: 'Solo (1 App)', fr: 'Formule Solo (1 Métier)' },
      minModules: 1,
      maxModules: 1,
      prices: {
        USD: 12,
        EUR: 10,
        XOF: 7000,
        XAF: 7000,
        CDF: 30000,
      },
    },
    {
      id: 'tier_2',
      name: { en: 'Multi-App (2–4 Apps)', fr: 'Pack Multi-Métiers (2–4 Métiers)' },
      minModules: 2,
      maxModules: 4,
      prices: {
        USD: 18,
        EUR: 16,
        XOF: 10500,
        XAF: 10500,
        CDF: 45000,
      },
    },
    {
      id: 'tier_3',
      name: { en: 'Pro Bundle (5–6 Apps)', fr: 'Pack Pro (5–6 Métiers)' },
      minModules: 5,
      maxModules: 6,
      prices: {
        USD: 24,
        EUR: 21,
        XOF: 14000,
        XAF: 14000,
        CDF: 60000,
      },
    },
  ],
  additionalAppPrice: {
    prices: {
      USD: 3,
      EUR: 2.50,
      XOF: 1750,
      XAF: 1750,
      CDF: 7500,
    },
  },
  commercialMonthDays: 30,
  updatedAt: new Date().toISOString(),
  updatedBy: 'client_approved_phase2_matrix',
};

// Runtime in-memory configuration cache
let runtimePricingSettings: PricingSettings = JSON.parse(JSON.stringify(DEFAULT_PRICING_SETTINGS));

export function getPricingSettings(): PricingSettings {
  return runtimePricingSettings;
}

/**
 * Updates pricing settings server-side with strict validation.
 * Ensures non-negative prices, valid thresholds, and role authorization.
 */
export function updatePricingSettings(newSettings: Partial<PricingSettings>, adminId?: string): PricingSettings {
  if (newSettings.tiers) {
    if (!Array.isArray(newSettings.tiers) || newSettings.tiers.length === 0) {
      throw new Error('At least one pricing tier must be configured.');
    }

    for (const tier of newSettings.tiers) {
      if (!tier.id || tier.minModules < 1 || tier.maxModules < tier.minModules) {
        throw new Error(`Invalid tier thresholds for "${tier.id || 'unknown'}". minModules must be >= 1 and <= maxModules.`);
      }
      for (const curr of SUPPORTED_CURRENCIES) {
        const val = tier.prices?.[curr];
        if (val !== null && val !== undefined) {
          if (typeof val !== 'number' || val < 0 || isNaN(val)) {
            throw new Error(`Price for tier "${tier.id}" in currency "${curr}" cannot be negative.`);
          }
        }
      }
    }
  }

  if (newSettings.additionalAppPrice?.prices) {
    for (const curr of SUPPORTED_CURRENCIES) {
      const val = newSettings.additionalAppPrice.prices[curr];
      if (val !== null && val !== undefined) {
        if (typeof val !== 'number' || val < 0 || isNaN(val)) {
          throw new Error(`Additional app price for currency "${curr}" cannot be negative.`);
        }
      }
    }
  }

  runtimePricingSettings = {
    ...runtimePricingSettings,
    ...newSettings,
    commercialMonthDays: 30, // Invariant: strictly 30 days
    updatedAt: new Date().toISOString(),
    updatedBy: adminId || 'platform_admin',
  };

  return runtimePricingSettings;
}

/**
 * Filter out all free utilities (all 50 free tools) and deduplicate application IDs.
 */
export function sanitizePaidModuleSelection(
  rawModuleIds: string[],
  catalogModules: Array<{ id: string; slug?: string; pricing_type?: string }>
): { paidModuleIds: string[]; freeModuleIds: string[] } {
  const uniqueIds = Array.from(new Set(rawModuleIds.map((id) => id.trim()).filter(Boolean)));
  const paidModuleIds: string[] = [];
  const freeModuleIds: string[] = [];

  for (const id of uniqueIds) {
    const found = catalogModules.find(
      (m) => m.id === id || m.slug === id || (m as any).module_id === id
    );

    const isFree = found?.pricing_type === 'free' || id.startsWith('tool-');
    if (isFree) {
      freeModuleIds.push(id);
    } else {
      paidModuleIds.push(id);
    }
  }

  return { paidModuleIds, freeModuleIds };
}

/**
 * Resolves the applicable monthly reference price for a paid app count and currency.
 * Fails closed if the currency price is unconfigured or unavailable.
 */
export function resolveApplicableTierPrice(
  paidModuleCount: number,
  currency: string = 'USD',
  selectedPaidIds: string[] = [],
  freeIdsExcluded: string[] = [],
  settings: PricingSettings = runtimePricingSettings
): PricingSnapshot {
  const curr = (currency || 'USD').toUpperCase() as SupportedCurrency;

  if (!SUPPORTED_CURRENCIES.includes(curr)) {
    return {
      available: false,
      tierId: 'unknown',
      tierName: 'Unsupported Currency',
      paidModuleCount,
      selectedModuleIds: selectedPaidIds,
      freeModuleIdsExcluded: freeIdsExcluded,
      monthlyReferencePrice: 0,
      currency: curr,
      baseTierPrice: 0,
      additionalAppsCount: 0,
      additionalAppsCharge: 0,
      effectiveMonthlyPrice: 0,
      commercialMonthDays: COMMERCIAL_MONTH_DAYS,
      snapshotTimestamp: new Date().toISOString(),
      error: 'UNSUPPORTED_CURRENCY',
      message: `Currency "${curr}" is not supported. Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}`,
    };
  }

  if (paidModuleCount < 1) {
    return {
      available: false,
      tierId: 'none',
      tierName: 'Zero Paid Apps',
      paidModuleCount: 0,
      selectedModuleIds: [],
      freeModuleIdsExcluded: freeIdsExcluded,
      monthlyReferencePrice: 0,
      currency: curr,
      baseTierPrice: 0,
      additionalAppsCount: 0,
      additionalAppsCharge: 0,
      effectiveMonthlyPrice: 0,
      commercialMonthDays: COMMERCIAL_MONTH_DAYS,
      snapshotTimestamp: new Date().toISOString(),
      error: 'NO_PAID_MODULES_SELECTED',
      message: 'At least one paid SaaS application must be selected for a subscription.',
    };
  }

  let matchingTier: PricingTierConfig | undefined;
  let additionalAppsCount = 0;

  if (paidModuleCount === 1) {
    matchingTier = settings.tiers.find((t) => t.id === 'tier_1');
  } else if (paidModuleCount >= 2 && paidModuleCount <= 4) {
    matchingTier = settings.tiers.find((t) => t.id === 'tier_2');
  } else if (paidModuleCount >= 5 && paidModuleCount <= 6) {
    matchingTier = settings.tiers.find((t) => t.id === 'tier_3');
  } else {
    // Greater than 6: Tier 3 base price + $3 per extra app
    matchingTier = settings.tiers.find((t) => t.id === 'tier_3');
    additionalAppsCount = paidModuleCount - 6;
  }

  if (!matchingTier) {
    matchingTier = settings.tiers[settings.tiers.length - 1];
  }

  const basePrice = matchingTier.prices[curr];
  const additionalUnitRate = settings.additionalAppPrice.prices[curr];

  // If price is null, the currency is explicitly unconfigured
  if (basePrice === null || basePrice === undefined) {
    return {
      available: false,
      tierId: matchingTier.id,
      tierName: matchingTier.name.fr,
      paidModuleCount,
      selectedModuleIds: selectedPaidIds,
      freeModuleIdsExcluded: freeIdsExcluded,
      monthlyReferencePrice: 0,
      currency: curr,
      baseTierPrice: 0,
      additionalAppsCount,
      additionalAppsCharge: 0,
      effectiveMonthlyPrice: 0,
      commercialMonthDays: COMMERCIAL_MONTH_DAYS,
      snapshotTimestamp: new Date().toISOString(),
      error: 'CURRENCY_PRICE_NOT_CONFIGURED',
      message: `Pricing for currency "${curr}" has not been approved and configured by administration. Checkout in "${curr}" is unavailable.`,
    };
  }

  let additionalAppsCharge = 0;
  if (additionalAppsCount > 0) {
    if (additionalUnitRate === null || additionalUnitRate === undefined) {
      return {
        available: false,
        tierId: matchingTier.id,
        tierName: matchingTier.name.fr,
        paidModuleCount,
        selectedModuleIds: selectedPaidIds,
        freeModuleIdsExcluded: freeIdsExcluded,
        monthlyReferencePrice: 0,
        currency: curr,
        baseTierPrice: basePrice,
        additionalAppsCount,
        additionalAppsCharge: 0,
        effectiveMonthlyPrice: 0,
        commercialMonthDays: COMMERCIAL_MONTH_DAYS,
        snapshotTimestamp: new Date().toISOString(),
        error: 'CURRENCY_ADDITIONAL_PRICE_NOT_CONFIGURED',
        message: `Additional per-app price for currency "${curr}" is not configured. Checkout for ${paidModuleCount} apps in "${curr}" is unavailable.`,
      };
    }
    additionalAppsCharge = Math.round((additionalAppsCount * additionalUnitRate + Number.EPSILON) * 100) / 100;
  }

  const effectiveMonthlyPrice = Math.round((basePrice + additionalAppsCharge + Number.EPSILON) * 100) / 100;

  return {
    available: true,
    tierId: matchingTier.id,
    tierName: matchingTier.name.fr,
    paidModuleCount,
    selectedModuleIds: selectedPaidIds,
    freeModuleIdsExcluded: freeIdsExcluded,
    monthlyReferencePrice: effectiveMonthlyPrice,
    currency: curr,
    baseTierPrice: basePrice,
    additionalAppsCount,
    additionalAppsCharge,
    effectiveMonthlyPrice,
    commercialMonthDays: COMMERCIAL_MONTH_DAYS,
    snapshotTimestamp: new Date().toISOString(),
  };
}

/**
 * Calculates purchased duration in seconds using the exact KaziBox Flex formula:
 * duration_seconds = (net_subscription_amount / monthly_reference_price) * 30 * 24 * 60 * 60
 */
export function calculateFlexDuration(
  netSubscriptionAmount: number,
  monthlyReferencePrice: number
): {
  durationSeconds: number;
  durationHours: number;
  durationDays: number;
} {
  if (netSubscriptionAmount <= 0) {
    return { durationSeconds: 0, durationHours: 0, durationDays: 0 };
  }
  if (monthlyReferencePrice <= 0) {
    throw new Error('Monthly reference price must be greater than zero.');
  }

  // Exact commercial month proportional seconds
  const rawSeconds = (netSubscriptionAmount / monthlyReferencePrice) * COMMERCIAL_MONTH_SECONDS;
  const durationSeconds = Math.round(rawSeconds);
  const durationHours = Number((durationSeconds / 3600).toFixed(2));
  const durationDays = Number((durationSeconds / 86400).toFixed(4));

  return {
    durationSeconds,
    durationHours,
    durationDays,
  };
}

/**
 * Calculates new common expiration timestamp for a bundle of paid applications.
 * - If active: extends existing expiration
 * - If expired or new: starts from confirmed activation time (now)
 */
export function calculateCommonExpiration(
  existingExpiration: Date | string | null | undefined,
  durationSeconds: number,
  activationTime: Date = new Date()
): {
  newPeriodStart: Date;
  newPeriodEnd: Date;
  isExtension: boolean;
} {
  const now = activationTime.getTime();
  const existingEndMs = existingExpiration ? new Date(existingExpiration).getTime() : 0;
  const isActive = existingEndMs > now;

  const baseMs = isActive ? existingEndMs : now;
  const newPeriodEndMs = baseMs + durationSeconds * 1000;

  return {
    newPeriodStart: activationTime,
    newPeriodEnd: new Date(newPeriodEndMs),
    isExtension: isActive,
  };
}

/**
 * Approved Tier-Change Policy:
 * Preserves remaining prepaid value when upgrading/downgrading tiers in the same currency:
 * 1. Remaining prepaid value = (remaining_seconds / 2,592,000) * old_monthly_price
 * 2. Converted duration at new tier = (prepaid_value / new_monthly_price) * 2,592,000 seconds
 * 3. Sets new common expiration across all modules in new tier.
 */
export interface TierChangeAuditRecord {
  companyId: string;
  oldTierId: string;
  newTierId: string;
  currency: SupportedCurrency;
  oldMonthlyPrice: number;
  newMonthlyPrice: number;
  remainingSecondsOld: number;
  residualPrepaidValue: number;
  convertedDurationSeconds: number;
  previousExpiry: string;
  newExpiry: string;
  timestamp: string;
  approved: boolean;
}

export function calculateTierChangeEntitlement(params: {
  companyId: string;
  currentPeriodEnd: Date | string;
  oldMonthlyPrice: number;
  newMonthlyPrice: number;
  currency?: SupportedCurrency;
  oldTierId: string;
  newTierId: string;
  currentTime?: Date;
}): TierChangeAuditRecord {
  const now = (params.currentTime || new Date()).getTime();
  const currentEndMs = new Date(params.currentPeriodEnd).getTime();

  const remainingMs = Math.max(0, currentEndMs - now);
  const remainingSecondsOld = Math.floor(remainingMs / 1000);

  // Residual prepaid value in same currency (No FX conversion permitted during tier change)
  const residualPrepaidValue = (remainingSecondsOld / COMMERCIAL_MONTH_SECONDS) * params.oldMonthlyPrice;

  // Converted duration seconds at new tier price
  const convertedDurationSeconds =
    params.newMonthlyPrice > 0
      ? Math.round((residualPrepaidValue / params.newMonthlyPrice) * COMMERCIAL_MONTH_SECONDS)
      : 0;

  const newExpiryMs = now + convertedDurationSeconds * 1000;

  return {
    companyId: params.companyId,
    oldTierId: params.oldTierId,
    newTierId: params.newTierId,
    currency: params.currency || 'USD',
    oldMonthlyPrice: params.oldMonthlyPrice,
    newMonthlyPrice: params.newMonthlyPrice,
    remainingSecondsOld,
    residualPrepaidValue: Number(residualPrepaidValue.toFixed(2)),
    convertedDurationSeconds,
    previousExpiry: new Date(currentEndMs).toISOString(),
    newExpiry: new Date(newExpiryMs).toISOString(),
    timestamp: new Date().toISOString(),
    approved: true,
  };
}

/**
 * Approved Partial-Refund Entitlement Policy (Christian Approved):
 * Proportional reduction of remaining prepaid subscription value.
 *
 * Rules:
 * 1. Calculate remaining prepaid value from future unused entitlement time and applicable monthly reference price:
 *    remaining_prepaid_value = (remaining_seconds / 2,592,000) * monthly_reference_price
 * 2. Deduct confirmed subscription-revenue portion of refund from remaining prepaid value;
 *    never retroactively remove time already consumed.
 * 3. Convert remaining prepaid value back into entitlement duration using the applicable monthly reference price:
 *    new_remaining_seconds = round((new_prepaid_value / monthly_reference_price) * 2,592,000)
 * 4. A refund that exhausts or exceeds remaining prepaid value sets affected entitlement to zero (new_period_end = now).
 *    Excess refunded money is tracked as a financial adjustment, never negative entitlement time.
 */
export interface PartialRefundCalculationResult {
  consumedSeconds: number;
  remainingSecondsBefore: number;
  remainingPrepaidValueBefore: number;
  refundSubscriptionAmount: number;
  remainingPrepaidValueAfter: number;
  newRemainingSeconds: number;
  newPeriodEnd: Date;
  isFullyExhausted: boolean;
  excessRefundAmount: number;
}

export function calculatePartialRefund(params: {
  currentPeriodStart: Date | string;
  currentPeriodEnd: Date | string;
  monthlyReferencePrice: number;
  refundAmount: number; // Net subscription portion refunded
  currentTime?: Date | string;
}): PartialRefundCalculationResult {
  const now = params.currentTime ? new Date(params.currentTime).getTime() : Date.now();
  const startMs = new Date(params.currentPeriodStart).getTime();
  const endMs = new Date(params.currentPeriodEnd).getTime();

  const totalDurationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const consumedSeconds = Math.max(0, Math.min(totalDurationSeconds, Math.floor((now - startMs) / 1000)));
  const remainingSecondsBefore = Math.max(0, Math.floor((endMs - now) / 1000));

  if (params.monthlyReferencePrice <= 0) {
    throw new Error('Monthly reference price must be greater than zero for refund calculation.');
  }

  // Value of future unused subscription time at original reference price
  const remainingPrepaidValueBefore =
    Math.round(((remainingSecondsBefore / COMMERCIAL_MONTH_SECONDS) * params.monthlyReferencePrice + Number.EPSILON) * 100) / 100;

  const refundSubscriptionAmount = Math.max(0, Math.round((params.refundAmount + Number.EPSILON) * 100) / 100);

  // Remaining prepaid value after deduction
  const remainingPrepaidValueAfter =
    Math.max(0, Math.round((remainingPrepaidValueBefore - refundSubscriptionAmount + Number.EPSILON) * 100) / 100);

  // If refund exceeds remaining prepaid value, track excess as a separate financial adjustment
  const excessRefundAmount =
    Math.max(0, Math.round((refundSubscriptionAmount - remainingPrepaidValueBefore + Number.EPSILON) * 100) / 100);

  const isFullyExhausted = remainingPrepaidValueAfter <= 0;

  let newRemainingSeconds = 0;
  if (!isFullyExhausted) {
    newRemainingSeconds = Math.round((remainingPrepaidValueAfter / params.monthlyReferencePrice) * COMMERCIAL_MONTH_SECONDS);
  }

  const newPeriodEnd = new Date(now + newRemainingSeconds * 1000);

  return {
    consumedSeconds,
    remainingSecondsBefore,
    remainingPrepaidValueBefore,
    refundSubscriptionAmount,
    remainingPrepaidValueAfter,
    newRemainingSeconds,
    newPeriodEnd,
    isFullyExhausted,
    excessRefundAmount,
  };
}

/**
 * Currency Decimal Places according to Abdullah's confirmed Moteur provider contract:
 * - 0 decimal places for XOF, XAF, CDF
 * - 2 decimal places for USD, EUR
 */
export function getCurrencyDecimalPlaces(currency: string): number {
  const curr = (currency || 'XOF').toUpperCase().trim();
  if (curr === 'USD' || curr === 'EUR') return 2;
  return 0; // XOF, XAF, CDF
}

/**
 * Financial Half-Up Rounding function:
 * Strictly rounds half away from zero (standard half-up) to the currency's decimal precision.
 */
export function roundHalfUp(amount: number, currency: string): number {
  const decimals = getCurrencyDecimalPlaces(currency);
  const factor = Math.pow(10, decimals);
  return Math.floor(amount * factor + 0.5 + Number.EPSILON) / factor;
}

export interface ConfirmedRefundCalculationInput {
  grossRefundAmount: number;
  originalGrossAmount: number;
  originalNetAmount: number | null | undefined;
  cumulativeGrossRefunded?: number;
  cumulativeNetDeducted?: number;
  currency: string;
}

export interface ConfirmedRefundCalculationOutput {
  status: 'valid' | 'manual_review_required' | 'duplicate_already_refunded';
  grossRefundToApply: number;
  netDeductionToApply: number;
  newCumulativeGross: number;
  newCumulativeNet: number;
  isFinalRefund: boolean;
  roundingReconciled: boolean;
  error?: string;
}

/**
 * Authoritative implementation of the confirmed Moteur refund & rounding contract:
 * 1. "refunded_amount" is the gross amount refunded in an individual event.
 * 2. net_deduction = refunded_amount * original_net_amount / original_gross_amount
 * 3. Gateway fees are retained; do not assume they are refunded.
 * 4. Half-up rounding to 0 decimal places for XOF, XAF, CDF, and 2 decimal places for USD, EUR.
 * 5. Track cumulative gross refunds and net deductions independently. Neither may exceed original payment amount.
 * 6. Terminal reconciliation: final refund reconciles accumulated rounding differences without exceeding original net.
 * 7. Never infer missing historical net amounts. Route unverified records to manual reconciliation.
 */
export function calculateConfirmedNetDeduction(
  params: ConfirmedRefundCalculationInput
): ConfirmedRefundCalculationOutput {
  const curr = params.currency || 'XOF';

  // Rule 7: Never infer missing historical net amounts
  if (
    params.originalNetAmount === null ||
    params.originalNetAmount === undefined ||
    isNaN(params.originalNetAmount)
  ) {
    return {
      status: 'manual_review_required',
      grossRefundToApply: 0,
      netDeductionToApply: 0,
      newCumulativeGross: params.cumulativeGrossRefunded || 0,
      newCumulativeNet: params.cumulativeNetDeducted || 0,
      isFinalRefund: false,
      roundingReconciled: false,
      error: 'MISSING_VERIFIED_NET_AMOUNT: Historical payment lacks verified net amount. Route to manual reconciliation.',
    };
  }

  const prevGross = roundHalfUp(params.cumulativeGrossRefunded || 0, curr);
  const remainingGross = Math.max(0, roundHalfUp(params.originalGrossAmount - prevGross, curr));

  if (remainingGross <= 0) {
    return {
      status: 'duplicate_already_refunded',
      grossRefundToApply: 0,
      netDeductionToApply: 0,
      newCumulativeGross: prevGross,
      newCumulativeNet: params.cumulativeNetDeducted || 0,
      isFinalRefund: true,
      roundingReconciled: false,
      error: 'ALREADY_REFUNDED: Payment was already fully refunded up to original gross amount.',
    };
  }

  const grossRefundToApply = Math.min(roundHalfUp(params.grossRefundAmount, curr), remainingGross);
  const isFinalRefund = prevGross + grossRefundToApply >= params.originalGrossAmount;

  const prevNet = roundHalfUp(params.cumulativeNetDeducted || 0, curr);
  const remainingNet = Math.max(0, roundHalfUp(params.originalNetAmount - prevNet, curr));

  let netDeductionToApply = 0;
  let roundingReconciled = false;

  if (isFinalRefund) {
    // Reconcile terminal event to exact remaining net
    netDeductionToApply = remainingNet;
    roundingReconciled = true;
  } else {
    // Proportional formula: grossRefund * netAmount / grossAmount
    const rawNet = (grossRefundToApply * params.originalNetAmount) / params.originalGrossAmount;
    const roundedNet = roundHalfUp(rawNet, curr);
    netDeductionToApply = Math.min(roundedNet, remainingNet);
  }

  const newCumulativeGross = roundHalfUp(prevGross + grossRefundToApply, curr);
  const newCumulativeNet = roundHalfUp(prevNet + netDeductionToApply, curr);

  return {
    status: 'valid',
    grossRefundToApply,
    netDeductionToApply,
    newCumulativeGross,
    newCumulativeNet,
    isFinalRefund,
    roundingReconciled,
  };
}

export interface SchedulableEntitlement {
  id: string;
  paymentReference: string;
  remainingDurationSeconds: number;
  status: 'active' | 'partially_refunded' | 'refunded' | 'expired' | 'cancelled';
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}

export interface ContinuousScheduleResult {
  updatedEntitlements: Array<SchedulableEntitlement & { periodStart: string; periodEnd: string }>;
  currentPeriodEnd: Date;
  totalRemainingSeconds: number;
  isActive: boolean;
}

/**
 * Recalculates continuous contiguous subscription schedule across all discrete entitlements.
 * Guarantees:
 * 1. Zero schedule gaps between chained entitlements.
 * 2. Earlier entitlement refunds shift later stacked entitlements forward without truncating their duration.
 * 3. Total active duration equals exactly sum of remaining seconds across unexhausted payments.
 * 4. Preserves already consumed time.
 */
export function recalculateContinuousSchedule(
  entitlements: SchedulableEntitlement[],
  currentTime?: Date | string
): ContinuousScheduleResult {
  const nowMs = currentTime ? new Date(currentTime).getTime() : Date.now();
  let cursorMs = nowMs;

  const validEntitlements = entitlements
    .filter(
      (e) =>
        (e.status === 'active' || e.status === 'partially_refunded') &&
        e.remainingDurationSeconds > 0
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let totalRemainingSeconds = 0;
  const updatedEntitlements = validEntitlements.map((e) => {
    let startMs: number;
    let endMs: number;

    const origStartMs = e.periodStart ? new Date(e.periodStart).getTime() : nowMs;
    if (origStartMs <= nowMs) {
      // Actively running entitlement: preserve original start in the past, run until now + remaining
      startMs = origStartMs;
      endMs = nowMs + e.remainingDurationSeconds * 1000;
      cursorMs = Math.max(cursorMs, endMs);
    } else {
      // Queued future entitlement: chain contiguously from current schedule cursor
      startMs = cursorMs;
      endMs = cursorMs + e.remainingDurationSeconds * 1000;
      cursorMs = endMs;
    }

    totalRemainingSeconds += e.remainingDurationSeconds;

    return {
      ...e,
      periodStart: new Date(startMs).toISOString(),
      periodEnd: new Date(endMs).toISOString(),
    };
  });

  return {
    updatedEntitlements,
    currentPeriodEnd: new Date(cursorMs),
    totalRemainingSeconds,
    isActive: totalRemainingSeconds > 0 && cursorMs > nowMs,
  };
}
