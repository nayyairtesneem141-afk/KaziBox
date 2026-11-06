import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

// Temporary test paths
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazibox-sec-hardening-'));
process.env.KAZIBOX_STORE_PATH = path.join(tmpDir, 'platform-store.json');
process.env.KAZIBOX_WEBHOOKS_PATH = path.join(tmpDir, 'webhooks-queue.json');
process.env.KAZIBOX_MASTER_KEY = 'test-master-encryption-key-for-kazibox-registry-suite-2026';

const {
  getRuntimeEnvironment,
  getMasterEncryptionKey,
  encryptModuleSecret,
  decryptModuleSecret,
  provisionModuleCredentials,
  getModuleRuntimeSecrets,
  registerOrSaveModule,
  computeSha256Hash,
} = await import('../lib/registry.ts');

const { activateModule } = await import('../lib/modules.ts');
const { authenticateModuleApiKey } = await import('../lib/api-auth.ts');
const { dispatchWebhookEvent } = await import('../lib/webhooks.ts');
const { getStore, setStoreItem } = await import('../lib/storage.ts');

const registryIdRoute = await import('../app/api/v1/modules/registry/[id]/route.ts');
const launchRoute = await import('../app/api/v1/modules/[slug]/launch/route.ts');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

function makeSessionRequest(url, { method = 'GET', session = null, body = undefined, headers = {} } = {}) {
  const reqHeaders = new Headers(headers);
  if (session) {
    const cookieVal = encodeURIComponent(JSON.stringify(session));
    reqHeaders.set('cookie', `kazibox_session=${cookieVal}`);
  }
  if (body !== undefined && !reqHeaders.has('content-type')) {
    reqHeaders.set('content-type', 'application/json');
  }
  return new NextRequest(url, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

console.log('\n================================================================');
console.log('KaziBox Flex Credential Provisioning Security Hardening Tests');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Master Encryption Key Handling
// ---------------------------------------------------------------------------
console.log('1. Encryption Master Key Hardening');

await test('Missing KAZIBOX_MASTER_KEY in production throws KAZIBOX_MASTER_KEY_REQUIRED', () => {
  const oldKey = process.env.KAZIBOX_MASTER_KEY;
  const oldEnv = process.env.NODE_ENV;
  try {
    delete process.env.KAZIBOX_MASTER_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_APP_ENV;

    let threw = false;
    try {
      getMasterEncryptionKey();
    } catch (err) {
      threw = true;
      assert.equal(err.code, 'KAZIBOX_MASTER_KEY_REQUIRED');
    }
    assert.ok(threw, 'Must throw KAZIBOX_MASTER_KEY_REQUIRED when missing in production');
  } finally {
    process.env.KAZIBOX_MASTER_KEY = oldKey;
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  }
});

await test('Short KAZIBOX_MASTER_KEY (< 32 chars) in staging throws INVALID_MASTER_KEY', () => {
  const oldKey = process.env.KAZIBOX_MASTER_KEY;
  const oldAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  try {
    process.env.KAZIBOX_MASTER_KEY = 'short_key_123';
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';

    let threw = false;
    try {
      getMasterEncryptionKey();
    } catch (err) {
      threw = true;
      assert.equal(err.code, 'INVALID_MASTER_KEY');
    }
    assert.ok(threw, 'Must throw INVALID_MASTER_KEY when master key is under 32 chars in staging');
  } finally {
    process.env.KAZIBOX_MASTER_KEY = oldKey;
    if (oldAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = oldAppEnv;
  }
});

await test('Corrupted ciphertext throws DECRYPTION_FAILED and never downgrades to fallback', async () => {
  const store = getStore();
  const validEncrypted = encryptModuleSecret('original_secret_12345');
  assert.ok(validEncrypted.startsWith('enc:v1:'));

  // Corrupt the ciphertext bytes
  const parts = validEncrypted.split(':');
  parts[4] = 'ff'.repeat(parts[4].length / 2); // Overwrite ciphertext with garbage
  const corrupted = parts.join(':');

  store.apiKeys.push({
    id: 'corrupted-key-1',
    moduleId: 'corrupted-saas',
    type: 'sso_secret',
    prefix: 'kz_sso_corrupted...',
    hashedSecret: `type:sso_secret:scope:platform:sha256:abc:${corrupted}`,
    encryptedSecret: corrupted,
    createdAt: new Date().toISOString(),
  });

  store.modules.push({
    id: 'corrupted-saas',
    slug: 'corrupted-saas',
    name: 'Corrupted SaaS',
    kind: 'external',
    status: 'published',
    version: '1.0.0',
    category: 'finance',
    entryUrl: 'https://example.com',
    pricing: { model: 'free' },
  });

  let threw = false;
  try {
    await getModuleRuntimeSecrets('corrupted-saas');
  } catch (err) {
    threw = true;
    assert.equal(err.code, 'DECRYPTION_FAILED');
  }
  assert.ok(threw, 'Must throw DECRYPTION_FAILED on corrupted AES-GCM ciphertext');
});

// ---------------------------------------------------------------------------
// 2. Credential Persistence Must Fail Closed
// ---------------------------------------------------------------------------
console.log('\n2. Credential Persistence Fail Closed');

await test('Missing Supabase admin client in staging throws DATABASE_PERSISTENCE_ERROR without plaintext keys', async () => {
  const oldAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const oldOverride = globalThis.__kaziboxSupabaseAdminOverride;
  try {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    delete globalThis.__kaziboxSupabaseAdminOverride;

    let threw = false;
    try {
      await provisionModuleCredentials('unbacked-module', undefined, { credentialType: 'api_key' });
    } catch (err) {
      threw = true;
      assert.equal(err.code, 'DATABASE_PERSISTENCE_ERROR');
    }
    assert.ok(threw, 'Must fail closed when Supabase is unconfigured in staging');
  } finally {
    if (oldAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = oldAppEnv;
    if (oldOverride !== undefined) globalThis.__kaziboxSupabaseAdminOverride = oldOverride;
  }
});

await test('Failed Supabase insert throws DATABASE_PERSISTENCE_ERROR and returns HTTP 500 via registry API route', async () => {
  const oldOverride = globalThis.__kaziboxSupabaseAdminOverride;
  try {
    const chainable = {
      select() { return chainable; },
      delete() { return Promise.resolve({ error: null }); },
      eq() { return chainable; },
      or() { return chainable; },
      ilike() { return chainable; },
      maybeSingle() { return Promise.resolve({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }); },
      insert() {
        return {
          select() {
            return {
              maybeSingle() {
                return Promise.resolve({
                  data: null,
                  error: { message: 'connection pool timeout: database unreachable' },
                });
              },
            };
          },
        };
      },
    };

    // Provide a mock Supabase client whose insert systematically returns a database failure
    globalThis.__kaziboxSupabaseAdminOverride = {
      from(table) {
        return chainable;
      },
    };

    // Ensure module and admin user exist in store
    const store = getStore();
    store.users = store.users || [];
    store.users.push({
      id: 'usr-admin-1',
      name: 'Admin User',
      email: 'admin@kazibox.com',
      role: 'platform_admin',
      company_id: '11111111-1111-4111-8111-111111111111',
    });

    store.modules.push({
      id: 'test-fail-mod',
      name: 'Test Fail Mod',
      slug: 'test-fail-mod',
      version: '1.0.0',
      category: 'operations',
      status: 'published',
      kind: 'external',
      entryUrl: 'https://example.com/app',
      pricing: { model: 'free' },
    });

    const adminSession = {
      userId: 'usr-admin-1',
      companyId: '11111111-1111-4111-8111-111111111111',
      role: 'platform_admin',
    };

    const req = makeSessionRequest('http://localhost:3000/api/v1/modules/registry/test-fail-mod', {
      method: 'POST',
      session: adminSession,
      body: { action: 'provision_credentials', credentialType: 'api_key' },
    });

    const res = await registryIdRoute.POST(req, { params: { id: 'test-fail-mod' } });
    assert.equal(res.status, 500);

    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'DATABASE_PERSISTENCE_ERROR');
    assert.equal(body.credentials, undefined);
  } finally {
    if (oldOverride !== undefined) globalThis.__kaziboxSupabaseAdminOverride = oldOverride;
    else delete globalThis.__kaziboxSupabaseAdminOverride;
  }
});

// ---------------------------------------------------------------------------
// 3. Removal of Insecure Secret Fallbacks
// ---------------------------------------------------------------------------
console.log('\n3. Unprovisioned External Module Isolation');

await test('Unprovisioned external module throws MISSING_MODULE_CREDENTIALS for SSO launch (HTTP 403)', async () => {
  const store = getStore();
  store.modules.push({
    id: 'unprovisioned-saas',
    slug: 'unprovisioned-saas',
    name: 'Unprovisioned SaaS',
    kind: 'external',
    version: '1.0.0',
    category: 'finance',
    status: 'published',
    entryUrl: 'https://unprovisioned.saas.com/app',
    webhookUrl: 'https://unprovisioned.saas.com/webhook',
    pricing: { model: 'free' },
    pricing_type: 'free',
  });

  store.users = store.users || [];
  store.users.push({
    id: 'usr-user-1',
    name: 'Standard User',
    email: 'user@kazibox.com',
    role: 'manager',
    company_id: '11111111-1111-4111-8111-111111111111',
  });

  await activateModule('11111111-1111-4111-8111-111111111111', 'unprovisioned-saas');

  let threw = false;
  try {
    await getModuleRuntimeSecrets('unprovisioned-saas');
  } catch (err) {
    threw = true;
    assert.equal(err.code, 'MISSING_MODULE_CREDENTIALS');
  }
  assert.ok(threw, 'Must throw MISSING_MODULE_CREDENTIALS for unprovisioned external module');

  // Verify launch route returns 403 with code MISSING_MODULE_CREDENTIALS
  const userSession = {
    userId: 'usr-user-1',
    companyId: '11111111-1111-4111-8111-111111111111',
    role: 'manager',
    modules: ['unprovisioned-saas'],
  };

  const req = makeSessionRequest('http://localhost:3000/api/v1/modules/unprovisioned-saas/launch', {
    method: 'GET',
    session: userSession,
  });

  const launchRes = await launchRoute.POST(req, { params: { slug: 'unprovisioned-saas' } });
  assert.equal(launchRes.status, 403);
  const launchBody = await launchRes.json();
  assert.equal(launchBody.code, 'MISSING_MODULE_CREDENTIALS');
});

await test('Unprovisioned external module outbound webhook fails closed without delivering or leaking platform secrets', async () => {
  const items = await dispatchWebhookEvent(
    'module.activated',
    {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      companyId: '11111111-1111-4111-8111-111111111111',
      moduleId: 'unprovisioned-saas',
    },
    'unprovisioned-saas'
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'failed');
  assert.ok(items[0].responseBody?.includes('Missing webhook signing secret') || items[0].responseBody?.includes('MISSING_MODULE_CREDENTIALS'));
  assert.equal(items[0].signature, '');
});

// ---------------------------------------------------------------------------
// 4. Environment Protection
// ---------------------------------------------------------------------------
console.log('\n4. Environment Protection');

await test('Production rejects kz_test_ API key with 403 TEST_KEY_REJECTED_IN_PRODUCTION even if matching key exists in store', async () => {
  const oldEnv = process.env.NODE_ENV;
  const oldAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_APP_ENV;

    // Put a kz_test_ key in the store
    const store = getStore();
    store.apiKeys.push({
      id: 'key-test-1',
      moduleId: 'test-mod',
      prefix: 'kz_test_12345678...',
      hashedSecret: 'type:api_key:scope:platform:sha256_mock_abc',
      createdAt: new Date().toISOString(),
    });

    const req = new Request('http://localhost:3000/api/v1/context', {
      headers: {
        Authorization: 'Bearer kz_test_12345678_some_secret_key',
        'X-Workspace-Id': '11111111-1111-4111-8111-111111111111',
      },
    });

    const authResult = await authenticateModuleApiKey(req, 'read:context');
    assert.ok(authResult.errorResponse, 'Must reject test key in production');
    assert.equal(authResult.errorResponse.status, 403);
    const body = await authResult.errorResponse.json();
    assert.equal(body.code, 'TEST_KEY_REJECTED_IN_PRODUCTION');
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = oldAppEnv;
  }
});

await test('Staging and dev environments permit valid kz_test_ API keys', async () => {
  const oldAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  try {
    const store = getStore();
    store.modules.push({
      id: 'staging-mod',
      slug: 'staging-mod',
      name: 'Staging Mod',
      status: 'published',
      kind: 'internal',
      version: '1.0.0',
      category: 'operations',
      entryUrl: '/modules/staging-mod',
      pricing: { model: 'free' },
      scopes: ['*'],
    });

    // Provision in local sandbox
    const creds = await provisionModuleCredentials('staging-mod', '11111111-1111-4111-8111-111111111111', {
      credentialType: 'api_key',
      scope: 'platform',
    });

    assert.ok(creds.apiKey?.startsWith('kz_test_'));

    // Now test in staging environment
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';

    const req = new Request('http://localhost:3000/api/v1/context', {
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'X-Workspace-Id': '11111111-1111-4111-8111-111111111111',
      },
    });

    const authResult = await authenticateModuleApiKey(req, 'read:context');
    assert.ok(!authResult.errorResponse, 'Must not error on valid kz_test_ in staging');
    assert.equal(authResult.auth?.moduleId, 'staging-mod');
  } finally {
    if (oldAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = oldAppEnv;
  }
});

// ---------------------------------------------------------------------------
// 5. Legitimate Internal Modules Functionality
// ---------------------------------------------------------------------------
console.log('\n5. Legitimate Internal Platform Module Support');

await test('Legitimate internal module uses platform secrets without error', async () => {
  const store = getStore();
  store.modules.push({
    id: 'internal-core-crm',
    slug: 'internal-core-crm',
    name: 'Core CRM',
    kind: 'internal',
    status: 'published',
    version: '1.0.0',
    category: 'operations',
    entryUrl: '/modules/crm',
    pricing: { model: 'free' },
  });

  const secrets = await getModuleRuntimeSecrets('internal-core-crm');
  assert.ok(secrets.ssoSecret);
  assert.ok(secrets.webhookSecret);
});

// ---------------------------------------------------------------------------
// 6. Client-Side SSO Secret Exposure Boundary & Sidebar Safety
// ---------------------------------------------------------------------------
console.log('\n6. Client-Side SSO Secret Exposure Boundary & Sidebar Safety');

await test('Sidebar.tsx does not import issueModuleToken or access private SSO secrets', async () => {
  const sidebarCode = fs.readFileSync(path.resolve('platform/app/(workspace)/components/Sidebar.tsx'), 'utf8');
  assert.ok(!sidebarCode.includes('issueModuleToken'), 'Sidebar must not call or reference issueModuleToken');
  assert.ok(!sidebarCode.includes('@/lib/sso'), 'Sidebar must not import from @/lib/sso');
  assert.ok(!sidebarCode.includes('KAZIBOX_SSO_SECRET'), 'Sidebar must not reference KAZIBOX_SSO_SECRET');
  assert.ok(sidebarCode.includes('/api/v1/modules/'), 'Sidebar must link external modules via launch API');
  assert.ok(sidebarCode.includes('redirect=true'), 'Sidebar must use redirect=true for external SaaS launch');
});

await test('No Client Component (use client) imports private platform lib/sso', async () => {
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== '.next') {
        scanDir(fullPath);
      } else if (ent.isFile() && (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes("'use client'") || content.includes('"use client"')) {
          assert.ok(
            !content.includes('@/lib/sso') && !content.includes('../lib/sso') && !content.includes('../../lib/sso'),
            `Client component ${fullPath} must not import private server-only @/lib/sso`
          );
        }
      }
    }
  }
  scanDir(path.resolve('platform/app'));
});

await test('Browser execution of getPlatformSsoSecret throws client security error', async () => {
  const { issueModuleToken } = await import('../lib/sso.ts');
  globalThis.window = {};
  try {
    assert.throws(
      () => {
        issueModuleToken(
          { id: 'usr-1', name: 'Test', email: 'test@example.com', role: 'owner' },
          { id: 'ws-1', name: 'WS', company_id: 'ws-1', currency: 'XOF' },
          'test-mod'
        );
      },
      (err) => err.message.includes('SSO secret cannot be accessed in browser / client-side execution')
    );
  } finally {
    delete globalThis.window;
  }
});

await test('Server-side SSO token signing and verification remain fully functional', async () => {
  const { issueModuleToken, verifyModuleToken } = await import('../lib/sso.ts');
  const user = { id: 'usr-123', name: 'Fatou', email: 'fatou@example.com', role: 'owner' };
  const ws = { id: 'ws-456', name: 'Dakar Hub', company_id: 'ws-456', currency: 'XOF' };

  const token = issueModuleToken(user, ws, 'crm');
  assert.ok(typeof token === 'string' && token.split('.').length === 3, 'Must issue 3-part JWT token');

  const result = verifyModuleToken(token);
  assert.ok(result.valid, 'Server must verify signed token');
  assert.equal(result.payload?.userId, 'usr-123');
  assert.equal(result.payload?.workspaceName, 'Dakar Hub');

  // Tampered token must fail
  const tampered = token.slice(0, -5) + 'xxxxx';
  const badResult = verifyModuleToken(tampered);
  assert.equal(badResult.valid, false, 'Tampered token must fail verification');
});

await test('External SaaS launch route supports secure token issuance and verify action', async () => {
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.companyId === '11111111-1111-4111-8111-111111111111');
  if (sub && !sub.includedModuleIds.includes('demo')) {
    sub.includedModuleIds.push('demo');
  }

  const session = {
    userId: 'usr-demo-1',
    companyId: '11111111-1111-4111-8111-111111111111',
    role: 'owner',
    email: 'admin@kazibox.test',
  };

  // 1. Issue token via launch route
  const launchReq = makeSessionRequest('http://localhost:3000/api/v1/modules/demo/launch', {
    method: 'GET',
    session,
  });
  const launchRes = await launchRoute.GET(launchReq, { params: { slug: 'demo' } });
  assert.equal(launchRes.status, 200);
  const launchData = await launchRes.json();
  assert.ok(launchData.success);
  assert.ok(launchData.token);
  assert.ok(launchData.launchUrl);

  // 2. Verify token via launch route with action=verify
  const verifyReq = makeSessionRequest(
    `http://localhost:3000/api/v1/modules/demo/launch?action=verify&token=${encodeURIComponent(launchData.token)}`,
    { method: 'GET', session }
  );
  const verifyRes = await launchRoute.GET(verifyReq, { params: { slug: 'demo' } });
  assert.equal(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.equal(verifyData.valid, true);
  assert.equal(verifyData.payload?.moduleId, 'demo');

  // 3. Rejects invalid token
  const invalidReq = makeSessionRequest(
    'http://localhost:3000/api/v1/modules/demo/launch?action=verify&token=invalid.token.data',
    { method: 'GET', session }
  );
  const invalidRes = await launchRoute.GET(invalidReq, { params: { slug: 'demo' } });
  const invalidData = await invalidRes.json();
  assert.equal(invalidData.valid, false);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
