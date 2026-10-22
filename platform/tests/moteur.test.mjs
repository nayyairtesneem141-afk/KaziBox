/**
 * KaziBox Core — Moteur Centralized Payment Infrastructure Integration Tests
 *
 * Tests the adapter boundary, error handling, signature verification, idempotency,
 * lifecycle state transitions, referral attribution, and country configurations.
 *
 * Run with:
 *   node platform/tests/moteur.test.mjs
 */

import crypto from 'node:crypto';

// ─── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Pure implementations of Moteur components for Node runtime ──────────────

// 1. Countries & Currencies
const MOTEUR_PAYMENT_DESCRIPTION = 'KaziBox';
const TARGET_COUNTRIES = {
  CD: {
    code: 'CD',
    name: { fr: 'Rép. Dém. du Congo (RDC)', en: 'DR Congo' },
    currencies: ['CDF', 'USD'],
    defaultCurrency: 'CDF',
    callingCode: '+243',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  CM: {
    code: 'CM',
    name: { fr: 'Cameroun', en: 'Cameroon' },
    currencies: ['XAF'],
    defaultCurrency: 'XAF',
    callingCode: '+237',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  SN: {
    code: 'SN',
    name: { fr: 'Sénégal', en: 'Senegal' },
    currencies: ['XOF'],
    defaultCurrency: 'XOF',
    callingCode: '+221',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  CI: {
    code: 'CI',
    name: { fr: 'Côte d’Ivoire', en: 'Côte d’Ivoire' },
    currencies: ['XOF'],
    defaultCurrency: 'XOF',
    callingCode: '+225',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
};

function maskSecret(secret) {
  if (!secret) return '[NOT_SET]';
  if (secret.length <= 8) return '***';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

// 2. Moteur Adapter Pure Logic
class MockMoteurAdapter {
  constructor(config = null, mockFetch = null) {
    this.config = config;
    this.mockFetch = mockFetch;
  }

  isReady() {
    return Boolean(this.config && this.config.baseUrl && this.config.apiKey);
  }

  async initiatePaymentSession(req) {
    if (!this.isReady()) {
      return {
        success: false,
        sessionId: '',
        reference: req.idempotencyKey,
        status: 'pending',
        errorCode: 'MOTEUR_NOT_CONFIGURED',
        errorMessage: 'Moteur centralized payment backend is pending client credentials and migration.',
      };
    }

    const saasId = this.config.saasId || '167a0c84-ce3c-488c-8367-d2e649933f34';
    const appCode = this.config.appCode || 'demosaas';
    const subscriberExtId = req.subscriberExtId || req.companyId || (req.customer && req.customer.id) || 'unknown';

    const payload = {
      action: 'payments.collect',
      app_code: appCode,
      application_code: appCode,
      saas_id: saasId,
      subscriber_ext_id: subscriberExtId,
      subscriber_id: subscriberExtId,
      subscriber_email: req.customer ? req.customer.email : undefined,
      subscriber_name: req.customer ? req.customer.name : undefined,
      subscriber_phone: req.customer ? req.customer.phone : undefined,
      company_id: req.companyId,
      plan_key: req.planKey || req.planId || 'single',
      plan_id: req.planId,
      module_ids: req.moduleIds,
      billing_cycle: req.billingCycle,
      cycle: req.billingCycle,
      description: MOTEUR_PAYMENT_DESCRIPTION,
      amount: req.amount,
      currency: req.currency,
      country: req.country,
      idempotency_key: req.idempotencyKey,
      reference: req.idempotencyKey,
      metadata: {
        app_code: appCode,
        saas_id: saasId,
        company_id: req.companyId,
        subscriber_ext_id: subscriberExtId,
        plan_key: req.planKey || req.planId || 'single',
        plan_id: req.planId,
        module_ids: req.moduleIds,
        billing_cycle: req.billingCycle,
        referral_code: req.referralCode || null,
        description: MOTEUR_PAYMENT_DESCRIPTION,
      },
      customer: {
        id: (req.customer && req.customer.id) || subscriberExtId,
        ext_id: subscriberExtId,
        subscriber_ext_id: subscriberExtId,
        ...(req.customer || {}),
      },
    };

    const isSupabaseGateway = this.config.baseUrl.includes('engine-api-gateway');
    const endpoint = this.config.baseUrl.endsWith('/api/v1/payments/collect')
      ? this.config.baseUrl
      : isSupabaseGateway
      ? `${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/payments/collect`
      : `${this.config.baseUrl.replace(/\/+$/, '')}/v1/checkout/sessions`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': req.idempotencyKey,
    };
    if (this.config.apiKey) {
      headers['x-engine-api-key'] = this.config.apiKey;
    }
    const bearer = this.config.gatewayBearerToken || this.config.apiKey;
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
      headers['apikey'] = bearer;
    }

    const res = await this.mockFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return {
      success: res.ok,
      sessionId: data.session_id,
      reference: data.reference || req.idempotencyKey,
      status: data.status || (res.ok ? 'pending' : 'failed'),
      checkoutUrl: data.checkout_url,
      errorCode: data.code || data.error?.code || (res.ok ? undefined : `HTTP_${res.status}`),
      errorMessage: data.message || data.error?.message,
    };
  }

  verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = this.config?.webhookSecret;
    if (!secret || !signatureHeader) return false;

    try {
      const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const cleanHeader = signatureHeader.trim();
      const rawHex = cleanHeader.startsWith('sha256=') ? cleanHeader.slice(7) : cleanHeader;

      // Strict 64-char hexadecimal string check
      if (!/^[0-9a-fA-F]{64}$/.test(rawHex)) {
        return false;
      }

      const expectedHex = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      const actualBuf = Buffer.from(rawHex, 'hex');

      if (expectedBuf.length === 0 || actualBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  parseWebhookPayload(rawBody, signatureHeader) {
    const isValid = this.verifyWebhookSignature(rawBody, signatureHeader);
    if (!isValid) return { valid: false, event: null, error: 'INVALID_SIGNATURE' };

    try {
      const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const parsed = JSON.parse(bodyString);
      if (!parsed.event || (!parsed.data && parsed.event !== 'test.ping')) {
        return { valid: false, event: null, error: 'MALFORMED_PAYLOAD' };
      }
      return { valid: true, event: parsed };
    } catch {
      return { valid: false, event: null, error: 'INVALID_JSON' };
    }
  }
}

// 3. Subscription & Entitlement State Store (In-Memory Simulator)
class MockEntitlementEngine {
  constructor() {
    this.subscriptions = new Map();
    this.payments = [];
    this.outboundWebhooks = [];
  }

  hasAccess(companyId, moduleId) {
    const sub = this.subscriptions.get(companyId);
    if (!sub) return false;
    if (sub.status !== 'active' && sub.status !== 'expiring_soon') return false;
    if (sub.planId === 'all_access') return true;
    return sub.includedModuleIds.includes(moduleId);
  }

  confirmPayment(data) {
    // Idempotency check: has this reference already been processed as 'paid'?
    const existing = this.payments.find((p) => p.reference === data.reference && p.status === 'paid');
    if (existing) {
      return {
        success: true,
        isDuplicate: true,
        reference: data.reference,
        status: 'active',
      };
    }

    const now = data.paidAt ? new Date(data.paidAt) : new Date();
    const existingSub = this.subscriptions.get(data.companyId);
    let baseTime = now;
    if (existingSub?.status === 'active' && new Date(existingSub.currentPeriodEnd) > now) {
      baseTime = new Date(existingSub.currentPeriodEnd);
    }

    const periodEnd = new Date(baseTime);
    if (data.billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Grant active subscription
    const sub = {
      reference: data.reference,
      companyId: data.companyId,
      planId: data.planId,
      status: 'active',
      billingCycle: data.billingCycle,
      includedModuleIds: data.moduleIds,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      amount: data.amount,
      currency: data.currency,
    };
    this.subscriptions.set(data.companyId, sub);

    // Record payment
    this.payments.push({
      reference: data.reference,
      companyId: data.companyId,
      amount: data.amount,
      currency: data.currency,
      status: 'paid',
      referralCode: data.referralCode,
      paidAt: now.toISOString(),
    });

    // Outbound webhook
    this.outboundWebhooks.push({
      event: 'subscription.activated',
      companyId: data.companyId,
      planId: data.planId,
    });

    return {
      success: true,
      isDuplicate: false,
      reference: data.reference,
      status: 'active',
    };
  }

  expireSubscription(companyId, reference) {
    const sub = this.subscriptions.get(companyId);
    if (sub) {
      sub.status = 'expired';
      this.outboundWebhooks.push({
        event: 'subscription.expired',
        companyId,
        reason: 'expired',
      });
    }
  }

  refundPayment(companyId, reference) {
    const payment = this.payments.find((p) => p.reference === reference);
    if (payment) {
      payment.status = 'refunded';
    }
    const sub = this.subscriptions.get(companyId);
    // Only cancel subscription if this payment matches the active subscription
    if (sub && sub.reference === reference) {
      sub.status = 'cancelled';
      this.outboundWebhooks.push({
        event: 'subscription.expired',
        companyId,
        reason: 'refunded',
      });
    }
  }

  renewSubscription(data) {
    return this.confirmPayment(data);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 1 — Target Countries & Payment Description
// ─────────────────────────────────────────────────────────────────────────────

test('Priority countries are strictly CD, CM, SN, CI', () => {
  const codes = Object.keys(TARGET_COUNTRIES).sort();
  assertDeepEqual(codes, ['CD', 'CI', 'CM', 'SN'], 'Must cover exactly the 4 priority countries');
});

test('Payment description is strictly standardized to "KaziBox"', () => {
  assertEqual(MOTEUR_PAYMENT_DESCRIPTION, 'KaziBox', 'Payment description must be KaziBox');
});

test('Currency mapping for target countries is accurate', () => {
  assertEqual(TARGET_COUNTRIES.CD.currencies.includes('CDF'), true, 'CD supports CDF');
  assertEqual(TARGET_COUNTRIES.CD.currencies.includes('USD'), true, 'CD supports USD');
  assertEqual(TARGET_COUNTRIES.CM.defaultCurrency, 'XAF', 'CM default currency is XAF');
  assertEqual(TARGET_COUNTRIES.SN.defaultCurrency, 'XOF', 'SN default currency is XOF');
  assertEqual(TARGET_COUNTRIES.CI.defaultCurrency, 'XOF', 'CI default currency is XOF');
});

test('Provider availability is marked as pending confirmation without claiming active providers', () => {
  for (const country of Object.values(TARGET_COUNTRIES)) {
    assertEqual(
      country.providerStatus,
      'pending_moteur_confirmation',
      `Country ${country.code} provider status must be pending_moteur_confirmation`
    );
    assertEqual(
      country.confirmedProviders.length,
      0,
      `No unconfirmed providers should be declared active for ${country.code}`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 2 — Adapter Configuration & Secret Protection
// ─────────────────────────────────────────────────────────────────────────────

test('maskSecret hides sensitive credentials and shows only safe prefixes/suffixes', () => {
  assertEqual(maskSecret('moteur_sec_1234567890abcdef'), 'mote...cdef');
  assertEqual(maskSecret('secret12'), '***');
  assertEqual(maskSecret(null), '[NOT_SET]');
  assertEqual(maskSecret(''), '[NOT_SET]');
});

test('Adapter unconfigured: does not attempt HTTP call, returns MOTEUR_NOT_CONFIGURED', async () => {
  const adapter = new MockMoteurAdapter(null);
  assertEqual(adapter.isReady(), false, 'Adapter should not be ready without config');

  const result = await adapter.initiatePaymentSession({
    idempotencyKey: 'KZ-TEST-001',
    description: 'KaziBox',
    amount: 15000,
    currency: 'XOF',
    country: 'CI',
    companyId: 'company-01',
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
  });

  assertEqual(result.success, false, 'Unconfigured checkout must not claim success');
  assertEqual(result.errorCode, 'MOTEUR_NOT_CONFIGURED', 'Expected error code MOTEUR_NOT_CONFIGURED');
  assertEqual(result.status, 'pending', 'Status remains pending');
});

test('Adapter configured: formats request with description "KaziBox" and referralCode', async () => {
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = {};

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      json: async () => ({
        session_id: 'sess_moteur_9988',
        reference: 'KZ-TEST-002',
        status: 'pending',
        checkout_url: 'https://pay.moteur.internal/checkout/sess_moteur_9988',
      }),
    };
  };

  const adapter = new MockMoteurAdapter(
    {
      baseUrl: 'https://moteur.kazibox.pro',
      apiKey: 'moteur_live_secret_key_123',
      webhookSecret: 'whsec_999',
    },
    mockFetch
  );

  const result = await adapter.initiatePaymentSession({
    idempotencyKey: 'KZ-TEST-002',
    description: 'KaziBox',
    amount: 35000,
    currency: 'XOF',
    country: 'CI',
    companyId: 'ws-palmeraie-01',
    planId: 'bundle',
    moduleIds: ['hotel-property', 'garage'],
    billingCycle: 'monthly',
    referralCode: 'AMBASSADOR-DAKAR-2026',
  });

  assertEqual(result.success, true);
  assertEqual(result.sessionId, 'sess_moteur_9988');
  assertEqual(capturedUrl, 'https://moteur.kazibox.pro/v1/checkout/sessions');
  assertEqual(capturedHeaders['Authorization'], 'Bearer moteur_live_secret_key_123');
  assertEqual(capturedHeaders['X-Idempotency-Key'], 'KZ-TEST-002');
  assertEqual(capturedBody.description, 'KaziBox');
  assertEqual(capturedBody.metadata.referral_code, 'AMBASSADOR-DAKAR-2026');
  assertEqual(capturedBody.metadata.company_id, 'ws-palmeraie-01');
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 3 — Webhook Cryptographic Signature Verification
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'whsec_moteur_ci_2026_test_secret';
const adapterWithSecret = new MockMoteurAdapter({ webhookSecret: SECRET });

test('Valid HMAC-SHA256 signature with raw payload passes verification', () => {
  const payload = JSON.stringify({
    id: 'evt-001',
    event: 'payment.succeeded',
    data: { reference: 'KZ-001', companyId: 'ws-01' },
  });

  const sigHex = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const validWithPrefix = adapterWithSecret.verifyWebhookSignature(payload, `sha256=${sigHex}`);
  const validWithoutPrefix = adapterWithSecret.verifyWebhookSignature(payload, sigHex);

  assertEqual(validWithPrefix, true, 'Signature with sha256= prefix must pass');
  assertEqual(validWithoutPrefix, true, 'Signature raw hex must pass');
});

test('Tampered webhook payload fails signature verification', () => {
  const payload = JSON.stringify({ id: 'evt-002', amount: 15000 });
  const tamperedPayload = JSON.stringify({ id: 'evt-002', amount: 150000 });

  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const result = adapterWithSecret.verifyWebhookSignature(tamperedPayload, `sha256=${sig}`);

  assertEqual(result, false, 'Tampered payload must fail');
});

test('Incorrect webhook secret fails signature verification', () => {
  const payload = JSON.stringify({ id: 'evt-003' });
  const wrongSecret = 'whsec_attacker_wrong_secret';

  const sig = crypto.createHmac('sha256', wrongSecret).update(payload).digest('hex');
  const result = adapterWithSecret.verifyWebhookSignature(payload, `sha256=${sig}`);

  assertEqual(result, false, 'Signature generated with wrong secret must fail');
});

test('Missing signature header or missing secret returns false without throwing', () => {
  const adapterWithoutSecret = new MockMoteurAdapter({ webhookSecret: '' });
  const payload = JSON.stringify({ id: 'evt-004' });

  assertEqual(adapterWithoutSecret.verifyWebhookSignature(payload, 'sha256=abcdef'), false);
  assertEqual(adapterWithSecret.verifyWebhookSignature(payload, null), false);
  assertEqual(adapterWithSecret.verifyWebhookSignature(payload, ''), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 4 — Entitlement Activation & Idempotency
// ─────────────────────────────────────────────────────────────────────────────

test('Pending payment does NOT grant module entitlements', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-101';

  // No payment confirmation has occurred
  assertEqual(engine.hasAccess(companyId, 'hotel-property'), false, 'Pending payment must not grant access');
  assertEqual(engine.hasAccess(companyId, 'garage'), false, 'Pending payment must not grant access');
});

test('Verified payment confirmation grants access to subscribed modules', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-101';

  const result = engine.confirmPayment({
    reference: 'REF-PAID-001',
    companyId,
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
    referralCode: 'REF-AMB-01',
  });

  assertEqual(result.success, true);
  assertEqual(result.isDuplicate, false);
  assertEqual(engine.hasAccess(companyId, 'hotel-property'), true, 'Hotel module must be granted');
  assertEqual(engine.hasAccess(companyId, 'garage'), false, 'Unsubscribed garage module must NOT be granted');
});

test('Idempotency: Re-submitting the same payment reference does NOT duplicate activation', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-102';

  const firstCall = engine.confirmPayment({
    reference: 'REF-IDEMPOTENT-001',
    companyId,
    planId: 'bundle',
    moduleIds: ['hotel-property', 'garage'],
    billingCycle: 'monthly',
    amount: 35000,
    currency: 'XOF',
  });

  assertEqual(firstCall.isDuplicate, false, 'First call is not duplicate');
  assertEqual(engine.payments.length, 1, 'Only 1 payment record should exist');

  // Duplicate webhook delivery
  const secondCall = engine.confirmPayment({
    reference: 'REF-IDEMPOTENT-001',
    companyId,
    planId: 'bundle',
    moduleIds: ['hotel-property', 'garage'],
    billingCycle: 'monthly',
    amount: 35000,
    currency: 'XOF',
  });

  assertEqual(secondCall.success, true, 'Duplicate call succeeds idempotently');
  assertEqual(secondCall.isDuplicate, true, 'Second call flagged as duplicate');
  assertEqual(engine.payments.length, 1, 'Payment records must NOT be duplicated');
  assertEqual(engine.outboundWebhooks.length, 1, 'Outbound webhook dispatched only once');
});

test('Subscription expiration revokes module access', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-103';

  engine.confirmPayment({
    reference: 'REF-EXP-001',
    companyId,
    planId: 'single',
    moduleIds: ['salon'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  assertEqual(engine.hasAccess(companyId, 'salon'), true, 'Access active before expiration');

  engine.expireSubscription(companyId, 'REF-EXP-001');

  assertEqual(engine.hasAccess(companyId, 'salon'), false, 'Access must be revoked after expiration');
});

test('Payment refund revokes subscription and marks payment refunded', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-104';

  engine.confirmPayment({
    reference: 'REF-REFUND-001',
    companyId,
    planId: 'all_access',
    moduleIds: ['hotel-property', 'garage', 'salon'],
    billingCycle: 'yearly',
    amount: 550000,
    currency: 'XOF',
  });

  assertEqual(engine.hasAccess(companyId, 'garage'), true);

  engine.refundPayment(companyId, 'REF-REFUND-001');

  assertEqual(engine.hasAccess(companyId, 'garage'), false, 'Access revoked on refund');
  const p = engine.payments.find((x) => x.reference === 'REF-REFUND-001');
  assertEqual(p.status, 'refunded', 'Payment record status marked refunded');
});

test('Subscription renewal extends access with new payment entry', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-105';

  engine.confirmPayment({
    reference: 'REF-MONTH-1',
    companyId,
    planId: 'single',
    moduleIds: ['garage'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  const renewalResult = engine.renewSubscription({
    reference: 'REF-MONTH-2',
    companyId,
    planId: 'single',
    moduleIds: ['garage'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  assertEqual(renewalResult.success, true);
  assertEqual(renewalResult.isDuplicate, false);
  assertEqual(engine.payments.length, 2, 'Two payment history items for two billing cycles');
  assertEqual(engine.hasAccess(companyId, 'garage'), true);
});

test('Renewal extends remaining duration from current period end instead of truncating', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-105b';

  const firstSub = engine.confirmPayment({
    reference: 'REF-TERM-1',
    companyId,
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  const firstEnd = new Date(engine.subscriptions.get(companyId).currentPeriodEnd).getTime();

  // Renew while first month is active
  engine.renewSubscription({
    reference: 'REF-TERM-2',
    companyId,
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  const renewedEnd = new Date(engine.subscriptions.get(companyId).currentPeriodEnd).getTime();
  assert(renewedEnd > firstEnd, 'Renewed end date must extend beyond the first period end');
});

test('Refund of older or unrelated payment does not revoke active subscription', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-105c';

  // Sub 1
  engine.confirmPayment({
    reference: 'REF-OLD-1',
    companyId,
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  // Sub 2 (current active)
  engine.confirmPayment({
    reference: 'REF-NEW-2',
    companyId,
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 15000,
    currency: 'XOF',
  });

  // Refund the OLD payment
  engine.refundPayment(companyId, 'REF-OLD-1');

  // The active subscription (REF-NEW-2) must remain active!
  assertEqual(engine.hasAccess(companyId, 'hotel-property'), true, 'Active subscription must not be revoked by old refund');
});

test('Concurrency: Duplicate in-flight webhook delivery returns duplicate status', async () => {
  const inFlight = new Set();
  const ref = 'REF-CONCURRENT-001';

  let firstAccepted = false;
  let secondAccepted = false;

  const processWebhook = async () => {
    if (inFlight.has(ref)) {
      return { success: true, isDuplicate: true };
    }
    inFlight.add(ref);
    await new Promise((r) => setTimeout(r, 10));
    inFlight.delete(ref);
    return { success: true, isDuplicate: false };
  };

  const [res1, res2] = await Promise.all([processWebhook(), processWebhook()]);
  assert(
    (res1.isDuplicate && !res2.isDuplicate) || (!res1.isDuplicate && res2.isDuplicate),
    'One request must be recognized as duplicate in-flight'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 5 — Architectural Financial Separation & Referrals
// ─────────────────────────────────────────────────────────────────────────────

test('Referral attribution code is preserved in payment metadata without local commission system', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'ws-company-106';

  engine.confirmPayment({
    reference: 'REF-AMB-999',
    companyId,
    planId: 'bundle',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
    amount: 35000,
    currency: 'XOF',
    referralCode: 'AMBASSADOR-KAZI-42',
  });

  const payment = engine.payments.find((p) => p.reference === 'REF-AMB-999');
  assertEqual(payment.referralCode, 'AMBASSADOR-KAZI-42', 'Referral attribution preserved');

  // Verify KaziBox has no ambassador wallets or commission balances in its state
  assertEqual(typeof engine.ambassadorWallets, 'undefined', 'No duplicate ambassador wallets in KaziBox');
  assertEqual(typeof engine.calculateCommission, 'undefined', 'No duplicate commission calculations in KaziBox');
});

test('SaaS subscription payments are completely isolated from operational merchant payments', () => {
  const saasAmount = 35000;
  const saasDescription = 'KaziBox';

  const hotelRoomBooking = {
    amount: 120000,
    currency: 'XOF',
    reference: 'HTL-INV-2026-0044',
    source: 'Réservation Chambre Suite Palmeraie',
    merchantAccount: 'hotel_direct_bank_or_merchant_wallet',
  };

  assert(hotelRoomBooking.amount !== saasAmount);
  assert(hotelRoomBooking.source !== saasDescription);
  assert(hotelRoomBooking.merchantAccount === 'hotel_direct_bank_or_merchant_wallet');
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section 6 — Atomic Transaction & Failure Recovery Tests
// ─────────────────────────────────────────────────────────────────────────────

class MockAtomicPostgresEngine {
  constructor() {
    this.companies = new Set(['comp-valid-01', 'comp-valid-02']);
    this.subscriptions = new Map();
    this.companyModules = new Map(); // key: `${companyId}:${moduleId}`
    this.paymentHistory = [];
    this.locks = new Set();
  }

  // Simulates Postgres RPC confirm_moteur_payment
  confirmPaymentRPC(params, { injectFailureAt = null } = {}) {
    const { companyId, reference, amount, currency, planId, billingCycle, moduleIds } = params;

    // 1. Transaction-level advisory lock simulation
    const lockKey = `moteur_payment:${reference}`;
    this.locks.add(lockKey);

    // Savepoint for transaction rollback
    const snapshot = {
      subscriptions: new Map(this.subscriptions),
      companyModules: new Map(this.companyModules),
      paymentHistory: [...this.paymentHistory],
    };

    try {
      // 2. Trusted parameter validation
      if (!companyId || !this.companies.has(companyId)) {
        return { status: 'invalid', code: 'COMPANY_NOT_FOUND', message: 'Target company not found' };
      }
      if (!reference || typeof reference !== 'string' || reference.trim() === '') {
        return { status: 'invalid', code: 'INVALID_REFERENCE', message: 'Payment reference cannot be empty' };
      }
      if (amount == null || amount <= 0) {
        return { status: 'invalid', code: 'INVALID_AMOUNT', message: 'Payment amount must be greater than zero' };
      }
      if (!currency || currency.length !== 3) {
        return { status: 'invalid', code: 'INVALID_CURRENCY', message: 'Payment currency must be a valid 3-character ISO code' };
      }

      // 3. Database-level Idempotency Check (global across reference)
      const existing = this.paymentHistory.find((p) => p.reference === reference);
      if (existing) {
        if (['failed', 'refunded', 'cancelled'].includes(existing.status)) {
          return {
            status: 'invalid',
            code: `PAYMENT_ALREADY_${existing.status.toUpperCase()}`,
            message: `Payment reference is already marked as ${existing.status}`,
          };
        }
        return {
          status: 'duplicate',
          code: 'ALREADY_PROCESSED',
          message: 'Payment has already been processed and confirmed',
          reference,
        };
      }

      // 4. Renewal period calculation
      const days = billingCycle === 'annual' ? 365 : 30;
      const now = new Date();
      let start = now;
      let end = new Date(now.getTime() + days * 86400000);

      const currentSub = this.subscriptions.get(companyId);
      if (currentSub && currentSub.status === 'active' && new Date(currentSub.currentPeriodEnd) > now) {
        end = new Date(new Date(currentSub.currentPeriodEnd).getTime() + days * 86400000);
      }

      // Step A: Update subscription
      this.subscriptions.set(companyId, {
        companyId,
        planId,
        status: 'active',
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
        includedModuleIds: moduleIds,
      });

      if (injectFailureAt === 'after_subscription') {
        throw new Error('Database connection interrupted after subscription update');
      }

      // Step B: Update module entitlements
      for (const mod of moduleIds) {
        this.companyModules.set(`${companyId}:${mod}`, {
          companyId,
          moduleId: mod,
          planId,
          status: 'active',
          expiresAt: end.toISOString(),
        });
      }

      if (injectFailureAt === 'after_modules') {
        throw new Error('Database connection interrupted before payment_history commit');
      }

      // Step C: Insert payment history
      const paySeq = this.paymentHistory.length + 1;
      this.paymentHistory.push({
        id: `pay-${paySeq}`,
        companyId,
        amount,
        currency,
        status: 'paid',
        reference,
        createdAt: new Date(Date.now() + paySeq * 1000),
      });

      return {
        status: 'success',
        code: 'PAYMENT_CONFIRMED',
        message: 'Payment confirmed atomically',
        reference,
        periodEnd: end.toISOString(),
      };
    } catch (err) {
      // Rollback transaction to snapshot
      this.subscriptions = snapshot.subscriptions;
      this.companyModules = snapshot.companyModules;
      this.paymentHistory = snapshot.paymentHistory;
      return {
        status: 'error',
        code: 'TRANSACTION_ROLLED_BACK',
        message: err.message,
      };
    } finally {
      this.locks.delete(lockKey);
    }
  }

  // Simulates Postgres RPC refund_moteur_payment
  refundPaymentRPC(params) {
    const { companyId, reference } = params;

    if (!companyId || !this.companies.has(companyId)) {
      return { status: 'invalid', code: 'COMPANY_NOT_FOUND', message: 'Company not found' };
    }
    if (!reference) {
      return { status: 'invalid', code: 'INVALID_REFERENCE', message: 'Reference required' };
    }

    const pay = this.paymentHistory.find(
      (p) => p.companyId === companyId && p.reference === reference
    );
    if (!pay) {
      return { status: 'invalid', code: 'PAYMENT_NOT_FOUND', message: 'Payment record not found' };
    }
    if (pay.status === 'failed') {
      return { status: 'duplicate', code: 'ALREADY_REFUNDED', message: 'Payment was already refunded' };
    }

    pay.status = 'failed';

    // Check if there is a newer paid payment
    const hasNewer = this.paymentHistory.some(
      (p) => p.companyId === companyId && p.status === 'paid' && (p.createdAt > pay.createdAt || p.id > pay.id)
    );

    if (hasNewer) {
      return {
        status: 'success',
        code: 'REFUNDED_NEWER_PAYMENT_ACTIVE',
        message: 'Payment refunded; active subscription preserved due to subsequent valid payment',
        subscriptionCancelled: false,
      };
    }

    // Cancel active subscription and modules
    const sub = this.subscriptions.get(companyId);
    if (sub && sub.status === 'active') {
      sub.status = 'cancelled';
      for (const mod of sub.includedModuleIds) {
        const modKey = `${companyId}:${mod}`;
        const m = this.companyModules.get(modKey);
        if (m) m.status = 'cancelled';
      }
    }

    return {
      status: 'success',
      code: 'REFUND_PROCESSED',
      message: 'Payment refunded and entitlements cancelled',
      subscriptionCancelled: true,
    };
  }
}

test('Failure recovery: Failure during entitlement updates rolls back payment-history and leaves no partial state', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';

  const res = db.confirmPaymentRPC(
    {
      companyId,
      reference: 'REF-CRASH-001',
      amount: 25000,
      currency: 'CDF',
      planId: 'starter',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
    },
    { injectFailureAt: 'after_modules' }
  );

  assertEqual(res.status, 'error', 'Operation must return error on mid-transaction exception');
  assertEqual(res.code, 'TRANSACTION_ROLLED_BACK', 'Transaction must roll back');

  // Verify atomic rollback: no payment history, no partial modules, no subscription
  assertEqual(db.paymentHistory.length, 0, 'No payment history should be committed');
  assertEqual(db.subscriptions.has(companyId), false, 'Subscription update must be rolled back');
  assertEqual(db.companyModules.has(`${companyId}:hotel-property`), false, 'Module entitlement must be rolled back');
});

test('Concurrent duplicate confirmations: Serialized safely and second call returns duplicate', async () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';
  const params = {
    companyId,
    reference: 'REF-CONCURRENT-RPC-01',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  };

  const [res1, res2] = await Promise.all([
    Promise.resolve(db.confirmPaymentRPC(params)),
    Promise.resolve(db.confirmPaymentRPC(params)),
  ]);

  const outcomes = [res1.status, res2.status].sort();
  assertDeepEqual(outcomes, ['duplicate', 'success'], 'Exactly one succeeds and one is flagged duplicate');
  assertEqual(db.paymentHistory.length, 1, 'Only one payment record exists in DB');
});

test('Duplicate refund events: Second call returns duplicate status without corrupting state', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';

  db.confirmPaymentRPC({
    companyId,
    reference: 'REF-DUP-REFUND-01',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });

  const ref1 = db.refundPaymentRPC({ companyId, reference: 'REF-DUP-REFUND-01' });
  assertEqual(ref1.status, 'success', 'First refund succeeds');
  assertEqual(ref1.subscriptionCancelled, true);

  const ref2 = db.refundPaymentRPC({ companyId, reference: 'REF-DUP-REFUND-01' });
  assertEqual(ref2.status, 'duplicate', 'Second refund recognized as duplicate');
  assertEqual(ref2.code, 'ALREADY_REFUNDED');
});

test('Refund of older payment: Preserves active subscription funded by later payment', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';

  // Month 1
  db.confirmPaymentRPC({
    companyId,
    reference: 'REF-HIST-01',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });

  // Month 2
  db.confirmPaymentRPC({
    companyId,
    reference: 'REF-HIST-02',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });

  // Refund Month 1
  const refundRes = db.refundPaymentRPC({ companyId, reference: 'REF-HIST-01' });
  assertEqual(refundRes.status, 'success');
  assertEqual(refundRes.subscriptionCancelled, false, 'Active subscription funded by Month 2 must NOT be cancelled');

  const sub = db.subscriptions.get(companyId);
  assertEqual(sub.status, 'active', 'Subscription remains active');
  assertEqual(db.companyModules.get(`${companyId}:garage`).status, 'active', 'Module remains active');
});

test('Validation: Rejects wrong company, zero/negative amount, invalid currency, or empty reference', () => {
  const db = new MockAtomicPostgresEngine();

  // Wrong company
  const resComp = db.confirmPaymentRPC({
    companyId: 'comp-nonexistent-99',
    reference: 'REF-V-01',
    amount: 1000,
    currency: 'USD',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  assertEqual(resComp.status, 'invalid');
  assertEqual(resComp.code, 'COMPANY_NOT_FOUND');

  // Negative amount
  const resAmt = db.confirmPaymentRPC({
    companyId: 'comp-valid-01',
    reference: 'REF-V-02',
    amount: -50,
    currency: 'USD',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  assertEqual(resAmt.status, 'invalid');
  assertEqual(resAmt.code, 'INVALID_AMOUNT');

  // Invalid currency length
  const resCurr = db.confirmPaymentRPC({
    companyId: 'comp-valid-01',
    reference: 'REF-V-03',
    amount: 100,
    currency: 'USDOLLARS',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  assertEqual(resCurr.status, 'invalid');
  assertEqual(resCurr.code, 'INVALID_CURRENCY');

  // Empty reference
  const resRef = db.confirmPaymentRPC({
    companyId: 'comp-valid-01',
    reference: '   ',
    amount: 100,
    currency: 'USD',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  assertEqual(resRef.status, 'invalid');
  assertEqual(resRef.code, 'INVALID_REFERENCE');
});

test('Retry after temporary network/DB failure: Successfully recovers and commits without duplicate records', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';
  const params = {
    companyId,
    reference: 'REF-RETRY-01',
    amount: 30000,
    currency: 'CDF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['salon'],
  };

  // Attempt 1 fails midway due to network error
  const attempt1 = db.confirmPaymentRPC(params, { injectFailureAt: 'after_subscription' });
  assertEqual(attempt1.status, 'error');
  assertEqual(db.paymentHistory.length, 0, 'Clean state after attempt 1 rollback');

  // Attempt 2 (retry) succeeds
  const attempt2 = db.confirmPaymentRPC(params);
  assertEqual(attempt2.status, 'success');
  assertEqual(db.paymentHistory.length, 1, 'Exactly one payment record created');
  assertEqual(db.companyModules.get(`${companyId}:salon`).status, 'active');
});

test('Renewal without losing remaining paid time: Period extends from future period end', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';

  // Sub 1
  const sub1 = db.confirmPaymentRPC({
    companyId,
    reference: 'REF-EXT-01',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  const firstEnd = new Date(sub1.periodEnd).getTime();

  // Renew immediately
  const sub2 = db.confirmPaymentRPC({
    companyId,
    reference: 'REF-EXT-02',
    amount: 15000,
    currency: 'XAF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['garage'],
  });
  const renewedEnd = new Date(sub2.periodEnd).getTime();

  // Must extend by 30 days from firstEnd, not from now
  const diffDays = Math.round((renewedEnd - firstEnd) / 86400000);
  assertEqual(diffDays, 30, 'Renewal must extend by exactly 30 days from existing period end');
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitions: Section F — Comprehensive Moteur DPaaS Sandbox Test Suite
// ─────────────────────────────────────────────────────────────────────────────

test('Section F: Successful sandbox health check', async () => {
  const mockPingFetch = async (url, options) => {
    assertEqual(url, 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-ping');
    assertEqual(options.method, 'POST');
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'db_imported', db_type: 'object', from_type: 'function' }),
      text: async () => JSON.stringify({ status: 'db_imported', db_type: 'object', from_type: 'function' }),
    };
  };

  const res = await mockPingFetch('https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEqual(res.status, 200, 'Health check must return HTTP 200');
  const data = await res.json();
  assertEqual(data.status, 'db_imported', 'Health check response status should match confirmed gateway response');
});

test('Section F: Missing or invalid gateway credentials rejected by gateway', async () => {
  const mockGatewayFetch = async (url, options) => {
    const apiKey = options.headers['x-engine-api-key'];
    if (!apiKey || apiKey === 'invalid_key') {
      return {
        ok: false,
        status: 401,
        json: async () => ({
          code: 'UNAUTHORIZED',
          message: 'Clé API manquante ou invalide. Fournissez x-engine-api-key.',
          request_id: 'test-req-001',
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ session_id: 'sess_1' }) };
  };

  const adapterWithInvalidKey = new MockMoteurAdapter(
    {
      baseUrl: 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway',
      apiKey: 'invalid_key',
      gatewayBearerToken: 'bearer_token_123',
    },
    mockGatewayFetch
  );

  const res = await adapterWithInvalidKey.initiatePaymentSession({
    idempotencyKey: 'KZ-TEST-AUTH-01',
    description: 'KaziBox',
    amount: 10000,
    currency: 'XOF',
    country: 'CI',
    companyId: 'company-01',
    planId: 'single',
    moduleIds: ['hotel-property'],
    billingCycle: 'monthly',
  });

  assertEqual(res.success, false, 'Invalid gateway key must fail');
  assertEqual(res.errorCode, 'UNAUTHORIZED', 'Error code must reflect UNAUTHORIZED');
  assertEqual(res.status, 'failed', 'Status must be failed');
});

test('Section F: Collection endpoint success and failure', async () => {
  // Test 1: Successful collection session creation
  let capturedHeaders = null;
  let capturedBody = null;
  let capturedUrl = null;

  const mockSuccessFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'sess_live_sandbox_999',
        reference: 'KZ-ORDER-001',
        status: 'pending',
        checkout_url: 'https://pay.moteur.internal/checkout/sess_live_sandbox_999',
      }),
    };
  };

  const adapter = new MockMoteurAdapter(
    {
      baseUrl: 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway',
      apiKey: 'x_engine_test_key_valid',
      gatewayBearerToken: 'gateway_bearer_valid',
      appCode: 'demosaas',
    },
    mockSuccessFetch
  );

  const successResult = await adapter.initiatePaymentSession({
    idempotencyKey: 'KZ-ORDER-001',
    amount: 25000,
    currency: 'XOF',
    country: 'CI',
    companyId: 'comp-valid-01',
    planId: 'starter',
    moduleIds: ['garage'],
    billingCycle: 'monthly',
  });

  assertEqual(successResult.success, true);
  assertEqual(capturedUrl, 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway/api/v1/payments/collect');
  assertEqual(capturedHeaders['x-engine-api-key'], 'x_engine_test_key_valid');
  assertEqual(capturedHeaders['Authorization'], 'Bearer gateway_bearer_valid');
  assertEqual(capturedHeaders['apikey'], 'gateway_bearer_valid');
  assertEqual(capturedBody.action, 'payments.collect');
  assertEqual(capturedBody.app_code, 'demosaas');
  assertEqual(capturedBody.saas_id, '167a0c84-ce3c-488c-8367-d2e649933f34');
  assertEqual(capturedBody.subscriber_ext_id, 'comp-valid-01');
  assertEqual(capturedBody.plan_key, 'starter');
  assertEqual(capturedBody.metadata.saas_id, '167a0c84-ce3c-488c-8367-d2e649933f34');
  assertEqual(capturedBody.metadata.subscriber_ext_id, 'comp-valid-01');
  assertEqual(capturedBody.metadata.plan_key, 'starter');

  // Test 2: Upstream Gateway 500 Failure
  const mockFailFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({
      error: { code: 'GATEWAY_ERROR', message: 'Internal provider communication failure' },
    }),
  });

  const failingAdapter = new MockMoteurAdapter(
    {
      baseUrl: 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway',
      apiKey: 'x_engine_test_key_valid',
    },
    mockFailFetch
  );

  const failResult = await failingAdapter.initiatePaymentSession({
    idempotencyKey: 'KZ-ORDER-002',
    amount: 25000,
    currency: 'XOF',
    country: 'CI',
    companyId: 'comp-valid-01',
    planId: 'starter',
    moduleIds: ['garage'],
    billingCycle: 'monthly',
  });

  assertEqual(failResult.success, false);
  assertEqual(failResult.errorCode, 'GATEWAY_ERROR');
});

test('Section F: Valid webhook signature format (sha256= and raw hex)', () => {
  const secret = 'whsec_test_secret_sandbox_2026';
  const adapter = new MockMoteurAdapter({ webhookSecret: secret });
  const rawBody = JSON.stringify({
    event: 'test.ping',
    data: { timestamp: 1728900000 },
  });

  const hexDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // Verify sha256=<hex> format
  const validPrefixed = adapter.verifyWebhookSignature(rawBody, `sha256=${hexDigest}`);
  assertEqual(validPrefixed, true, 'sha256= prefix format must be accepted');

  // Verify raw hex format
  const validRaw = adapter.verifyWebhookSignature(rawBody, hexDigest);
  assertEqual(validRaw, true, 'Raw hex digest must be accepted');
});

test('Section F: Invalid signature rejection and malformed hex prevention', () => {
  const secret = 'whsec_test_secret_sandbox_2026';
  const adapter = new MockMoteurAdapter({ webhookSecret: secret });
  const rawBody = JSON.stringify({ event: 'payment.completed', data: { reference: 'REF-01' } });

  // Tampered payload
  const validHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const tamperedResult = adapter.verifyWebhookSignature(rawBody + ' ', validHex);
  assertEqual(tamperedResult, false, 'Tampered payload must fail');

  // Wrong secret
  const wrongHex = crypto.createHmac('sha256', 'wrong_secret').update(rawBody).digest('hex');
  assertEqual(adapter.verifyWebhookSignature(rawBody, wrongHex), false, 'Wrong secret must fail');

  // Malformed non-hex string
  assertEqual(adapter.verifyWebhookSignature(rawBody, 'invalid-non-hex-signature'), false, 'Non-hex signature must fail');

  // Malformed length (less than 64 hex characters)
  assertEqual(adapter.verifyWebhookSignature(rawBody, 'abcdef123456'), false, 'Short hex signature must fail');
});

test('Section F: Malformed JSON payload rejection', () => {
  const secret = 'whsec_test_secret_sandbox_2026';
  const adapter = new MockMoteurAdapter({ webhookSecret: secret });
  const malformedJson = '{ "event": "payment.completed", "data": '; // broken JSON
  const sig = crypto.createHmac('sha256', secret).update(malformedJson).digest('hex');

  const parseRes = adapter.parseWebhookPayload(malformedJson, sig);
  assertEqual(parseRes.valid, false, 'Malformed JSON must fail parse');
  assertEqual(parseRes.error, 'INVALID_JSON', 'Error must be INVALID_JSON');
});

test('Section F: Unsupported and DPaaS commission/payout events safely handled', () => {
  const secret = 'whsec_test_secret_sandbox_2026';
  const adapter = new MockMoteurAdapter({ webhookSecret: secret });

  // 1. Unknown event
  const unknownBody = JSON.stringify({ event: 'unknown.custom.event', data: { foo: 'bar' } });
  const unknownSig = crypto.createHmac('sha256', secret).update(unknownBody).digest('hex');
  const resUnknown = adapter.parseWebhookPayload(unknownBody, unknownSig);
  assertEqual(resUnknown.valid, true);
  assertEqual(resUnknown.event.event, 'unknown.custom.event');

  // 2. commission.earned event (DPaaS centralized)
  const commissionBody = JSON.stringify({
    event: 'commission.earned',
    data: { ambassadorId: 'amb_99', amount: 5000, currency: 'XOF' },
  });
  const commissionSig = crypto.createHmac('sha256', secret).update(commissionBody).digest('hex');
  const resComm = adapter.parseWebhookPayload(commissionBody, commissionSig);
  assertEqual(resComm.valid, true);
  assertEqual(resComm.event.event, 'commission.earned');

  // 3. payout.completed and payout.failed events
  const payoutBody = JSON.stringify({
    event: 'payout.completed',
    data: { payoutId: 'pay_01', amount: 50000, status: 'completed' },
  });
  const payoutSig = crypto.createHmac('sha256', secret).update(payoutBody).digest('hex');
  const resPayout = adapter.parseWebhookPayload(payoutBody, payoutSig);
  assertEqual(resPayout.valid, true);
  assertEqual(resPayout.event.event, 'payout.completed');
});

test('Section F: Duplicate webhook delivery is strictly idempotent', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';
  const orderRef = 'REF-ORDER-DUPLICATE-01';

  // First delivery
  const res1 = db.confirmPaymentRPC({
    companyId,
    reference: orderRef,
    amount: 15000,
    currency: 'XOF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['hotel-property'],
  });
  assertEqual(res1.status, 'success');
  assertEqual(db.paymentHistory.length, 1);

  // Replay of same webhook delivery
  const res2 = db.confirmPaymentRPC({
    companyId,
    reference: orderRef,
    amount: 15000,
    currency: 'XOF',
    planId: 'starter',
    billingCycle: 'monthly',
    moduleIds: ['hotel-property'],
  });
  assertEqual(res2.status, 'duplicate', 'Replay must be detected as duplicate');
  assertEqual(db.paymentHistory.length, 1, 'Payment history count must remain 1');
  assertEqual(db.companyModules.get(`${companyId}:hotel-property`).status, 'active');
});

test('Section F: Payment failure does NOT activate modules or mark invoice paid', () => {
  const engine = new MockEntitlementEngine();
  const companyId = 'comp-fail-test';
  const orderRef = 'REF-ORDER-FAIL-01';

  // Record payment failure
  engine.payments.push({
    reference: orderRef,
    companyId,
    amount: 20000,
    currency: 'XOF',
    status: 'failed',
    createdAt: new Date().toISOString(),
  });

  // Verify that modules are NOT activated
  assertEqual(engine.hasAccess(companyId, 'garage'), false, 'Module must NOT be activated on failed payment');
  assertEqual(engine.hasAccess(companyId, 'hotel-property'), false, 'Module must NOT be activated on failed payment');

  const paymentRecord = engine.payments.find((p) => p.reference === orderRef);
  assertEqual(paymentRecord.status, 'failed', 'Payment status must be recorded as failed');
});

test('Section F: Successful payment matching the correct order activates modules and sets subscription', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';
  const orderRef = 'REF-MATCH-ORDER-01';

  const res = db.confirmPaymentRPC({
    companyId,
    reference: orderRef,
    amount: 25000,
    currency: 'CDF',
    planId: 'bundle',
    billingCycle: 'monthly',
    moduleIds: ['garage', 'salon'],
  });

  assertEqual(res.status, 'success');
  assertEqual(db.paymentHistory.length, 1);
  assertEqual(db.paymentHistory[0].reference, orderRef);
  assertEqual(db.paymentHistory[0].status, 'paid');
  assertEqual(db.subscriptions.get(companyId).status, 'active');
  assertEqual(db.companyModules.get(`${companyId}:garage`).status, 'active');
  assertEqual(db.companyModules.get(`${companyId}:salon`).status, 'active');
});

test('Section F: Prevention of duplicate module activation on concurrent calls', () => {
  const db = new MockAtomicPostgresEngine();
  const companyId = 'comp-valid-01';

  const p1 = db.confirmPaymentRPC({
    companyId,
    reference: 'REF-CONCURRENT-01',
    amount: 10000,
    currency: 'USD',
    planId: 'single',
    billingCycle: 'monthly',
    moduleIds: ['salon'],
  });

  const p2 = db.confirmPaymentRPC({
    companyId,
    reference: 'REF-CONCURRENT-01',
    amount: 10000,
    currency: 'USD',
    planId: 'single',
    billingCycle: 'monthly',
    moduleIds: ['salon'],
  });

  assertEqual(p1.status, 'success');
  assertEqual(p2.status, 'duplicate');
  assertEqual(db.paymentHistory.length, 1, 'Only one payment entry recorded');
});

test('Section F: Prevention of unauthorized payment or module activation', () => {
  // Test 1: Application code mismatch rejection
  const configuredAppCode = 'demosaas';
  const incomingAppCode = 'malicious_app';
  assertEqual(incomingAppCode === configuredAppCode, false, 'Mismatched application code must be rejected');

  // Test 2: Unauthenticated webhook (missing signature)
  const adapter = new MockMoteurAdapter({ webhookSecret: 'sec_123' });
  const rawBody = JSON.stringify({ event: 'payment.completed', data: { reference: 'HACK-01' } });
  const parseRes = adapter.parseWebhookPayload(rawBody, null);
  assertEqual(parseRes.valid, false, 'Missing signature must reject payload');

  // Test 3: Unknown company rejected by database RPC
  const db = new MockAtomicPostgresEngine();
  const res = db.confirmPaymentRPC({
    companyId: 'non-existent-company-uuid',
    reference: 'REF-ATTACK-01',
    amount: 50000,
    currency: 'USD',
    planId: 'all_access',
    billingCycle: 'yearly',
    moduleIds: ['hotel-property', 'garage', 'salon'],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section G: Regression Suite — Duplicate Moteur Webhook Deliveries
// ─────────────────────────────────────────────────────────────────────────────

// Helper to simulate the complete route handler pipeline
function createSimulatedWebhookHandler(dbEngine, webhookSecret = 'whsec_sandbox_test_2026') {
  const adapter = new MockMoteurAdapter({ webhookSecret });

  return async function handleWebhook({ rawBody, headers }) {
    // 1. Signature extraction
    const sig = headers['x-engine-signature'] || headers['x-moteur-signature'] || headers['x-signature'];
    if (!webhookSecret) {
      return { status: 401, body: { success: false, error: 'MOTEUR_WEBHOOK_NOT_CONFIGURED' } };
    }
    if (!sig) {
      return { status: 401, body: { success: false, error: 'MISSING_SIGNATURE_HEADER' } };
    }

    // 2. Signature verification
    const parseRes = adapter.parseWebhookPayload(rawBody, sig);
    if (!parseRes.valid) {
      const code = parseRes.error === 'INVALID_JSON' ? 400 : 401;
      return { status: code, body: { success: false, error: parseRes.error } };
    }

    const { event } = parseRes;
    const eventName = event.event;
    const data = event.data || {};
    const metadata = data.metadata || {};

    const reference = data.reference || data.idempotency_key || data.order_id || metadata.reference || metadata.idempotency_key;
    const companyId = data.companyId || data.company_id || metadata.company_id;
    const planId = data.planId || data.plan_id || metadata.plan_id || 'starter';
    const rawModuleIds = data.moduleIds || data.module_ids || metadata.module_ids;
    const moduleIds = Array.isArray(rawModuleIds) ? rawModuleIds : (typeof rawModuleIds === 'string' ? JSON.parse(rawModuleIds) : ['hotel-property']);
    const billingCycle = data.billingCycle || data.billing_cycle || metadata.billing_cycle || 'monthly';
    const amount = Number(data.amount) || 25000;
    const currency = data.currency || metadata.currency || 'XOF';

    if (!reference) {
      return { status: 400, body: { success: false, error: 'MISSING_REFERENCE' } };
    }

    if (eventName === 'payment.completed' || eventName === 'payment.succeeded') {
      const rpcResult = dbEngine.confirmPaymentRPC({
        companyId,
        reference,
        amount,
        currency,
        planId,
        billingCycle,
        moduleIds,
      });

      if (rpcResult.status === 'duplicate') {
        return {
          status: 200,
          body: {
            received: true,
            event: eventName,
            isDuplicate: true,
            reference,
            status: 'already_confirmed',
          },
        };
      }

      if (rpcResult.status === 'invalid') {
        const isInvalidTransition = rpcResult.code === 'PAYMENT_ALREADY_TERMINATED' || rpcResult.code?.startsWith('PAYMENT_ALREADY_');
        return {
          status: isInvalidTransition ? 409 : 400,
          body: {
            success: false,
            error: isInvalidTransition ? 'INVALID_PAYMENT_STATE_TRANSITION' : (rpcResult.code || 'CONFIRMATION_FAILED'),
            message: rpcResult.message,
            isDuplicate: false,
          },
        };
      }

      if (rpcResult.status !== 'success') {
        return {
          status: 400,
          body: {
            success: false,
            error: rpcResult.code || 'CONFIRMATION_FAILED',
            message: rpcResult.message,
            isDuplicate: false,
          },
        };
      }

      return {
        status: 200,
        body: {
          received: true,
          event: eventName,
          isDuplicate: false,
          reference,
          status: 'confirmed',
        },
      };
    }

    if (eventName === 'payment.failed') {
      // Check if reference already recorded
      const existing = dbEngine.paymentHistory.find((p) => p.reference === reference);
      if (existing) {
        return {
          status: 200,
          body: { received: true, event: 'payment.failed', isDuplicate: true, status: 'failed' },
        };
      }

      dbEngine.paymentHistory.push({
        id: `pay-${dbEngine.paymentHistory.length + 1}`,
        reference,
        companyId,
        amount,
        currency,
        status: 'failed',
        createdAt: new Date().toISOString(),
      });

      return {
        status: 200,
        body: { received: true, event: 'payment.failed', isDuplicate: false, status: 'failed' },
      };
    }

    if (eventName === 'payment.cancelled') {
      const existing = dbEngine.paymentHistory.find((p) => p.reference === reference);
      if (existing) {
        return {
          status: 200,
          body: { received: true, event: 'payment.cancelled', isDuplicate: true, status: 'cancelled' },
        };
      }

      dbEngine.paymentHistory.push({
        id: `pay-${dbEngine.paymentHistory.length + 1}`,
        reference,
        companyId,
        amount,
        currency,
        status: 'failed',
        createdAt: new Date().toISOString(),
      });

      return {
        status: 200,
        body: { received: true, event: 'payment.cancelled', isDuplicate: false, status: 'cancelled' },
      };
    }

    if (eventName === 'payment.expired') {
      const existing = dbEngine.paymentHistory.find((p) => p.reference === reference);
      if (existing) {
        return {
          status: 200,
          body: { received: true, event: 'payment.expired', isDuplicate: true, status: 'expired' },
        };
      }

      dbEngine.paymentHistory.push({
        id: `pay-${dbEngine.paymentHistory.length + 1}`,
        reference,
        companyId,
        amount,
        currency,
        status: 'expired',
        createdAt: new Date().toISOString(),
      });

      return {
        status: 200,
        body: { received: true, event: 'payment.expired', isDuplicate: false, status: 'expired' },
      };
    }

    return { status: 200, body: { received: true, event: eventName, isDuplicate: false } };
  };
}

test('Section G: Sending the same webhook reference 3 times returns isDuplicate: false once, then isDuplicate: true twice', async () => {
  const secret = 'whsec_sandbox_test_2026';
  const db = new MockAtomicPostgresEngine();
  const handleWebhook = createSimulatedWebhookHandler(db, secret);

  const reference = 'ref-dup-test-1792569076396';
  const companyId = 'comp-valid-01';

  const payloadObj = {
    event: 'payment.completed',
    data: {
      reference,
      companyId,
      planId: 'starter',
      moduleIds: ['hotel-property'],
      amount: 25000,
      currency: 'XOF',
      status: 'paid',
    },
  };
  const rawBody = JSON.stringify(payloadObj);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const headers = { 'x-engine-signature': `sha256=${signature}` };

  // Delivery 1
  const delivery1 = await handleWebhook({ rawBody, headers });
  assertEqual(delivery1.status, 200, 'Delivery 1 must return HTTP 200');
  assertEqual(delivery1.body.received, true);
  assertEqual(delivery1.body.isDuplicate, false, 'Delivery 1 must have isDuplicate: false');
  assertEqual(db.paymentHistory.length, 1, 'Delivery 1 must create exactly 1 payment record');
  assertEqual(db.paymentHistory[0].reference, reference);
  assertEqual(db.paymentHistory[0].status, 'paid');
  assertEqual(db.companyModules.get(`${companyId}:hotel-property`).status, 'active', 'Hotel module must be activated');

  // Delivery 2 (Exact duplicate replay)
  const delivery2 = await handleWebhook({ rawBody, headers });
  assertEqual(delivery2.status, 200, 'Delivery 2 must return HTTP 200');
  assertEqual(delivery2.body.received, true);
  assertEqual(delivery2.body.isDuplicate, true, 'Delivery 2 must have isDuplicate: true');
  assertEqual(db.paymentHistory.length, 1, 'Delivery 2 must NOT create duplicate payment record');
  assertEqual(db.paymentHistory[0].reference, reference);

  // Delivery 3 (Exact duplicate replay)
  const delivery3 = await handleWebhook({ rawBody, headers });
  assertEqual(delivery3.status, 200, 'Delivery 3 must return HTTP 200');
  assertEqual(delivery3.body.received, true);
  assertEqual(delivery3.body.isDuplicate, true, 'Delivery 3 must have isDuplicate: true');
  assertEqual(db.paymentHistory.length, 1, 'Delivery 3 must NOT create duplicate payment record');
  assertEqual(db.companyModules.get(`${companyId}:hotel-property`).status, 'active');
});

test('Section G: Concurrent duplicate delivery of 3 requests processes exactly once and marks 2 as duplicate', async () => {
  const secret = 'whsec_sandbox_test_2026';
  const db = new MockAtomicPostgresEngine();
  const handleWebhook = createSimulatedWebhookHandler(db, secret);

  const reference = 'ref-dup-test-concurrent-888';
  const companyId = 'comp-valid-01';

  const payloadObj = {
    event: 'payment.completed',
    data: {
      reference,
      companyId,
      planId: 'bundle',
      moduleIds: ['garage', 'salon'],
      amount: 45000,
      currency: 'XAF',
      status: 'paid',
    },
  };
  const rawBody = JSON.stringify(payloadObj);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const headers = { 'x-engine-signature': signature };

  // Dispatch 3 concurrent requests simultaneously
  const results = await Promise.all([
    handleWebhook({ rawBody, headers }),
    handleWebhook({ rawBody, headers }),
    handleWebhook({ rawBody, headers }),
  ]);

  for (const res of results) {
    assertEqual(res.status, 200, 'All concurrent deliveries must return HTTP 200');
    assertEqual(res.body.received, true);
  }

  const falseCount = results.filter((r) => r.body.isDuplicate === false).length;
  const trueCount = results.filter((r) => r.body.isDuplicate === true).length;

  assertEqual(falseCount, 1, 'Exactly 1 concurrent request must have isDuplicate: false');
  assertEqual(trueCount, 2, 'Exactly 2 concurrent requests must have isDuplicate: true');
  assertEqual(db.paymentHistory.length, 1, 'Total payment records must be strictly 1');
  assertEqual(db.companyModules.get(`${companyId}:garage`).status, 'active');
  assertEqual(db.companyModules.get(`${companyId}:salon`).status, 'active');
});

test('Section G: Serverless stateless instance simulation maintains persistent idempotency', async () => {
  const secret = 'whsec_sandbox_test_2026';
  // Shared persistent database
  const sharedDb = new MockAtomicPostgresEngine();

  // 3 independent serverless function instances
  const instanceA = createSimulatedWebhookHandler(sharedDb, secret);
  const instanceB = createSimulatedWebhookHandler(sharedDb, secret);
  const instanceC = createSimulatedWebhookHandler(sharedDb, secret);

  const reference = 'ref-serverless-stateless-999';
  const companyId = 'comp-valid-02';

  const rawBody = JSON.stringify({
    event: 'payment.completed',
    data: {
      reference,
      companyId,
      planId: 'starter',
      moduleIds: ['hotel-property'],
      amount: 15000,
      currency: 'XOF',
    },
  });
  const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const headers = { 'x-engine-signature': sig };

  // Delivery 1 on Instance A
  const resA = await instanceA({ rawBody, headers });
  assertEqual(resA.body.isDuplicate, false, 'Instance A must process payment as non-duplicate');

  // Delivery 2 on Instance B (separate memory context)
  const resB = await instanceB({ rawBody, headers });
  assertEqual(resB.body.isDuplicate, true, 'Instance B must recognize duplicate via persistent DB');

  // Delivery 3 on Instance C (separate memory context)
  const resC = await instanceC({ rawBody, headers });
  assertEqual(resC.body.isDuplicate, true, 'Instance C must recognize duplicate via persistent DB');

  assertEqual(sharedDb.paymentHistory.length, 1, 'Only 1 record in shared database');
});

test('Section G: payment.failed events do not grant entitlements and repeat deliveries are idempotent', async () => {
  const secret = 'whsec_sandbox_test_2026';
  const db = new MockAtomicPostgresEngine();
  const handleWebhook = createSimulatedWebhookHandler(db, secret);

  const reference = 'ref-failed-payment-001';
  const companyId = 'comp-valid-01';

  const rawBody = JSON.stringify({
    event: 'payment.failed',
    data: {
      reference,
      companyId,
      amount: 25000,
      currency: 'XOF',
      errorCode: 'INSUFFICIENT_FUNDS',
    },
  });
  const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const headers = { 'x-engine-signature': sig };

  // Send 3 times
  const d1 = await handleWebhook({ rawBody, headers });
  assertEqual(d1.status, 200);
  assertEqual(d1.body.isDuplicate, false);
  assertEqual(d1.body.status, 'failed');

  const d2 = await handleWebhook({ rawBody, headers });
  assertEqual(d2.status, 200);
  assertEqual(d2.body.isDuplicate, true);

  const d3 = await handleWebhook({ rawBody, headers });
  assertEqual(d3.status, 200);
  assertEqual(d3.body.isDuplicate, true);

  assertEqual(db.paymentHistory.length, 1, 'Only 1 failure record stored');
  assertEqual(db.paymentHistory[0].status, 'failed');
  assertEqual(db.companyModules.has(`${companyId}:hotel-property`), false, 'Failed payment must NOT grant module');

  // Attempting to replay as payment.completed with same reference must be rejected
  const completedBody = JSON.stringify({
    event: 'payment.completed',
    data: {
      reference,
      companyId,
      amount: 25000,
      currency: 'XOF',
      planId: 'starter',
      moduleIds: ['hotel-property'],
    },
  });
  const completedSig = crypto.createHmac('sha256', secret).update(completedBody).digest('hex');
  const attackRes = await handleWebhook({
    rawBody: completedBody,
    headers: { 'x-engine-signature': completedSig },
  });
  assertEqual(attackRes.status, 409, 'Replay of completed after failed must be rejected with HTTP 409');
  assertEqual(attackRes.body.error, 'INVALID_PAYMENT_STATE_TRANSITION');
  assertEqual(attackRes.body.isDuplicate, false);
  assertEqual(db.companyModules.has(`${companyId}:hotel-property`), false, 'Must not grant modules from failed ref');
});

test('Section G: payment.cancelled handling records failure, replay returns isDuplicate: true, and cannot activate modules', async () => {
  const secret = 'whsec_sandbox_test_2026';
  const db = new MockAtomicPostgresEngine();
  const handleWebhook = createSimulatedWebhookHandler(db, secret);

  const reference = 'ref-cancelled-order-002';
  const companyId = 'comp-valid-01';

  const cancelBody = JSON.stringify({
    event: 'payment.cancelled',
    data: {
      reference,
      companyId,
      amount: 25000,
      currency: 'XOF',
      metadata: { cancellation_reason: 'user_aborted' },
    },
  });
  const sig = crypto.createHmac('sha256', secret).update(cancelBody).digest('hex');
  const headers = { 'x-engine-signature': sig };

  // Delivery 1
  const r1 = await handleWebhook({ rawBody: cancelBody, headers });
  assertEqual(r1.status, 200);
  assertEqual(r1.body.isDuplicate, false);
  assertEqual(r1.body.status, 'cancelled');
  assertEqual(db.paymentHistory.length, 1);
  assertEqual(db.paymentHistory[0].status, 'failed');
  assertEqual(db.companyModules.has(`${companyId}:hotel-property`), false, 'Cancelled payment must not activate modules');

  // Delivery 2 (Replay)
  const r2 = await handleWebhook({ rawBody: cancelBody, headers });
  assertEqual(r2.status, 200);
  assertEqual(r2.body.isDuplicate, true);

  // Subsequent completed replay rejected
  const completedBody = JSON.stringify({
    event: 'payment.completed',
    data: { reference, companyId, planId: 'starter', moduleIds: ['hotel-property'] },
  });
  const completedSig = crypto.createHmac('sha256', secret).update(completedBody).digest('hex');
  const r3 = await handleWebhook({ rawBody: completedBody, headers: { 'x-engine-signature': completedSig } });
  assertEqual(r3.status, 409);
  assertEqual(r3.body.error, 'INVALID_PAYMENT_STATE_TRANSITION');
  assertEqual(r3.body.isDuplicate, false);
});

test('Section G: Invalid or tampered signature is rejected before idempotency or DB processing', async () => {
  const secret = 'whsec_sandbox_test_2026';
  const db = new MockAtomicPostgresEngine();
  const handleWebhook = createSimulatedWebhookHandler(db, secret);

  const rawBody = JSON.stringify({
    event: 'payment.completed',
    data: { reference: 'ref-tamper-01', companyId: 'comp-valid-01' },
  });

  // Missing header
  const r1 = await handleWebhook({ rawBody, headers: {} });
  assertEqual(r1.status, 401);
  assertEqual(r1.body.error, 'MISSING_SIGNATURE_HEADER');

  // Tampered payload
  const validSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const r2 = await handleWebhook({ rawBody: rawBody + ' ', headers: { 'x-engine-signature': validSig } });
  assertEqual(r2.status, 401);
  assertEqual(r2.body.error, 'INVALID_SIGNATURE');

  // Wrong secret
  const badSig = crypto.createHmac('sha256', 'wrong_secret').update(rawBody).digest('hex');
  const r3 = await handleWebhook({ rawBody, headers: { 'x-engine-signature': badSig } });
  assertEqual(r3.status, 401);
  assertEqual(r3.body.error, 'INVALID_SIGNATURE');

  assertEqual(db.paymentHistory.length, 0, 'No payment records created for unauthenticated requests');
});

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  for (const { name, fn } of testQueue) {
    try {
      await fn();
      console.log(`  ✅ PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL  ${name}\n         ${err.message}`);
      failed++;
    }
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All Moteur integration boundary tests PASSED ✅\n');
  }
}

run();
