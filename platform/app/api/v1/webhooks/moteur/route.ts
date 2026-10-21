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

        const result = await moteurService.handlePaymentConfirmation({
          reference,
          sessionId: event.data?.sessionId || (event.data as any)?.session_id,
          companyId,
          planId,
          moduleIds,
          billingCycle,
          amount,
          currency,
          referralCode: event.data?.referralCode || (event.data as any)?.referral_code,
          providerReference: event.data?.providerReference || (event.data as any)?.provider_reference,
          paidAt: event.data?.paidAt || (event.data as any)?.paid_at || event.occurredAt,
        });

        if (!result.success) {
          const isInvalidTransition =
            Boolean((result as any).isInvalidTransition) ||
            (result as any).code === 'PAYMENT_ALREADY_TERMINATED';

          return NextResponse.json(
            {
              success: false,
              error: isInvalidTransition
                ? 'INVALID_PAYMENT_STATE_TRANSITION'
                : 'PAYMENT_CONFIRMATION_FAILED',
              message:
                result.message ||
                (isInvalidTransition
                  ? 'Payment reference was already terminated (failed/refunded) and cannot be confirmed.'
                  : 'Payment processing failed.'),
              isDuplicate: false,
              reference,
            },
            { status: isInvalidTransition ? 409 : 400 }
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

        const refundResult = await moteurService.handlePaymentRefund({
          reference,
          companyId,
          reason: (event.data.metadata as any)?.refund_reason,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: Boolean(refundResult.isDuplicate),
          reference,
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
