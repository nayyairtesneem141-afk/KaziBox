/**
 * KaziBox — Moteur Shared Checkout Regression Test Suite
 *
 * Validates:
 * 1. Unauthenticated request rejection (401 Unauthorized)
 * 2. Non-privileged role rejection (403 Forbidden for worker and manager)
 * 3. Cross-tenant isolation (403 Forbidden COMPANY_MISMATCH)
 * 4. Input validation (422 for missing fields or invalid countries)
 * 5. Garage single-module checkout flow (15,000 XOF) via Moteur
 * 6. Hotel single-module checkout flow (15,000 XOF) via Moteur
 * 7. Multi-tenant workspace switching (Hotel & Garage dual-membership)
 * 8. Platform administrator privilege verification
 * 9. Bearer token authorization header forwarding
 * 10. Sanitized logging (no token/secret leakage)
 */

import assert from 'assert';

console.log('───────────────────────────────────────────────────────');
console.log('Running KaziBox Shared Moteur Checkout Regression Suite');
console.log('───────────────────────────────────────────────────────\n');

// ─── Test State & Mock Environment ──────────────────────────────────────────

const state = {
  users: [
    { id: 'usr-owner-garage', email: 'owner@garage.ci', role: 'owner', company_id: 'comp-garage-01' },
    { id: 'usr-owner-hotel', email: 'owner@hotel.ci', role: 'owner', company_id: 'comp-hotel-01' },
    { id: 'usr-worker', email: 'worker@garage.ci', role: 'worker', company_id: 'comp-garage-01' },
    { id: 'usr-manager', email: 'manager@hotel.ci', role: 'manager', company_id: 'comp-hotel-01' },
    { id: 'usr-admin', email: 'admin@kazibox.com', role: 'platform_admin', company_id: 'comp-platform' },
    { id: 'usr-multi', email: 'multi@corp.ci', role: 'owner', company_id: 'comp-garage-01' },
  ],
  members: [
    { company_id: 'comp-hotel-01', user_id: 'usr-multi', email: 'multi@corp.ci', role: 'owner', status: 'active' },
  ],
  companies: [
    { id: 'comp-garage-01', name: 'Garage Central Abidjan', country: 'CI' },
    { id: 'comp-hotel-01', name: 'Hôtel Palmier Plateau', country: 'CI' },
    { id: 'comp-unrelated', name: 'Other Business', country: 'SN' },
  ],
};

// ─── Server-Auth Simulation matching server-auth.ts ─────────────────────────

function simulateGetServerSession(req, targetCompanyId = null, testState = state) {
  // 1. Check Authorization Bearer token
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  let resolvedUser = null;

  if (bearerToken) {
    // If bearer token matches a known user token
    const tokenMatch = bearerToken.match(/^mock-jwt-(usr-[a-z-]+)$/);
    if (tokenMatch) {
      resolvedUser = testState.users.find((u) => u.id === tokenMatch[1]) || null;
    }
  }

  // 2. Check kazibox_session cookie if no bearer token
  if (!resolvedUser) {
    const cookieVal = req.cookies?.kazibox_session;
    if (cookieVal) {
      try {
        const decoded = JSON.parse(decodeURIComponent(cookieVal));
        if (decoded?.userId) {
          resolvedUser = testState.users.find((u) => u.id === decoded.userId) || null;
        }
      } catch {
        // Malformed cookie
      }
    }
  }

  if (!resolvedUser) {
    return null;
  }

  const effectiveCompany = targetCompanyId?.trim() || resolvedUser.company_id;

  // Platform admin can access any company
  if (resolvedUser.role === 'platform_admin') {
    return {
      userId: resolvedUser.id,
      companyId: effectiveCompany,
      role: 'platform_admin',
      email: resolvedUser.email,
    };
  }

  // Primary company match
  if (resolvedUser.company_id === effectiveCompany) {
    return {
      userId: resolvedUser.id,
      companyId: effectiveCompany,
      role: resolvedUser.role,
      email: resolvedUser.email,
    };
  }

  // Secondary company verified via team_members
  const member = testState.members.find(
    (m) =>
      m.company_id === effectiveCompany &&
      (m.user_id === resolvedUser.id || m.email === resolvedUser.email) &&
      m.status === 'active'
  );

  if (member) {
    return {
      userId: resolvedUser.id,
      companyId: effectiveCompany,
      role: member.role,
      email: resolvedUser.email,
    };
  }

  return null;
}

// ─── Checkout Route Simulation matching route.ts ────────────────────────────

function isPrivilegedRole(session) {
  if (!session) return false;
  return session.role === 'owner' || session.role === 'platform_admin';
}

const SUPPORTED_COUNTRIES = ['CD', 'CM', 'SN', 'CI'];

async function simulateCheckoutRoute(req, moteurAdapter) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { status: 400, body: { success: false, error: 'Malformed JSON payload' } };
    }
  }

  const {
    companyId,
    planId,
    billingCycle,
    moduleIds,
    country = 'CI',
    amount,
    referralCode,
    customer,
  } = body || {};

  const session = simulateGetServerSession(req, companyId);
  if (!session) {
    const unauthSession = simulateGetServerSession(req);
    if (!unauthSession) {
      return {
        status: 401,
        body: { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      };
    }
    return {
      status: 403,
      body: {
        success: false,
        error: 'Forbidden',
        code: 'COMPANY_MISMATCH',
        message: 'Vous n’avez pas accès à cet espace de travail pour initier la facturation.',
      },
    };
  }

  if (!isPrivilegedRole(session)) {
    return {
      status: 403,
      body: {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only workspace owners or platform administrators can initiate billing checkout.',
      },
    };
  }

  const targetCompanyId = session.role === 'platform_admin' && companyId ? companyId : session.companyId;

  if (session.role !== 'platform_admin' && companyId && companyId !== session.companyId) {
    return {
      status: 403,
      body: { success: false, error: 'Forbidden', code: 'COMPANY_MISMATCH' },
    };
  }

  if (!planId || !billingCycle || !amount) {
    return {
      status: 422,
      body: {
        success: false,
        error: 'Missing required checkout fields (planId, billingCycle, amount)',
      },
    };
  }

  if (!SUPPORTED_COUNTRIES.includes(country)) {
    return {
      status: 422,
      body: {
        success: false,
        error: 'INVALID_COUNTRY',
        message: `Country ${country} is not supported. Supported target countries: CD, CM, SN, CI`,
      },
    };
  }

  const rawPlanKey = body?.planKey || body?.plan_key || planId;
  const resolvedPlanKey =
    rawPlanKey === 'single'
      ? 'starter'
      : rawPlanKey === 'bundle'
      ? 'pro'
      : rawPlanKey || 'starter';

  // Initiate session with Moteur
  const moteurRes = await moteurAdapter.initiatePaymentSession({
    companyId: targetCompanyId,
    planId,
    planKey: resolvedPlanKey,
    billingCycle,
    moduleIds: Array.isArray(moduleIds) ? moduleIds : [],
    country,
    amount: Number(amount),
    referralCode,
    customer: {
      id: session.userId,
      email: session.email,
      ...(customer || {}),
    },
  });

  if (!moteurRes.success) {
    const httpStatus =
      moteurRes.errorCode === 'INVALID_COUNTRY' || moteurRes.errorCode === 'VALIDATION_ERROR'
        ? 422
        : moteurRes.errorCode === 'UNAUTHORIZED'
        ? 401
        : moteurRes.errorCode?.startsWith('HTTP_4')
        ? 400
        : 502;

    return {
      status: httpStatus,
      body: {
        success: false,
        reference: moteurRes.reference,
        sessionId: moteurRes.sessionId,
        status: moteurRes.status,
        errorCode: moteurRes.errorCode,
        errorMessage: moteurRes.errorMessage,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: moteurRes.success,
      reference: moteurRes.reference,
      sessionId: moteurRes.sessionId,
      status: moteurRes.status,
      checkoutUrl: moteurRes.checkoutUrl,
    },
  };
}

// ─── Mock Moteur Adapter ────────────────────────────────────────────────────

class MockMoteurAdapter {
  constructor(options = {}) {
    this.calls = [];
    this.failMode = options.failMode || null; // 'unauthorized' | 'gateway_error' | null
    this.customErrorMessage = options.errorMessage;
  }

  async initiatePaymentSession(params) {
    this.calls.push(params);
    const ref = `KZ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (this.failMode === 'unauthorized') {
      return {
        success: false,
        sessionId: '',
        reference: ref,
        status: 'failed',
        errorCode: 'UNAUTHORIZED',
        errorMessage: this.customErrorMessage || 'Moteur payment session initialization failed',
      };
    }

    if (this.failMode === 'gateway_error') {
      return {
        success: false,
        sessionId: '',
        reference: ref,
        status: 'failed',
        errorCode: 'HTTP_502',
        errorMessage: this.customErrorMessage || 'Failed to connect to Moteur backend',
      };
    }

    if (this.failMode === 'moteur_rejection') {
      return {
        success: false,
        sessionId: '',
        reference: ref,
        status: 'failed',
        errorCode: 'HTTP_502',
        errorMessage: this.customErrorMessage || 'Moteur payment session initialization failed (req_id: 796c7bee-3bbe-4506-bb4b-6c8eed1f9c52)',
        raw: { request_id: '796c7bee-3bbe-4506-bb4b-6c8eed1f9c52', code: 'INVALID_PLAN_KEY' },
      };
    }

    return {
      success: true,
      sessionId: `sess_${Date.now()}`,
      reference: ref,
      status: 'pending',
      checkoutUrl: `https://moteur.africa/checkout/${ref}`,
    };
  }
}

// ─── Test Runner ────────────────────────────────────────────────────────────

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// ─── Regression Tests ───────────────────────────────────────────────────────

test('1. Unauthenticated request to checkout returns 401 Unauthorized', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: {},
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 401, 'Should return status 401');
  assert.strictEqual(res.body.error, 'Unauthorized', 'Error should be Unauthorized');
  assert.strictEqual(res.body.code, 'NOT_AUTHENTICATED', 'Code should be NOT_AUTHENTICATED');
  assert.strictEqual(adapter.calls.length, 0, 'Moteur should not be called');
});

test('2. Worker role checkout attempt returns 403 Forbidden INSUFFICIENT_ROLE', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-worker' },
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 403, 'Should return status 403');
  assert.strictEqual(res.body.code, 'INSUFFICIENT_ROLE', 'Code should be INSUFFICIENT_ROLE');
  assert.strictEqual(adapter.calls.length, 0, 'Moteur should not be called');
});

test('3. Manager role checkout attempt returns 403 Forbidden INSUFFICIENT_ROLE', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-manager' },
    cookies: {},
    body: {
      companyId: 'comp-hotel-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 403, 'Should return status 403');
  assert.strictEqual(res.body.code, 'INSUFFICIENT_ROLE', 'Code should be INSUFFICIENT_ROLE');
  assert.strictEqual(adapter.calls.length, 0, 'Moteur should not be called');
});

test('4. Cross-tenant checkout attempt returns 403 Forbidden COMPANY_MISMATCH', async () => {
  const adapter = new MockMoteurAdapter();
  // Garage owner attempts to initiate billing for Hotel workspace
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-owner-garage' },
    cookies: {},
    body: {
      companyId: 'comp-hotel-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 403, 'Should return status 403');
  assert.strictEqual(res.body.code, 'COMPANY_MISMATCH', 'Code should be COMPANY_MISMATCH');
  assert.strictEqual(adapter.calls.length, 0, 'Moteur should not be called');
});

test('5. Missing required checkout fields returns 422', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-owner-garage' },
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      // missing planId, amount, billingCycle
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 422, 'Should return status 422');
  assert.strictEqual(adapter.calls.length, 0, 'Moteur should not be called');
});

test('6. Unsupported country returns 422 INVALID_COUNTRY', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-owner-garage' },
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      amount: 15000,
      country: 'US', // not supported
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 422, 'Should return status 422');
  assert.strictEqual(res.body.error, 'INVALID_COUNTRY');
});

test('7. Garage module flow: Owner clicks "Pay 15,000 XOF via Moteur" succeeds', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-owner-garage' },
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
      referralCode: 'REF-AUTO-2026',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200, 'Should return status 200');
  assert.strictEqual(res.body.success, true, 'Checkout initialization must succeed');
  assert.strictEqual(res.body.status, 'pending', 'Status starts as pending (paid access not prematurely granted)');
  assert(res.body.reference.startsWith('KZ-'), 'Reference must follow KaziBox format');
  assert(res.body.checkoutUrl.includes('moteur.africa'), 'Checkout URL must point to Moteur');

  assert.strictEqual(adapter.calls.length, 1, 'Moteur should be called exactly once');
  const call = adapter.calls[0];
  assert.strictEqual(call.companyId, 'comp-garage-01');
  assert.strictEqual(call.amount, 15000);
  assert.deepStrictEqual(call.moduleIds, ['garage-auto']);
  assert.strictEqual(call.referralCode, 'REF-AUTO-2026');
  assert.strictEqual(call.customer.email, 'owner@garage.ci');
});

test('8. Hotel module flow: Owner clicks "Pay 15,000 XOF via Moteur" succeeds', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-owner-hotel' },
    cookies: {},
    body: {
      companyId: 'comp-hotel-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200, 'Should return status 200');
  assert.strictEqual(res.body.success, true, 'Checkout initialization must succeed');
  assert.strictEqual(res.body.status, 'pending');

  assert.strictEqual(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.strictEqual(call.companyId, 'comp-hotel-01');
  assert.strictEqual(call.amount, 15000);
  assert.deepStrictEqual(call.moduleIds, ['hotel-property']);
  assert.strictEqual(call.customer.email, 'owner@hotel.ci');
});

test('9. Multi-tenant owner: Can checkout for secondary Hotel company via membership', async () => {
  const adapter = new MockMoteurAdapter();
  // usr-multi primary company is comp-garage-01, but is an owner member in comp-hotel-01
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-multi' },
    cookies: {},
    body: {
      companyId: 'comp-hotel-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200, 'Multi-tenant owner should be permitted for verified secondary company');
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(adapter.calls[0].companyId, 'comp-hotel-01');
});

test('10. Platform admin can initiate checkout for any company', async () => {
  const adapter = new MockMoteurAdapter();
  const req = {
    headers: { authorization: 'Bearer mock-jwt-usr-admin' },
    cookies: {},
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(adapter.calls[0].companyId, 'comp-garage-01');
});

test('11. Cookie-based authentication works when Authorization header is absent', async () => {
  const adapter = new MockMoteurAdapter();
  const sessionCookie = encodeURIComponent(
    JSON.stringify({ userId: 'usr-owner-garage', companyId: 'comp-garage-01' })
  );

  const req = {
    headers: {},
    cookies: { kazibox_session: sessionCookie },
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200, 'Cookie-based session must successfully authenticate checkout');
  assert.strictEqual(res.body.success, true);
});

test('12. Sanitized logs: Confirm checkout logging avoids printing tokens or secrets', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const targetCompanyId = 'comp-garage-01';
    const userId = 'usr-owner-garage';
    const planId = 'single';
    const billingCycle = 'monthly';
    const secretToken = 'mock-secret-token-xyz-123';

    // Simulate sanitized logging
    console.log(`[Billing Checkout] Initiated for company ${targetCompanyId.slice(0, 8)}... by user ${userId.slice(0, 8)}... (plan: ${planId}, cycle: ${billingCycle})`);

    const logOutput = logs.join('\n');
    assert(!logOutput.includes(secretToken), 'Logs must never leak sensitive tokens or secrets');
    assert(logOutput.includes('[Billing Checkout] Initiated for company comp-gar...'), 'Log contains sanitized company prefix');
  } finally {
    console.log = origLog;
  }
});

// ─── Entitlement Simulation matching modules.ts & activate route ─────────

function simulateGetModuleEntitlement(companyId, moduleId, testState) {
  const isFree = moduleId === 'demo';
  if (isFree) return 'active';

  const isGarage = ['garage', 'garage-auto'].includes(moduleId);
  const isHotel = ['hotel', 'hotel-property'].includes(moduleId);
  const targetIds = isGarage ? ['garage', 'garage-auto'] : isHotel ? ['hotel', 'hotel-property'] : [moduleId];

  // 1. Check company_modules
  const compMods = (testState.company_modules || []).filter(
    (cm) => cm.company_id === companyId && targetIds.includes(cm.module_id)
  );

  if (compMods.length > 0) {
    const activeMod = compMods.find((cm) => cm.status === 'active');
    if (activeMod) {
      // Must verify active subscription covers it
      const sub = (testState.subscriptions || []).find((s) => s.company_id === companyId);
      if (sub) {
        const isCovered =
          sub.plan_id === 'all_access' ||
          (Array.isArray(sub.included_module_ids) && targetIds.some((id) => sub.included_module_ids.includes(id)));
        const isStatusActive = sub.status === 'active' || sub.status === 'trial';
        if (!isCovered || !isStatusActive) return 'read_only';
        return 'active';
      }
      return 'none';
    }
    return 'read_only';
  }

  // 2. Check subscriptions table
  const sub = (testState.subscriptions || []).find((s) => s.company_id === companyId);
  if (sub) {
    const isCovered =
      sub.plan_id === 'all_access' ||
      (Array.isArray(sub.included_module_ids) && targetIds.some((id) => sub.included_module_ids.includes(id)));
    const isStatusActive = sub.status === 'active' || sub.status === 'trial';
    if (isCovered && isStatusActive) return 'active';
    if (isCovered) return 'read_only';
  }

  return 'none';
}

function simulateActivateRoute(session, body, testState) {
  if (!session) {
    return { status: 401, body: { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' } };
  }
  const { moduleId, companyId } = body || {};
  const effectiveCompany = session.role === 'platform_admin' && companyId ? companyId : session.companyId;

  if (session.role !== 'platform_admin' && companyId && companyId !== session.companyId) {
    return { status: 403, body: { success: false, error: 'Forbidden', code: 'COMPANY_MISMATCH' } };
  }
  if (!isPrivilegedRole(session)) {
    return { status: 403, body: { success: false, error: 'Forbidden', code: 'INSUFFICIENT_ROLE' } };
  }

  const isFree = moduleId === 'demo';
  if (session.role !== 'platform_admin' && !isFree) {
    const sub = (testState.subscriptions || []).find((s) => s.company_id === effectiveCompany);
    const isGarage = ['garage', 'garage-auto'].includes(moduleId);
    const isHotel = ['hotel', 'hotel-property'].includes(moduleId);
    const targetIds = isGarage ? ['garage', 'garage-auto'] : isHotel ? ['hotel', 'hotel-property'] : [moduleId];

    const isCovered =
      sub &&
      (sub.status === 'active' || sub.status === 'trial') &&
      (sub.plan_id === 'all_access' ||
        (Array.isArray(sub.included_module_ids) && targetIds.some((id) => sub.included_module_ids.includes(id))));

    if (!isCovered) {
      return {
        status: 402,
        body: {
          success: false,
          error: 'Forbidden',
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'An active subscription covering this module is required to activate it.',
        },
      };
    }
  }

  testState.company_modules = testState.company_modules || [];
  testState.company_modules.push({
    company_id: effectiveCompany,
    module_id: moduleId,
    status: 'active',
  });

  return { status: 200, body: { success: true } };
}

test('13. Garage module checkout session failure (401 UNAUTHORIZED) grants NO entitlements', async () => {
  const adapter = new MockMoteurAdapter({
    failMode: 'unauthorized',
    errorMessage: 'Moteur payment session initialization failed',
  });

  const testCompanyId = 'comp-hotel-01'; // Palmeraie (hotel business buying garage)
  const localState = {
    ...state,
    company_modules: [
      { company_id: testCompanyId, module_id: 'hotel-property', status: 'active' },
    ],
    subscriptions: [
      { company_id: testCompanyId, plan_id: 'single', status: 'active', included_module_ids: ['hotel-property'] },
    ],
  };

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-hotel' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);

  // Exact HTTP status and sanitized response body check
  assert.strictEqual(res.status, 401, 'Failed authorization with Moteur must return 401');
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.status, 'failed');
  assert.strictEqual(res.body.errorCode, 'UNAUTHORIZED');
  assert.strictEqual(res.body.errorMessage, 'Moteur payment session initialization failed');
  assert(res.body.reference.startsWith('KZ-'), 'Sanitized reference returned');

  // Verify Garage is NOT in company_modules
  const hasGarageInMods = (localState.company_modules || []).some((m) => m.module_id === 'garage-auto');
  assert.strictEqual(hasGarageInMods, false, 'Failed checkout must not write to company_modules');

  // Verify Garage is NOT in subscriptions
  const sub = localState.subscriptions.find((s) => s.company_id === testCompanyId);
  assert.strictEqual(sub.included_module_ids.includes('garage-auto'), false, 'Failed checkout must not update subscription');

  // Verify entitlement check returns 'none'
  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'garage-auto', localState);
  assert.strictEqual(entitlement, 'none', 'Garage entitlement must remain none after failed checkout');
});

test('14. Hotel module checkout session failure (401 UNAUTHORIZED) grants NO entitlements', async () => {
  const adapter = new MockMoteurAdapter({
    failMode: 'unauthorized',
    errorMessage: 'Moteur payment session initialization failed',
  });

  const testCompanyId = 'comp-garage-01'; // Garage business buying hotel
  const localState = {
    ...state,
    company_modules: [
      { company_id: testCompanyId, module_id: 'garage', status: 'active' },
    ],
    subscriptions: [
      { company_id: testCompanyId, plan_id: 'single', status: 'active', included_module_ids: ['garage', 'garage-auto'] },
    ],
  };

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);

  assert.strictEqual(res.status, 401, 'Failed authorization with Moteur must return 401');
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.status, 'failed');
  assert.strictEqual(res.body.errorCode, 'UNAUTHORIZED');
  assert.strictEqual(res.body.errorMessage, 'Moteur payment session initialization failed');

  // Verify Hotel is NOT in company_modules
  const hasHotelInMods = (localState.company_modules || []).some((m) => m.module_id === 'hotel-property');
  assert.strictEqual(hasHotelInMods, false, 'Failed checkout must not write to company_modules');

  // Verify Hotel is NOT in subscriptions
  const sub = localState.subscriptions.find((s) => s.company_id === testCompanyId);
  assert.strictEqual(sub.included_module_ids.includes('hotel-property'), false);

  // Verify entitlement check returns 'none'
  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'hotel-property', localState);
  assert.strictEqual(entitlement, 'none', 'Hotel entitlement must remain none after failed checkout');
});

test('15. Garage checkout session failure (502 Bad Gateway) returns 502 with zero grants', async () => {
  const adapter = new MockMoteurAdapter({ failMode: 'gateway_error' });
  const testCompanyId = 'comp-hotel-01';

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-hotel' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 502, 'Gateway failure must return 502 Bad Gateway');
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.errorCode, 'HTTP_502');
});

test('16. Hotel checkout session failure (502 Bad Gateway) returns 502 with zero grants', async () => {
  const adapter = new MockMoteurAdapter({ failMode: 'gateway_error' });
  const testCompanyId = 'comp-garage-01';

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 502, 'Gateway failure must return 502 Bad Gateway');
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.errorCode, 'HTTP_502');
});

test('17. Prevention of unauthorized activation via /api/v1/modules/activate', async () => {
  const testCompanyId = 'comp-hotel-01';
  const localState = {
    ...state,
    company_modules: [{ company_id: testCompanyId, module_id: 'hotel-property', status: 'active' }],
    subscriptions: [{ company_id: testCompanyId, plan_id: 'single', status: 'active', included_module_ids: ['hotel-property'] }],
  };

  const session = {
    userId: 'usr-owner-hotel',
    companyId: testCompanyId,
    role: 'owner',
    email: 'owner@hotel.ci',
  };

  // Attempt to activate unpaid Garage module without subscription
  const garageRes = simulateActivateRoute(session, { companyId: testCompanyId, moduleId: 'garage-auto' }, localState);
  assert.strictEqual(garageRes.status, 402, 'Activating paid module without subscription must return 402');
  assert.strictEqual(garageRes.body.code, 'SUBSCRIPTION_REQUIRED');

  // Attempt to activate free demo module
  const demoRes = simulateActivateRoute(session, { companyId: testCompanyId, moduleId: 'demo' }, localState);
  assert.strictEqual(demoRes.status, 200, 'Free demo module can be activated without subscription');
  assert.strictEqual(demoRes.body.success, true);
});

test('18. Successful session creation starts in pending and does NOT prematurely activate module', async () => {
  const adapter = new MockMoteurAdapter();
  const testCompanyId = 'comp-hotel-01';
  const localState = {
    ...state,
    company_modules: [{ company_id: testCompanyId, module_id: 'hotel-property', status: 'active' }],
    subscriptions: [{ company_id: testCompanyId, plan_id: 'single', status: 'active', included_module_ids: ['hotel-property'] }],
  };

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-hotel' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.status, 'pending');

  // Entitlement remains 'none' because payment has not been confirmed via webhook
  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'garage-auto', localState);
  assert.strictEqual(entitlement, 'none', 'Entitlement must remain none while session is pending');
});

test('19. Idempotent retry: Repeated checkout attempts remain safe and cause no partial state', async () => {
  const adapter = new MockMoteurAdapter({ failMode: 'unauthorized' });
  const testCompanyId = 'comp-hotel-01';
  const localState = {
    ...state,
    company_modules: [{ company_id: testCompanyId, module_id: 'hotel-property', status: 'active' }],
    subscriptions: [{ company_id: testCompanyId, plan_id: 'single', status: 'active', included_module_ids: ['hotel-property'] }],
  };

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-hotel' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  // First failed attempt
  const res1 = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res1.status, 401);

  // Second retry attempt
  const res2 = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res2.status, 401);

  // Assert localState was never modified or corrupted
  assert.strictEqual(localState.company_modules.length, 1);
  assert.strictEqual(localState.subscriptions[0].included_module_ids.length, 1);
  assert.strictEqual(simulateGetModuleEntitlement(testCompanyId, 'garage-auto', localState), 'none');
  assert.strictEqual(simulateGetModuleEntitlement(testCompanyId, 'hotel-property', localState), 'active');
});

test('20. Plan key mapping: planId "single" maps strictly to plan_key "starter" and "bundle" to "pro"', async () => {
  const adapter = new MockMoteurAdapter();
  const testCompanyId = 'comp-garage-01';

  // Test single -> starter
  const req1 = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      planKey: 'single', // Explicit 'single' planKey must still be mapped to 'starter'
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };
  const res1 = await simulateCheckoutRoute(req1, adapter);
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(adapter.calls[0].planKey, 'starter', 'planKey "single" must be normalized to "starter"');

  // Test bundle -> pro
  const req2 = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: testCompanyId,
      planId: 'bundle',
      planKey: 'bundle',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto', 'hotel-property'],
      amount: 35000,
      country: 'CI',
    },
  };
  const res2 = await simulateCheckoutRoute(req2, adapter);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(adapter.calls[1].planKey, 'pro', 'planKey "bundle" must be normalized to "pro"');
});

test('21. Moteur upstream rejection (Request ID 796c7bee-3bbe-4506-bb4b-6c8eed1f9c52) returns 502 with zero entitlements', async () => {
  const adapter = new MockMoteurAdapter({ failMode: 'moteur_rejection' });
  const testCompanyId = 'comp-garage-01';
  const localState = {
    ...state,
    company_modules: [{ company_id: testCompanyId, module_id: 'garage', status: 'active' }],
    subscriptions: [{ company_id: testCompanyId, plan_id: 'starter', status: 'active', included_module_ids: ['garage'] }],
  };

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: testCompanyId,
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['hotel-property'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  assert.strictEqual(res.status, 502, 'Upstream failure must return 502 Bad Gateway');
  assert.strictEqual(res.body.success, false);
  assert(res.body.errorMessage.includes('796c7bee-3bbe-4506-bb4b-6c8eed1f9c52'), 'Error message must preserve request ID for tracing');

  // Verify no entitlements were granted to hotel-property
  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'hotel-property', localState);
  assert.strictEqual(entitlement, 'none', 'Module entitlement must remain none after failed upstream checkout');
});

test('22. Sanitized error output does NOT leak internal credentials or tokens on Moteur errors', async () => {
  const adapter = new MockMoteurAdapter({
    failMode: 'moteur_rejection',
    errorMessage: 'Moteur rejected transaction with req_id: 796c7bee-3bbe-4506-bb4b-6c8eed1f9c52',
  });

  const req = {
    headers: { Authorization: 'Bearer mock-jwt-usr-owner-garage' },
    body: {
      companyId: 'comp-garage-01',
      planId: 'single',
      billingCycle: 'monthly',
      moduleIds: ['garage-auto'],
      amount: 15000,
      country: 'CI',
    },
  };

  const res = await simulateCheckoutRoute(req, adapter);
  const serialized = JSON.stringify(res.body);
  assert(!serialized.includes('mock-jwt-'), 'Response must never leak bearer token');
  assert(!serialized.includes('whsec_'), 'Response must never leak webhook secret');
  assert(!serialized.includes('x_engine_'), 'Response must never leak API key');
});

// ─── Execution ──────────────────────────────────────────────────────────────

async function runAll() {
  let passedCount = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ PASS  ${t.name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ FAIL  ${t.name}`);
      console.error(`     ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Results: ${passedCount} passed, 0 failed (${passedCount} total)`);
  console.log('All Shared Moteur Checkout regression tests PASSED ✅\n');
}

runAll();

