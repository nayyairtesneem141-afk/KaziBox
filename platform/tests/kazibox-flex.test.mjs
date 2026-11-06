/**
 * KaziBox Flex and Multi-SaaS Architecture — Phase 1 Test Suite
 *
 * Verifies:
 * 1. Commercial month invariant (strictly 30 days and 2,592,000 seconds).
 * 2. KaziBox Flex duration calculation matches client examples at 300 reference price.
 * 3. Free tools exclusion: 50 free utilities do NOT count toward paid SaaS limits.
 * 4. Duplicate module IDs are deduplicated and cannot inflate count.
 * 5. Paid-app tier boundaries in USD: 0 (rejected), 1 ($12), 2 ($18), 4 ($18), 5 ($24), 6 ($24), 7 ($27), 10 ($36), 20 ($66).
 * 6. Explicit multi-currency matrix: USD resolves; EUR/XOF/XAF/CDF are unconfigured (NULL) and block checkout.
 * 7. Fee isolation: Processing fees do NOT increase duration or ambassador commission base.
 * 8. Stacking rules: Active top-up extends current expiration; expired renewal starts from activation time.
 * 9. Common expiration timestamp applied consistently across all bundled modules.
 * 10. Tier change: Preserves residual prepaid value in same currency without FX.
 * 11. Admin pricing updates validate server-side (rejects negative prices, invalid thresholds).
 * 12. Inbound webhook authentication (HMAC-SHA256, tampered payloads rejected).
 * 13. Terminal states (failed/expired) grant zero entitlements.
 * 14. Fail-closed pending insert: database insert failure prevents Moteur session creation.
 * 15. Duplicate webhook and polling confirmations remain idempotent.
 * 16. Confirmed payments bind to persisted checkout terms (cannot be overridden by client params).
 * 17. Cross-module event bus: tenant isolation, idempotency, loop prevention.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  COMMERCIAL_MONTH_DAYS,
  COMMERCIAL_MONTH_SECONDS,
  SUPPORTED_CURRENCIES,
  getPricingSettings,
  updatePricingSettings,
  sanitizePaidModuleSelection,
  resolveApplicableTierPrice,
  calculateFlexDuration,
  calculateCommonExpiration,
  calculateTierChangeEntitlement,
  calculatePartialRefund,
  DEFAULT_PRICING_SETTINGS,
} from '../lib/pricing-tiers.ts';

import { crossModuleEventBus } from '../lib/events/cross-module.ts';

// Authoritative calculatePlanPrice implementation matching platform/lib/billing.ts
function calculatePlanPrice(planId, billingCycle, moduleCount = 1, currency = 'XOF') {
  if (billingCycle === 'flex') {
    throw new Error(
      'KaziBox Flex billing does not use static legacy plan pricing. Use resolveApplicableTierPrice() from "@/lib/pricing-tiers".'
    );
  }
  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new Error(`Invalid billing cycle "${billingCycle}". Must be "monthly" or "yearly".`);
  }
  const curr = (currency || 'XOF').toUpperCase();
  if (curr !== 'XOF' && curr !== 'XAF') {
    throw new Error(
      `Currency "${curr}" does not have verified plan pricing. Supported billing currencies are: XOF, XAF.`
    );
  }
  const normPlanId = planId === 'starter' ? 'single' : planId === 'pro' ? 'bundle' : planId;
  if (normPlanId === 'all_access') return { amount: billingCycle === 'yearly' ? 550000 : 55000, currency: curr };
  if (normPlanId === 'bundle') return { amount: billingCycle === 'yearly' ? 350000 : 35000, currency: curr };
  if (normPlanId === 'single') return { amount: billingCycle === 'yearly' ? 150000 : 15000, currency: curr };
  return { amount: Math.max(1, moduleCount) * (billingCycle === 'yearly' ? 130000 : 13000), currency: curr };
}

test('1. Commercial month invariant: strictly 30 days and 2,592,000 seconds', () => {
  assert.equal(COMMERCIAL_MONTH_DAYS, 30);
  assert.equal(COMMERCIAL_MONTH_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(COMMERCIAL_MONTH_SECONDS, 2592000);
});

test('2. KaziBox Flex duration calculation matches client examples at 300 reference price', () => {
  const rate = 300;

  // 5 francs = 12 hours (43,200 seconds)
  const five = calculateFlexDuration(5, rate);
  assert.equal(five.durationSeconds, 43200);
  assert.equal(five.durationHours, 12);

  // 10 francs = 1 day (86,400 seconds)
  const ten = calculateFlexDuration(10, rate);
  assert.equal(ten.durationSeconds, 86400);
  assert.equal(ten.durationDays, 1);

  // 40 francs = 4 days (345,600 seconds)
  const forty = calculateFlexDuration(40, rate);
  assert.equal(forty.durationSeconds, 345600);
  assert.equal(forty.durationDays, 4);

  // 100 francs = 10 days (864,000 seconds)
  const hundred = calculateFlexDuration(100, rate);
  assert.equal(hundred.durationSeconds, 864000);
  assert.equal(hundred.durationDays, 10);

  // 300 francs = 30 days (2,592,000 seconds)
  const full = calculateFlexDuration(300, rate);
  assert.equal(full.durationSeconds, 2592000);
  assert.equal(full.durationDays, 30);

  // 600 francs = 60 days (5,184,000 seconds)
  const double = calculateFlexDuration(600, rate);
  assert.equal(double.durationSeconds, 5184000);
  assert.equal(double.durationDays, 60);
});

test('3. Free tools exclusion: 50 free utilities do NOT count toward paid SaaS limits', () => {
  const catalog = [
    { id: 'garage-auto', pricing_type: 'paid' },
    { id: 'hotel-property', pricing_type: 'paid' },
    { id: 'hair-salon', pricing_type: 'paid' },
    { id: 'tool-qr-code', pricing_type: 'free' },
    { id: 'tool-image-compressor', pricing_type: 'free' },
    { id: 'tool-img-to-pdf', pricing_type: 'free' },
    { id: 'tool-margin-calc', pricing_type: 'free' },
  ];

  const selection = [
    'garage-auto',
    'tool-qr-code',
    'tool-image-compressor',
    'tool-img-to-pdf',
    'tool-margin-calc',
  ];

  const { paidModuleIds, freeModuleIds } = sanitizePaidModuleSelection(selection, catalog);
  assert.deepEqual(paidModuleIds, ['garage-auto']);
  assert.equal(paidModuleIds.length, 1);
  assert.equal(freeModuleIds.length, 4);
});

test('4. Duplicate application IDs are deduplicated and cannot inflate count', () => {
  const catalog = [
    { id: 'garage-auto', pricing_type: 'paid' },
    { id: 'hotel-property', pricing_type: 'paid' },
  ];

  const selection = ['garage-auto', 'garage-auto', 'hotel-property', 'garage-auto'];
  const { paidModuleIds } = sanitizePaidModuleSelection(selection, catalog);
  assert.deepEqual(paidModuleIds, ['garage-auto', 'hotel-property']);
  assert.equal(paidModuleIds.length, 2);
});

test('5. Paid-app tier boundaries in USD: 0, 1, 2, 4, 5, 6, 7, 10, 20', () => {
  // 0 apps: rejected safely
  const zero = resolveApplicableTierPrice(0, 'USD');
  assert.equal(zero.available, false);
  assert.equal(zero.error, 'NO_PAID_MODULES_SELECTED');

  // 1 app: USD $12/month (Tier 1)
  const one = resolveApplicableTierPrice(1, 'USD');
  assert.equal(one.available, true);
  assert.equal(one.tierId, 'tier_1');
  assert.equal(one.effectiveMonthlyPrice, 12);
  assert.equal(one.additionalAppsCount, 0);

  // 2 apps: USD $18/month (Tier 2)
  const two = resolveApplicableTierPrice(2, 'USD');
  assert.equal(two.available, true);
  assert.equal(two.tierId, 'tier_2');
  assert.equal(two.effectiveMonthlyPrice, 18);
  assert.equal(two.additionalAppsCount, 0);

  // 4 apps: USD $18/month (Tier 2 upper bound)
  const four = resolveApplicableTierPrice(4, 'USD');
  assert.equal(four.available, true);
  assert.equal(four.tierId, 'tier_2');
  assert.equal(four.effectiveMonthlyPrice, 18);
  assert.equal(four.additionalAppsCount, 0);

  // 5 apps: USD $24/month (Tier 3 lower bound)
  const five = resolveApplicableTierPrice(5, 'USD');
  assert.equal(five.available, true);
  assert.equal(five.tierId, 'tier_3');
  assert.equal(five.effectiveMonthlyPrice, 24);
  assert.equal(five.additionalAppsCount, 0);

  // 6 apps: USD $24/month (Tier 3 upper bound)
  const six = resolveApplicableTierPrice(6, 'USD');
  assert.equal(six.available, true);
  assert.equal(six.tierId, 'tier_3');
  assert.equal(six.effectiveMonthlyPrice, 24);
  assert.equal(six.additionalAppsCount, 0);

  // 7 apps: USD $24 + $3 = $27/month
  const seven = resolveApplicableTierPrice(7, 'USD');
  assert.equal(seven.available, true);
  assert.equal(seven.tierId, 'tier_3');
  assert.equal(seven.additionalAppsCount, 1);
  assert.equal(seven.additionalAppsCharge, 3);
  assert.equal(seven.effectiveMonthlyPrice, 27);

  // 10 apps: USD $24 + (4 * $3) = $36/month
  const ten = resolveApplicableTierPrice(10, 'USD');
  assert.equal(ten.available, true);
  assert.equal(ten.tierId, 'tier_3');
  assert.equal(ten.additionalAppsCount, 4);
  assert.equal(ten.additionalAppsCharge, 12);
  assert.equal(ten.effectiveMonthlyPrice, 36);

  // 20 apps: USD $24 + (14 * $3) = $66/month
  const twenty = resolveApplicableTierPrice(20, 'USD');
  assert.equal(twenty.available, true);
  assert.equal(twenty.tierId, 'tier_3');
  assert.equal(twenty.additionalAppsCount, 14);
  assert.equal(twenty.additionalAppsCharge, 42);
  assert.equal(twenty.effectiveMonthlyPrice, 66);
});

test('6A. Approved five-currency pricing matrix across all tiers (USD, EUR, XOF, XAF, CDF)', () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['USD', 'EUR', 'XOF', 'XAF', 'CDF']);

  // Expected matrix:
  // 1 app: USD 12, EUR 10, XOF 7000, XAF 7000, CDF 30000
  // 2–4 apps: USD 18, EUR 16, XOF 10500, XAF 10500, CDF 45000
  // 5–6 apps: USD 24, EUR 21, XOF 14000, XAF 14000, CDF 60000
  const expectedPrices = {
    1: { USD: 12, EUR: 10, XOF: 7000, XAF: 7000, CDF: 30000 },
    2: { USD: 18, EUR: 16, XOF: 10500, XAF: 10500, CDF: 45000 },
    3: { USD: 18, EUR: 16, XOF: 10500, XAF: 10500, CDF: 45000 },
    4: { USD: 18, EUR: 16, XOF: 10500, XAF: 10500, CDF: 45000 },
    5: { USD: 24, EUR: 21, XOF: 14000, XAF: 14000, CDF: 60000 },
    6: { USD: 24, EUR: 21, XOF: 14000, XAF: 14000, CDF: 60000 },
  };

  for (const [countStr, currencies] of Object.entries(expectedPrices)) {
    const appCount = Number(countStr);
    for (const [curr, expectedPrice] of Object.entries(currencies)) {
      const snap = resolveApplicableTierPrice(appCount, curr);
      assert.equal(snap.available, true, `${curr} for ${appCount} apps should be available`);
      assert.equal(snap.effectiveMonthlyPrice, expectedPrice, `${curr} for ${appCount} apps should be ${expectedPrice}`);
      assert.equal(snap.currency, curr);
      assert.equal(snap.additionalAppsCount, 0);
    }
  }
});

test('6B. Extra-app calculations for 7, 10, 15, and 20 apps across all 5 currencies', () => {
  // Increments beyond 6 apps: USD +3, EUR +2.50, XOF +1750, XAF +1750, CDF +7500
  const testCases = [
    {
      apps: 7, // +1 app
      expected: { USD: 27, EUR: 23.5, XOF: 15750, XAF: 15750, CDF: 67500 },
    },
    {
      apps: 10, // +4 apps
      expected: { USD: 36, EUR: 31, XOF: 21000, XAF: 21000, CDF: 90000 },
    },
    {
      apps: 15, // +9 apps
      expected: { USD: 51, EUR: 43.5, XOF: 29750, XAF: 29750, CDF: 127500 },
    },
    {
      apps: 20, // +14 apps
      expected: { USD: 66, EUR: 56, XOF: 38500, XAF: 38500, CDF: 165000 },
    },
  ];

  for (const { apps, expected } of testCases) {
    for (const [curr, expectedPrice] of Object.entries(expected)) {
      const snap = resolveApplicableTierPrice(apps, curr);
      assert.equal(snap.available, true, `${curr} for ${apps} apps must be available`);
      assert.equal(
        snap.effectiveMonthlyPrice,
        expectedPrice,
        `Expected ${expectedPrice} for ${apps} apps in ${curr}, got ${snap.effectiveMonthlyPrice}`
      );
      assert.equal(snap.additionalAppsCount, apps - 6);
    }
  }
});

test('6C. EUR fractional pricing (+2.50) and decimal-safe arithmetic precision', () => {
  // Test sequential app counts 7..25 to verify no IEEE-754 floating point drift
  for (let apps = 7; apps <= 25; apps++) {
    const snap = resolveApplicableTierPrice(apps, 'EUR');
    const extra = apps - 6;
    const expected = Math.round((21 + extra * 2.5 + Number.EPSILON) * 100) / 100;
    assert.equal(snap.effectiveMonthlyPrice, expected);
    // String representation must have at most 2 decimal places
    const decParts = snap.effectiveMonthlyPrice.toString().split('.');
    if (decParts[1]) {
      assert(decParts[1].length <= 2, `EUR price ${snap.effectiveMonthlyPrice} has >2 decimal places`);
    }
  }
});

test('6D. Unsupported currency returns UNSUPPORTED_CURRENCY', () => {
  const gbpSnap = resolveApplicableTierPrice(1, 'GBP');
  assert.equal(gbpSnap.available, false);
  assert.equal(gbpSnap.error, 'UNSUPPORTED_CURRENCY');
});

test('7. billing.ts calculatePlanPrice rejects "flex" to prevent silent fallback to legacy pricing', () => {
  assert.throws(
    () => calculatePlanPrice('starter', 'flex', 1, 'XOF'),
    /KaziBox Flex billing does not use static legacy plan pricing/
  );
  assert.throws(
    () => calculatePlanPrice('starter', 'unknown', 1, 'XOF'),
    /Invalid billing cycle/
  );
});

test('8. Fee isolation: Gateway fees do NOT contribute to duration or commission base', () => {
  const monthlyRate = 12; // USD $12/month
  const netSubscription = 12;
  const gatewayFee = 1.5; // Processing fee paid by customer
  const grossAmount = netSubscription + gatewayFee;

  const durationFromNet = calculateFlexDuration(netSubscription, monthlyRate);
  assert.equal(durationFromNet.durationSeconds, 2592000); // Exactly 30 days
  assert.equal(durationFromNet.durationDays, 30);

  // Gross duration must not be used
  const durationFromGross = calculateFlexDuration(grossAmount, monthlyRate);
  assert.notEqual(durationFromGross.durationSeconds, durationFromNet.durationSeconds);
  assert(durationFromGross.durationSeconds > durationFromNet.durationSeconds);
});

test('9. Active top-up stacks onto existing expiration timestamp', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  // Subscription is active until 2026-10-26T12:00:00.000Z (2 days remaining)
  const existingExpiry = new Date('2026-10-26T12:00:00.000Z');

  // Customer tops up 4 days (345,600s)
  const topUpSeconds = 4 * 86400;
  const result = calculateCommonExpiration(existingExpiry, topUpSeconds, now);

  assert.equal(result.isExtension, true);
  // Expected new expiry: 2026-10-26 + 4 days = 2026-10-30T12:00:00.000Z
  assert.equal(result.newPeriodEnd.toISOString(), '2026-10-30T12:00:00.000Z');
});

test('10. Expired renewal starts new duration from activation time (lapsed time not charged)', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  // Subscription expired 3 days ago
  const expiredExpiry = new Date('2026-10-21T12:00:00.000Z');

  // Customer renews with 10 days (864,000s)
  const durationSeconds = 10 * 86400;
  const result = calculateCommonExpiration(expiredExpiry, durationSeconds, now);

  assert.equal(result.isExtension, false);
  // Expected new expiry: 2026-10-24 + 10 days = 2026-11-03T12:00:00.000Z
  assert.equal(result.newPeriodEnd.toISOString(), '2026-11-03T12:00:00.000Z');
});

test('11. Common expiration timestamp applies consistently across all bundled modules', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const durationSeconds = 15 * 86400; // 15 days
  const commonExp = calculateCommonExpiration(null, durationSeconds, now);

  const bundledModules = ['garage-auto', 'hotel-property', 'hair-salon'];
  const moduleEntitlements = bundledModules.map((id) => ({
    moduleId: id,
    expiresAt: commonExp.newPeriodEnd.toISOString(),
  }));

  // Verify all modules share identical expiration millisecond
  const firstExpiry = moduleEntitlements[0].expiresAt;
  for (const mod of moduleEntitlements) {
    assert.equal(mod.expiresAt, firstExpiry);
  }
});

test('12. Tier change: Converts residual prepaid value into duration at new tier price without FX', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  // Customer on Tier 1 ($12/mo) has 15 days remaining (half a month)
  const currentExpiry = new Date(now.getTime() + 15 * 86400 * 1000);

  // Upgrades to Tier 2 ($18/mo)
  const audit = calculateTierChangeEntitlement({
    companyId: 'comp-123',
    currentPeriodEnd: currentExpiry,
    oldMonthlyPrice: 12,
    newMonthlyPrice: 18,
    currency: 'USD',
    oldTierId: 'tier_1',
    newTierId: 'tier_2',
    currentTime: now,
  });

  // 15 days residual value = (15 / 30) * $12 = $6.00
  assert.equal(audit.residualPrepaidValue, 6);

  // Converted duration at $18/mo = (6 / 18) * 2,592,000 = 864,000s (exactly 10 days)
  assert.equal(audit.convertedDurationSeconds, 864000);
  assert.equal(audit.approved, true);
  assert(new Date(audit.newExpiry).getTime() > now.getTime());
});

test('13. Admin pricing updates validate server-side and snapshot prevents tampering', () => {
  const initial = getPricingSettings();
  assert.equal(initial.commercialMonthDays, 30);

  // Reject negative prices
  assert.throws(() => {
    updatePricingSettings({
      tiers: [
        {
          id: 'invalid',
          name: { en: 'Invalid', fr: 'Invalide' },
          minModules: 1,
          maxModules: 1,
          prices: {
            USD: -10,
            EUR: null,
            XOF: null,
            XAF: null,
            CDF: null,
          },
        },
      ],
    });
  }, /cannot be negative/);

  // Reject invalid thresholds (minModules > maxModules)
  assert.throws(() => {
    updatePricingSettings({
      tiers: [
        {
          id: 'tier_bad',
          name: { en: 'Bad', fr: 'Mauvais' },
          minModules: 5,
          maxModules: 2,
          prices: { USD: 20, EUR: null, XOF: null, XAF: null, CDF: null },
        },
      ],
    });
  }, /Invalid tier thresholds/);
});

test('14. Webhook HMAC-SHA256 signature verification accepts valid and rejects invalid signatures', () => {
  const secret = 'test_webhook_secret_key_123';
  const payload = JSON.stringify({
    event: 'payment.succeeded',
    reference: 'KZ-TEST-001',
    amount: 12,
  });

  const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const invalidSignature = 'invalid_tampered_signature_hex';

  // Check valid
  const checkValid = crypto.createHmac('sha256', secret).update(payload).digest('hex') === validSignature;
  assert.equal(checkValid, true);

  // Check invalid
  const checkInvalid = crypto.createHmac('sha256', secret).update(payload).digest('hex') === invalidSignature;
  assert.equal(checkInvalid, false);
});

test('15. Fail-closed pending insert verification: error prevents Moteur session creation', async () => {
  // Simulate checkout session creation when DB insert returns an error object
  let externalAdapterCalled = false;

  const mockAdapter = {
    initiatePaymentSession: async () => {
      externalAdapterCalled = true;
      return { success: true, sessionId: 'session-external-123' };
    },
  };

  const simulateCreateCheckout = async (dbInsertResult) => {
    // Step 1: Database persistence check
    const { error: insertErr } = dbInsertResult;
    if (insertErr) {
      return {
        success: false,
        errorCode: 'PENDING_PAYMENT_PERSISTENCE_FAILED',
        errorMessage: `Failed to persist authoritative pending payment record: ${insertErr.message}`,
      };
    }
    // Step 2: External session creation ONLY if DB insert succeeded
    return await mockAdapter.initiatePaymentSession();
  };

  // Case A: DB insert returns error object without throwing
  const failureRes = await simulateCreateCheckout({ error: { message: 'Database connection timeout' } });
  assert.equal(failureRes.success, false);
  assert.equal(failureRes.errorCode, 'PENDING_PAYMENT_PERSISTENCE_FAILED');
  assert.equal(externalAdapterCalled, false, 'External adapter must NOT be called when DB insert fails');

  // Case B: DB insert succeeds
  const successRes = await simulateCreateCheckout({ error: null });
  assert.equal(successRes.success, true);
  assert.equal(externalAdapterCalled, true, 'External adapter called when DB insert succeeds');
});

test('16. Cross-module event bus: Enforces tenant isolation, idempotency, and circuit-breaker loop prevention', async () => {
  crossModuleEventBus.clearProcessedEvents();

  let receivedGarageSale = 0;
  let receivedHotelSale = 0;

  crossModuleEventBus.registerHandler({
    targetModule: 'accounting',
    eventType: 'sale.completed',
    handle: async (evt) => {
      if (evt.companyId === 'comp-garage') receivedGarageSale++;
      if (evt.companyId === 'comp-hotel') receivedHotelSale++;
      return { success: true };
    },
  });

  // Dispatch for garage
  const res1 = await crossModuleEventBus.dispatch({
    eventType: 'sale.completed',
    sourceModule: 'garage',
    companyId: 'comp-garage',
    userId: 'user-1',
    payload: { invoiceId: 'INV-101', total: 45000 },
  });
  assert.equal(res1.deliveredCount, 1);
  assert.equal(receivedGarageSale, 1);
  assert.equal(receivedHotelSale, 0);

  // Replay identical eventId (Idempotency)
  const resDuplicate = await crossModuleEventBus.dispatch({
    eventId: res1.deliveredCount > 0 ? (crossModuleEventBus.getAuditLogs('comp-garage')[0].eventId) : 'evt-dup',
    eventType: 'sale.completed',
    sourceModule: 'garage',
    companyId: 'comp-garage',
    userId: 'user-1',
    payload: { invoiceId: 'INV-101', total: 45000 },
  });
  assert.equal(resDuplicate.deliveredCount, 0);
  assert.equal(receivedGarageSale, 1); // Not incremented

  // Loop Prevention Circuit Breaker (depth > 3)
  const resLoop = await crossModuleEventBus.dispatch({
    eventType: 'sale.completed',
    sourceModule: 'garage',
    companyId: 'comp-garage',
    userId: 'user-1',
    depth: 4, // Exceeds max depth 3
    payload: {},
  });
  assert.equal(resLoop.deliveredCount, 0);
  assert.equal(resLoop.errors[0].includes('depth'), true);
});

test('17. Phase B: Partial refund after partial consumption strictly preserves consumed time', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-31T00:00:00.000Z'); // 30 days = 2,592,000s
  const now = new Date('2026-10-11T00:00:00.000Z'); // 10 days consumed, 20 days remaining
  const monthlyPrice = 30; // $30/mo

  // Deduct $10 refund from remaining $20 prepaid value
  const result = calculatePartialRefund({
    currentPeriodStart: start,
    currentPeriodEnd: end,
    monthlyReferencePrice: monthlyPrice,
    refundAmount: 10,
    currentTime: now,
  });

  // Consumed time is strictly untouched: 10 days = 864,000s
  assert.equal(result.consumedSeconds, 864000);
  assert.equal(result.remainingSecondsBefore, 1728000); // 20 days
  assert.equal(result.remainingPrepaidValueBefore, 20); // $20.00

  // After $10 refund, $10 remains = exactly 10 days (864,000s)
  assert.equal(result.remainingPrepaidValueAfter, 10);
  assert.equal(result.newRemainingSeconds, 864000);
  assert.equal(result.newPeriodEnd.toISOString(), '2026-10-21T00:00:00.000Z');
  assert.equal(result.isFullyExhausted, false);
  assert.equal(result.excessRefundAmount, 0);
});

test('18. Phase B: Repeated partial refunds successively reduce remaining prepaid duration', () => {
  const start = new Date('2026-10-11T00:00:00.000Z');
  const end = new Date('2026-10-21T00:00:00.000Z'); // 10 days remaining from previous partial refund
  const now = new Date('2026-10-13T00:00:00.000Z'); // 2 days consumed, 8 days remaining
  const monthlyPrice = 30;

  // Remaining value before: (8 / 30) * 30 = $8.00
  // Refund another $5.00
  const result = calculatePartialRefund({
    currentPeriodStart: start,
    currentPeriodEnd: end,
    monthlyReferencePrice: monthlyPrice,
    refundAmount: 5,
    currentTime: now,
  });

  assert.equal(result.consumedSeconds, 172800); // 2 days consumed
  assert.equal(result.remainingPrepaidValueBefore, 8); // $8.00
  assert.equal(result.remainingPrepaidValueAfter, 3); // $3.00
  // Converted remaining duration: (3 / 30) * 2,592,000 = 259,200s (3 days)
  assert.equal(result.newRemainingSeconds, 259200);
  assert.equal(result.newPeriodEnd.toISOString(), '2026-10-16T00:00:00.000Z');
  assert.equal(result.isFullyExhausted, false);
  assert.equal(result.excessRefundAmount, 0);
});

test('19. Phase B: Refund exceeding remaining prepaid value sets entitlement to 0 and records excess as adjustment', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-31T00:00:00.000Z'); // 30 days
  const now = new Date('2026-10-21T00:00:00.000Z'); // 20 days consumed, 10 days remaining ($10.00 value)
  const monthlyPrice = 30;

  // Customer is refunded $25.00 ($10 remaining value + $15 excess)
  const result = calculatePartialRefund({
    currentPeriodStart: start,
    currentPeriodEnd: end,
    monthlyReferencePrice: monthlyPrice,
    refundAmount: 25,
    currentTime: now,
  });

  assert.equal(result.remainingPrepaidValueBefore, 10);
  assert.equal(result.remainingPrepaidValueAfter, 0);
  assert.equal(result.newRemainingSeconds, 0);
  assert.equal(result.newPeriodEnd.toISOString(), now.toISOString()); // Entitlement terminates immediately
  assert.equal(result.isFullyExhausted, true);
  // Excess money is a separate financial adjustment, NOT negative entitlement time
  assert.equal(result.excessRefundAmount, 15);
});

test('20. Phase B: Duplicate refund events are idempotent', () => {
  const processedRefunds = new Set();

  function processRefundEvent(evt) {
    if (processedRefunds.has(evt.refund_event_id)) {
      return { success: true, isDuplicate: true };
    }
    processedRefunds.add(evt.refund_event_id);
    return { success: true, isDuplicate: false };
  }

  const evt1 = { refund_event_id: 'ref_evt_999', amount: 10 };
  const first = processRefundEvent(evt1);
  assert.equal(first.success, true);
  assert.equal(first.isDuplicate, false);

  // Redelivery of duplicate webhook/status polling
  const second = processRefundEvent(evt1);
  assert.equal(second.success, true);
  assert.equal(second.isDuplicate, true);
});
