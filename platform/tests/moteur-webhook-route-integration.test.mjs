/**
 * KaziBox Flex & Moteur — Webhook Route End-to-End Integration Test Suite
 *
 * Exercises the actual exported Next.js route handler:
 *   platform/app/api/v1/webhooks/moteur/route.ts -> POST(req: NextRequest)
 *
 * Verifies:
 * 1. Cryptographic HMAC-SHA256 signature enforcement (x-engine-signature / x-moteur-signature).
 * 2. Strict rejection of missing, unconfigured, or tampered signatures.
 * 3. Malformed JSON and payload validation.
 * 4. Application code isolation (demosaas).
 * 5. Successful payment confirmation with term binding.
 * 6. Idempotent duplicate delivery recognition (HTTP 200 with isDuplicate: true).
 * 7. Fail-closed handling when database RPC returns HTTP 200 with { status: "error" }.
 * 8. Distinguishes retryable database failures (HTTP 500) from terminal validation errors (HTTP 400/409).
 * 9. Out-of-order refund quarantine awaiting payment confirmation.
 * 10. Conflicting refund payload quarantine without ledger mutation.
 * 11. Legacy payment without verified net amount quarantine.
 * 12. Currency rounding (XOF/CDF: 0 decimals, USD/EUR: 2 decimals) and non-negative entitlement invariants.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

import { POST } from '../app/api/v1/webhooks/moteur/route.ts';
import { moteurService } from '../lib/moteur/service.ts';
import {
  roundHalfUp,
  getCurrencyDecimalPlaces,
  calculateConfirmedNetDeduction,
  COMMERCIAL_MONTH_SECONDS,
} from '../lib/pricing-tiers.ts';

const TEST_SECRET = 'test_webhook_hmac_secret_2026_kazibox_flex_xyz';
const TEST_APP_CODE = 'demosaas';

// Configure test environment variables safely for local execution
process.env.MOTEUR_WEBHOOK_SECRET = TEST_SECRET;
process.env.MOTEUR_APP_CODE = TEST_APP_CODE;

function signPayload(body, secret = TEST_SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function createWebhookRequest(payload, options = {}) {
  const bodyText = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = new Headers();
  headers.set('content-type', 'application/json');

  if (options.signature !== null) {
    const signature = options.signature !== undefined ? options.signature : signPayload(bodyText, options.secret || TEST_SECRET);
    if (signature) {
      headers.set(options.headerName || 'x-engine-signature', signature);
    }
  }

  if (options.eventId) {
    headers.set('moteur-event-id', options.eventId);
  }

  return new NextRequest('http://localhost:3000/api/v1/webhooks/moteur', {
    method: 'POST',
    headers,
    body: bodyText,
  });
}

test('Webhook Route: Rejects requests when MOTEUR_WEBHOOK_SECRET is unconfigured', async () => {
  const originalSecret = process.env.MOTEUR_WEBHOOK_SECRET;
  try {
    delete process.env.MOTEUR_WEBHOOK_SECRET;
    const req = createWebhookRequest({ event: 'test.ping' }, { signature: 'dummy_sig' });
    const res = await POST(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'MOTEUR_WEBHOOK_NOT_CONFIGURED');
  } finally {
    process.env.MOTEUR_WEBHOOK_SECRET = originalSecret;
  }
});

test('Webhook Route: Rejects requests missing signature header with HTTP 401', async () => {
  const req = createWebhookRequest({ event: 'test.ping' }, { signature: null });
  const res = await POST(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'MISSING_SIGNATURE_HEADER');
});

test('Webhook Route: Rejects tampered or invalid HMAC signature with HTTP 401', async () => {
  const payload = { event: 'test.ping' };
  const rawBody = JSON.stringify(payload);
  const wrongSignature = signPayload(rawBody, 'wrong_secret_key');
  const req = createWebhookRequest(payload, { signature: wrongSignature });
  const res = await POST(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_SIGNATURE');
});

test('Webhook Route: Rejects malformed JSON with HTTP 400', async () => {
  const malformedBody = '{"event": "test.ping", malformed';
  const sig = signPayload(malformedBody);
  const headers = new Headers({
    'content-type': 'application/json',
    'x-engine-signature': sig,
  });
  const req = new NextRequest('http://localhost:3000/api/v1/webhooks/moteur', {
    method: 'POST',
    headers,
    body: malformedBody,
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_JSON');
});

test('Webhook Route: Successfully accepts valid test.ping event with HTTP 200', async () => {
  const req = createWebhookRequest({
    event: 'test.ping',
    timestamp: new Date().toISOString(),
    app_code: TEST_APP_CODE,
  });
  const res = await POST(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.received, true);
  assert.equal(data.event, 'test.ping');
});

test('Webhook Route: Rejects payload with mismatched application code with HTTP 400', async () => {
  const req = createWebhookRequest({
    event: 'test.ping',
    app_code: 'unauthorized_external_saas',
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_APPLICATION_CODE');
});

test('Webhook Route: Confirms payment.completed successfully (HTTP 200)', async () => {
  const origConfirm = moteurService.handlePaymentConfirmation;
  try {
    moteurService.handlePaymentConfirmation = async (params) => {
      assert.equal(params.reference, 'ref_test_success_100');
      assert.equal(params.companyId, 'comp_123');
      assert.equal(params.amount, 50000);
      assert.equal(params.currency, 'XOF');
      return {
        success: true,
        isDuplicate: false,
        companyId: params.companyId,
        status: 'active',
        planId: 'flex',
        activatedModuleIds: ['invoicing'],
        reference: params.reference,
      };
    };

    const req = createWebhookRequest({
      event: 'payment.completed',
      occurred_at: new Date().toISOString(),
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_test_success_100',
        company_id: 'comp_123',
        amount: 50000,
        currency: 'XOF',
        payment_event_id: 'evt_pay_100',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.received, true);
    assert.equal(data.isDuplicate, false);
    assert.equal(data.reference, 'ref_test_success_100');
  } finally {
    moteurService.handlePaymentConfirmation = origConfirm;
  }
});

test('Webhook Route: Idempotently acknowledges duplicate payment.completed (HTTP 200)', async () => {
  const origConfirm = moteurService.handlePaymentConfirmation;
  try {
    moteurService.handlePaymentConfirmation = async (params) => {
      return {
        success: true,
        isDuplicate: true,
        companyId: params.companyId,
        status: 'active',
        planId: 'flex',
        activatedModuleIds: ['invoicing'],
        reference: params.reference,
        message: 'Payment already processed (idempotent)',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.completed',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_duplicate_200',
        company_id: 'comp_123',
        amount: 50000,
        currency: 'XOF',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.received, true);
    assert.equal(data.isDuplicate, true);
  } finally {
    moteurService.handlePaymentConfirmation = origConfirm;
  }
});

test('Webhook Route: Fails closed with HTTP 500 on database error during payment confirmation', async () => {
  const origConfirm = moteurService.handlePaymentConfirmation;
  try {
    moteurService.handlePaymentConfirmation = async (params) => {
      return {
        success: false,
        isDuplicate: false,
        companyId: params.companyId,
        status: 'cancelled',
        planId: 'starter',
        activatedModuleIds: [],
        reference: params.reference,
        code: 'DB_ERROR',
        message: 'Database error: Transaction aborted',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.completed',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_db_crash_500',
        company_id: 'comp_123',
        amount: 30000,
        currency: 'XOF',
      },
    });

    const res = await POST(req);
    // Transient/DB failures must return 500 so Moteur retries, not swallowed or returned as 200/400
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'DATABASE_TRANSACTION_FAILED');
  } finally {
    moteurService.handlePaymentConfirmation = origConfirm;
  }
});

test('Webhook Route: Rejects confirming already-terminated payment with HTTP 409', async () => {
  const origConfirm = moteurService.handlePaymentConfirmation;
  try {
    moteurService.handlePaymentConfirmation = async (params) => {
      return {
        success: false,
        isDuplicate: false,
        isInvalidTransition: true,
        companyId: params.companyId,
        status: 'cancelled',
        planId: 'starter',
        activatedModuleIds: [],
        reference: params.reference,
        code: 'PAYMENT_ALREADY_TERMINATED',
        message: 'Payment reference was terminated',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.completed',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_terminated_409',
        company_id: 'comp_123',
        amount: 30000,
        currency: 'XOF',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, 'INVALID_PAYMENT_STATE_TRANSITION');
  } finally {
    moteurService.handlePaymentConfirmation = origConfirm;
  }
});

test('Webhook Route: Processes payment.refunded successfully (HTTP 200, isPartial: true)', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      assert.equal(params.reference, 'ref_refund_success_100');
      assert.equal(params.refundAmount, 10000);
      return {
        success: true,
        isDuplicate: false,
        isPartial: true,
        refundedAmount: 10000,
        reference: params.reference,
        newPeriodEnd: new Date(Date.now() + 15 * 86400000).toISOString(),
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_refund_success_100',
        company_id: 'comp_123',
        refunded_amount: 10000,
        refunded_currency: 'XOF',
        refund_event_id: 'evt_ref_100',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.received, true);
    assert.equal(data.isDuplicate, false);
    assert.equal(data.isPartial, true);
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Acknowledges duplicate refund event idempotently (HTTP 200, isDuplicate: true)', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      return {
        success: true,
        isDuplicate: true,
        reference: params.reference,
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_refund_dup',
        company_id: 'comp_123',
        refunded_amount: 10000,
        refund_event_id: 'evt_ref_dup',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.received, true);
    assert.equal(data.isDuplicate, true);
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Durably quarantines out-of-order refund arriving before payment confirmation (HTTP 200)', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      return {
        success: true,
        isDuplicate: false,
        isUnmatched: true,
        reference: params.reference,
        message: 'Payment record unmatched; recorded to unmapped events awaiting payment confirmation.',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_unmatched_out_of_order',
        company_id: 'comp_123',
        refunded_amount: 10000,
        refund_event_id: 'evt_out_of_order',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.quarantined, true);
    assert.equal(data.status, 'unmatched_pending_payment');
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Conflicting refund payload is quarantined without ledger mutation (HTTP 200)', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      return {
        success: true,
        isDuplicate: false,
        isConflicting: true,
        reference: params.reference,
        message: 'Conflicting payload detected and quarantined without financial ledger mutation.',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_conflicting_replay',
        company_id: 'comp_123',
        refunded_amount: 99999,
        refund_event_id: 'evt_existing_conflict',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.quarantined, true);
    assert.equal(data.status, 'conflicting_payload_quarantined');
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Legacy payment with missing net amount is routed to manual review (HTTP 200)', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      return {
        success: true,
        isDuplicate: false,
        requiresManualReview: true,
        reference: params.reference,
        message: 'Payment record lacks verified net amount. Durably routed for manual finance reconciliation.',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_legacy_missing_net',
        company_id: 'comp_123',
        refunded_amount: 15000,
        refund_event_id: 'evt_legacy',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.quarantined, true);
    assert.equal(data.status, 'manual_reconciliation_required');
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Returns HTTP 500 when refund RPC fails with database error', async () => {
  const origRefund = moteurService.handlePaymentRefund;
  try {
    moteurService.handlePaymentRefund = async (params) => {
      return {
        success: false,
        isDuplicate: false,
        reference: params.reference,
        code: 'DB_ERROR',
        message: 'Database error: Transaction aborted',
      };
    };

    const req = createWebhookRequest({
      event: 'payment.refunded',
      app_code: TEST_APP_CODE,
      data: {
        reference: 'ref_refund_db_error',
        company_id: 'comp_123',
        refunded_amount: 10000,
        refund_event_id: 'evt_err',
      },
    });

    const res = await POST(req);
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'REFUND_PROCESSING_FAILED');
  } finally {
    moteurService.handlePaymentRefund = origRefund;
  }
});

test('Webhook Route: Rejects invalid refund parameters (zero or negative amount) with HTTP 400', async () => {
  const req = createWebhookRequest({
    event: 'payment.refunded',
    app_code: TEST_APP_CODE,
    data: {
      reference: 'ref_invalid_amount',
      company_id: 'comp_123',
      refunded_amount: -500,
      refund_event_id: 'evt_negative',
    },
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_REFUND_AMOUNT');
});

// ─── Mathematical Accounting & Invariant In-Memory Unit Tests ─────────────────

test('Accounting Invariants: Currency decimal places (0 for XOF/XAF/CDF, 2 for USD/EUR)', () => {
  assert.equal(getCurrencyDecimalPlaces('XOF'), 0);
  assert.equal(getCurrencyDecimalPlaces('XAF'), 0);
  assert.equal(getCurrencyDecimalPlaces('CDF'), 0);
  assert.equal(getCurrencyDecimalPlaces('USD'), 2);
  assert.equal(getCurrencyDecimalPlaces('EUR'), 2);
});

test('Accounting Invariants: Half-up rounding precision', () => {
  assert.equal(roundHalfUp(12.345, 'USD'), 12.35);
  assert.equal(roundHalfUp(12.344, 'USD'), 12.34);
  assert.equal(roundHalfUp(12.5, 'XOF'), 13);
  assert.equal(roundHalfUp(12.4, 'XOF'), 12);
  assert.equal(roundHalfUp(100.5, 'CDF'), 101);
});

test('Accounting Invariants: Proportional net deduction math matches provider contract', () => {
  // Gross: $100, Net: $96.50 (fee: $3.50). Partial refund: $50 gross.
  // Net deduction: (50 * 96.50) / 100 = 48.25
  const resUsd = calculateConfirmedNetDeduction({
    grossRefundAmount: 50,
    originalGrossAmount: 100,
    originalNetAmount: 96.5,
    currency: 'USD',
  });
  assert.equal(resUsd.netDeductionToApply, 48.25);
  assert.equal(resUsd.status, 'valid');

  // XOF Gross: 30,000, Net: 28,500. Partial refund: 10,000 gross.
  // Net deduction: (10,000 * 28,500) / 30,000 = 9,500
  const resXof = calculateConfirmedNetDeduction({
    grossRefundAmount: 10000,
    originalGrossAmount: 30000,
    originalNetAmount: 28500,
    currency: 'XOF',
  });
  assert.equal(resXof.netDeductionToApply, 9500);
  assert.equal(resXof.status, 'valid');
});

test('Accounting Invariants: Terminal refund reconciles accumulated rounding without exceeding original net', () => {
  // Cumulative net cannot exceed original verified net
  const originalGross = 100;
  const originalNet = 96.5;

  const res1 = calculateConfirmedNetDeduction({
    grossRefundAmount: 33.33,
    originalGrossAmount: originalGross,
    originalNetAmount: originalNet,
    cumulativeGrossRefunded: 0,
    cumulativeNetDeducted: 0,
    currency: 'USD',
  });

  const res2 = calculateConfirmedNetDeduction({
    grossRefundAmount: 33.33,
    originalGrossAmount: originalGross,
    originalNetAmount: originalNet,
    cumulativeGrossRefunded: res1.newCumulativeGross,
    cumulativeNetDeducted: res1.newCumulativeNet,
    currency: 'USD',
  });

  // Terminal refund for the remainder (33.34 gross):
  const resTerminal = calculateConfirmedNetDeduction({
    grossRefundAmount: 33.34,
    originalGrossAmount: originalGross,
    originalNetAmount: originalNet,
    cumulativeGrossRefunded: res2.newCumulativeGross,
    cumulativeNetDeducted: res2.newCumulativeNet,
    currency: 'USD',
  });

  assert.equal(resTerminal.isFinalRefund, true);
  assert.equal(resTerminal.roundingReconciled, true);
  assert.equal(resTerminal.newCumulativeGross, 100);
  assert.equal(resTerminal.newCumulativeNet, 96.5);
});
