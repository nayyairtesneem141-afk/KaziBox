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

  /**
   * Creates an unconfirmed checkout session with Moteur.
   *
   * CRITICAL SECURITY RULE:
   * This step creates a PENDING session. Paid entitlements are NEVER granted here.
   */
  public async createCheckoutSession(params: {
    companyId: string;
    planId: string;
    billingCycle: 'monthly' | 'yearly';
    moduleIds: string[];
    country: 'CD' | 'CM' | 'SN' | 'CI';
    amount: number;
    currency?: string;
    customer?: { id?: string; name?: string; email?: string; phone?: string };
    referralCode?: string;
    returnUrl?: string;
  }): Promise<MoteurInitiatePaymentResponse> {
    const currency = params.currency || resolveCurrencyForCountry(params.country);
    const reference = `KZ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const initiateReq: MoteurInitiatePaymentRequest = {
      idempotencyKey: reference,
      description: MOTEUR_PAYMENT_DESCRIPTION,
      amount: params.amount,
      currency,
      country: params.country,
      companyId: params.companyId,
      planId: params.planId,
      moduleIds: params.moduleIds,
      billingCycle: params.billingCycle,
      customer: params.customer,
      // Referral attribution passed along for Moteur to process commissions
      referralCode: params.referralCode,
      returnUrl: params.returnUrl,
    };

    // Store pending session in local registry
    const sessions = getSessionsMap();
    sessions.set(reference, {
      reference,
      sessionId: '',
      companyId: params.companyId,
      planId: params.planId,
      moduleIds: params.moduleIds,
      billingCycle: params.billingCycle,
      amount: params.amount,
      currency,
      status: 'pending',
      referralCode: params.referralCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Delegate to adapter
    const result = await this.adapter.initiatePaymentSession(initiateReq);

    if (result.sessionId) {
      const rec = sessions.get(reference);
      if (rec) {
        rec.sessionId = result.sessionId;
        rec.updatedAt = new Date().toISOString();
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
    billingCycle: 'monthly' | 'yearly';
    amount: number;
    currency: string;
    referralCode?: string;
    providerReference?: string;
    paidAt?: string;
  }): Promise<EntitlementGrantResult> {
    if (MoteurPaymentService.inFlightReferences.has(data.reference)) {
      return {
        success: true,
        isDuplicate: true,
        companyId: data.companyId,
        status: 'active',
        planId: data.planId,
        activatedModuleIds: data.moduleIds,
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
          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('confirm_moteur_payment', {
              p_company_id: data.companyId,
              p_reference: data.reference,
              p_amount: data.amount,
              p_currency: data.currency,
              p_plan_id: data.planId,
              p_billing_cycle: data.billingCycle,
              p_module_ids: data.moduleIds,
              p_metadata: {
                referralCode: data.referralCode || null,
                countryCode: (data as any).countryCode || null,
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
                  planId: data.planId,
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
                  planId: data.planId,
                  activatedModuleIds: data.moduleIds,
                  reference: data.reference,
                  message: rpcRes.message || 'Payment already processed (idempotent)',
                };
              }
              if (rpcRes.status === 'invalid') {
                return {
                  success: false,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'cancelled',
                  planId: data.planId,
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
                  planId: data.planId,
                  activatedModuleIds: [],
                  reference: data.reference,
                  message: `Database error: ${rpcRes.message || 'Transaction aborted'}`,
                };
              }
              if (rpcRes.status === 'success') {
                const periodEnd = rpcRes.period_end ? new Date(rpcRes.period_end) : new Date(Date.now() + 30 * 86400000);
                await this.syncLocalStoreAndNotify(data, periodEnd);
                return {
                  success: true,
                  isDuplicate: false,
                  companyId: data.companyId,
                  status: 'active',
                  planId: data.planId,
                  activatedModuleIds: data.moduleIds,
                  reference: data.reference,
                };
              }
            }
          } catch (e: any) {
            // Unexpected network/client throw: fail closed
            return {
              success: false,
              isDuplicate: false,
              companyId: data.companyId,
              status: 'cancelled',
              planId: data.planId,
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
            .eq('company_id', data.companyId)
            .eq('description', `Moteur Payment: ${data.reference}`)
            .maybeSingle();

          if (existingPayment && existingPayment.status === 'paid') {
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
        }
      }

      // ── 2. Idempotency Check in Local Store ───────────────────────────────────
      const store = getStore();
      const existingLocal = store.payments.find(
        (p) => p.invoiceNumber === invoiceNumber || p.id === data.reference
      );

      if (existingLocal && existingLocal.status === 'paid') {
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
      if (data.billingCycle === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
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
              plan_id: data.planId,
              status: 'active',
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              cancel_at_period_end: false,
              included_module_ids: data.moduleIds,
            })
            .eq('id', currentSub.id);
        } else {
          await supabase.from('subscriptions').insert({
            company_id: data.companyId,
            plan_id: data.planId,
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            cancel_at_period_end: false,
            included_module_ids: data.moduleIds,
          });
        }

        // Activate each module in company_modules
        for (const modId of data.moduleIds) {
          await supabase.from('company_modules').upsert(
            {
              company_id: data.companyId,
              module_id: modId,
              plan_id: data.planId,
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
          invoice_url: '#',
        });
      }
    }

    // ── 5. Sync In-Memory Store & Dispatch Events ────────────────────────────
    await this.syncLocalStoreAndNotify(data, periodEnd);

      return {
        success: true,
        isDuplicate: false,
        companyId: data.companyId,
        status: 'active',
        planId: data.planId,
        activatedModuleIds: data.moduleIds,
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
  }): Promise<{ success: boolean; reference: string }> {
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
    }

    await notifyPaymentFailed(
      data.companyId,
      data.reason || 'Le règlement via Moteur n’a pas abouti.'
    );

    return { success: true, reference: data.reference };
  }

  /**
   * Handles payment expiration (e.g. USSD prompt expired without confirmation)
   */
  public async handlePaymentExpiration(data: {
    reference: string;
    companyId: string;
  }): Promise<{ success: boolean; reference: string }> {
    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'expired';
      session.updatedAt = new Date().toISOString();
    }

    return { success: true, reference: data.reference };
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
  }): Promise<{ success: boolean; isDuplicate: boolean; reference: string }> {
    const invoiceNumber = data.reference.startsWith('INV-') ? data.reference : `INV-${data.reference}`;

    // ── 1. Atomic Supabase Refund RPC ─────────────────────────────────────────
    if (isSupabaseConfigured()) {
      const supabase: any = createAdminClient() || createServerClient();
      if (supabase) {
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('refund_moteur_payment', {
            p_company_id: data.companyId,
            p_reference: data.reference,
            p_reason: data.reason || 'customer_requested',
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
            if (rpcRes.status === 'invalid') {
              return { success: false, isDuplicate: false, reference: data.reference };
            }
            if (rpcRes.status === 'success') {
              await this.syncLocalStoreOnRefund(data);
              return { success: true, isDuplicate: false, reference: data.reference };
            }
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
          .eq('description', `Moteur Payment: ${data.reference}`)
          .maybeSingle();

        if (paymentRow) {
          if (paymentRow.status === 'failed') {
            return { success: true, isDuplicate: true, reference: data.reference };
          }
          await supabase
            .from('payment_history')
            .update({ status: 'failed' })
            .eq('id', paymentRow.id);
        }

        // Cancel only the subscription associated with this workspace
        const { data: activeSub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', data.companyId)
          .eq('status', 'active')
          .maybeSingle();

        if (activeSub) {
          await supabase
            .from('subscriptions')
            .update({ status: 'cancelled' })
            .eq('id', activeSub.id);

          const modulesToRevoke = Array.isArray(activeSub.included_module_ids)
            ? (activeSub.included_module_ids as string[])
            : [];

          for (const modId of modulesToRevoke) {
            await supabase
              .from('company_modules')
              .update({ status: 'cancelled' })
              .eq('company_id', data.companyId)
              .eq('module_id', modId);
          }
        }
      }
    }

    // ── 2. Local Store Refund Persistence ─────────────────────────────────────
    await this.syncLocalStoreOnRefund(data);
    return { success: true, isDuplicate: false, reference: data.reference };
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

    const updatedSub: Subscription = {
      id: `sub-${Date.now()}`,
      companyId: data.companyId,
      planId: data.planId,
      status: 'active',
      billingCycle: (data.billingCycle as 'monthly' | 'yearly') || 'monthly',
      includedModuleIds: data.moduleIds,
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
    data: { companyId: string; reference: string }
  ): Promise<void> {
    const invoiceNumber = data.reference.startsWith('INV-') ? data.reference : `INV-${data.reference}`;
    const store = getStore();
    const payment = store.payments.find(
      (p) => p.invoiceNumber === invoiceNumber || p.id === data.reference
    );

    if (payment) {
      payment.status = 'failed';
      setStoreItem('PAYMENTS', store.payments);
    }

    const subIdx = store.subscriptions.findIndex(
      (s) => s.companyId === data.companyId && s.status === 'active'
    );
    if (subIdx !== -1) {
      const sub = store.subscriptions[subIdx];
      sub.status = 'canceled';
      setStoreItem('SUBSCRIPTIONS', store.subscriptions);

      for (const modId of sub.includedModuleIds) {
        await dispatchWebhookEvent(
          'subscription.expired',
          {
            workspaceId: data.companyId,
            reason: 'refunded',
            reference: data.reference,
          },
          modId
        );
      }
    }

    const sessions = getSessionsMap();
    const session = sessions.get(data.reference);
    if (session) {
      session.status = 'refunded';
      session.updatedAt = new Date().toISOString();
    }
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
  public async getPaymentSessionStatus(reference: string): Promise<{
    reference: string;
    status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded';
    companyId?: string;
    planId?: string;
    amount?: number;
    currency?: string;
  }> {
    const sessions = getSessionsMap();
    const localSession = sessions.get(reference);

    if (localSession) {
      // If still pending and adapter is ready, attempt active verification with Moteur
      if (localSession.status === 'pending' && this.adapter.isReady()) {
        try {
          const verifyResult = await this.adapter.verifyPayment({ reference });
          if (verifyResult.status === 'succeeded') {
            await this.handlePaymentConfirmation({
              reference,
              sessionId: verifyResult.sessionId,
              companyId: verifyResult.companyId || localSession.companyId,
              planId: verifyResult.planId || localSession.planId,
              moduleIds: verifyResult.moduleIds || localSession.moduleIds,
              billingCycle: verifyResult.billingCycle || localSession.billingCycle,
              amount: verifyResult.amount || localSession.amount,
              currency: verifyResult.currency || localSession.currency,
              paidAt: verifyResult.paidAt,
            });
            localSession.status = 'succeeded';
          } else if (verifyResult.status === 'failed') {
            await this.handlePaymentFailure({
              reference,
              companyId: localSession.companyId,
            });
            localSession.status = 'failed';
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

    return {
      reference,
      status: 'pending',
    };
  }
}

// Export singleton instance
export const moteurService = new MoteurPaymentService();
