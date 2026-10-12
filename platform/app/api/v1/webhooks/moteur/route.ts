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
  // Inspect standard Moteur signature headers (x-moteur-signature, x-signature)
  const signatureHeader =
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
        message: 'Signature header (x-moteur-signature) is required.',
      },
      { status: 401 }
    );
  }

  const { valid, event, error } = adapter.parseWebhookPayload(rawBody, signatureHeader);

  if (!valid || !event) {
    return NextResponse.json(
      {
        success: false,
        error: error || 'INVALID_SIGNATURE',
        message: 'Cryptographic signature verification failed.',
      },
      { status: 401 }
    );
  }

  // ── 4. Dispatch Event into KaziBox Lifecycle ────────────────────────────────
  try {
    switch (event.event) {
      case 'payment.succeeded': {
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
