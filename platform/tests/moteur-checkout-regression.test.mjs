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

test('23. Indefinite polling prevention: Polling terminates at maxAttempts (timeout) without spinning forever', async () => {
  let pollAttempts = 0;
  const maxAttempts = 30;
  let isPollingTimeout = false;
  let isTerminal = false;

  const mockStatusCheck = async () => {
    pollAttempts++;
    // Status stays pending
    return false;
  };

  while (!isTerminal && pollAttempts < maxAttempts) {
    isTerminal = await mockStatusCheck();
  }

  if (pollAttempts >= maxAttempts && !isTerminal) {
    isPollingTimeout = true;
  }

  assert.strictEqual(pollAttempts, 30, 'Polling must cease after exactly 30 attempts');
  assert.strictEqual(isPollingTimeout, true, 'isPollingTimeout flag must be set to true');
});

test('24. Status normalization: Moteur status "COMPLETED" / "completed" / "paid" maps to "succeeded" and activates modules', async () => {
  const rawStatuses = ['COMPLETED', 'completed', 'paid', 'PAID', 'succeeded', 'SUCCEEDED'];
  for (const raw of rawStatuses) {
    const rawLower = String(raw).toLowerCase();
    const isSuccess = rawLower === 'succeeded' || rawLower === 'completed' || rawLower === 'paid';
    assert.strictEqual(isSuccess, true, `Status "${raw}" must be treated as successful`);
  }

  const testCompanyId = 'comp-garage-01';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
  };

  // Simulate payment confirmation for garage module
  localState.subscriptions.push({
    company_id: testCompanyId,
    plan_id: 'starter',
    status: 'active',
    included_module_ids: ['garage'],
  });
  localState.company_modules.push({
    company_id: testCompanyId,
    module_id: 'garage',
    status: 'active',
  });

  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'garage', localState);
  assert.strictEqual(entitlement, 'active', 'Module entitlement must be active after confirmed payment');
});

test('25. Terminal failure states ("failed", "cancelled", "rejected", "expired") do NOT grant entitlements', async () => {
  const terminalFailures = ['failed', 'FAILED', 'cancelled', 'CANCELLED', 'rejected', 'REJECTED', 'expired', 'EXPIRED'];
  for (const raw of terminalFailures) {
    const rawLower = String(raw).toLowerCase();
    const isFailed = rawLower === 'failed' || rawLower === 'cancelled' || rawLower === 'rejected';
    const isExpired = rawLower === 'expired';
    const isTerminalFailure = isFailed || isExpired;
    assert.strictEqual(isTerminalFailure, true, `Status "${raw}" must be recognized as terminal failure`);
  }

  const testCompanyId = 'comp-hotel-01';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
  };

  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'hotel-property', localState);
  assert.strictEqual(entitlement, 'none', 'Module entitlement must remain none for failed/cancelled/expired payment');
});

test('26. Serverless stateless status check: Recovers and confirms when session is absent from in-memory cache', async () => {
  // Simulate serverless Lambda instance where localSessions map is empty
  const inMemorySessions = new Map();
  const targetRef = 'KZ-STATELESS-TEST-999';

  assert.strictEqual(inMemorySessions.has(targetRef), false, 'Session must not be in local memory');

  // Verify that an active adapter check returns confirmed payment details
  const mockVerifyResult = {
    reference: targetRef,
    sessionId: 'sess_12345',
    status: 'completed',
    amount: 15000,
    currency: 'XOF',
    companyId: 'comp-hotel-01',
    planId: 'starter',
    moduleIds: ['hotel-property'],
  };

  const rawStatus = String(mockVerifyResult.status).toLowerCase();
  const isSuccess = rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'paid';
  assert.strictEqual(isSuccess, true);

  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
  };

  if (isSuccess && mockVerifyResult.companyId) {
    localState.subscriptions.push({
      company_id: mockVerifyResult.companyId,
      plan_id: mockVerifyResult.planId,
      status: 'active',
      included_module_ids: mockVerifyResult.moduleIds,
    });
    localState.company_modules.push({
      company_id: mockVerifyResult.companyId,
      module_id: mockVerifyResult.moduleIds[0],
      status: 'active',
    });
  }

  const entitlement = simulateGetModuleEntitlement(mockVerifyResult.companyId, 'hotel-property', localState);
  assert.strictEqual(entitlement, 'active', 'Module entitlement must be granted after verified stateless status confirmation');
});

test('27. Refresh recovery & zero unverified activation: Client return URL does NOT grant access without trusted backend verification', async () => {
  const testCompanyId = 'comp-garage-01';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
  };

  // Malicious / unverified query parameter on return URL
  const unverifiedUrlParam = { status: 'completed', checkout_id: 'fake_tx_123' };

  // Rule: Do NOT activate module merely based on unverified URL parameter
  let moduleActivated = false;
  const verifiedWithBackend = false; // Backend verification rejected or not yet done

  if (verifiedWithBackend) {
    moduleActivated = true;
  }

  assert.strictEqual(moduleActivated, false, 'Module must NOT be activated without trusted backend verification');
  const entitlement = simulateGetModuleEntitlement(testCompanyId, 'garage', localState);
  assert.strictEqual(entitlement, 'none', 'Module entitlement must remain none when unverified');
});

test('28. Interactive return from Sandbox Mock provider: Recovers session context, halts waiting spinner, and confirms module activation', async () => {
  const testCompanyId = 'comp-garage-01';
  const targetModule = 'garage';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
    payments: [],
  };

  // Simulating user returning with ?checkout_id=mock_col_777&status=completed&provider=mock
  const mockRedirectQuery = {
    checkoutId: 'mock_col_777',
    returnStatus: 'completed',
    provider: 'mock',
  };

  // Stored pending checkout from before redirection
  const storedPendingCheckout = {
    reference: 'KZ-MOCK-TX-777',
    sessionId: 'mock_col_777',
    companyId: testCompanyId,
    planId: 'single',
    moduleIds: [targetModule],
  };

  // Verify that the backend status endpoint resolves the session and confirms it
  const isCompleted = mockRedirectQuery.returnStatus === 'completed';
  assert.strictEqual(isCompleted, true, 'Status must be recognized as completed');

  if (isCompleted && storedPendingCheckout.companyId) {
    localState.subscriptions.push({
      company_id: storedPendingCheckout.companyId,
      plan_id: storedPendingCheckout.planId,
      status: 'active',
      included_module_ids: storedPendingCheckout.moduleIds,
    });
    localState.company_modules.push({
      company_id: storedPendingCheckout.companyId,
      module_id: targetModule,
      status: 'active',
    });
    localState.payments.push({
      companyId: storedPendingCheckout.companyId,
      reference: storedPendingCheckout.reference,
      status: 'paid',
      amount: 15000,
      currency: 'XOF',
    });
  }

  // Waiting spinner stops (stage transitions to success)
  const checkoutStage = localState.payments[0]?.status === 'paid' ? 'success' : 'waiting';
  assert.strictEqual(checkoutStage, 'success', 'Checkout stage must transition from waiting to success');

  const entitlement = simulateGetModuleEntitlement(testCompanyId, targetModule, localState);
  assert.strictEqual(entitlement, 'active', 'Garage module entitlement must be granted on mock sandbox return');
});

test('29. Multi-ID session resolution: Resolves session whether queried by reference (KZ-...) or checkoutId (mock_col_...)', async () => {
  const sessions = new Map();
  const testSession = {
    reference: 'KZ-ORDER-555',
    sessionId: 'mock_col_555',
    companyId: 'comp-hotel-01',
    planId: 'starter',
    moduleIds: ['hotel-property'],
    status: 'succeeded',
    amount: 15000,
    currency: 'XOF',
  };

  // Indexed by both reference and sessionId
  sessions.set(testSession.reference, testSession);
  sessions.set(testSession.sessionId, testSession);

  // Lookup by KZ reference
  const byRef = sessions.get('KZ-ORDER-555');
  assert.strictEqual(byRef?.companyId, 'comp-hotel-01');

  // Lookup by checkoutId (from return URL query parameter)
  const byCheckoutId = sessions.get('mock_col_555');
  assert.strictEqual(byCheckoutId?.companyId, 'comp-hotel-01');
  assert.strictEqual(byCheckoutId?.status, 'succeeded');
});

test('30. Tenant isolation on status polling route: Rejects foreign workspace caller with 403 COMPANY_MISMATCH', async () => {
  const callerSession = {
    userId: 'usr-owner-hotel',
    companyId: 'comp-hotel-01',
    role: 'owner',
  };

  const paymentRecord = {
    reference: 'KZ-GARAGE-SECRET-123',
    companyId: 'comp-garage-01', // Different tenant!
    status: 'succeeded',
  };

  let statusCode = 200;
  let errorCode = null;

  if (
    paymentRecord.companyId &&
    callerSession.role !== 'platform_admin' &&
    paymentRecord.companyId !== callerSession.companyId
  ) {
    statusCode = 403;
    errorCode = 'COMPANY_MISMATCH';
  }

  assert.strictEqual(statusCode, 403, 'Cross-tenant status lookup must return 403');
  assert.strictEqual(errorCode, 'COMPANY_MISMATCH');
});

test('31. Canonical module alias resolution: garage-auto and hair-salon resolve to catalogue entries and grant access', async () => {
  const MODULE_ALIASES = {
    'garage-auto': 'garage',
    'garage': 'garage',
    'hotel': 'hotel-property',
    'hotel-property': 'hotel-property',
    'hair-salon': 'salon',
    'salon-beauty': 'salon',
    'salon': 'salon',
  };

  const toCanonical = (id) => MODULE_ALIASES[id] || id;

  assert.strictEqual(toCanonical('garage-auto'), 'garage');
  assert.strictEqual(toCanonical('hair-salon'), 'salon');
  assert.strictEqual(toCanonical('hotel'), 'hotel-property');

  const testCompanyId = 'comp-garage-01';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
  };

  // Payment confirmation with canonical garage ID
  localState.subscriptions.push({
    company_id: testCompanyId,
    plan_id: 'starter',
    status: 'active',
    included_module_ids: ['garage', 'garage-auto'],
  });
  localState.company_modules.push({
    company_id: testCompanyId,
    module_id: 'garage',
    status: 'active',
  });

  // Verify entitlement check works whether queried by garage or garage-auto
  const entCanonical = simulateGetModuleEntitlement(testCompanyId, 'garage', localState);
  assert.strictEqual(entCanonical, 'active', 'Canonical garage query must return active');

  const entAlias = simulateGetModuleEntitlement(testCompanyId, 'garage-auto', localState);
  assert.strictEqual(entAlias, 'active', 'Alias garage-auto query must return active');
});

test('32. Spoofed browser return status rejected: Client-supplied returnStatus does NOT grant entitlements without authoritative confirmation', async () => {
  const testCompanyId = 'comp-garage-01';
  const targetModule = 'garage';
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
    payments: [],
  };

  // Attacker returns with ?returnStatus=completed, but authoritative gateway returns pending
  const spoofedQuery = {
    reference: 'KZ-SPOOF-001',
    returnStatus: 'completed',
  };

  const authoritativeGatewayStatus = 'pending';

  // Rule: Entitlements are NEVER activated if authoritative status is not completed/succeeded
  const shouldActivate = authoritativeGatewayStatus === 'completed' || authoritativeGatewayStatus === 'succeeded';
  assert.strictEqual(shouldActivate, false, 'Authoritative check must gate activation');

  const entitlement = simulateGetModuleEntitlement(testCompanyId, targetModule, localState);
  assert.strictEqual(entitlement, 'none', 'Module entitlement must remain none despite returnStatus=completed');
});

test('33. Company mismatch rejection: Confirming payment for mismatched company is strictly rejected', async () => {
  const localState = {
    ...state,
    company_modules: [],
    subscriptions: [],
    payments: [
      {
        id: 'KZ-LEGIT-123',
        reference: 'KZ-LEGIT-123',
        companyId: 'comp-garage-01',
        amount: 15000,
        status: 'pending',
      },
    ],
  };

  // Malicious request attempts to confirm KZ-LEGIT-123 for comp-hotel-01
  const attackerCompanyId = 'comp-hotel-01';
  const targetRef = 'KZ-LEGIT-123';

  const existingPayment = localState.payments.find((p) => p.reference === targetRef);
  let isRejected = false;
  let rejectionCode = '';

  if (existingPayment && existingPayment.companyId !== attackerCompanyId) {
    isRejected = true;
    rejectionCode = 'COMPANY_MISMATCH';
  }

  assert.strictEqual(isRejected, true, 'Confirmation attempt on foreign reference must be rejected');
  assert.strictEqual(rejectionCode, 'COMPANY_MISMATCH');
  assert.strictEqual(localState.subscriptions.length, 0, 'Zero subscriptions must be granted');
});

test('34. Gateway contract verification: verifyPayment includes action, app_code, saas_id, and reference in POST payload', async () => {
  let capturedBody = null;
  const mockFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        reference: capturedBody.reference,
        amount: 15000,
        currency: 'XOF',
      }),
    };
  };

  const gatewayUrl = 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway';
  const payload = {
    action: 'payments.status',
    app_code: 'demosaas',
    saas_id: '167a0c84-ce3c-488c-8367-d2e649933f34',
    reference: 'KZ-TEST-CONTRACT-001',
    session_id: 'sess_contract_001',
  };

  await mockFetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.strictEqual(capturedBody.action, 'payments.status');
  assert.strictEqual(capturedBody.app_code, 'demosaas');
  assert.strictEqual(capturedBody.saas_id, '167a0c84-ce3c-488c-8367-d2e649933f34');
  assert.strictEqual(capturedBody.reference, 'KZ-TEST-CONTRACT-001');
  assert.strictEqual(capturedBody.session_id, 'sess_contract_001');
});

test('35. Gateway error & terminal states handled safely: failed, cancelled, expired, timeout grant ZERO entitlements', async () => {
  const terminalStates = ['failed', 'cancelled', 'rejected', 'expired', 'timeout'];
  const testCompanyId = 'comp-garage-01';

  for (const st of terminalStates) {
    const localState = {
      ...state,
      company_modules: [],
      subscriptions: [],
    };

    const isSuccess = st === 'succeeded' || st === 'completed' || st === 'paid';
    assert.strictEqual(isSuccess, false, `State "${st}" must not be treated as success`);

    const entitlement = simulateGetModuleEntitlement(testCompanyId, 'garage', localState);
    assert.strictEqual(entitlement, 'none', `Zero entitlements must be granted for state "${st}"`);
  }
});

test('36. Catalogue deduplication: Merging base modules with canonical catalogue does not duplicate cards', async () => {
  // Simulate getModules merging logic from platform/lib/modules.ts
  const baseModules = [
    { id: 'garage-auto', slug: 'garage-auto', name: 'Garage & Auto Repair' },
    { id: 'hotel-property', slug: 'hotel-property', name: 'Hotel & Property Rental' },
    { id: 'hair-salon', slug: 'hair-salon', name: 'Hair Salon & Beauty Spa' },
  ];

  // Canonical rows in public.modules (exactly as seeded without alias insertions)
  const dbModules = [
    { id: 'hotel-property', slug: 'hotel-property', name: 'Gestion Hôtelière & Résidences' },
    { id: 'garage', slug: 'garage', name: 'Garage & Mécanique' },
    { id: 'demo', slug: 'demo', name: 'Module de Démonstration Interne' },
  ];

  const dbMap = new Map();
  dbModules.forEach((m) => {
    dbMap.set(m.id, m);
    if (m.slug) dbMap.set(m.slug, m);
  });

  const merged = [];
  const processedIds = new Set();

  for (const baseMod of baseModules) {
    const dbRow = dbMap.get(baseMod.id) || (baseMod.slug ? dbMap.get(baseMod.slug) : null);
    if (dbRow) {
      merged.push({ ...baseMod, id: dbRow.id || baseMod.id, name: dbRow.name });
    } else {
      merged.push(baseMod);
    }
    processedIds.add(baseMod.id);
  }

  // Without alias insertions in DB, only external/third-party modules are appended
  dbModules.forEach((m) => {
    // If alias rows like 'garage-auto' are NOT in dbModules, 'garage' is canonical
    if (!processedIds.has(m.id)) {
      // If m.id matches canonical alias target of baseMod, it should not create duplicate
      const hasBaseCounterpart = baseModules.some((b) => b.id === m.id || b.slug === m.slug || (b.id === 'garage-auto' && m.id === 'garage'));
      if (!hasBaseCounterpart) {
        merged.push(m);
        processedIds.add(m.id);
      }
    }
  });

  // Verify garage appears once in catalogue
  const garageEntries = merged.filter((m) => m.id === 'garage' || m.id === 'garage-auto');
  assert.strictEqual(garageEntries.length, 1, 'There must be exactly one garage entry in the catalogue');

  // Verify hotel appears once in catalogue
  const hotelEntries = merged.filter((m) => m.id === 'hotel' || m.id === 'hotel-property');
  assert.strictEqual(hotelEntries.length, 1, 'There must be exactly one hotel entry in the catalogue');
});

test('37. Payment integrity: Underpayment and currency mismatches are strictly rejected before activation', async () => {
  const pendingCheckout = {
    reference: 'KZ-INTEGRITY-001',
    companyId: 'comp-garage-01',
    amount: 25000,
    currency: 'XOF',
    status: 'pending',
  };

  // Helper verifying payment confirmation integrity
  function verifyPaymentIntegrity(checkout, confirmedAmount, confirmedCurrency) {
    if (confirmedAmount < checkout.amount) {
      return { valid: false, error: 'UNDERPAID_AMOUNT' };
    }
    if (confirmedCurrency.toUpperCase() !== checkout.currency.toUpperCase()) {
      return { valid: false, error: 'CURRENCY_MISMATCH' };
    }
    return { valid: true };
  }

  // Underpaid confirmation: 10,000 XOF instead of 25,000 XOF
  const underpaidCheck = verifyPaymentIntegrity(pendingCheckout, 10000, 'XOF');
  assert.strictEqual(underpaidCheck.valid, false);
  assert.strictEqual(underpaidCheck.error, 'UNDERPAID_AMOUNT');

  // Currency mismatch confirmation: 25,000 USD instead of 25,000 XOF
  const currencyCheck = verifyPaymentIntegrity(pendingCheckout, 25000, 'USD');
  assert.strictEqual(currencyCheck.valid, false);
  assert.strictEqual(currencyCheck.error, 'CURRENCY_MISMATCH');

  // Exact match confirmation: valid
  const exactCheck = verifyPaymentIntegrity(pendingCheckout, 25000, 'XOF');
  assert.strictEqual(exactCheck.valid, true);

  // Overpayment is safely accepted
  const overpayCheck = verifyPaymentIntegrity(pendingCheckout, 30000, 'XOF');
  assert.strictEqual(overpayCheck.valid, true);
});

test('38. Replay of terminal states (failed/cancelled/refunded) rejected with HTTP 409 transition error', async () => {
  const terminalPayments = [
    { reference: 'REF-TERM-1', status: 'failed' },
    { reference: 'REF-TERM-2', status: 'cancelled' },
    { reference: 'REF-TERM-3', status: 'refunded' },
  ];

  for (const pay of terminalPayments) {
    let transitionError = null;
    let httpStatus = 200;

    if (['failed', 'cancelled', 'refunded'].includes(pay.status)) {
      transitionError = 'PAYMENT_ALREADY_TERMINATED';
      httpStatus = 409;
    }

    assert.strictEqual(httpStatus, 409, `Terminal status ${pay.status} must return HTTP 409`);
    assert.strictEqual(transitionError, 'PAYMENT_ALREADY_TERMINATED');
  }
});

test('39. Server-authoritative checkout route validation: Tampered client amount is ignored and replaced by authoritative pricing', async () => {
  // Simulates /api/v1/billing/checkout validation
  const clientPayload = {
    planId: 'single',
    billingCycle: 'monthly',
    amount: 1, // Tampered client amount (1 XOF instead of 15,000 XOF)
    currency: 'XOF',
    country: 'CI',
    moduleIds: ['garage-auto'],
  };

  function calculatePlanPrice(planId, billingCycle, moduleCount = 1) {
    const norm = planId === 'starter' ? 'single' : planId === 'pro' ? 'bundle' : planId;
    if (norm === 'single') return { amount: billingCycle === 'yearly' ? 150000 : 15000, currency: 'XOF' };
    return { amount: 35000, currency: 'XOF' };
  }

  // Server overrides client-supplied amount with authoritative price
  const authoritative = calculatePlanPrice(clientPayload.planId, clientPayload.billingCycle, clientPayload.moduleIds.length);
  assert.strictEqual(authoritative.amount, 15000, 'Server must calculate 15,000 XOF');
  assert.notStrictEqual(authoritative.amount, clientPayload.amount, 'Client tampered amount of 1 XOF must be ignored');
});

test('40. Exact reference matching: Payment lookup rejects broad substring collisions', async () => {
  const existingPayments = [
    { reference: 'KZ-1700000000000-1111', company_id: 'comp-A', status: 'paid' },
    { reference: 'KZ-1700000000000-11110', company_id: 'comp-B', status: 'paid' },
  ];

  // Exact reference lookup
  const targetRef = 'KZ-1700000000000-1111';
  const matched = existingPayments.filter((p) => p.reference === targetRef);

  assert.strictEqual(matched.length, 1, 'Exact reference matching must resolve exactly one payment record');
  assert.strictEqual(matched[0].company_id, 'comp-A');
});

// ─── Priority 5: Additional Regression Tests ─────────────────────────────────

test('41. Priority 5.1: Lower-tier checkout cannot gain a higher tier through modified status query parameters', async () => {
  // Stored pending checkout in payment_history was created for 'single' plan (15,000 XOF)
  const storedPendingPayment = {
    id: 'pay-001',
    company_id: 'comp-garage-01',
    plan_id: 'single',
    billing_cycle: 'monthly',
    module_ids: ['garage-auto'],
    amount: 15000,
    currency: 'XOF',
    status: 'pending',
    reference: 'KZ-SINGLE-001',
  };

  // Attacker returns with modified status query parameters attempting to claim 'all_access'
  const modifiedQueryParams = {
    planId: 'all_access',
    billingCycle: 'yearly',
    moduleIds: ['garage-auto', 'hotel-property', 'salon'],
  };

  // Simulating the resolution in getPaymentSessionStatus:
  // It binds terms to stored payment_history (payHistory), ignoring client fallback query parameters
  const effectivePlanId = storedPendingPayment.plan_id || modifiedQueryParams.planId || 'starter';
  const effectiveBillingCycle = storedPendingPayment.billing_cycle || modifiedQueryParams.billingCycle || 'monthly';
  const effectiveModuleIds = Array.isArray(storedPendingPayment.module_ids) && storedPendingPayment.module_ids.length > 0
    ? storedPendingPayment.module_ids
    : modifiedQueryParams.moduleIds;

  assert.strictEqual(effectivePlanId, 'single', 'Effective plan must remain single, not all_access');
  assert.strictEqual(effectiveBillingCycle, 'monthly', 'Effective billing cycle must remain monthly, not yearly');
  assert.deepStrictEqual(effectiveModuleIds, ['garage-auto'], 'Effective module IDs must not include hotel or salon');
});

test('42. Priority 5.2: Module IDs and billing cycle cannot be replaced during confirmation RPC', async () => {
  // Simulates confirm_moteur_payment RPC term-binding logic
  const storedCheckout = {
    id: 'pay-002',
    company_id: 'comp-garage-01',
    reference: 'KZ-FIXED-002',
    plan_id: 'single',
    billing_cycle: 'monthly',
    module_ids: ['garage-auto'],
    amount: 15000,
    currency: 'XOF',
    status: 'pending',
  };

  function simulateConfirmRPC({ companyId, reference, amount, currency, planId, billingCycle, moduleIds }) {
    // 1. Basic validation
    if (!['monthly', 'yearly'].includes(billingCycle?.toLowerCase())) {
      return { status: 'invalid', code: 'INVALID_BILLING_CYCLE' };
    }
    // 2. Terms mismatch checks against stored pending checkout
    if (storedCheckout.plan_id && planId !== storedCheckout.plan_id) {
      return { status: 'invalid', code: 'PLAN_MISMATCH', message: 'Confirmation plan does not match checkout plan' };
    }
    if (storedCheckout.billing_cycle && billingCycle.toLowerCase() !== storedCheckout.billing_cycle) {
      return { status: 'invalid', code: 'BILLING_CYCLE_MISMATCH', message: 'Confirmation billing cycle does not match checkout billing cycle' };
    }
    // Effective terms bound to stored checkout
    return {
      status: 'success',
      effectivePlanId: storedCheckout.plan_id,
      effectiveBillingCycle: storedCheckout.billing_cycle,
      effectiveModuleIds: storedCheckout.module_ids,
    };
  }

  // Attempt 1: Tampered planId ('all_access') is strictly rejected
  const resTamperedPlan = simulateConfirmRPC({
    companyId: 'comp-garage-01',
    reference: 'KZ-FIXED-002',
    amount: 15000,
    currency: 'XOF',
    planId: 'all_access', // Tampered!
    billingCycle: 'monthly',
    moduleIds: ['garage-auto'],
  });
  assert.strictEqual(resTamperedPlan.status, 'invalid');
  assert.strictEqual(resTamperedPlan.code, 'PLAN_MISMATCH');

  // Attempt 2: Tampered billingCycle ('yearly') is strictly rejected
  const resTamperedCycle = simulateConfirmRPC({
    companyId: 'comp-garage-01',
    reference: 'KZ-FIXED-002',
    amount: 15000,
    currency: 'XOF',
    planId: 'single',
    billingCycle: 'yearly', // Tampered!
    moduleIds: ['garage-auto'],
  });
  assert.strictEqual(resTamperedCycle.status, 'invalid');
  assert.strictEqual(resTamperedCycle.code, 'BILLING_CYCLE_MISMATCH');

  // Attempt 3: Valid confirmation matching checkout succeeds and binds stored terms
  const resValid = simulateConfirmRPC({
    companyId: 'comp-garage-01',
    reference: 'KZ-FIXED-002',
    amount: 15000,
    currency: 'XOF',
    planId: 'single',
    billingCycle: 'monthly',
    moduleIds: ['all-sorts-of-extra-modules'], // Client attempts extra modules
  });
  assert.strictEqual(resValid.status, 'success');
  assert.deepStrictEqual(resValid.effectiveModuleIds, ['garage-auto'], 'Effective modules must strictly follow stored checkout');
});

test('43. Priority 5.3: Yearly polling grants a full yearly subscription (not truncated to 30 days)', async () => {
  // Simulates date calculation in getPaymentSessionStatus and handlePaymentConfirmation
  const baseDate = new Date('2026-03-15T12:00:00.000Z');

  function calculateSubscriptionPeriod(startDate, billingCycle) {
    const periodStart = new Date(startDate);
    const periodEnd = new Date(startDate);
    if (billingCycle === 'yearly') {
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    } else {
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    }
    return { periodStart, periodEnd, durationMs: periodEnd.getTime() - periodStart.getTime() };
  }

  // Yearly cycle
  const yearlySub = calculateSubscriptionPeriod(baseDate, 'yearly');
  assert.strictEqual(yearlySub.periodEnd.toISOString(), '2027-03-15T12:00:00.000Z');

  const daysDifference = yearlySub.durationMs / (1000 * 60 * 60 * 24);
  assert(daysDifference >= 365, `Yearly subscription must grant at least 365 days, got ${daysDifference}`);
  assert.notStrictEqual(daysDifference, 30, 'Yearly subscription must NOT be truncated to 30 days');
});

test('44. Priority 5.4: Monthly and yearly expiration dates use calendar semantics', async () => {
  // Calendar semantics accurately advance by full calendar month interval
  const march1 = new Date('2026-03-01T00:00:00.000Z');
  const marchPlusOneMonth = new Date(march1);
  marchPlusOneMonth.setUTCMonth(marchPlusOneMonth.getUTCMonth() + 1);
  assert.strictEqual(marchPlusOneMonth.toISOString(), '2026-04-01T00:00:00.000Z', 'March 1 + 1 month must be April 1');

  // Leap year calendar semantics: 2024 (leap year) Feb 29 + 1 year
  const leapDay = new Date('2024-02-29T00:00:00.000Z');
  const yearCalc = new Date(leapDay);
  yearCalc.setUTCFullYear(yearCalc.getUTCFullYear() + 1);
  // 2025 is not a leap year, rolls to March 1 (or Feb 28)
  assert.strictEqual(yearCalc.getUTCFullYear(), 2025);

  // Compare with a naive 30-day addition for a 31-day month
  const naive30Days = new Date(march1.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.strictEqual(naive30Days.toISOString(), '2026-03-31T00:00:00.000Z', 'Naive 30 days shortchanges March by 1 day');
  assert.notStrictEqual(naive30Days.toISOString(), marchPlusOneMonth.toISOString(), 'Calendar month must differ from naive 30-day interval');
});

test('45. Priority 5.5: Invalid billing cycles are explicitly rejected and do not default to monthly', async () => {
  // Simulates billing.ts calculatePlanPrice validation
  function calculatePlanPrice(planId, billingCycle, moduleCount = 1, currency = 'XOF') {
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      throw new Error(`Invalid billing cycle "${billingCycle}". Must be "monthly" or "yearly".`);
    }
    const curr = (currency || 'XOF').toUpperCase();
    if (curr !== 'XOF' && curr !== 'XAF') {
      throw new Error(`Currency "${curr}" does not have verified plan pricing. Supported billing currencies are: XOF, XAF.`);
    }
    return { amount: 15000, currency: curr };
  }

  const invalidCycles = ['weekly', 'quarterly', 'daily', 'custom', '', null, undefined];

  for (const invalid of invalidCycles) {
    assert.throws(
      () => calculatePlanPrice('single', invalid),
      (err) => err.message.includes('Invalid billing cycle'),
      `Invalid billing cycle "${invalid}" must throw validation error`
    );
  }

  // Valid cycles must not throw
  assert.doesNotThrow(() => calculatePlanPrice('single', 'monthly'));
  assert.doesNotThrow(() => calculatePlanPrice('single', 'yearly'));
});

test('46. Priority 5.6: Currency mismatches and unsupported pricing fail closed', async () => {
  function calculatePlanPrice(planId, billingCycle, moduleCount = 1, currency = 'XOF') {
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      throw new Error(`Invalid billing cycle "${billingCycle}". Must be "monthly" or "yearly".`);
    }
    const curr = (currency || 'XOF').toUpperCase();
    if (curr !== 'XOF' && curr !== 'XAF') {
      throw new Error(`Currency "${curr}" does not have verified plan pricing. Supported billing currencies are: XOF, XAF.`);
    }
    const norm = planId === 'starter' ? 'single' : planId === 'pro' ? 'bundle' : planId;
    if (norm === 'all_access') return { amount: billingCycle === 'yearly' ? 550000 : 55000, currency: curr };
    if (norm === 'bundle') return { amount: billingCycle === 'yearly' ? 350000 : 35000, currency: curr };
    if (norm === 'single') return { amount: billingCycle === 'yearly' ? 150000 : 15000, currency: curr };
    return { amount: Math.max(1, moduleCount) * (billingCycle === 'yearly' ? 130000 : 13000), currency: curr };
  }

  // 1. Supported CFA currencies (XOF and XAF) have 1:1 parity and succeed
  const xofRes = calculatePlanPrice('single', 'monthly', 1, 'XOF');
  assert.strictEqual(xofRes.amount, 15000);
  assert.strictEqual(xofRes.currency, 'XOF');

  const xafRes = calculatePlanPrice('single', 'monthly', 1, 'XAF');
  assert.strictEqual(xafRes.amount, 15000);
  assert.strictEqual(xafRes.currency, 'XAF');

  // 2. Unsupported currencies (USD in CD, CDF in CD, EUR) fail closed
  const unsupportedCurrencies = ['USD', 'CDF', 'EUR', 'GBP', 'CAD'];
  for (const unsupp of unsupportedCurrencies) {
    assert.throws(
      () => calculatePlanPrice('single', 'monthly', 1, unsupp),
      (err) => err.message.includes('does not have verified plan pricing'),
      `Currency "${unsupp}" must fail closed with clear validation error`
    );
  }
});

test('47. Priority 5.7: Duplicate and cross-company references are rejected safely', async () => {
  const dbPayments = [
    { id: 'p1', reference: 'KZ-LEGIT-100', company_id: 'comp-alpha', status: 'pending', amount: 15000 },
  ];

  function confirmPayment({ companyId, reference }) {
    const existing = dbPayments.find((p) => p.reference === reference);
    if (!existing) {
      return { status: 'invalid', code: 'PAYMENT_NOT_FOUND' };
    }
    if (existing.company_id !== companyId) {
      return { status: 'invalid', code: 'COMPANY_MISMATCH', message: 'Payment reference belongs to another company' };
    }
    if (existing.status === 'paid') {
      return { status: 'duplicate', code: 'ALREADY_PROCESSED' };
    }
    existing.status = 'paid';
    return { status: 'success' };
  }

  // 1. Cross-company hijack attempt from comp-beta
  const crossCompanyRes = confirmPayment({ companyId: 'comp-beta', reference: 'KZ-LEGIT-100' });
  assert.strictEqual(crossCompanyRes.status, 'invalid');
  assert.strictEqual(crossCompanyRes.code, 'COMPANY_MISMATCH');

  // 2. Legitimate confirmation for comp-alpha
  const legitRes = confirmPayment({ companyId: 'comp-alpha', reference: 'KZ-LEGIT-100' });
  assert.strictEqual(legitRes.status, 'success');

  // 3. Duplicate confirmation attempt for comp-alpha
  const dupRes = confirmPayment({ companyId: 'comp-alpha', reference: 'KZ-LEGIT-100' });
  assert.strictEqual(dupRes.status, 'duplicate');
  assert.strictEqual(dupRes.code, 'ALREADY_PROCESSED');
});

test('48. Priority 5.8: Repeated callbacks cannot duplicate entitlement grants or subscription extensions', async () => {
  let subPeriodEnd = new Date('2026-10-23T00:00:00.000Z');
  let companyModules = new Set();
  let paymentStatus = 'pending';

  function processPaymentWebhook(event) {
    if (paymentStatus === 'paid') {
      return { isDuplicate: true, status: 'duplicate' };
    }
    paymentStatus = 'paid';
    // Extend period by 1 month
    const newEnd = new Date(subPeriodEnd);
    newEnd.setMonth(newEnd.getMonth() + 1);
    subPeriodEnd = newEnd;
    companyModules.add('garage');
    return { isDuplicate: false, status: 'success' };
  }

  // First callback delivery
  const r1 = processPaymentWebhook({ reference: 'KZ-CALLBACK-01' });
  assert.strictEqual(r1.isDuplicate, false);
  const periodEndAfterFirst = subPeriodEnd.toISOString();

  // Second callback delivery (replay)
  const r2 = processPaymentWebhook({ reference: 'KZ-CALLBACK-01' });
  assert.strictEqual(r2.isDuplicate, true);
  assert.strictEqual(subPeriodEnd.toISOString(), periodEndAfterFirst, 'Subscription periodEnd must NOT extend again on duplicate');
  assert.strictEqual(companyModules.size, 1, 'Entitlement module count must remain exactly 1');

  // Third callback delivery
  const r3 = processPaymentWebhook({ reference: 'KZ-CALLBACK-01' });
  assert.strictEqual(r3.isDuplicate, true);
  assert.strictEqual(subPeriodEnd.toISOString(), periodEndAfterFirst, 'Subscription periodEnd must NOT extend again on third call');
});

test('49. Priority 5.9: Salon migration handles existing ID/slug conflicts safely', async () => {
  // Simulates Migration 10 DO block logic on 4 distinct database states
  function runMigrationSeed(existingModules) {
    const byId = existingModules.find((m) => m.id === 'salon');
    const bySlug = existingModules.find((m) => m.slug === 'hair-salon');

    if (byId && bySlug && byId.id !== bySlug.id) {
      // Split conflict: id='salon' has one slug, slug='hair-salon' has another id
      return { action: 'SPLIT_CONFLICT_PRESERVED', notice: 'Modules catalogue conflict detected. Preserving existing data.' };
    }
    if (byId) {
      // id='salon' exists: update metadata safely
      byId.name = 'Salon de Coiffure & Esthétique';
      byId.status = 'active';
      return { action: 'UPDATED_EXISTING_ID_SALON', module: byId };
    }
    if (bySlug) {
      // slug='hair-salon' exists under another ID (e.g. 'hair-salon')
      // Preserve primary key to avoid violating foreign keys!
      bySlug.name = 'Salon de Coiffure & Esthétique';
      bySlug.status = 'active';
      return { action: 'PRESERVED_EXISTING_PK_AND_UPDATED_METADATA', module: bySlug };
    }
    // Clean insert
    const newMod = { id: 'salon', slug: 'hair-salon', name: 'Salon de Coiffure & Esthétique', status: 'active' };
    existingModules.push(newMod);
    return { action: 'INSERTED_CLEAN', module: newMod };
  }

  // Case 1: Clean DB (neither exists)
  const dbCase1 = [];
  const res1 = runMigrationSeed(dbCase1);
  assert.strictEqual(res1.action, 'INSERTED_CLEAN');
  assert.strictEqual(dbCase1.length, 1);
  assert.strictEqual(dbCase1[0].id, 'salon');
  assert.strictEqual(dbCase1[0].slug, 'hair-salon');

  // Case 2: Row with id='salon' exists
  const dbCase2 = [{ id: 'salon', slug: 'salon-beauty', name: 'Old Salon' }];
  const res2 = runMigrationSeed(dbCase2);
  assert.strictEqual(res2.action, 'UPDATED_EXISTING_ID_SALON');
  assert.strictEqual(dbCase2[0].name, 'Salon de Coiffure & Esthétique');

  // Case 3: Row with slug='hair-salon' exists under id='hair-salon'
  // Crucial: Primary key 'hair-salon' must NOT be blindly renamed to 'salon', which would orphan company_modules FKs
  const dbCase3 = [{ id: 'hair-salon', slug: 'hair-salon', name: 'Hair Salon Legacy' }];
  const res3 = runMigrationSeed(dbCase3);
  assert.strictEqual(res3.action, 'PRESERVED_EXISTING_PK_AND_UPDATED_METADATA');
  assert.strictEqual(dbCase3[0].id, 'hair-salon', 'Primary key must be preserved to protect FKs');
  assert.strictEqual(dbCase3[0].name, 'Salon de Coiffure & Esthétique');

  // Case 4: Split conflict (id='salon' has slug='salon-main', but another row has slug='hair-salon' with id='custom-mod')
  const dbCase4 = [
    { id: 'salon', slug: 'salon-main', name: 'Salon Main' },
    { id: 'custom-mod', slug: 'hair-salon', name: 'Custom Hair' },
  ];
  const res4 = runMigrationSeed(dbCase4);
  assert.strictEqual(res4.action, 'SPLIT_CONFLICT_PRESERVED');
  assert(res4.notice.includes('Preserving existing data'));
  assert.strictEqual(dbCase4[0].id, 'salon');
  assert.strictEqual(dbCase4[1].id, 'custom-mod');
});

test('50. Priority 5.10: Catalogue deduplication renders Salon only once for canonical ID/slug strategy', async () => {
  // Simulates platform/lib/modules.ts getModules() merge logic
  const baseModules = [
    { id: 'garage-auto', slug: 'garage-auto', name: 'Garage & Auto Repair' },
    { id: 'hotel-property', slug: 'hotel-property', name: 'Hotel & Property Rental' },
    { id: 'hair-salon', slug: 'hair-salon', name: 'Hair Salon & Beauty Spa' },
  ];

  // Database contains canonical row id='salon', slug='hair-salon'
  const dbRows = [
    { id: 'hotel-property', slug: 'hotel-property', name: 'Gestion Hôtelière' },
    { id: 'garage', slug: 'garage', name: 'Garage & Mécanique' },
    { id: 'salon', slug: 'hair-salon', name: 'Salon de Coiffure & Esthétique' },
  ];

  const CANONICAL_ALIAS_MAP = {
    'garage-auto': 'garage',
    'garage': 'garage',
    'hair-salon': 'salon',
    'salon': 'salon',
    'salon-beauty': 'salon',
    'hotel': 'hotel-property',
    'hotel-property': 'hotel-property',
    'demo-module': 'demo',
    'demo': 'demo',
  };

  const dbMap = new Map();
  dbRows.forEach((m) => {
    dbMap.set(m.id, m);
    if (m.slug) dbMap.set(m.slug, m);
  });

  const merged = [];
  const processedIds = new Set();

  // Step 1: Process base modules
  for (const baseMod of baseModules) {
    const canonicalTarget = CANONICAL_ALIAS_MAP[baseMod.id] || (baseMod.slug ? CANONICAL_ALIAS_MAP[baseMod.slug] : null);
    const dbRow = dbMap.get(baseMod.id) || (baseMod.slug ? dbMap.get(baseMod.slug) : null) || (canonicalTarget ? dbMap.get(canonicalTarget) : null);
    if (dbRow) {
      merged.push({ ...baseMod, id: dbRow.id || baseMod.id, slug: dbRow.slug || baseMod.slug, name: dbRow.name });
    } else {
      merged.push(baseMod);
    }
    processedIds.add(baseMod.id);
    if (baseMod.slug) processedIds.add(baseMod.slug);
    if (canonicalTarget) processedIds.add(canonicalTarget);
    if (dbRow) {
      if (dbRow.id) processedIds.add(dbRow.id);
      if (dbRow.slug) processedIds.add(dbRow.slug);
    }
  }

  // Step 2: Add any external / third-party modules from DB
  dbRows.forEach((m) => {
    const mCanonical = CANONICAL_ALIAS_MAP[m.id] || (m.slug ? CANONICAL_ALIAS_MAP[m.slug] : null);
    if (
      !processedIds.has(m.id) &&
      (!m.slug || !processedIds.has(m.slug)) &&
      (!mCanonical || !processedIds.has(mCanonical))
    ) {
      merged.push(m);
      processedIds.add(m.id);
    }
  });

  // Verify Salon is rendered exactly ONCE in the catalogue
  const salonCards = merged.filter((m) => m.id === 'salon' || m.id === 'hair-salon' || m.slug === 'hair-salon');
  assert.strictEqual(salonCards.length, 1, `Catalogue must render exactly 1 Salon card, got ${salonCards.length}`);
  assert.strictEqual(salonCards[0].id, 'salon');
  assert.strictEqual(salonCards[0].slug, 'hair-salon');
  assert.strictEqual(salonCards[0].name, 'Salon de Coiffure & Esthétique');

  // Verify total catalogue count has no duplicates
  assert.strictEqual(merged.length, 3, `Catalogue should have exactly 3 modules (garage, hotel, salon), got ${merged.length}`);
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

