import { NextRequest, NextResponse } from 'next/server';
import { MoteurAdapter } from '@/lib/moteur/adapter';
import { moteurService } from '@/lib/moteur/service';
import { MoteurWebhookEvent } from '@/lib/moteur/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/moteur
 *
 * Inbound Webhook Endpoint for Centralized Payment Notifications from Moteur
 *
 * Security & Lifecycle Rules:
 * 1. Signature Verification: All incoming webhooks must be cryptographically authenticated.
 *    KaziBox uses HMAC-SHA256 constant-time comparison against MOTEUR_WEBHOOK_SECRET.
 *    If unconfigured or signature is missing/invalid, requests are strictly rejected with HTTP 401.
 * 2. Idempotency: Duplicate events are safely handled without double-activating entitlements or duplicating payments.
 * 3. Separation of Concerns: Referral attribution is processed by Moteur; KaziBox does not calculate ambassador commissions.
 */
export async function POST(req: NextRequest) {
  // ── 1. Read Raw Body ────────────────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to read request body' },
      { status: 400 }
    );
  }

  // ── 2. Extract Signature Header ─────────────────────────────────────────────
  // Inspect standard Moteur & DPaaS signature headers (x-engine-signature first)
  const signatureHeader =
    req.headers.get('x-engine-signature') ||
    req.headers.get('x-moteur-signature') ||
    req.headers.get('x-signature') ||
    req.headers.get('x-webhook-signature');

  const adapter = new MoteurAdapter();

  // ── 3. Authenticate Inbound Webhook ─────────────────────────────────────────
  if (!process.env.MOTEUR_WEBHOOK_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: 'MOTEUR_WEBHOOK_NOT_CONFIGURED',
        message: 'Moteur webhook secret is not yet configured in server environment. Inbound webhooks are rejected for security.',
      },
      { status: 401 }
    );
  }

  if (!signatureHeader) {
    return NextResponse.json(
      {
        success: false,
        error: 'MISSING_SIGNATURE_HEADER',
        message: 'Signature header (x-engine-signature or x-moteur-signature) is required.',
      },
      { status: 401 }
    );
  }

  const { valid, event, error } = adapter.parseWebhookPayload(rawBody, signatureHeader);

  if (!valid || !event) {
    const isSyntaxError = error === 'INVALID_JSON' || error === 'MALFORMED_PAYLOAD';
    return NextResponse.json(
      {
        success: false,
        error: error || 'INVALID_SIGNATURE',
        message:
          error === 'INVALID_JSON'
            ? 'Malformed JSON payload.'
            : error === 'MALFORMED_PAYLOAD'
            ? 'Payload is missing required event fields.'
            : 'Cryptographic signature verification failed.',
      },
      { status: isSyntaxError ? 400 : 401 }
    );
  }

  // ── 4. Application Code Validation ──────────────────────────────────────────
  const configuredAppCode = process.env.MOTEUR_APP_CODE || 'demosaas';
  const payloadAppCode =
    (event as any).app_code ||
    (event as any).application_code ||
    (event.data as any)?.app_code ||
    (event.data as any)?.application_code ||
    (event.data as any)?.metadata?.app_code;

  if (payloadAppCode && payloadAppCode !== configuredAppCode) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_APPLICATION_CODE',
        message: `Event application code '${payloadAppCode}' does not match expected '${configuredAppCode}'.`,
      },
      { status: 400 }
    );
  }

  // ── 5. Dispatch Event into KaziBox Lifecycle ────────────────────────────────
  try {
    switch (event.event as string) {
      case 'test.ping': {
        return NextResponse.json({
          received: true,
          event: 'test.ping',
          message: 'Moteur DPaaS test ping successfully received and authenticated.',
        });
      }

      case 'payment.completed':
      case 'payment.succeeded': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference || !companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        const planId =
          event.data?.planId ||
          (event.data as any)?.plan_id ||
          (event.data as any)?.metadata?.plan_id ||
          (event.data as any)?.metadata?.planId ||
          'starter';
        const moduleIds =
          event.data?.moduleIds ||
          (event.data as any)?.module_ids ||
          (event.data as any)?.metadata?.module_ids ||
          [];
        const billingCycle =
          event.data?.billingCycle ||
          (event.data as any)?.billing_cycle ||
          (event.data as any)?.metadata?.billing_cycle ||
          'monthly';
        const amount =
          event.data?.amount !== undefined
            ? Number(event.data.amount)
            : Number((event.data as any)?.metadata?.amount || 0);
        const currency =
          event.data?.currency ||
          (event.data as any)?.metadata?.currency ||
          'XOF';

        const paymentEventId =
          (event as any).id ||
          (event as any).event_id ||
          (event.data as any)?.payment_event_id ||
          (event.data as any)?.paymentEventId;
        const netAmount =
          (event.data as any)?.net_amount !== undefined
            ? Number((event.data as any).net_amount)
            : (event.data as any)?.netAmount !== undefined
            ? Number((event.data as any).netAmount)
            : undefined;
        const feeAmount =
          (event.data as any)?.fee_amount !== undefined
            ? Number((event.data as any).fee_amount)
            : (event.data as any)?.feeAmount !== undefined
            ? Number((event.data as any).feeAmount)
            : 0;

        const result = await moteurService.handlePaymentConfirmation({
          reference,
          sessionId: event.data?.sessionId || (event.data as any)?.session_id,
          companyId,
          planId,
          moduleIds,
          billingCycle: billingCycle as any,
          amount,
          currency,
          referralCode: event.data?.referralCode || (event.data as any)?.referral_code,
          providerReference: event.data?.providerReference || (event.data as any)?.provider_reference,
          paidAt: event.data?.paidAt || (event.data as any)?.paid_at || event.occurredAt,
          paymentEventId,
          netAmount,
          feeAmount,
        });

        if (!result.success) {
          const isInvalidTransition =
            Boolean((result as any).isInvalidTransition) ||
            (result as any).code === 'PAYMENT_ALREADY_TERMINATED';

          const isDatabaseOrTransient =
            (result as any).code === 'DB_ERROR' ||
            (result as any).code === 'UNEXPECTED_RPC_RESPONSE' ||
            Boolean(result.message?.includes('Database error')) ||
            Boolean(result.message?.includes('RPC execution error'));

          return NextResponse.json(
            {
              success: false,
              error: isInvalidTransition
                ? 'INVALID_PAYMENT_STATE_TRANSITION'
                : isDatabaseOrTransient
                ? 'DATABASE_TRANSACTION_FAILED'
                : 'PAYMENT_CONFIRMATION_FAILED',
              message: isInvalidTransition
                ? 'Payment reference was already terminated (failed/refunded) and cannot be confirmed.'
                : isDatabaseOrTransient
                ? 'Transient database error during payment confirmation. Please retry.'
                : (result.message || 'Payment processing failed.'),
              isDuplicate: false,
              reference,
            },
            { status: isInvalidTransition ? 409 : isDatabaseOrTransient ? 500 : 400 }
          );
        }

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: Boolean(result.isDuplicate),
          reference,
        });
      }

      case 'payment.failed': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference || !companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment failure events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        const failResult = await moteurService.handlePaymentFailure({
          reference,
          companyId,
          reason: (event.data.metadata as any)?.failure_reason,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: (failResult as any)?.isDuplicate ?? false,
          reference,
        });
      }

      case 'payment.expired': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment expiration events must include reference.',
            },
            { status: 400 }
          );
        }

        const expireResult = await moteurService.handlePaymentExpiration({
          reference,
          companyId: companyId || '',
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: (expireResult as any)?.isDuplicate ?? false,
          reference,
        });
      }

      case 'payment.cancelled': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment cancellation events must include reference.',
            },
            { status: 400 }
          );
        }

        const cancelResult = await moteurService.handlePaymentCancellation({
          reference,
          companyId,
          reason: (event.data?.metadata as any)?.cancellation_reason,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: Boolean(cancelResult.isDuplicate),
          status: 'cancelled',
          reference,
        });
      }

      case 'payment.refunded': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference || !companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment refund events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        const rawData = (event.data || {}) as any;
        const metadata = (rawData.metadata || {}) as any;

        const parseNumeric = (val: any): number | undefined => {
          if (typeof val === 'number' && Number.isFinite(val)) return val;
          if (typeof val === 'string' && val.trim() !== '') {
            const num = Number(val);
            if (Number.isFinite(num)) return num;
          }
          return undefined;
        };

        const refundedAmount =
          parseNumeric(rawData.refunded_amount) ??
          parseNumeric(rawData.refund_amount) ??
          parseNumeric(rawData.amount) ??
          parseNumeric(metadata.refunded_amount);

        if (refundedAmount !== undefined && refundedAmount <= 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'INVALID_REFUND_AMOUNT',
              message: 'Refund amount must be strictly positive.',
            },
            { status: 400 }
          );
        }

        const refundedCurrency =
          rawData.refunded_currency ||
          rawData.currency ||
          metadata.refunded_currency ||
          metadata.currency ||
          undefined;

        const transportEventId =
          (event as any).id ||
          (event as any).event_id ||
          req.headers.get('moteur-event-id') ||
          req.headers.get('x-moteur-event-id') ||
          undefined;

        const refundEventId =
          rawData.refund_event_id ||
          rawData.refundEventId ||
          undefined;

        const paymentEventId =
          rawData.payment_event_id ||
          rawData.paymentEventId ||
          metadata.payment_event_id ||
          undefined;

        const providerRefundId =
          rawData.provider_refund_id ||
          rawData.providerRefundId ||
          rawData.provider_reference ||
          rawData.providerReference ||
          rawData.provider_tx_id ||
          rawData.providerTxId ||
          undefined;

        const commissionsReversed =
          typeof rawData.commissions_reversed === 'boolean'
            ? rawData.commissions_reversed
            : typeof metadata.commissions_reversed === 'boolean'
            ? metadata.commissions_reversed
            : false;

        const reversalTotalCents =
          typeof rawData.reversal_total_cents === 'number'
            ? rawData.reversal_total_cents
            : typeof metadata.reversal_total_cents === 'number'
            ? metadata.reversal_total_cents
            : undefined;

        const reason =
          rawData.reason ||
          metadata.reason ||
          metadata.refund_reason ||
          'customer_requested';

        const refundResult = await moteurService.handlePaymentRefund({
          reference,
          companyId,
          refundAmount: refundedAmount,
          refundedAmount,
          refundedCurrency,
          currency: refundedCurrency,
          refundEventId,
          paymentEventId,
          providerRefundId,
          providerReference: providerRefundId,
          commissionsReversed,
          reversalTotalCents,
          reason,
          transportEventId,
          rawPayload: event,
        });

        // 1. Safe duplicate handling: Return HTTP 200 for recognized duplicate events
        if (refundResult.isDuplicate) {
          return NextResponse.json({
            received: true,
            event: event.event,
            isDuplicate: true,
            reference,
            message: 'Refund event already processed.',
          });
        }

        // 2. Conflicting payloads for same event ID: Durably quarantined without ledger mutation
        // Return HTTP 200 acknowledged to stop Moteur retry loops; ledger remains unmutated
        if (refundResult.isConflicting) {
          return NextResponse.json({
            received: true,
            event: event.event,
            quarantined: true,
            status: 'conflicting_payload_quarantined',
            reference,
            message: 'Conflicting payload detected and quarantined without financial ledger mutation.',
          });
        }

        // 3. Out-of-order / unmatched refund: Durably preserved in unmapped table
        // Return HTTP 200 acknowledged once safely stored; auto-reconciles when payment confirms
        if (refundResult.isUnmatched) {
          return NextResponse.json({
            received: true,
            event: event.event,
            quarantined: true,
            status: 'unmatched_pending_payment',
            reference,
            message: 'Payment record not yet committed. Refund durably quarantined in inbox awaiting payment confirmation.',
          });
        }

        // 4. Legacy safety: Historical payment missing verified net amount routed to manual review
        if (refundResult.requiresManualReview) {
          return NextResponse.json({
            received: true,
            event: event.event,
            quarantined: true,
            status: 'manual_reconciliation_required',
            reference,
            message: 'Payment record lacks verified net amount. Durably routed for manual finance reconciliation.',
          });
        }

        // 5. Fail closed if business effects have not been durably recorded
        if (!refundResult.success) {
          const isInvalidInput =
            (refundResult as any).code === 'INVALID_REFUND_PARAMETERS' ||
            (refundResult as any).code === 'INVALID_REFUND_AMOUNT' ||
            (refundResult as any).code === 'INVALID_REFERENCE';

          return NextResponse.json(
            {
              success: false,
              error: isInvalidInput ? 'INVALID_REFUND_PARAMETERS' : 'REFUND_PROCESSING_FAILED',
              message: isInvalidInput
                ? (refundResult.message || 'Refund parameters validation failed.')
                : 'Transient error during refund processing. Please retry.',
              reference,
            },
            { status: isInvalidInput ? 400 : 500 }
          );
        }

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: false,
          reference,
          isPartial: refundResult.isPartial,
          newPeriodEnd: refundResult.newPeriodEnd,
        });
      }

      case 'subscription.renewed': {
        const reference =
          event.data?.reference ||
          (event.data as any)?.idempotency_key ||
          (event.data as any)?.idempotencyKey;
        const companyId =
          event.data?.companyId ||
          (event.data as any)?.company_id ||
          (event.data as any)?.workspace_id ||
          (event.data as any)?.workspaceId ||
          (event.data as any)?.metadata?.company_id ||
          (event.data as any)?.metadata?.companyId;

        if (!reference || !companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Subscription renewal events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        const planId =
          event.data?.planId ||
          (event.data as any)?.plan_id ||
          (event.data as any)?.metadata?.plan_id ||
          (event.data as any)?.metadata?.planId ||
          'starter';
        const moduleIds =
          event.data?.moduleIds ||
          (event.data as any)?.module_ids ||
          (event.data as any)?.metadata?.module_ids ||
          [];
        const billingCycle =
          event.data?.billingCycle ||
          (event.data as any)?.billing_cycle ||
          (event.data as any)?.metadata?.billing_cycle ||
          'monthly';
        const amount =
          event.data?.amount !== undefined
            ? Number(event.data.amount)
            : Number((event.data as any)?.metadata?.amount || 0);
        const currency =
          event.data?.currency ||
          (event.data as any)?.metadata?.currency ||
          'XOF';

        const renewResult = await moteurService.handlePaymentRenewal({
          reference,
          companyId,
          planId,
          moduleIds,
          billingCycle,
          amount,
          currency,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: Boolean(renewResult.isDuplicate),
          reference,
        });
      }

      case 'commission.earned': {
        // Moteur DPaaS handles ambassador commissions, wallets, and payouts centrally.
        // KaziBox safely acknowledges without double-accounting.
        return NextResponse.json({
          received: true,
          event: 'commission.earned',
          acknowledged: true,
          note: 'Ambassador commission accounted for in centralized Moteur ledger',
        });
      }

      case 'payout.completed': {
        return NextResponse.json({
          received: true,
          event: 'payout.completed',
          acknowledged: true,
          note: 'Payout processed by centralized Moteur infrastructure',
        });
      }

      case 'payout.failed': {
        return NextResponse.json({
          received: true,
          event: 'payout.failed',
          acknowledged: true,
          note: 'Payout failure logged from centralized Moteur infrastructure',
        });
      }

      default: {
        return NextResponse.json({
          received: true,
          ignored: true,
          message: `Unhandled event type: ${(event as any).event}`,
        });
      }
    }
  } catch (handlerErr: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'PROCESSING_ERROR',
        message: handlerErr.message || 'Error processing webhook event',
      },
      { status: 500 }
    );
  }
}
