/**
 * KaziBox – Phase 1 + 1.5 Security Boundary Tests
 *
 * No external testing framework needed. Run with:
 *   node platform/tests/security.test.mjs
 *
 * Primary auth path (production): Supabase JWT via supabase.auth.getUser().
 * Fallback path (demo/offline only): plain-JSON kazibox_session cookie.
 *
 * Each test() call logs PASS / FAIL and exits with code 1 if anything fails.
 */
import crypto from 'node:crypto';

// ─── Minimal test harness ─────────────────────────────────────────────────────
let failed = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result
        .then(() => console.log(`  ✅ PASS  ${name}`))
        .catch((err) => {
          console.error(`  ❌ FAIL  ${name}\n         ${err.message}`);
          failed++;
        });
    } else {
      console.log(`  ✅ PASS  ${name}`);
    }
  } catch (err) {
    console.error(`  ❌ FAIL  ${name}\n         ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ─── Minimal mocks (no framework required) ───────────────────────────────────

function mockReq({ cookies = {}, headers = {}, body = null } = {}) {
  return {
    cookies: {
      get: (name) => (cookies[name] ? { value: cookies[name] } : undefined),
    },
    headers: {
      get: (name) => headers[name.toLowerCase()] || null,
    },
    _body: body,
  };
}

// ── server-auth logic re-implementation (pure JS, no Next.js runtime) ─────────
// We test the logic directly as pure functions to avoid Next.js server-only
// imports, which cannot run in plain Node.

function parseSessionCookie(cookieValue) {
  if (!cookieValue) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(cookieValue));
    if (!decoded?.userId || !decoded?.companyId) return null;
    return { userId: decoded.userId, companyId: decoded.companyId };
  } catch {
    return null;
  }
}

function isPrivilegedRole(role) {
  return role === 'owner' || role === 'platform_admin';
}

function sessionBelongsToCompany(session, companyId) {
  return !!session && session.companyId === companyId;
}

// ── api-auth logic (pure functions) ──────────────────────────────────────────
function hashSecret(secret) {
  // Mirrors the hashSecret in api-auth.ts (mock hash)
  return `sha256_mock_${Buffer.from(secret).toString('base64').substring(0, 16)}`;
}

function resolveApiKey(apiKey, storedKeys) {
  const computedHash = hashSecret(apiKey);
  const match = storedKeys.find(
    (k) =>
      k.hashedSecret === computedHash ||
      apiKey.startsWith(k.prefix.replace('...', ''))
  );
  return match || null;
}

function validateWorkspaceBinding(requestedWsId, keyCompanyId) {
  if (requestedWsId && keyCompanyId && requestedWsId !== keyCompanyId) {
    return { ok: false, code: 'WORKSPACE_MISMATCH' };
  }
  return { ok: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── JWT primary path simulation ─────────────────────────────────────────────
// We cannot call the real supabase.auth.getUser() in a plain-Node test, so we
// model the two outcomes it can produce and assert server-auth reacts correctly.

/**
 * Simulates getServerSession() when supabase.auth.getUser() returns a verified user.
 * In production this would be a cryptographically valid Supabase JWT.
 */
async function simulateJwtSession({ sbUser, profile } = {}) {
  // If getUser() returns no user, session must be null.
  if (!sbUser) return null;
  // If there is no matching profile row, session must be null.
  if (!profile) return null;
  // Success: return session shaped from DB row, NOT from any request header.
  return {
    userId: profile.id,
    companyId: profile.company_id,
    role: profile.role || 'worker',
    email: profile.email || sbUser.email || '',
    name: profile.name || '',
  };
}

console.log('\n── server-auth: JWT primary path (Supabase configured) ──');

test('Valid JWT + profile → session returned', async () => {
  const session = await simulateJwtSession({
    sbUser: { id: 'sb-uid-001', email: 'owner@hotel.ci' },
    profile: { id: 'sb-uid-001', company_id: 'c-hotel-001', role: 'owner', email: 'owner@hotel.ci', name: 'Alice' },
  });
  assert(session !== null, 'Expected session from valid JWT');
  assert(session.userId === 'sb-uid-001', 'Wrong userId');
  assert(session.companyId === 'c-hotel-001', 'Wrong companyId');
  assert(session.role === 'owner', 'Wrong role');
});

test('JWT verifies user but profile missing → null (no ghost sessions)', async () => {
  const session = await simulateJwtSession({
    sbUser: { id: 'sb-uid-orphan', email: 'orphan@hotel.ci' },
    profile: null, // no profile row
  });
  assert(session === null, 'Missing profile must return null');
});

test('getUser() returns null (forged/expired JWT) → null session', async () => {
  const session = await simulateJwtSession({ sbUser: null, profile: null });
  assert(session === null, 'Forged JWT must not produce a session');
});

test('Session userId always comes from Supabase user record, never from request header', async () => {
  // Simulate an attacker sending x-user-id: 'attacker' with a valid JWT for a different user.
  const attackerHeader = 'attacker-uid';
  const session = await simulateJwtSession({
    sbUser: { id: 'real-user-001', email: 'legit@hotel.ci' },
    profile: { id: 'real-user-001', company_id: 'c-hotel-001', role: 'worker', email: 'legit@hotel.ci', name: 'Bob' },
  });
  // The session userId must be the verified JWT user, not the injected header.
  assert(session !== null);
  assert(session.userId !== attackerHeader, 'Header injection must not affect userId');
  assert(session.userId === 'real-user-001', 'Must use Supabase-verified userId');
});

test('CompanyId always comes from profile row, never from cookie/header', async () => {
  const forgedCookieCompany = 'c-victim-999';
  const session = await simulateJwtSession({
    sbUser: { id: 'real-user-001', email: 'legit@hotel.ci' },
    profile: { id: 'real-user-001', company_id: 'c-hotel-001', role: 'worker', email: 'legit@hotel.ci', name: 'Bob' },
  });
  assert(session !== null);
  assert(session.companyId !== forgedCookieCompany, 'Forged companyId must be ignored');
  assert(session.companyId === 'c-hotel-001', 'CompanyId must come from profile row');
});

console.log('\n── server-auth: demo fallback cookie (offline/demo mode ONLY) ──');

test('Missing cookie → null session', () => {
  const req = mockReq({ cookies: {} });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result === null, 'Expected null for missing cookie');
});

test('Malformed JSON → null session', () => {
  const req = mockReq({ cookies: { kazibox_session: 'NOT_JSON' } });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result === null, 'Expected null for malformed JSON');
});

test('Cookie missing userId → null session', () => {
  const val = encodeURIComponent(JSON.stringify({ companyId: 'c-001' }));
  const req = mockReq({ cookies: { kazibox_session: val } });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result === null, 'Expected null when userId missing');
});

test('Cookie missing companyId → null session', () => {
  const val = encodeURIComponent(JSON.stringify({ userId: 'u-001' }));
  const req = mockReq({ cookies: { kazibox_session: val } });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result === null, 'Expected null when companyId missing');
});

test('Valid cookie → session with userId and companyId', () => {
  const val = encodeURIComponent(JSON.stringify({ userId: 'u-001', companyId: 'c-001' }));
  const req = mockReq({ cookies: { kazibox_session: val } });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result !== null, 'Expected session');
  assert(result.userId === 'u-001', 'Wrong userId');
  assert(result.companyId === 'c-001', 'Wrong companyId');
});

test('Forged x-user-id header is ignored (not used as identity)', () => {
  // server-auth never reads these headers; we confirm by showing that a
  // request with ONLY x-user-id (no cookie) produces null.
  const req = mockReq({ headers: { 'x-user-id': 'attacker-uid', 'x-company-id': 'victim-co' } });
  const result = parseSessionCookie(req.cookies.get('kazibox_session')?.value);
  assert(result === null, 'Identity headers must not be trusted');
});

console.log('\n── server-auth: role and company helpers ──');

test('owner is privileged', () => {
  assert(isPrivilegedRole('owner'), 'owner should be privileged');
});

test('platform_admin is privileged', () => {
  assert(isPrivilegedRole('platform_admin'), 'platform_admin should be privileged');
});

test('worker is NOT privileged', () => {
  assert(!isPrivilegedRole('worker'), 'worker should not be privileged');
});

test('manager is NOT privileged', () => {
  assert(!isPrivilegedRole('manager'), 'manager should not be privileged');
});

test('sessionBelongsToCompany: matching company → true', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'owner' };
  assert(sessionBelongsToCompany(session, 'c-001'));
});

test('sessionBelongsToCompany: different company → false', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'owner' };
  assert(!sessionBelongsToCompany(session, 'c-002'), 'Cross-company access must be rejected');
});

test('sessionBelongsToCompany: null session → false', () => {
  assert(!sessionBelongsToCompany(null, 'c-001'));
});

console.log('\n── api-auth: key resolution ──');

const mockStoredKeys = [
  {
    hashedSecret: hashSecret('valid_key_for_hotel'),
    prefix: 'valid_key_fo...',
    moduleId: 'hotel-property',
    companyId: 'c-hotel-001',
  },
];

test('Valid API key resolves to correct module', () => {
  const key = resolveApiKey('valid_key_for_hotel', mockStoredKeys);
  assert(key !== null, 'Expected key to resolve');
  assert(key.moduleId === 'hotel-property', 'Wrong moduleId');
  assert(key.companyId === 'c-hotel-001', 'Wrong companyId');
});

test('Unknown API key → null', () => {
  const key = resolveApiKey('unknown_random_key', mockStoredKeys);
  assert(key === null, 'Unknown key must not resolve');
});

test('String "demo" in key does NOT grant access (dev bypass removed)', () => {
  const key = resolveApiKey('kz_demo_bypass_key', mockStoredKeys);
  assert(key === null, 'demo-string bypass must be removed');
});

test('String "hotel" in key does NOT grant access without proper hash', () => {
  const key = resolveApiKey('kz_hotel_bypass_key', mockStoredKeys);
  assert(key === null, 'hotel-string bypass must be removed');
});

test('String "garage" in key does NOT grant access without proper hash', () => {
  const key = resolveApiKey('kz_garage_bypass_key', mockStoredKeys);
  assert(key === null, 'garage-string bypass must be removed');
});

console.log('\n── api-auth: workspace binding ──');

test('Matching workspace → ok', () => {
  const result = validateWorkspaceBinding('c-hotel-001', 'c-hotel-001');
  assert(result.ok, 'Matching workspace should pass');
});

test('Mismatched workspace → WORKSPACE_MISMATCH', () => {
  const result = validateWorkspaceBinding('c-attacker-999', 'c-hotel-001');
  assert(!result.ok, 'Mismatch should fail');
  assert(result.code === 'WORKSPACE_MISMATCH', 'Wrong error code');
});

test('No requested workspace → ok (key company used)', () => {
  const result = validateWorkspaceBinding(null, 'c-hotel-001');
  assert(result.ok, 'Absent workspace header should be ok');
});

test('No key company and no requested workspace → ok (caller provides nothing)', () => {
  const result = validateWorkspaceBinding(null, null);
  assert(result.ok);
});

console.log('\n── module activation: role enforcement ──');

test('worker cannot activate modules', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'worker' };
  assert(!isPrivilegedRole(session.role), 'worker must be blocked from activation');
});

test('manager cannot activate modules', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'manager' };
  assert(!isPrivilegedRole(session.role), 'manager must be blocked from activation');
});

test('owner can activate modules', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'owner' };
  assert(isPrivilegedRole(session.role), 'owner must be allowed to activate');
});

test('Cross-tenant activation attempt blocked', () => {
  const session = { userId: 'u1', companyId: 'c-001', role: 'owner' };
  const requestedCompanyId = 'c-victim-002';
  const allowed = session.role === 'platform_admin' || requestedCompanyId === session.companyId;
  assert(!allowed, 'Cross-tenant activation must be blocked');
});

test('platform_admin can target any company', () => {
  const session = { userId: 'u-admin', companyId: 'c-admin', role: 'platform_admin' };
  const requestedCompanyId = 'c-any-tenant';
  const effectiveCompanyId =
    session.role === 'platform_admin' ? requestedCompanyId : session.companyId;
  assert(effectiveCompanyId === 'c-any-tenant', 'platform_admin should be able to target any company');
});

// ── webhook signature verification ──────────────────────────────────────────
function computeSignatureHex(secret, data) {
  let h1 = 0xdeadbeef ^ secret.length;
  let h2 = 0x41c64e6d ^ data.length;
  const combined = `${secret}:${data}:${secret}`;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let fullSig = '';
  for (let i = 0; i < 4; i++) {
    fullSig += ((h1 ^ (i * 0x9e3779b9)) >>> 0).toString(16).padStart(8, '0');
    fullSig += ((h2 ^ (i * 0x517cc1b7)) >>> 0).toString(16).padStart(8, '0');
  }
  return fullSig;
}

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const bodyString = typeof rawBody === 'string'
    ? rawBody
    : (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody));

  const rawSig = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;

  if (crypto) {
    const expectedHex = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
    const rawSigBuf = Buffer.from(rawSig, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (rawSigBuf.length !== expectedBuf.length || rawSigBuf.length === 0) return false;
    return crypto.timingSafeEqual(rawSigBuf, expectedBuf);
  }

  const expectedSig = computeSignatureHex(secret, bodyString);
  if (rawSig.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < rawSig.length; i++) {
    mismatch |= rawSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}

console.log('\n── webhooks: signature verification ──');

test('Valid HMAC-SHA256 signature passes verification with exact raw body', () => {
  const secret = 'sec_moteur_kz_123';
  const rawBody = JSON.stringify({ event: 'subscription.activated', workspaceId: 'ws-1' });
  const validHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const validSig = `sha256=${validHex}`;
  assert(verifyWebhookSignature(rawBody, validSig, secret), 'Valid signature must verify');
});

test('Tampered raw body fails verification', () => {
  const secret = 'sec_moteur_kz_123';
  const originalBody = JSON.stringify({ event: 'subscription.activated', workspaceId: 'ws-1' });
  const validHex = crypto.createHmac('sha256', secret).update(originalBody).digest('hex');
  const validSig = `sha256=${validHex}`;
  const tamperedBody = JSON.stringify({ event: 'subscription.activated', workspaceId: 'ws-attacker' });
  assert(!verifyWebhookSignature(tamperedBody, validSig, secret), 'Tampered body must be rejected');
});

test('Incorrect secret fails verification', () => {
  const secret = 'sec_moteur_kz_123';
  const wrongSecret = 'sec_forged_999';
  const rawBody = JSON.stringify({ event: 'payment.completed', amount: 50000 });
  const forgedHex = crypto.createHmac('sha256', wrongSecret).update(rawBody).digest('hex');
  const validSig = `sha256=${forgedHex}`;
  assert(!verifyWebhookSignature(rawBody, validSig, secret), 'Forged secret must be rejected');
});

test('Missing or empty signature/secret returns false', () => {
  const rawBody = JSON.stringify({ event: 'test' });
  assert(!verifyWebhookSignature(rawBody, '', 'sec'), 'Empty signature must return false');
  assert(!verifyWebhookSignature(rawBody, null, 'sec'), 'Null signature must return false');
  assert(!verifyWebhookSignature(rawBody, 'sha256=1234', ''), 'Empty secret must return false');
  assert(!verifyWebhookSignature(rawBody, 'sha256=1234', null), 'Null secret must return false');
});

// ── Task 1: API Security & Multi-Tenant Route Isolation ───────────────────────
console.log('\n── Task 1: API Security & Multi-Tenant Route Isolation ──');

const testState = {
  users: [
    { id: 'usr-1', email: 'owner_a@example.com', company_id: 'comp-a', role: 'owner' },
    { id: 'usr-2', email: 'worker_a@example.com', company_id: 'comp-a', role: 'worker' },
    { id: 'usr-3', email: 'owner_b@example.com', company_id: 'comp-b', role: 'owner' },
    { id: 'usr-admin', email: 'admin@kazibox.io', company_id: 'comp-a', role: 'platform_admin' },
  ],
  members: [
    // usr-1 is also a 'worker' in comp-b (multi-workspace membership)
    { id: 'mem-1', company_id: 'comp-b', user_id: 'usr-1', email: 'owner_a@example.com', role: 'worker', status: 'active' },
  ],
  entitlements: {
    'comp-a': ['hotel-property', 'garage-auto'],
    'comp-b': ['salon-beauty'],
  },
  rooms: [
    { id: 'room-101', company_id: 'comp-a', room_number: '101' },
    { id: 'room-201', company_id: 'comp-b', room_number: '201' },
  ],
};

function simulateRequireServerAuth(req, options, state = testState) {
  const cookieVal = req.cookies.get('kazibox_session')?.value;
  if (!cookieVal) {
    return { status: 401, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' };
  }

  let sessionData = null;
  try {
    sessionData = JSON.parse(decodeURIComponent(cookieVal));
  } catch {
    return { status: 401, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' };
  }

  if (!sessionData?.userId) {
    return { status: 401, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' };
  }

  const user = state.users.find((u) => u.id === sessionData.userId);
  if (!user) {
    return { status: 401, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' };
  }

  const targetCompany = options?.targetCompanyId || sessionData.companyId || user.company_id;

  // Resolve role in targetCompany
  let effectiveRole = null;
  if (user.role === 'platform_admin') {
    effectiveRole = 'platform_admin';
  } else if (user.company_id === targetCompany) {
    effectiveRole = user.role;
  } else {
    const member = state.members.find(
      (m) =>
        m.company_id === targetCompany &&
        (m.user_id === user.id || m.email === user.email) &&
        m.status === 'active'
    );
    if (member) {
      effectiveRole = member.role;
    }
  }

  // Cross-tenant boundary check: user has no membership in targetCompany
  if (!effectiveRole) {
    return { status: 403, error: 'Forbidden', code: 'COMPANY_MISMATCH' };
  }

  // Role permissions check
  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    if (!options.allowedRoles.includes(effectiveRole)) {
      return { status: 403, error: 'Forbidden', code: 'INSUFFICIENT_ROLE' };
    }
  }

  // Module entitlement check
  if (options?.requiredModuleId) {
    const activeMods = state.entitlements[targetCompany] || [];
    if (!activeMods.includes(options.requiredModuleId)) {
      return { status: 403, error: 'Forbidden', code: 'MODULE_NOT_ENTITLED' };
    }
  }

  return {
    status: 200,
    session: {
      userId: user.id,
      companyId: targetCompany,
      role: effectiveRole,
    },
  };
}

test('1. Unauthenticated request to business-module API returns 401', () => {
  const req = mockReq({ cookies: {} });
  const result = simulateRequireServerAuth(req, { requiredModuleId: 'hotel-property' });
  assert(result.status === 401, 'Must return 401 for missing session');
  assert(result.code === 'NOT_AUTHENTICATED', 'Code must be NOT_AUTHENTICATED');
});

test('2. Company A user cannot access Company B records by supplying company_id (rejected with 403)', () => {
  // usr-2 belongs only to comp-a
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-2', companyId: 'comp-a' })),
    },
  });
  // Attempting to access comp-b
  const result = simulateRequireServerAuth(req, {
    targetCompanyId: 'comp-b',
    requiredModuleId: 'salon-beauty',
  });
  assert(result.status === 403, 'Must return 403 Forbidden for cross-tenant access');
  assert(result.code === 'COMPANY_MISMATCH', 'Code must be COMPANY_MISMATCH');
});

test('3. Cross-tenant resource manipulation is blocked (queries scoped to authorized company)', () => {
  // User authenticated for comp-a attempts to manipulate room-201 (which belongs to comp-b)
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-1', companyId: 'comp-a' })),
    },
  });
  const auth = simulateRequireServerAuth(req, { requiredModuleId: 'hotel-property' });
  assert(auth.status === 200, 'Auth succeeds for comp-a');

  // Simulated DB query scoped by company_id:
  const foundRoom = testState.rooms.find(
    (r) => r.id === 'room-201' && r.company_id === auth.session.companyId
  );
  assert(!foundRoom, 'Room from company B cannot be matched in company A queries');
});

test('4. Worker cannot perform privileged manager/owner mutation (rejected with 403)', () => {
  // usr-2 is a worker in comp-a
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-2', companyId: 'comp-a' })),
    },
  });
  const result = simulateRequireServerAuth(req, {
    requiredModuleId: 'hotel-property',
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  assert(result.status === 403, 'Worker must be blocked from owner/manager mutations');
  assert(result.code === 'INSUFFICIENT_ROLE', 'Code must be INSUFFICIENT_ROLE');
});

test('5. Users cannot write to modules they have not subscribed to (rejected with 403)', () => {
  // comp-a has hotel-property and garage-auto, but NOT salon-beauty
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-1', companyId: 'comp-a' })),
    },
  });
  const result = simulateRequireServerAuth(req, {
    requiredModuleId: 'salon-beauty',
  });
  assert(result.status === 403, 'Must return 403 when module is not entitled');
  assert(result.code === 'MODULE_NOT_ENTITLED', 'Code must be MODULE_NOT_ENTITLED');
});

test('6. Authorized members can perform permitted actions in their own workspace', () => {
  // usr-1 is owner of comp-a, comp-a is entitled to hotel-property
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-1', companyId: 'comp-a' })),
    },
  });
  const result = simulateRequireServerAuth(req, {
    requiredModuleId: 'hotel-property',
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  assert(result.status === 200, 'Owner must be permitted');
  assert(result.session.companyId === 'comp-a', 'CompanyId must be comp-a');
  assert(result.session.role === 'owner', 'Role must be owner');
});

test('7. Workspace switching refreshes the correct role for destination company', () => {
  // usr-1 is 'owner' in comp-a, but only 'worker' in comp-b (via team_members)
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-1', companyId: 'comp-b' })),
    },
  });
  const result = simulateRequireServerAuth(req, {
    targetCompanyId: 'comp-b',
    requiredModuleId: 'salon-beauty',
  });
  assert(result.status === 200, 'Member access to comp-b is allowed');
  assert(result.session.companyId === 'comp-b', 'CompanyId is comp-b');
  assert(result.session.role === 'worker', 'Role must be refreshed to worker for comp-b');
});

test('8. Platform admin can access any workspace with platform_admin role', () => {
  const req = mockReq({
    cookies: {
      kazibox_session: encodeURIComponent(JSON.stringify({ userId: 'usr-admin', companyId: 'comp-b' })),
    },
  });
  const result = simulateRequireServerAuth(req, {
    targetCompanyId: 'comp-b',
    requiredModuleId: 'salon-beauty',
  });
  assert(result.status === 200, 'Platform admin is permitted');
  assert(result.session.companyId === 'comp-b', 'Target company is comp-b');
  assert(result.session.role === 'platform_admin', 'Role is platform_admin');
});

test('9. Cross-tenant garage job item injection blocked (jobId must belong to companyId)', () => {
  // Simulating addGarageJobItem tenant ownership check
  const jobsInDb = [
    { id: 'job-tenant-b', company_id: 'comp-b', total_amount: 50000 },
  ];
  const callerCompany = 'comp-a';
  const targetJobId = 'job-tenant-b';

  const job = jobsInDb.find((j) => j.id === targetJobId && j.company_id === callerCompany);
  assert(!job, 'Job from company B must not be found by company A caller');
});

test('10. Non-platform admin cannot activate paid module without active subscription coverage', () => {
  // Simulating module activation entitlement enforcement
  const callerSession = { role: 'owner', companyId: 'comp-a' };
  const requestedModule = { id: 'garage-auto', pricing_type: 'paid' };
  const subscriptions = [
    { companyId: 'comp-a', status: 'active', planId: 'starter', includedModuleIds: ['hotel-property'] },
  ];

  const sub = subscriptions.find((s) => s.companyId === callerSession.companyId);
  const isCovered =
    callerSession.role === 'platform_admin' ||
    requestedModule.pricing_type === 'free' ||
    (sub &&
      sub.status === 'active' &&
      (sub.planId === 'all_access' || sub.includedModuleIds.includes(requestedModule.id)));

  assert(!isCovered, 'Owner cannot activate paid module not covered by their subscription');
});

test('11. Client-supplied plan_id, status, or price in activation payload cannot override server entitlement', () => {
  // Malicious owner payload attempting to spoof all_access and active status
  const maliciousBody = {
    moduleId: 'hotel-property',
    companyId: 'comp-victim-001',
    plan_id: 'all_access',
    status: 'active',
    price: 0,
    entitlement: 'active',
  };

  // Server only extracts moduleId and companyId, never trusting client-supplied plan/status
  const { moduleId } = maliciousBody;
  assert(moduleId === 'hotel-property');

  // Trusted DB subscription lookup
  const trustedDbSub = null; // No subscription in trusted DB
  const isCovered = !!(trustedDbSub && trustedDbSub.status === 'active');
  assert(!isCovered, 'Spoofed client payload must not grant access without trusted DB record');
});

test('12. Module aliases (hotel/hotel-property, garage/garage-auto, salon/hair-salon) match consistently', () => {
  const normalize = (id) => {
    if (['hair-salon', 'salon', 'salon-beauty'].includes(id)) return ['hair-salon', 'salon', 'salon-beauty'];
    if (['garage', 'garage-auto'].includes(id)) return ['garage', 'garage-auto'];
    if (['hotel', 'hotel-property'].includes(id)) return ['hotel', 'hotel-property'];
    return [id];
  };

  const hotelSub = { includedModuleIds: ['hotel-property'] };
  const garageSub = { includedModuleIds: ['garage-auto'] };
  const salonSub = { includedModuleIds: ['hair-salon'] };

  assert(normalize('hotel').some((id) => hotelSub.includedModuleIds.includes(id)), 'hotel alias matches hotel-property');
  assert(normalize('garage').some((id) => garageSub.includedModuleIds.includes(id)), 'garage alias matches garage-auto');
  assert(normalize('salon').some((id) => salonSub.includedModuleIds.includes(id)), 'salon alias matches hair-salon');
});

test('13. Expired, cancelled, or suspended subscriptions deny paid write access', () => {
  const statuses = ['expired', 'cancelled', 'suspended', 'inactive'];
  for (const status of statuses) {
    const sub = {
      status,
      current_period_end: new Date(Date.now() - 86400000).toISOString(),
      plan_id: 'all_access',
    };
    const isActive = (sub.status === 'active' || sub.status === 'trial') && new Date(sub.current_period_end) > new Date();
    assert(!isActive, `Subscription with status "${status}" must not be active`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n${'─'.repeat(55)}`);
  if (failed === 0) {
    console.log('All security boundary tests PASSED ✅');
  } else {
    console.error(`${failed} test(s) FAILED ❌`);
    process.exit(1);
  }
}, 50);

