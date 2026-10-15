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
        if (!event.data?.reference || !event.data?.companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        const result = await moteurService.handlePaymentConfirmation({
          reference: event.data.reference,
          sessionId: event.data.sessionId,
          companyId: event.data.companyId,
          planId: event.data.planId,
          moduleIds: event.data.moduleIds || [],
          billingCycle: event.data.billingCycle || 'monthly',
          amount: event.data.amount,
          currency: event.data.currency,
          referralCode: event.data.referralCode,
          providerReference: event.data.providerReference,
          paidAt: event.data.paidAt || event.occurredAt,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: result.isDuplicate,
          reference: event.data.reference,
        });
      }

      case 'payment.failed': {
        if (!event.data?.reference || !event.data?.companyId) {
          return NextResponse.json(
            {
              success: false,
              error: 'MISSING_REQUIRED_FIELDS',
              message: 'Payment failure events must include reference and companyId.',
            },
            { status: 400 }
          );
        }

        await moteurService.handlePaymentFailure({
          reference: event.data.reference,
          companyId: event.data.companyId,
          reason: (event.data.metadata as any)?.failure_reason,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          reference: event.data.reference,
        });
      }

      case 'payment.expired': {
        await moteurService.handlePaymentExpiration({
          reference: event.data.reference,
          companyId: event.data.companyId,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          reference: event.data.reference,
        });
      }

      case 'payment.refunded': {
        const refundResult = await moteurService.handlePaymentRefund({
          reference: event.data.reference,
          companyId: event.data.companyId,
          reason: (event.data.metadata as any)?.refund_reason,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: refundResult.isDuplicate,
          reference: event.data.reference,
        });
      }

      case 'subscription.renewed': {
        const renewResult = await moteurService.handlePaymentRenewal({
          reference: event.data.reference,
          companyId: event.data.companyId,
          planId: event.data.planId,
          moduleIds: event.data.moduleIds || [],
          billingCycle: event.data.billingCycle || 'monthly',
          amount: event.data.amount,
          currency: event.data.currency,
        });

        return NextResponse.json({
          received: true,
          event: event.event,
          isDuplicate: renewResult.isDuplicate,
          reference: event.data.reference,
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
