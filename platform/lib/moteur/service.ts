import { Subscription, PaymentHistoryItem } from '@kazibox/sdk';
import { getStore, setStoreItem } from '../storage';
import { notifySubscriptionActivated, notifyPaymentFailed } from '../notifications';
import { dispatchWebhookEvent } from '../webhooks';
import { createBrowserClient } from '../supabase/client';
import { createServerClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { isSupabaseConfigured } from '../supabase/config';
import { MoteurAdapter } from './adapter';
import {
  MoteurInitiatePaymentRequest,
  MoteurInitiatePaymentResponse,
  MoteurVerifyPaymentResponse,
  MoteurWebhookEvent,
  EntitlementGrantResult,
} from './types';
import { MOTEUR_PAYMENT_DESCRIPTION, resolveCurrencyForCountry } from './countries';
import { getPlans } from '../billing';
import { toCanonicalModuleId, toCanonicalModuleIds, getModuleAliases } from './modules';
import { calculatePartialRefund, calculateConfirmedNetDeduction, roundHalfUp } from '../pricing-tiers';

/**
 * In-memory registry for pending payment sessions when running without Supabase
 */
interface PendingSessionRecord {
  reference: string;
  sessionId: string;
  companyId: string;
  planId: string;
  moduleIds: string[];
  billingCycle: 'monthly' | 'yearly';
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
  referralCode?: string;
  createdAt: string;
  updatedAt: string;
}

const globalForMoteurService = globalThis as unknown as {
  moteurPendingSessions?: Map<string, PendingSessionRecord>;
};

function getSessionsMap(): Map<string, PendingSessionRecord> {
  if (!globalForMoteurService.moteurPendingSessions) {
    globalForMoteurService.moteurPendingSessions = new Map();
  }
  return globalForMoteurService.moteurPendingSessions;
}

/**
 * Moteur Payment & Entitlements Orchestration Service
 */
export class MoteurPaymentService {
  private adapter: MoteurAdapter;

  constructor(customAdapter?: MoteurAdapter) {
    this.adapter = customAdapter || new MoteurAdapter();
  }

  public setAdapter(adapter: MoteurAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Creates an unconfirmed checkout session with Moteur.
   *
   * CRITICAL SECURITY RULE:
   * This step creates a PENDING session. Paid entitlements are NEVER granted here.
   */
  public async createCheckoutSession(params: {
    companyId: string;
    planId: string;
    planKey?: string;
    billingCycle: 'monthly' | 'yearly' | 'flex';
    moduleIds: string[];
    country: 'CD' | 'CM' | 'SN' | 'CI';
    amount: number;
    currency?: string;
    customer?: { id?: string; name?: string; email?: string; phone?: string };
    referralCode?: string;
    returnUrl?: string;
    netAmount?: number;
    feeAmount?: number;
    durationSeconds?: number;
    monthlyReferencePrice?: number;
    pricingSnapshot?: any;
    paymentEventId?: string;
  }): Promise<MoteurInitiatePaymentResponse> {
    const currency = params.currency || resolveCurrencyForCountry(params.country);
    const reference = `KZ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const canonicalModuleIds = toCanonicalModuleIds(params.moduleIds);

    const initiateReq: MoteurInitiatePaymentRequest = {
      idempotencyKey: reference,
      description: MOTEUR_PAYMENT_DESCRIPTION,
      amount: params.amount,
      currency,
      country: params.country,
      companyId: params.companyId,
      subscriberExtId: params.companyId,
      planId: params.planId,
      planKey:
        params.planKey === 'single' || (!params.planKey && params.planId === 'single')
          ? 'starter'
          : params.planKey === 'bundle' || (!params.planKey && params.planId === 'bundle')
          ? 'pro'
          : params.planKey || params.planId || 'starter',
      moduleIds: canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds,
      billingCycle: params.billingCycle as any,
      customer: params.customer,
      // Referral attribution passed along for Moteur to process commissions
      referralCode: params.referralCode,
      returnUrl: params.returnUrl,
    };

    // 1. Persist authoritative pending checkout record in Supabase BEFORE contacting external gateway
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { error: insertErr } = await supabase.from('payment_history').insert({
            company_id: params.companyId,
            amount: params.amount,
            currency,
            status: 'pending',
            plan_id: params.planId,
            billing_cycle: params.billingCycle,
            module_ids: canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds,
            description: `Moteur Payment: ${reference} | plan:${params.planId} | cycle:${params.billingCycle} | modules:${(canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds).join(',')}`,
            reference: reference,
            invoice_url: '#',
            net_amount: params.netAmount ?? params.amount,
            fee_amount: params.feeAmount ?? 0,
            duration_seconds: params.durationSeconds,
            monthly_reference_price: params.monthlyReferencePrice,
            pricing_snapshot: params.pricingSnapshot,
          });

          if (insertErr) {
            console.error(`[Moteur] Failed to persist authoritative pending payment record for ${reference}:`, insertErr);
            return {
              success: false,
              reference,
              sessionId: '',
              status: 'failed',
              errorCode: 'PENDING_PAYMENT_PERSISTENCE_FAILED',
              errorMessage: `Failed to persist authoritative pending payment record: ${insertErr.message || 'Database insert error'}`,
            };
          }
        } catch (dbErr: any) {
          console.error(`[Moteur] Unexpected error persisting pending payment record for ${reference}:`, dbErr);
          return {
            success: false,
            reference,
            sessionId: '',
            status: 'failed',
            errorCode: 'PENDING_PAYMENT_PERSISTENCE_FAILED',
            errorMessage: `Unexpected error persisting pending payment record: ${dbErr.message || 'Database exception'}`,
          };
        }
      }
    }

    // 2. Store pending session in local registry
    const sessions = getSessionsMap();
    sessions.set(reference, {
      reference,
      sessionId: '',
      companyId: params.companyId,
      planId: params.planId,
      moduleIds: canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds,
      billingCycle: params.billingCycle as any,
      amount: params.amount,
      currency,
      status: 'pending',
      referralCode: params.referralCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      netAmount: params.netAmount,
      feeAmount: params.feeAmount,
      durationSeconds: params.durationSeconds,
      monthlyReferencePrice: params.monthlyReferencePrice,
      pricingSnapshot: params.pricingSnapshot,
    } as any);

    // Also store pending checkout in local store for development / test environments
    const store = getStore();
    const existingIdx = store.payments.findIndex(
      (p) => p.invoiceNumber === reference || p.id === reference
    );
    const pendingPaymentObj = {
      id: reference,
      invoiceNumber: reference,
      amount: params.amount,
      currency,
      date: new Date().toISOString().split('T')[0],
      status: 'pending',
      description: `Moteur Payment: ${reference} | plan:${params.planId} | cycle:${params.billingCycle} | modules:${(canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds).join(',')}`,
      pdfUrl: '#',
      reference: reference,
      companyId: params.companyId,
      planId: params.planId,
      billingCycle: params.billingCycle,
      moduleIds: canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds,
      netAmount: params.netAmount,
      feeAmount: params.feeAmount,
      durationSeconds: params.durationSeconds,
      monthlyReferencePrice: params.monthlyReferencePrice,
      pricingSnapshot: params.pricingSnapshot,
    };
    if (existingIdx >= 0) {
      store.payments[existingIdx] = pendingPaymentObj as any;
    } else {
      store.payments.push(pendingPaymentObj as any);
    }
    setStoreItem('PAYMENTS', store.payments);

    // 3. Delegate to adapter to create external payment session
    const result = await this.adapter.initiatePaymentSession(initiateReq);

    const rec = sessions.get(reference);
    if (rec) {
      if (result.success && result.sessionId) {
        rec.sessionId = result.sessionId;
        rec.updatedAt = new Date().toISOString();
        // Index by Moteur sessionId/checkoutId as well for fast resolution
        sessions.set(result.sessionId, rec);
      } else if (!result.success) {
        rec.status = 'failed';
        rec.updatedAt = new Date().toISOString();
      }
    }

    if (!result.success) {
      const failedIdx = store.payments.findIndex(
        (p) => p.invoiceNumber === reference || p.id === reference
      );
      if (failedIdx >= 0) {
        store.payments[failedIdx].status = 'failed';
        setStoreItem('PAYMENTS', store.payments);
      }
    }

    // 4. Update the persisted record with sessionId on success or mark failed on rejection
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          if (result.success && result.sessionId) {
            await supabase.from('payment_history').update({
              description: `Moteur Payment: ${reference} | session:${result.sessionId} | plan:${params.planId} | cycle:${params.billingCycle} | modules:${(canonicalModuleIds.length > 0 ? canonicalModuleIds : params.moduleIds).join(',')}`,
            }).eq('reference', reference);
          } else if (!result.success) {
            await supabase.from('payment_history').update({
              status: 'failed',
            }).eq('reference', reference);
          }
        } catch {
          // Non-blocking post-initiation status sync
        }
      }
    }

    return result;
  }

  private static inFlightReferences = new Set<string>();

  /**
   * Confirms payment and activates subscription entitlements.
   *
   * IDEMPOTENCY GUARANTEE:
   * - If this payment reference has already been confirmed and processed,
   *   it returns immediately with `isDuplicate: true` and makes NO changes.
   * - In-process lock serializes concurrent duplicate webhook deliveries.
   * - Duplicate webhooks cannot double-extend subscription duration or duplicate records.
   */
  public async handlePaymentConfirmation(data: {
    reference: string;
    sessionId?: string;
    companyId: string;
    planId: string;
    moduleIds: string[];
    billingCycle: 'monthly' | 'yearly' | 'flex';
    amount: number;
    currency: string;
    referralCode?: string;
    providerReference?: string;
    paidAt?: string;
    paymentEventId?: string;
    netAmount?: number;
    feeAmount?: number;
    durationSeconds?: number;
    monthlyReferencePrice?: number;
    pricingSnapshot?: any;
  }): Promise<EntitlementGrantResult> {
    if (data.billingCycle !== 'monthly' && data.billingCycle !== 'yearly' && data.billingCycle !== 'flex') {
      return {
        success: false,
        isDuplicate: false,
        companyId: data.companyId,
        status: 'cancelled',
        planId: data.planId,
        activatedModuleIds: [],
        reference: data.reference,
        message: `Invalid billing cycle: ${data.billingCycle}. Must be "flex", "monthly", or "yearly".`,
      };
    }

    // Canonical module resolution for database catalogue compatibility
    const canonicalModuleIds = toCanonicalModuleIds(data.moduleIds);

    // Verify company match and bind terms against in-memory session if present
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);

    let effectivePlanId = data.planId;
    let effectiveBillingCycle: 'monthly' | 'yearly' | 'flex' = data.billingCycle;
    let effectiveModuleIds = canonicalModuleIds.length > 0 ? canonicalModuleIds : data.moduleIds;
    let effectiveNetAmount = data.netAmount;
    let effectiveFeeAmount = data.feeAmount;
    let effectiveDurationSeconds = data.durationSeconds;
    let effectiveMonthlyRefPrice = data.monthlyReferencePrice;
    let effectivePricingSnapshot = data.pricingSnapshot;
    let effectiveEventId = data.paymentEventId;

    if (session) {
      if (session.companyId && session.companyId !== data.companyId) {
        return {
          success: false,
          isDuplicate: false,
          companyId: data.companyId,
          status: 'cancelled',
          planId: data.planId,
          activatedModuleIds: [],
          reference: data.reference,
          message: 'Payment reference belongs to another company (company mismatch)',
        };
      }
      if (session.planId) effectivePlanId = session.planId;
      if (session.billingCycle) effectiveBillingCycle = session.billingCycle;
      if (session.moduleIds?.length) effectiveModuleIds = toCanonicalModuleIds(session.moduleIds);
      if ((session as any).netAmount != null) effectiveNetAmount = (session as any).netAmount;
      if ((session as any).feeAmount != null) effectiveFeeAmount = (session as any).feeAmount;
      if ((session as any).durationSeconds != null) effectiveDurationSeconds = (session as any).durationSeconds;
      if ((session as any).monthlyReferencePrice != null) effectiveMonthlyRefPrice = (session as any).monthlyReferencePrice;
      if ((session as any).pricingSnapshot != null) effectivePricingSnapshot = (session as any).pricingSnapshot;

      if (session.amount != null && Number(data.amount) < Number(session.amount)) {
        return {
          success: false,
          isDuplicate: false,
          companyId: data.companyId,
          status: 'cancelled',
          planId: effectivePlanId,
          activatedModuleIds: [],
          reference: data.reference,
          message: `Payment underpaid: confirmed amount (${data.amount}) is less than expected session amount (${session.amount})`,
        };
      }
      if (session.currency && data.currency && session.currency.toUpperCase() !== data.currency.toUpperCase()) {
        return {
          success: false,
          isDuplicate: false,
          companyId: data.companyId,
          status: 'cancelled',
          planId: effectivePlanId,
          activatedModuleIds: [],
          reference: data.reference,
          message: `Payment currency mismatch: confirmed ${data.currency} does not match expected session currency ${session.currency}`,
        };
      }
    }

    if (MoteurPaymentService.inFlightReferences.has(data.reference)) {
      return {
        success: true,
        isDuplicate: true,
        companyId: data.companyId,
        status: 'active',
        planId: effectivePlanId,
        activatedModuleIds: effectiveModuleIds,
        reference: data.reference,
        message: 'Payment confirmation currently processing (concurrent duplicate)',
      };
    }

    MoteurPaymentService.inFlightReferences.add(data.reference);

    try {
      const invoiceNumber = data.reference.startsWith('INV-')
        ? data.reference
        : `INV-${data.reference}`;

      // ── 1. Atomic RPC Execution in Supabase ───────────────────────────────────
      if (isSupabaseConfigured()) {
        const supabase: any = createAdminClient() || createServerClient();
        if (supabase) {
          // Pre-check persistent database idempotency by reference across serverless instances
          try {
            const { data: existingPayment } = await supabase
              .from('payment_history')
              .select('id, status, company_id, amount, currency, plan_id, billing_cycle, module_ids, description, net_amount, fee_amount, duration_seconds, monthly_reference_price, pricing_snapshot')
              .eq('reference', data.reference)
              .maybeSingle();

            if (existingPayment) {
              if (existingPayment.plan_id) effectivePlanId = existingPayment.plan_id;
              if (existingPayment.billing_cycle === 'yearly' || existingPayment.billing_cycle === 'monthly' || existingPayment.billing_cycle === 'flex') {
                effectiveBillingCycle = existingPayment.billing_cycle;
              }
              if (existingPayment.module_ids?.length) {
                effectiveModuleIds = toCanonicalModuleIds(existingPayment.module_ids);
              } else if (!existingPayment.plan_id && existingPayment.description) {
                const pMatch = existingPayment.description.match(/plan:([a-z_]+)/i);
                if (pMatch) effectivePlanId = pMatch[1];
                const cMatch = existingPayment.description.match(/cycle:([a-z_]+)/i);
                if (cMatch && (cMatch[1] === 'monthly' || cMatch[1] === 'yearly' || cMatch[1] === 'flex')) effectiveBillingCycle = cMatch[1] as any;
                const mMatch = existingPayment.description.match(/modules:([a-z0-9_,-]+)/i);
                if (mMatch) effectiveModuleIds = toCanonicalModuleIds(mMatch[1].split(',').filter(Boolean));
              }
              if (existingPayment.net_amount != null) effectiveNetAmount = Number(existingPayment.net_amount);
              if (existingPayment.fee_amount != null) effectiveFeeAmount = Number(existingPayment.fee_amount);
              if (existingPayment.duration_seconds != null) effectiveDurationSeconds = Number(existingPayment.duration_seconds);
              if (existingPayment.monthly_reference_price != null) effectiveMonthlyRefPrice = Number(existingPayment.monthly_reference_price);
              if (existingPayment.pricing_snapshot != null) effectivePricingSnapshot = existingPayment.pricing_snapshot;

              if (existingPayment.company_id && existingPayment.company_id !== data.companyId) {
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: 'Payment reference belongs to another company (company mismatch)',
                };
              }
              if (existingPayment.amount != null && Number(data.amount) < Number(existingPayment.amount)) {
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: `Payment underpaid: confirmed amount (${data.amount}) is less than expected amount (${existingPayment.amount})`,
                };
              }
              if (existingPayment.currency && data.currency && existingPayment.currency.toUpperCase() !== data.currency.toUpperCase()) {
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: `Payment currency mismatch: confirmed ${data.currency} does not match expected ${existingPayment.currency}`,
                };
              }
              if (existingPayment.status === 'paid') {
                return {
                  success: true,
                  isDuplicate: true,
                  companyId: data.companyId,
                  status: 'active',
                  planId: effectivePlanId,
                  activatedModuleIds: effectiveModuleIds,
                  reference: data.reference,
                  message: 'Payment has already been processed and confirmed (idempotent)',
                };
              }
              if (existingPayment.status === 'refunded' || existingPayment.status === 'failed') {
                return {
                  success: false,
                  isDuplicate: false,
                  isInvalidTransition: true,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: `Payment reference is already marked as ${existingPayment.status}; confirmation rejected.`,
                };
              }
            }
          } catch {
            // Non-blocking pre-check failure, proceed to RPC
          }

          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('confirm_moteur_payment', {
              p_company_id: data.companyId,
              p_reference: data.reference,
              p_amount: data.amount,
              p_currency: data.currency,
              p_plan_id: effectivePlanId,
              p_billing_cycle: effectiveBillingCycle,
              p_module_ids: effectiveModuleIds,
              p_metadata: {
                referralCode: data.referralCode || null,
                countryCode: (data as any).countryCode || null,
                requestedModuleIds: data.moduleIds || [],
                payment_event_id: effectiveEventId || null,
                net_amount: effectiveNetAmount ?? data.amount,
                fee_amount: effectiveFeeAmount ?? 0,
                duration_seconds: effectiveDurationSeconds || null,
                monthly_reference_price: effectiveMonthlyRefPrice || null,
                pricing_snapshot: effectivePricingSnapshot || null,
              },
            });

            if (rpcErr) {
              const isFunctionNotFound =
                rpcErr.code === 'PGRST202' ||
                rpcErr.message?.includes('Could not find the function') ||
                rpcErr.message?.includes('schema cache');

              if (!isFunctionNotFound) {
                // Real database error: fail closed to prevent partial non-atomic updates
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: `Database RPC execution error: ${rpcErr.message}`,
                };
              }
              // If specifically function not found, fall through to fallback read check
            } else if (rpcRes) {
              if (rpcRes.status === 'duplicate') {
                return {
                  success: true,
                  isDuplicate: true,
                  companyId: data.companyId,
                  status: 'active',
                  planId: effectivePlanId,
                  activatedModuleIds: effectiveModuleIds,
                  reference: data.reference,
                  message: rpcRes.message || 'Payment already processed (idempotent)',
                };
              }
              if (rpcRes.status === 'invalid') {
                return {
                  success: false,
                  isDuplicate: false,
                  isInvalidTransition: rpcRes.code === 'PAYMENT_ALREADY_TERMINATED',
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: rpcRes.message || 'Payment parameters validation failed',
                };
              }
              if (rpcRes.status === 'error') {
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: effectivePlanId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  code: rpcRes.code || 'DB_ERROR',
                  message: `Database error: ${rpcRes.message || 'Transaction aborted'}`,
                };
              }
              if (rpcRes.status === 'success') {
                const periodEnd = rpcRes.period_end
                  ? new Date(rpcRes.period_end)
                  : effectiveBillingCycle === 'yearly'
                  ? new Date(Date.now() + 365 * 86400000)
                  : effectiveBillingCycle === 'flex' && (effectiveDurationSeconds || rpcRes.duration_seconds)
                  ? new Date(Date.now() + Number(effectiveDurationSeconds || rpcRes.duration_seconds) * 1000)
                  : new Date(Date.now() + 30 * 86400000);
                await this.syncLocalStoreAndNotify(
                  {
                    ...data,
                    planId: effectivePlanId,
                    billingCycle: effectiveBillingCycle,
                    moduleIds: effectiveModuleIds,
                  },
                  periodEnd
                );
                return {
                  success: true,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'active',
                  planId: effectivePlanId,
                  activatedModuleIds: effectiveModuleIds,
                  reference: data.reference,
                };
              }

              // Fail-closed on missing or unknown RPC status contract
              return {
                success: false,
                isDuplicate: false,
                companyId: data.companyId,
                status: 'cancelled',
                planId: effectivePlanId,
                activatedModuleIds: [],
                reference: data.reference,
                code: 'UNEXPECTED_RPC_RESPONSE',
                message: 'Unexpected RPC response contract from confirm_moteur_payment',
              };
            }
          } catch (e: any) {
            // Unexpected network/client throw: fail closed
            return {
              success: false,
              isDuplicate: false,
              companyId: data.companyId,
              status: 'cancelled',
              planId: effectivePlanId,
              activatedModuleIds: [],
              reference: data.reference,
              message: `Unexpected error during RPC call: ${e.message}`,
            };
          }

          // Fallback guard: In production, non-atomic multi-step fallback is strictly prohibited
          const isProduction = process.env.NODE_ENV === 'production';
          const allowLegacyFallback = process.env.ALLOW_LEGACY_BILLING_FALLBACK === 'true';

          if (isProduction && !allowLegacyFallback) {
            console.error('[Moteur] Fatal: confirm_moteur_payment RPC is missing on database. Non-atomic fallback is prohibited in production.');
            return {
              success: false,
              isDuplicate: false,
              companyId: data.companyId,
              status: 'cancelled',
              planId: data.planId,
              activatedModuleIds: [],
              reference: data.reference,
              message: 'Database migration 06 is not applied. Non-atomic fallback is disabled in production.',
            };
          }

          // Fallback read check if RPC was unavailable (Development only)
          const { data: existingPayment } = await supabase
            .from('payment_history')
            .select('id, status')
            .or(`reference.eq.${data.reference},description.eq.Moteur Payment: ${data.reference}`)
            .maybeSingle();

          if (existingPayment) {
            if (existingPayment.status === 'paid') {
              return {
                success: true,
                isDuplicate: true,
                companyId: data.companyId,
                status: 'active',
                planId: data.planId,
                activatedModuleIds: data.moduleIds,
                reference: data.reference,
                message: 'Payment already processed (idempotent)',
              };
            }
            if (existingPayment.status === 'failed' || existingPayment.status === 'refunded') {
              return {
                success: false,
                isDuplicate: false,
                isInvalidTransition: true,
                companyId: data.companyId,
                status: 'cancelled',
                planId: data.planId,
                activatedModuleIds: [],
                reference: data.reference,
                message: `Payment reference is already marked as ${existingPayment.status}; confirmation rejected.`,
              };
            }
          }
        }
      }

      // ── 2. Idempotency Check in Local Store ───────────────────────────────────
      const store = getStore();
      const existingLocal = store.payments.find(
        (p) => p.invoiceNumber === invoiceNumber || p.id === data.reference || p.invoiceNumber === data.reference
      );

      if (existingLocal) {
        if ((existingLocal as any).planId) effectivePlanId = (existingLocal as any).planId;
        if ((existingLocal as any).billingCycle) effectiveBillingCycle = (existingLocal as any).billingCycle;
        if ((existingLocal as any).moduleIds?.length) effectiveModuleIds = toCanonicalModuleIds((existingLocal as any).moduleIds);
        if ((existingLocal as any).netAmount != null) effectiveNetAmount = (existingLocal as any).netAmount;
        if ((existingLocal as any).feeAmount != null) effectiveFeeAmount = (existingLocal as any).feeAmount;
        if ((existingLocal as any).durationSeconds != null) effectiveDurationSeconds = (existingLocal as any).durationSeconds;
        if ((existingLocal as any).monthlyReferencePrice != null) effectiveMonthlyRefPrice = (existingLocal as any).monthlyReferencePrice;
        if ((existingLocal as any).pricingSnapshot != null) effectivePricingSnapshot = (existingLocal as any).pricingSnapshot;

        if (existingLocal.companyId && existingLocal.companyId !== data.companyId) {
          return {
            success: false,
            isDuplicate: false,
            companyId: data.companyId,
            status: 'cancelled',
            planId: effectivePlanId,
            activatedModuleIds: [],
            reference: data.reference,
            message: 'Payment reference belongs to another workspace (company mismatch)',
          };
        }
        if (existingLocal.amount != null && Number(data.amount) < Number(existingLocal.amount)) {
          return {
            success: false,
            isDuplicate: false,
            companyId: data.companyId,
            status: 'cancelled',
            planId: effectivePlanId,
            activatedModuleIds: [],
            reference: data.reference,
            message: `Payment underpaid: confirmed amount (${data.amount}) is less than expected local amount (${existingLocal.amount})`,
          };
        }
        if (existingLocal.currency && data.currency && existingLocal.currency.toUpperCase() !== data.currency.toUpperCase()) {
          return {
            success: false,
            isDuplicate: false,
            companyId: data.companyId,
            status: 'cancelled',
            planId: effectivePlanId,
            activatedModuleIds: [],
            reference: data.reference,
            message: `Payment currency mismatch: confirmed ${data.currency} does not match expected local currency ${existingLocal.currency}`,
          };
        }
        if (existingLocal.status === 'paid') {
          return {
            success: true,
            isDuplicate: true,
            companyId: data.companyId,
            status: 'active',
            planId: effectivePlanId,
            activatedModuleIds: effectiveModuleIds,
            reference: data.reference,
            message: 'Payment already processed (idempotent)',
          };
        }
        if (existingLocal.status === 'failed' || existingLocal.status === 'refunded') {
          return {
            success: false,
            isDuplicate: false,
            isInvalidTransition: true,
            companyId: data.companyId,
            status: 'cancelled',
            planId: effectivePlanId,
            activatedModuleIds: [],
            reference: data.reference,
            message: `Payment reference is already marked as ${existingLocal.status}; confirmation rejected.`,
          };
        }
      }

      // ── 3. Calculate Period Dates (Renewal Extension Aware) ───────────────────
      const now = data.paidAt ? new Date(data.paidAt) : new Date();
      let baseStartDate = now;

      // Check if workspace currently has an active term ending in the future
      if (isSupabaseConfigured()) {
        const supabase: any = createAdminClient() || createServerClient();
        if (supabase) {
          const { data: activeSub } = await supabase
            .from('subscriptions')
            .select('current_period_end')
            .eq('company_id', data.companyId)
            .eq('status', 'active')
            .maybeSingle();

          if (activeSub?.current_period_end) {
            const activeEnd = new Date(activeSub.current_period_end);
            if (activeEnd > now) {
              baseStartDate = activeEnd;
            }
          }
        }
      } else {
        const activeSub = store.subscriptions.find(
          (s) => s.companyId === data.companyId && s.status === 'active'
        );
        if (activeSub?.currentPeriodEnd) {
          const activeEnd = new Date(activeSub.currentPeriodEnd);
          if (activeEnd > now) {
            baseStartDate = activeEnd;
          }
        }
      }

      const periodEnd = new Date(baseStartDate);
      if (effectiveBillingCycle === 'yearly') {
        periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
      } else if (effectiveBillingCycle === 'flex') {
        const durSec = Number(effectiveDurationSeconds || (existingLocal as any)?.durationSeconds || 0);
        if (durSec > 0) {
          periodEnd.setTime(baseStartDate.getTime() + durSec * 1000);
        } else {
          periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
        }
      } else {
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      }

    // ── 4. Activate Subscription Entitlements in Supabase ─────────────────────
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        // Upsert company subscription
        const { data: currentSub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', data.companyId)
          .order('created_at', { ascending: false })
          .maybeSingle();

        if (currentSub) {
          await supabase
            .from('subscriptions')
            .update({
              plan_id: effectivePlanId,
              status: 'active',
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              cancel_at_period_end: false,
              included_module_ids: effectiveModuleIds,
            })
            .eq('id', currentSub.id);
        } else {
          await supabase.from('subscriptions').insert({
            company_id: data.companyId,
            plan_id: effectivePlanId,
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            cancel_at_period_end: false,
            included_module_ids: effectiveModuleIds,
          });
        }

        // Activate each module in company_modules
        for (const modId of effectiveModuleIds) {
          await supabase.from('company_modules').upsert(
            {
              company_id: data.companyId,
              module_id: modId,
              plan_id: effectivePlanId,
              status: 'active',
              activated_at: now.toISOString(),
              expires_at: periodEnd.toISOString(),
              auto_renew: true,
            },
            { onConflict: 'company_id,module_id' }
          );
        }

        // Insert payment history
        await supabase.from('payment_history').insert({
          company_id: data.companyId,
          amount: data.amount,
          currency: data.currency,
          status: 'paid',
          description: `Moteur Payment: ${data.reference}`,
          reference: data.reference,
          plan_id: effectivePlanId,
          billing_cycle: effectiveBillingCycle,
          module_ids: effectiveModuleIds,
          invoice_url: '#',
        });
      }
    }

    // ── 5. Sync In-Memory Store & Dispatch Events ────────────────────────────
    await this.syncLocalStoreAndNotify(
      {
        ...data,
        planId: effectivePlanId,
        billingCycle: effectiveBillingCycle,
        moduleIds: effectiveModuleIds,
      },
      periodEnd
    );

      return {
        success: true,
        isDuplicate: false,
        companyId: data.companyId,
        status: 'active',
        planId: effectivePlanId,
        activatedModuleIds: effectiveModuleIds,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        reference: data.reference,
      };
    } finally {
      MoteurPaymentService.inFlightReferences.delete(data.reference);
    }
  }

  /**
   * Handles payment failure from Moteur
   */
  public async handlePaymentFailure(data: {
    reference: string;
    companyId: string;
    reason?: string;
  }): Promise<{ success: boolean; isDuplicate: boolean; reference: string }> {
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
    }

    let isDuplicate = false;

    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { data: existing } = await supabase
            .from('payment_history')
            .select('id, status')
            .eq('reference', data.reference)
            .maybeSingle();

          if (existing) {
            if (existing.status === 'failed' || existing.status === 'refunded') {
              isDuplicate = true;
            } else if (existing.status !== 'paid') {
              await supabase
                .from('payment_history')
                .update({ status: 'failed' })
                .eq('id', existing.id);
            }
          } else if (data.companyId) {
            const { data: comp } = await supabase
              .from('companies')
              .select('id')
              .eq('id', data.companyId)
              .maybeSingle();

            if (comp) {
              await supabase.from('payment_history').insert({
                company_id: data.companyId,
                amount: 0,
                currency: 'XOF',
                status: 'failed',
                description: `Moteur Payment Failed: ${data.reference}`,
                reference: data.reference,
                invoice_url: '#',
              });
            }
          }
        } catch {
          // Non-blocking
        }
      }
    }

    await notifyPaymentFailed(
      data.companyId,
      data.reason || 'Le règlement via Moteur n’a pas abouti.'
    );

    return { success: true, isDuplicate, reference: data.reference };
  }

  /**
   * Handles payment expiration (e.g. USSD prompt expired without confirmation)
   */
  public async handlePaymentExpiration(data: {
    reference: string;
    companyId: string;
  }): Promise<{ success: boolean; isDuplicate: boolean; reference: string }> {
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'expired';
      session.updatedAt = new Date().toISOString();
    }

    let isDuplicate = false;

    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { data: existing } = await supabase
            .from('payment_history')
            .select('id, status')
            .eq('reference', data.reference)
            .maybeSingle();

          if (existing) {
            if (existing.status === 'failed' || existing.status === 'refunded') {
              isDuplicate = true;
            }
          } else if (data.companyId) {
            const { data: comp } = await supabase
              .from('companies')
              .select('id')
              .eq('id', data.companyId)
              .maybeSingle();

            if (comp) {
              await supabase.from('payment_history').insert({
                company_id: data.companyId,
                amount: 0,
                currency: 'XOF',
                status: 'failed',
                description: `Moteur Payment Expired: ${data.reference}`,
                reference: data.reference,
                invoice_url: '#',
              });
            }
          }
        } catch {
          // Non-blocking
        }
      }
    }

    return { success: true, isDuplicate, reference: data.reference };
  }

  /**
   * Handles payment cancellation from Moteur (e.g. checkout session cancelled by user or merchant)
   */
  public async handlePaymentCancellation(data: {
    reference: string;
    companyId?: string;
    reason?: string;
  }): Promise<{ success: boolean; isDuplicate: boolean; reference: string }> {
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
    }

    let isDuplicate = false;

    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { data: existing } = await supabase
            .from('payment_history')
            .select('id, status')
            .eq('reference', data.reference)
            .maybeSingle();

          if (existing) {
            if (existing.status === 'failed' || existing.status === 'refunded') {
              isDuplicate = true;
            }
          } else if (data.companyId) {
            const { data: comp } = await supabase
              .from('companies')
              .select('id')
              .eq('id', data.companyId)
              .maybeSingle();

            if (comp) {
              await supabase.from('payment_history').insert({
                company_id: data.companyId,
                amount: 0,
                currency: 'XOF',
                status: 'failed',
                description: `Moteur Payment Cancelled: ${data.reference}`,
                reference: data.reference,
                invoice_url: '#',
              });
            }
          }
        } catch {
          // Non-blocking
        }
      }
    }

    const store = getStore();
    const existingLocal = store.payments.find(
      (p) => p.invoiceNumber === data.reference || p.id === data.reference
    );
    if (existingLocal) {
      if (existingLocal.status === 'failed' || existingLocal.status === 'refunded') {
        isDuplicate = true;
      }
    } else if (data.companyId) {
      store.payments.push({
        id: data.reference,
        invoiceNumber: data.reference,
        amount: 0,
        currency: 'XOF',
        date: new Date().toISOString().split('T')[0],
        status: 'failed',
        description: `Moteur Payment Cancelled: ${data.reference}`,
        pdfUrl: '#',
        reference: data.reference,
      });
      setStoreItem('PAYMENTS', store.payments);
    }

    return { success: true, isDuplicate, reference: data.reference };
  }

  /**
   * Handles payment refund from Moteur
   *
   * State Transition Rules:
   * 1. Marks payment record as refunded / failed.
   * 2. Only revokes the specific subscription and module entitlements funded by this payment.
   * 3. Leaves unrelated modules and subscriptions untouched.
   */
  public async handlePaymentRefund(data: {
    reference: string;
    companyId: string;
    reason?: string;
    refundAmount?: number;
    refundedAmount?: number;
    currency?: string;
    refundedCurrency?: string;
    refundEventId?: string;
    paymentEventId?: string;
    providerRefundId?: string;
    providerReference?: string;
    commissionsReversed?: boolean;
    reversalTotalCents?: number;
    transportEventId?: string;
    rawPayload?: any;
  }): Promise<{
    success: boolean;
    isDuplicate: boolean;
    reference: string;
    isPartial?: boolean;
    refundedAmount?: number;
    newPeriodEnd?: string;
    isConflicting?: boolean;
    isUnmatched?: boolean;
    retryScheduled?: boolean;
    requiresManualReview?: boolean;
    code?: string;
    message?: string;
  }> {
    const invoiceNumber = data.reference.startsWith('INV-') ? data.reference : `INV-${data.reference}`;
    const effectiveRefundAmount = data.refundedAmount ?? data.refundAmount;
    const effectiveProviderRef = data.providerRefundId || data.providerReference || undefined;
    const effectiveRefundEventId = data.refundEventId || data.transportEventId || undefined;
    const effectiveReason = data.reason || 'customer_requested';

    // ── 1. Atomic Supabase Refund RPC ─────────────────────────────────────────
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('refund_moteur_payment', {
            p_company_id: data.companyId,
            p_reference: data.reference,
            p_reason: effectiveReason,
            p_refund_amount: effectiveRefundAmount ?? null,
            p_refund_event_id: effectiveRefundEventId ?? null,
            p_provider_reference: effectiveProviderRef ?? null,
          });

          if (rpcErr) {
            const isFunctionNotFound =
              rpcErr.code === 'PGRST202' ||
              rpcErr.message?.includes('Could not find the function') ||
              rpcErr.message?.includes('schema cache');

            if (!isFunctionNotFound) {
              return {
                success: false,
                isDuplicate: false,
                reference: data.reference,
              };
            }
          } else if (rpcRes) {
            if (rpcRes.status === 'duplicate') {
              return { success: true, isDuplicate: true, reference: data.reference };
            }

            if (rpcRes.status === 'conflict_quarantined' || rpcRes.code === 'CONFLICTING_PAYLOAD_QUARANTINED' || rpcRes.code === 'CONFLICTING_PAYLOAD_FOR_EVENT') {
              return {
                success: true,
                isDuplicate: false,
                isConflicting: true,
                reference: data.reference,
                message: rpcRes.message,
              };
            }

            if (rpcRes.status === 'manual_review_required' || rpcRes.code === 'UNVERIFIED_NET_AMOUNT') {
              return {
                success: true,
                isDuplicate: false,
                requiresManualReview: true,
                reference: data.reference,
                message: rpcRes.message,
              };
            }

            if (rpcRes.status === 'unmatched' || rpcRes.code === 'PAYMENT_NOT_FOUND') {
              // Out-of-order / unmatched refund: Recover original payment via Moteur GET status endpoint
              try {
                const verifyRes = await this.adapter.verifyPayment({ reference: data.reference });
                if (verifyRes && verifyRes.success && verifyRes.status === 'succeeded') {
                  await this.handlePaymentConfirmation({
                    reference: data.reference,
                    companyId: verifyRes.companyId || data.companyId,
                    planId: verifyRes.planId || 'starter',
                    moduleIds: verifyRes.moduleIds || [],
                    billingCycle: (verifyRes.billingCycle as any) || 'flex',
                    amount: verifyRes.amount,
                    currency: verifyRes.currency,
                    providerReference: verifyRes.providerReference,
                    paidAt: verifyRes.paidAt,
                    netAmount: (verifyRes as any).netAmount || verifyRes.amount,
                    feeAmount: (verifyRes as any).feeAmount || 0,
                  });

                  // Retry atomic refund RPC after successful payment recovery
                  const { data: retryRpcRes } = await supabase.rpc('refund_moteur_payment', {
                    p_company_id: data.companyId,
                    p_reference: data.reference,
                    p_reason: effectiveReason,
                    p_refund_amount: effectiveRefundAmount ?? null,
                    p_refund_event_id: effectiveRefundEventId ?? null,
                    p_provider_reference: effectiveProviderRef ?? null,
                  });

                  if (retryRpcRes && retryRpcRes.status === 'success') {
                    await this.syncLocalStoreOnRefund(data, retryRpcRes);
                    return {
                      success: true,
                      isDuplicate: false,
                      reference: data.reference,
                      isPartial: Boolean(retryRpcRes.is_partial),
                      refundedAmount: retryRpcRes.gross_refund_amount || retryRpcRes.refunded_amount,
                      newPeriodEnd: retryRpcRes.new_subscription_period_end || retryRpcRes.new_period_end,
                    };
                  }
                }
              } catch {
                // Fall through to durable unmapped return
              }

              return {
                success: true,
                isDuplicate: false,
                isUnmatched: true,
                retryScheduled: false,
                reference: data.reference,
                message: 'Payment record unmatched; recorded to unmapped events awaiting payment confirmation.',
              };
            }

            if (rpcRes.status === 'invalid') {
              return {
                success: false,
                isDuplicate: false,
                reference: data.reference,
                code: rpcRes.code || 'INVALID_REFUND_PARAMETERS',
                message: rpcRes.message || 'Refund parameters validation failed',
              };
            }

            if (rpcRes.status === 'error') {
              return {
                success: false,
                isDuplicate: false,
                reference: data.reference,
                code: rpcRes.code || 'DB_ERROR',
                message: `Database error during refund: ${rpcRes.message || 'Transaction aborted'}`,
              };
            }

            if (rpcRes.status === 'success') {
              const localSync = await this.syncLocalStoreOnRefund(data, rpcRes);
              return {
                success: true,
                isDuplicate: false,
                reference: data.reference,
                isPartial: Boolean(rpcRes.is_partial),
                refundedAmount: rpcRes.gross_refund_amount || rpcRes.refunded_amount,
                newPeriodEnd: rpcRes.new_subscription_period_end || rpcRes.new_period_end,
              };
            }

            // Fail closed on missing or unexpected RPC status contract
            return {
              success: false,
              isDuplicate: false,
              reference: data.reference,
              code: 'UNEXPECTED_RPC_RESPONSE',
              message: 'Unexpected RPC response contract from refund_moteur_payment',
            };
          }
        } catch {
          // Unexpected throw: fail closed
          return { success: false, isDuplicate: false, reference: data.reference };
        }

        // Fallback guard: In production, non-atomic multi-step fallback is strictly prohibited
        const isProduction = process.env.NODE_ENV === 'production';
        const allowLegacyFallback = process.env.ALLOW_LEGACY_BILLING_FALLBACK === 'true';

        if (isProduction && !allowLegacyFallback) {
          console.error('[Moteur] Fatal: refund_moteur_payment RPC is missing on database. Non-atomic fallback is prohibited in production.');
          return { success: false, isDuplicate: false, reference: data.reference };
        }

        // Query payment record (Fallback - Development only)
        const { data: paymentRow } = await supabase
          .from('payment_history')
          .select('*')
          .eq('company_id', data.companyId)
          .eq('reference', data.reference)
          .maybeSingle();

        if (paymentRow) {
          const existingRefunds = Array.isArray(paymentRow.refund_history) ? paymentRow.refund_history : [];
          if (data.refundEventId && existingRefunds.some((r: any) => r.refund_event_id === data.refundEventId)) {
            return { success: true, isDuplicate: true, reference: data.reference };
          }
          if (paymentRow.status === 'refunded' && (!data.refundAmount || data.refundAmount >= paymentRow.amount)) {
            return { success: true, isDuplicate: true, reference: data.reference };
          }
        }
      }
    }

    // ── 2. Local Store Refund Persistence ─────────────────────────────────────
    const localRefundRes = await this.syncLocalStoreOnRefund(data);
    return {
      success: true,
      isDuplicate: localRefundRes.isDuplicate,
      reference: data.reference,
      isPartial: localRefundRes.isPartial,
      newPeriodEnd: localRefundRes.newPeriodEnd ?? undefined,
      isConflicting: localRefundRes.isConflicting,
      isUnmatched: localRefundRes.isUnmatched,
      retryScheduled: false,
      requiresManualReview: localRefundRes.requiresManualReview,
    };
  }

  /**
   * Helper to sync local store mirror and dispatch events on successful confirmation
   */
  private async syncLocalStoreAndNotify(
    data: {
      companyId: string;
      reference: string;
      amount: number;
      currency: string;
      planId: string;
      billingCycle: string;
      moduleIds: string[];
      paidAt?: string;
    },
    periodEnd: Date
  ): Promise<void> {
    const store = getStore();
    const now = data.paidAt ? new Date(data.paidAt) : new Date();
    const invoiceNumber = data.reference.startsWith('INV-')
      ? data.reference
      : `INV-${data.reference}`;

    const canonicalIds = toCanonicalModuleIds(data.moduleIds);
    const allModuleIds = Array.from(
      new Set([
        ...data.moduleIds,
        ...canonicalIds,
        ...data.moduleIds.flatMap(getModuleAliases),
      ])
    );

    const updatedSub: Subscription = {
      id: `sub-${Date.now()}`,
      companyId: data.companyId,
      planId: data.planId,
      status: 'active',
      billingCycle: (data.billingCycle as 'monthly' | 'yearly') || 'monthly',
      includedModuleIds: allModuleIds,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      renewAt: periodEnd.toISOString(),
      autoRenew: true,
      amount: data.amount,
      currency: data.currency,
    };

    const subIdx = store.subscriptions.findIndex((s) => s.companyId === data.companyId);
    if (subIdx !== -1) {
      store.subscriptions[subIdx] = updatedSub;
    } else {
      store.subscriptions.push(updatedSub);
    }
    setStoreItem('SUBSCRIPTIONS', store.subscriptions);

    const plans = await getPlans();
    const planObj = plans.find((p) => p.id === data.planId);
    const planTitle = typeof planObj?.name === 'string' ? planObj.name : planObj?.name?.fr || data.planId;

    const newPayment: PaymentHistoryItem = {
      id: data.reference,
      invoiceNumber,
      companyId: data.companyId,
      date: now.toISOString(),
      amount: data.amount,
      currency: data.currency,
      planName: `KaziBox ${planTitle} (${data.billingCycle === 'yearly' ? 'Annuel' : 'Mensuel'})`,
      moduleCount: data.moduleIds.length,
      paymentMethod: 'mobile_money',
      operator: 'Moteur Payment Infrastructure',
      status: 'paid',
      receiptUrl: '#',
    };

    store.payments.unshift(newPayment);
    setStoreItem('PAYMENTS', store.payments);

    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'succeeded';
      session.updatedAt = new Date().toISOString();
    }

    await notifySubscriptionActivated(data.companyId, planTitle);

    for (const modId of data.moduleIds) {
      await dispatchWebhookEvent(
        'subscription.activated',
        {
          workspaceId: data.companyId,
          planId: data.planId,
          billingCycle: data.billingCycle,
          renewAt: periodEnd.toISOString(),
          reference: data.reference,
        },
        modId
      );
    }
  }

  /**
   * Helper to sync local store mirror and dispatch events on refund
   */
  private async syncLocalStoreOnRefund(
    data: {
      companyId: string;
      reference: string;
      refundAmount?: number;
      refundedAmount?: number;
      currency?: string;
      refundedCurrency?: string;
      refundEventId?: string;
      providerReference?: string;
      providerRefundId?: string;
      reason?: string;
    },
    rpcRes?: any
  ): Promise<{
    isDuplicate: boolean;
    isPartial: boolean;
    newPeriodEnd?: string | null;
    isConflicting?: boolean;
    isUnmatched?: boolean;
    retryScheduled?: boolean;
    requiresManualReview?: boolean;
  }> {
    const invoiceNumber = data.reference.startsWith('INV-') ? data.reference : `INV-${data.reference}`;
    const store = getStore();
    let payment = store.payments.find(
      (p) => p.invoiceNumber === invoiceNumber || p.id === data.reference
    );
    const sessions = getSessionsMap();
    let session = sessions.get(data.reference);

    // If RPC result is provided, apply authoritative values from database
    if (rpcRes) {
      const isPartial = Boolean(rpcRes.is_partial);
      const newPeriodEnd = (rpcRes.new_subscription_period_end || rpcRes.new_period_end) as string | null;

      if (payment) {
        (payment as any).refundedAmount = rpcRes.gross_refund_amount ?? rpcRes.refunded_amount ?? payment.amount;
        if (!isPartial) {
          payment.status = 'failed';
        }
        setStoreItem('PAYMENTS', store.payments);
      }

      const subIdx = store.subscriptions.findIndex(
        (s) => s.companyId === data.companyId && s.status === 'active'
      );
      if (subIdx !== -1) {
        const sub = store.subscriptions[subIdx];
        if (!isPartial || (newPeriodEnd && new Date(newPeriodEnd) <= new Date())) {
          sub.status = 'canceled';
          if (newPeriodEnd) sub.currentPeriodEnd = newPeriodEnd;
          setStoreItem('SUBSCRIPTIONS', store.subscriptions);
          for (const modId of sub.includedModuleIds) {
            await dispatchWebhookEvent(
              'subscription.expired',
              {
                workspaceId: data.companyId,
                reason: data.reason || 'refunded',
                reference: data.reference,
              },
              modId
            );
          }
        } else if (newPeriodEnd) {
          sub.currentPeriodEnd = newPeriodEnd;
          sub.renewAt = newPeriodEnd;
          setStoreItem('SUBSCRIPTIONS', store.subscriptions);
          for (const modId of sub.includedModuleIds) {
            await dispatchWebhookEvent(
              'subscription.modified' as any,
              {
                workspaceId: data.companyId,
                newPeriodEnd,
                reason: 'partial_refund',
                reference: data.reference,
              },
              modId
            );
          }
        }
      }

      if (session) {
        session.status = 'refunded';
        session.updatedAt = new Date().toISOString();
      }

      return {
        isDuplicate: false,
        isPartial,
        newPeriodEnd,
      };
    }

    // Local / In-Memory Fallback
    // 1. If payment record is missing, attempt recovery via Moteur GET status endpoint
    if (!payment && !session) {
      try {
        const verifyRes = await this.adapter.verifyPayment({ reference: data.reference });
        if (verifyRes && verifyRes.success && verifyRes.status === 'succeeded') {
          await this.handlePaymentConfirmation({
            reference: data.reference,
            companyId: verifyRes.companyId || data.companyId,
            planId: verifyRes.planId || 'starter',
            moduleIds: verifyRes.moduleIds || [],
            billingCycle: (verifyRes.billingCycle as any) || 'flex',
            amount: verifyRes.amount,
            currency: verifyRes.currency,
            providerReference: verifyRes.providerReference,
            paidAt: verifyRes.paidAt,
            netAmount: (verifyRes as any).netAmount || verifyRes.amount,
            feeAmount: (verifyRes as any).feeAmount || 0,
          });

          // Re-fetch after confirmation
          payment = store.payments.find(
            (p) => p.invoiceNumber === invoiceNumber || p.id === data.reference
          );
          session = sessions.get(data.reference);
        }
      } catch {
        // Recovery failed
      }

      if (!payment && !session) {
        return {
          isDuplicate: false,
          isPartial: false,
          isUnmatched: true,
          retryScheduled: false,
        };
      }
    }

    // Check currency mismatch between incoming refund and existing payment
    const incomingCurr = (data.refundedCurrency || data.currency || '').trim().toUpperCase();
    const existingCurr = (payment?.currency || session?.currency || '').trim().toUpperCase();
    if (incomingCurr && existingCurr && incomingCurr !== existingCurr) {
      return {
        isDuplicate: false,
        isPartial: false,
        requiresManualReview: true,
      };
    }

    // 2. Stable event deduplication and conflicting payload detection
    const existingRefundHistory: any[] = (payment as any)?.refundHistory || [];
    const effectiveAmt = data.refundedAmount ?? data.refundAmount;
    if (data.refundEventId) {
      const existingEvt = existingRefundHistory.find((r: any) => r.refund_event_id === data.refundEventId);
      if (existingEvt) {
        if (effectiveAmt !== undefined && existingEvt.amount !== effectiveAmt) {
          return { isDuplicate: false, isPartial: false, isConflicting: true };
        }
        return { isDuplicate: true, isPartial: false };
      }
    }

    // 3. Legacy safety: Check for unverified net amount
    if (payment && ((payment as any).isLegacyUnverified || (payment as any).netAmount === null)) {
      return { isDuplicate: false, isPartial: false, requiresManualReview: true };
    }

    const subIdx = store.subscriptions.findIndex(
      (s) => s.companyId === data.companyId && s.status === 'active'
    );
    const sub = subIdx !== -1 ? store.subscriptions[subIdx] : null;

    const originalAmount = payment?.amount ?? session?.amount ?? 12;
    const originalNet = (payment as any)?.netAmount !== undefined ? (payment as any).netAmount : originalAmount;
    const currency = payment?.currency || session?.currency || 'XOF';
    const refundAmount = data.refundAmount !== undefined ? data.refundAmount : originalAmount;

    // 4. Calculate confirmed net deduction using confirmed provider rounding contract
    const netDeductionResult = calculateConfirmedNetDeduction({
      grossRefundAmount: refundAmount,
      originalGrossAmount: originalAmount,
      originalNetAmount: originalNet,
      cumulativeGrossRefunded: (payment as any)?.refundedAmount ?? 0,
      cumulativeNetDeducted: (payment as any)?.cumulativeNetDeducted ?? 0,
      currency,
    });

    if (netDeductionResult.status === 'manual_review_required') {
      return { isDuplicate: false, isPartial: false, requiresManualReview: true };
    }
    if (netDeductionResult.status === 'duplicate_already_refunded') {
      return { isDuplicate: true, isPartial: false };
    }

    let isPartial = false;
    let newPeriodEnd: string | null = null;

    if (sub && sub.currentPeriodEnd) {
      try {
        const refundCalc = calculatePartialRefund({
          currentPeriodStart: sub.currentPeriodStart || new Date().toISOString(),
          currentPeriodEnd: sub.currentPeriodEnd,
          monthlyReferencePrice: originalAmount,
          refundAmount: netDeductionResult.netDeductionToApply,
        });

        isPartial = !refundCalc.isFullyExhausted;
        newPeriodEnd = refundCalc.newPeriodEnd.toISOString();

        if (refundCalc.isFullyExhausted) {
          sub.status = 'canceled';
          sub.currentPeriodEnd = new Date().toISOString();
          setStoreItem('SUBSCRIPTIONS', store.subscriptions);

          for (const modId of sub.includedModuleIds) {
            await dispatchWebhookEvent(
              'subscription.expired',
              {
                workspaceId: data.companyId,
                reason: data.reason || 'refunded',
                reference: data.reference,
              },
              modId
            );
          }
        } else {
          sub.currentPeriodEnd = newPeriodEnd;
          sub.renewAt = newPeriodEnd;
          setStoreItem('SUBSCRIPTIONS', store.subscriptions);

          for (const modId of sub.includedModuleIds) {
            await dispatchWebhookEvent(
              'subscription.modified' as any,
              {
                workspaceId: data.companyId,
                newPeriodEnd,
                reason: 'partial_refund',
                reference: data.reference,
              },
              modId
            );
          }
        }
      } catch {
        sub.status = 'canceled';
        setStoreItem('SUBSCRIPTIONS', store.subscriptions);
      }
    }

    if (payment) {
      (payment as any).refundedAmount = netDeductionResult.newCumulativeGross;
      (payment as any).cumulativeNetDeducted = netDeductionResult.newCumulativeNet;
      if (!isPartial) {
        payment.status = 'failed';
      }
      existingRefundHistory.push({
        refund_event_id: data.refundEventId || `ref_evt_${Date.now()}`,
        amount: netDeductionResult.grossRefundToApply,
        net_deduction: netDeductionResult.netDeductionToApply,
        is_final_refund: netDeductionResult.isFinalRefund,
        rounding_reconciled: netDeductionResult.roundingReconciled,
        refunded_at: new Date().toISOString(),
        provider_reference: data.providerReference || null,
        reason: data.reason || 'customer_requested',
      });
      (payment as any).refundHistory = existingRefundHistory;
      setStoreItem('PAYMENTS', store.payments);
    }

    if (session) {
      session.status = 'refunded';
      session.updatedAt = new Date().toISOString();
    }

    return {
      isDuplicate: false,
      isPartial,
      newPeriodEnd,
    };
  }

  /**
   * Handles subscription renewal confirmed by Moteur
   */
  public async handlePaymentRenewal(data: {
    reference: string;
    companyId: string;
    planId: string;
    moduleIds: string[];
    billingCycle: 'monthly' | 'yearly';
    amount: number;
    currency: string;
  }): Promise<EntitlementGrantResult> {
    return this.handlePaymentConfirmation(data);
  }

  /**
   * Checks current payment session status
   */
  public async getPaymentSessionStatus(
    reference: string,
    fallback?: {
      companyId?: string;
      planId?: string;
      moduleIds?: string[];
      sessionId?: string;
      returnStatus?: string;
      provider?: string;
    }
  ): Promise<{
    reference: string;
    status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
    companyId?: string;
    planId?: string;
    amount?: number;
    currency?: string;
  }> {
    const sessions = getSessionsMap();
    const localSession =
      sessions.get(reference) ||
      (fallback?.sessionId ? sessions.get(fallback.sessionId) : undefined) ||
      Array.from(sessions.values()).find(
        (s) =>
          s.reference === reference ||
          s.sessionId === reference ||
          (fallback?.sessionId && s.sessionId === fallback.sessionId)
      );

    if (localSession) {
      if (fallback?.companyId && localSession.companyId && localSession.companyId !== fallback.companyId) {
        return {
          reference: localSession.reference,
          status: localSession.status,
          companyId: localSession.companyId,
        };
      }

      // If still pending and adapter is ready, attempt active verification with Moteur
      if (localSession.status === 'pending' && this.adapter.isReady()) {
        try {
          const verifyResult = await this.adapter.verifyPayment({
            reference: localSession.reference,
            sessionId: fallback?.sessionId || localSession.sessionId,
          });
          const rawStatus = String(verifyResult.status || '').toLowerCase();
          const isSuccess = rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'paid';
          const isFailed = rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'rejected';
          const isExpired = rawStatus === 'expired';

          if (isSuccess) {
            const targetCompany = verifyResult.companyId || localSession.companyId;
            if (verifyResult.companyId && localSession.companyId && verifyResult.companyId !== localSession.companyId) {
              localSession.status = 'failed';
              return {
                reference: localSession.reference,
                status: 'failed',
                companyId: localSession.companyId,
              };
            }

            const confirmRes = await this.handlePaymentConfirmation({
              reference: localSession.reference,
              sessionId: verifyResult.sessionId || localSession.sessionId,
              companyId: targetCompany,
              planId: localSession.planId,
              moduleIds: localSession.moduleIds,
              billingCycle: localSession.billingCycle,
              amount: verifyResult.amount || localSession.amount,
              currency: verifyResult.currency || localSession.currency,
              paidAt: verifyResult.paidAt,
            });

            if (confirmRes.success) {
              localSession.status = 'succeeded';
            } else {
              localSession.status = 'failed';
            }
          } else if (isFailed) {
            await this.handlePaymentFailure({
              reference: localSession.reference,
              companyId: localSession.companyId,
            });
            localSession.status = 'failed';
          } else if (isExpired) {
            localSession.status = 'expired';
          }
        } catch {
          // Keep local pending status
        }
      }

      return {
        reference: localSession.reference,
        status: localSession.status,
        companyId: localSession.companyId,
        planId: localSession.planId,
        amount: localSession.amount,
        currency: localSession.currency,
      };
    }

    let dbPayment: any = null;
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const lookupFilter = fallback?.sessionId
            ? `reference.eq.${reference},reference.eq.${fallback.sessionId},description.eq.Moteur Payment: ${reference}`
            : `reference.eq.${reference},description.eq.Moteur Payment: ${reference}`;

          const { data: foundDbPayment } = await supabase
            .from('payment_history')
            .select('reference, status, company_id, amount, currency, plan_id, billing_cycle, module_ids, description, net_amount, fee_amount, duration_seconds, monthly_reference_price, pricing_snapshot')
            .or(lookupFilter)
            .maybeSingle();

          dbPayment = foundDbPayment;

          if (dbPayment) {
            if (fallback?.companyId && dbPayment.company_id && dbPayment.company_id !== fallback.companyId) {
              return {
                reference,
                status: 'failed',
                companyId: dbPayment.company_id,
              };
            }

            const rawStatus = String(dbPayment.status || '').toLowerCase();
            const normalizedStatus =
              rawStatus === 'paid' || rawStatus === 'succeeded' || rawStatus === 'completed'
                ? 'succeeded'
                : (dbPayment.status as any);

            // If found in database and marked paid, return success directly
            if (normalizedStatus === 'succeeded') {
              return {
                reference,
                status: 'succeeded',
                companyId: dbPayment.company_id,
                amount: dbPayment.amount,
                currency: dbPayment.currency,
              };
            }
          }
        } catch {
          // Fall through
        }
      }
    }

    const store = getStore();
    const localPayment = store.payments.find(
      (p) =>
        p.invoiceNumber === reference ||
        p.id === reference ||
        (fallback?.sessionId && (p.invoiceNumber === fallback.sessionId || p.id === fallback.sessionId))
    );
    if (localPayment) {
      if (fallback?.companyId && localPayment.companyId && localPayment.companyId !== fallback.companyId) {
        return {
          reference,
          status: 'failed',
          companyId: localPayment.companyId,
        };
      }

      const rawStatus = String(localPayment.status || '').toLowerCase();
      const normalizedStatus =
        rawStatus === 'paid' || rawStatus === 'succeeded' || rawStatus === 'completed'
          ? 'succeeded'
          : (localPayment.status as any);
      return {
        reference,
        status: normalizedStatus,
        companyId: localPayment.companyId,
        amount: localPayment.amount,
        currency: localPayment.currency,
      };
    }

    const effectiveCompanyId = fallback?.companyId;

    // Serverless stateless verification: query Moteur directly if session not in local memory
    if (this.adapter.isReady()) {
      try {
        const verifyResult = await this.adapter.verifyPayment({
          reference,
          sessionId: fallback?.sessionId,
        });
        const rawStatus = String(verifyResult.status || '').toLowerCase();
        const isSuccess = rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'paid';
        const isFailed = rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'rejected';
        const isExpired = rawStatus === 'expired';

        // Recover original terms from stored database checkout record
        let trustedPlanId = verifyResult.planId;
        let trustedModuleIds = verifyResult.moduleIds && verifyResult.moduleIds.length > 0 ? verifyResult.moduleIds : undefined;
        let trustedBillingCycle = (verifyResult.billingCycle === 'yearly' || verifyResult.billingCycle === 'monthly' || (verifyResult.billingCycle as any) === 'flex') ? verifyResult.billingCycle : undefined;
        let trustedCompanyId = verifyResult.companyId || dbPayment?.company_id || effectiveCompanyId;

        if (dbPayment) {
          if (dbPayment.company_id) trustedCompanyId = dbPayment.company_id;
          if (dbPayment.plan_id) trustedPlanId = dbPayment.plan_id;
          if (dbPayment.billing_cycle === 'monthly' || dbPayment.billing_cycle === 'yearly' || dbPayment.billing_cycle === 'flex') {
            trustedBillingCycle = dbPayment.billing_cycle;
          }
          if (dbPayment.module_ids?.length) trustedModuleIds = dbPayment.module_ids;

          if (!trustedPlanId && dbPayment.description) {
            const pMatch = dbPayment.description.match(/plan:([a-z_]+)/i);
            if (pMatch) trustedPlanId = pMatch[1];
          }
          if (!trustedBillingCycle && dbPayment.description) {
            const cMatch = dbPayment.description.match(/cycle:([a-z_]+)/i);
            if (cMatch && (cMatch[1] === 'monthly' || cMatch[1] === 'yearly' || cMatch[1] === 'flex')) {
              trustedBillingCycle = cMatch[1] as any;
            }
          }
          if (!trustedModuleIds && dbPayment.description) {
            const mMatch = dbPayment.description.match(/modules:([a-z0-9_,-]+)/i);
            if (mMatch) trustedModuleIds = mMatch[1].split(',').filter(Boolean);
          }
        }

        const finalCompanyId = trustedCompanyId;
        const finalPlanId = trustedPlanId || 'starter';
        const finalModuleIds = trustedModuleIds && trustedModuleIds.length > 0
          ? toCanonicalModuleIds(trustedModuleIds)
          : [finalPlanId === 'starter' ? 'hotel-property' : 'garage'];
        const finalBillingCycle: 'monthly' | 'yearly' | 'flex' =
          trustedBillingCycle === 'yearly' ? 'yearly' : (trustedBillingCycle as any) === 'flex' ? 'flex' : 'monthly';

        if (isSuccess && finalCompanyId) {
          if (effectiveCompanyId && finalCompanyId !== effectiveCompanyId) {
            return {
              reference,
              status: 'failed',
              companyId: finalCompanyId,
            };
          }

          const confirmed = await this.handlePaymentConfirmation({
            reference,
            sessionId: verifyResult.sessionId || fallback?.sessionId || reference,
            companyId: finalCompanyId,
            planId: finalPlanId,
            moduleIds: finalModuleIds,
            billingCycle: finalBillingCycle,
            amount: verifyResult.amount || dbPayment?.amount || 15000,
            currency: verifyResult.currency || dbPayment?.currency || 'XOF',
            paidAt: verifyResult.paidAt || new Date().toISOString(),
            netAmount: (dbPayment?.net_amount != null ? Number(dbPayment.net_amount) : undefined) ?? (localPayment as any)?.netAmount,
            feeAmount: (dbPayment?.fee_amount != null ? Number(dbPayment.fee_amount) : undefined) ?? (localPayment as any)?.feeAmount,
            durationSeconds: (dbPayment?.duration_seconds != null ? Number(dbPayment.duration_seconds) : undefined) ?? (localPayment as any)?.durationSeconds,
            monthlyReferencePrice: (dbPayment?.monthly_reference_price != null ? Number(dbPayment.monthly_reference_price) : undefined) ?? (localPayment as any)?.monthlyReferencePrice,
            pricingSnapshot: dbPayment?.pricing_snapshot ?? (localPayment as any)?.pricingSnapshot,
          });

          if (confirmed.success) {
            return {
              reference,
              status: 'succeeded',
              companyId: finalCompanyId,
              planId: finalPlanId,
              amount: verifyResult.amount || 15000,
              currency: verifyResult.currency || 'XOF',
            };
          }
          return {
            reference,
            status: 'failed',
            companyId: finalCompanyId,
          };
        } else if (isFailed) {
          if (finalCompanyId) {
            await this.handlePaymentFailure({
              reference,
              companyId: finalCompanyId,
            });
          }
          return {
            reference,
            status: 'failed',
            companyId: finalCompanyId,
          };
        } else if (isExpired) {
          return {
            reference,
            status: 'expired',
            companyId: finalCompanyId,
          };
        }
      } catch {
        // Fall through to pending
      }
    }

    // Authoritative status requirement:
    // Client-supplied returnStatus query parameters are NEVER accepted to activate paid entitlements.
    // Authoritative gateway verification or HMAC webhook confirmation is required.
    return {
      reference,
      status: 'pending',
      companyId: effectiveCompanyId,
    };
  }
}

// Export singleton instance
export const moteurService = new MoteurPaymentService();
