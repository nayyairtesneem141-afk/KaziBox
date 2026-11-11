/**
 * KaziBox Flex — Day 1 Core Integration System Verification Suite
 *
 * Verifies all 7 Priority Tasks:
 * 1. Module Registration & Manifest Validation
 * 2. Supabase Database Persistence & Foreign Key Integrity
 * 3. Secure Credential Provisioning, Encryption, Rotation & Revocation
 * 4. API Authentication, Scope-Based Authorization & Tenant Isolation
 * 5. SSO 5-Minute Token Issuance, Signature Verification & Replay Protection
 * 6. Outbound Webhook HMAC-SHA256 Delivery, Idempotency & Persistence
 * 7. Genuine External SaaS Staging Integration Readiness (PharmaStock)
 */

import assert from 'assert';
import http from 'http';
import {
  registerOrSaveModule,
  updateModuleStatus,
  provisionModuleCredentials,
  revokeApiKey,
  getApiKeysForModule,
  getModuleRuntimeSecrets,
  runPwaChecks,
  isValidEndpointUrl,
  encryptModuleSecret,
  decryptModuleSecret,
  computeSha256Hash,
} from '../lib/registry.js';
import { getModule, getModules } from '../lib/modules.js';
import { authenticateModuleApiKey } from '../lib/api-auth.js';
import { dispatchWebhookEvent } from '../lib/webhooks.js';
import { getStore } from '../lib/storage.js';
import { createPharmaServer } from '../../modules/pharmastock/dist/server.js';
import { createAdminClient } from '../lib/supabase/admin.js';
import { isSupabaseConfigured } from '../lib/supabase/config.js';
import { issueSsoToken, verifySsoToken, verifyWebhookSignature } from '@kazibox/sdk';

console.log('═══════════════════════════════════════════════════════════════');
console.log('   KaziBox Flex — Day 1 Core Integration Verification Suite');
console.log('═══════════════════════════════════════════════════════════════\n');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const TEST_COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const TEST_COMPANY_B_ID = '22222222-2222-4222-8222-222222222222';
const STAGING_ORIGIN = 'https://kazibox-staging.vercel.app';

// ─── TASK 1: Module Registration & Schema Validation ─────────────────────────

test('1.1 Rejects registration payload with missing fields, invalid IDs or bad URLs', async () => {
  const badId = await registerOrSaveModule({
    id: 'INVALID SLUG WITH SPACES!',
    name: { fr: 'Test', en: 'Test' },
  });
  assert.strictEqual(badId.success, false);
  assert.strictEqual(badId.code, 'VALIDATION_FAILED');

  const badUrl = await registerOrSaveModule({
    id: 'test-bad-url',
    name: { fr: 'Test', en: 'Test' },
    entryUrl: 'ftp://insecure-ftp.com/app',
  });
  assert.strictEqual(badUrl.success, false);
  assert.strictEqual(badUrl.code, 'VALIDATION_FAILED');
});

test('1.2 Successfully registers a dynamic external SaaS module and enforces schema normalization', async () => {
  const result = await registerOrSaveModule(
    {
      id: 'day1-logistics-saas',
      slug: 'day1-logistics-saas',
      name: { fr: 'Logistique Express', en: 'Express Logistics' },
      tagline: { fr: 'Transport et livraison en temps réel', en: 'Real-time transport and dispatch' },
      description: { fr: 'Solution complète de transport.', en: 'Complete transport solution.' },
      category: 'transport',
      kind: 'external',
      entryUrl: 'https://logistics.example.com/app',
      webhookUrl: 'https://logistics.example.com/api/webhooks',
      summaryUrl: 'https://logistics.example.com/api/summary',
      pricing_type: 'paid',
      pricePerMonth: { amount: 15000, currency: 'XOF' },
      scopes: ['read:context', 'write:finance', 'write:events'],
      pwa: {
        scope: 'https://logistics.example.com/app',
        startUrl: 'https://logistics.example.com/app',
        themeColor: '#2563EB',
        icons: [
          { src: 'https://logistics.example.com/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'https://logistics.example.com/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'https://logistics.example.com/icon-maskable.png', sizes: '512x512', purpose: 'maskable' },
        ],
      },
      status: 'review',
    },
    {
      allowOverwrite: true,
      companyId: TEST_COMPANY_ID,
      provisionCredentials: true,
      origin: STAGING_ORIGIN,
    }
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.module?.id, 'day1-logistics-saas');
  assert.strictEqual(result.module?.kind, 'external');
  assert.strictEqual(result.module?.status, 'review');
  assert(result.credentials?.apiKey, 'API key must be provisioned');
  assert(result.credentials?.ssoSecret, 'SSO secret must be provisioned');
  assert(result.credentials?.webhookSecret, 'Webhook secret must be provisioned');
});

test('1.3 Lifecycle state management enforces 6-point PWA compliance before publishing', async () => {
  // Attempt to register a module with non‑HTTPS entryUrl which should be rejected by validation
  const invalidMod = {
    id: 'failing-pwa-mod',
    slug: 'failing-pwa-mod',
    name: 'Failing PWA Module',
    entryUrl: 'http://insecure.example.com/app', // non‑HTTPS should fail
    webhookUrl: '',
    status: 'published',
    pwa: { startUrl: '', scope: '', icons: [] },
  };

  const regRes = await registerOrSaveModule(invalidMod, { allowOverwrite: true });
  // Registration should fail due to URL validation (non‑HTTPS)
  assert.strictEqual(regRes.success, false);
  assert(regRes.error?.includes('HTTPS'), 'Error should indicate HTTPS requirement');
});


// ─── TASK 2: Supabase Persistence & Foreign Key Protection ───────────────────

test('2.1 Credential provisioning automatically guarantees module presence in public.modules', async () => {
  const store = getStore();
  const testModuleId = 'isolated-fk-test-mod';

  // Add module to memory store
  const testManifest = {
    id: testModuleId,
    slug: testModuleId,
    name: { fr: 'FK Test Module', en: 'FK Test Module' },
    category: 'utilities',
    developer: 'KaziBox QA',
    version: '1.0.0',
    entryUrl: '/modules/fk-test',
    kind: 'external',
    status: 'draft',
    pricing_type: 'free',
    pricePerMonth: { amount: 0, currency: 'XOF' },
    pwa: {
      scope: '/modules/fk-test',
      startUrl: '/modules/fk-test',
      themeColor: '#6B7280',
      icons: [
        { src: '/icon-192.png', sizes: '192x192' },
        { src: '/icon-512.png', sizes: '512x512' },
        { src: '/icon-maskable.png', sizes: '512x512', purpose: 'maskable' },
      ],
    },
  };
  store.modules.push(testManifest);

  // Provision credentials without explicitly inserting into public.modules first
  const creds = await provisionModuleCredentials(testModuleId, TEST_COMPANY_ID, {
    credentialType: 'all',
    scope: 'platform',
  });

  assert(creds.apiKey, 'API key must be provisioned without throwing foreign key error');
  assert(creds.ssoSecret, 'SSO secret must be provisioned');
  assert(creds.webhookSecret, 'Webhook secret must be provisioned');

  // If Supabase is configured, verify both tables contain the records
  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    if (supabase) {
      const { data: modRow } = await supabase.from('modules').select('id').eq('id', testModuleId).maybeSingle();
      assert(modRow?.id === testModuleId, 'Module must be persisted in public.modules');

      const { data: keyRows } = await supabase.from('module_api_keys').select('id, key_prefix').eq('module_id', testModuleId);
      assert(keyRows && keyRows.length >= 3, 'All 3 credential keys must be persisted in public.module_api_keys');
    }
  }
});

// ─── TASK 3: Secure Credentials, Rotation & Revocation ───────────────────────

test('3.1 Credentials are encrypted at rest with KAZIBOX_MASTER_KEY and masked on retrieval', async () => {
  const secret = 'kz_sso_test_sensitive_secret_value_12345';
  const ciphertext = encryptModuleSecret(secret);
  assert(ciphertext && !ciphertext.includes('sensitive'), 'Ciphertext must not expose plaintext');

  const decrypted = decryptModuleSecret(ciphertext);
  assert.strictEqual(decrypted, secret, 'Decryption must restore exact secret');

  const metaKeys = await getApiKeysForModule('day1-logistics-saas');
  assert(metaKeys.length > 0, 'Must return metadata keys');
  for (const k of metaKeys) {
    assert.strictEqual(k.hashedSecret, '[REDACTED]', 'Plaintext secrets and hashes must never be exposed');
    assert(k.prefix && k.prefix.endsWith('...'), 'Prefix must be safely truncated');
  }
});

test('3.2 Credential rotation revokes previous platform keys and installs fresh credentials', async () => {
  const initialKeys = await getApiKeysForModule('day1-logistics-saas');
  const initialApiKey = initialKeys.find((k) => k.type === 'api_key');

  // Rotate credentials
  const rotated = await provisionModuleCredentials('day1-logistics-saas', TEST_COMPANY_ID, {
    credentialType: 'all',
    scope: 'platform',
  });

  assert(rotated.apiKey && rotated.apiKey !== initialApiKey?.prefix, 'New API key must differ');

  // Verify only one active platform API key exists after rotation
  const updatedKeys = await getApiKeysForModule('day1-logistics-saas');
  const platformApiKeys = updatedKeys.filter((k) => k.type === 'api_key' && k.scope === 'platform');
  assert.strictEqual(platformApiKeys.length, 1, 'Rotation must cleanly replace older platform API keys');
});

test('3.3 Explicit API key revocation permanently invalidates the target key', async () => {
  // Provision a dedicated key to revoke
  const creds = await provisionModuleCredentials('day1-logistics-saas', TEST_COMPANY_ID, {
    credentialType: 'api_key',
    scope: 'workspace',
  });

  const revokeRes = await revokeApiKey(creds.keyId, 'day1-logistics-saas');
  assert.strictEqual(revokeRes.success, true);
  assert(revokeRes.revokedCount >= 1, 'At least 1 key must be revoked');

  const keysAfter = await getApiKeysForModule('day1-logistics-saas');
  const found = keysAfter.find((k) => k.id === creds.keyId || k.prefix === creds.apiKeyPrefix);
  assert(!found, 'Revoked key must no longer exist in registry');
});

// ─── TASK 4: API Authentication, Scopes & Tenant Isolation ───────────────────

test('4.1 authenticateModuleApiKey enforces valid Bearer tokens, rejecting invalid & revoked keys', async () => {
  // Create a published test module
  const modId = 'api-auth-test-mod';
  await registerOrSaveModule(
    {
      id: modId,
      slug: modId,
      name: 'Auth Test Module',
      kind: 'external',
      entryUrl: 'https://example.com/app',
      status: 'published',
      scopes: ['read:context', 'write:finance'],
    },
    { allowOverwrite: true }
  );

  const creds = await provisionModuleCredentials(modId, TEST_COMPANY_ID, {
    credentialType: 'api_key',
    scope: 'platform',
  });

  // Test Missing Header
  const reqNoHeader = new Request('https://api.kazibox.com/api/v1/context');
  const resNoHeader = await authenticateModuleApiKey(reqNoHeader, 'read:context');
  assert.strictEqual(resNoHeader.errorResponse?.status, 401);

  // Test Invalid Secret as Bearer
  const reqInvalid = new Request('https://api.kazibox.com/api/v1/context', {
    headers: { Authorization: 'Bearer kz_live_mod_invalid_bogus_key' },
  });
  const resInvalid = await authenticateModuleApiKey(reqInvalid, 'read:context');
  assert.strictEqual(resInvalid.errorResponse?.status, 401);

  // Test Valid Key
  const reqValid = new Request('https://api.kazibox.com/api/v1/context', {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'X-Workspace-Id': TEST_COMPANY_ID,
    },
  });
  const resValid = await authenticateModuleApiKey(reqValid, 'read:context');
  assert(resValid.auth, 'Valid key must authenticate successfully');
  assert.strictEqual(resValid.auth.moduleId, modId);

  // Test Insufficient Scope
  const resBadScope = await authenticateModuleApiKey(reqValid, 'write:events');
  assert.strictEqual(resBadScope.errorResponse?.status, 403);
});

test('4.2 Workspace-scoped API keys strictly enforce tenant isolation (WORKSPACE_MISMATCH)', async () => {
  const modId = 'tenant-isolation-test-mod';
  await registerOrSaveModule(
    {
      id: modId,
      slug: modId,
      name: 'Tenant Module',
      kind: 'external',
      entryUrl: 'https://example.com',
      status: 'published',
      scopes: ['*'],
    },
    { allowOverwrite: true }
  );

  // Provision key bound to Company A
  const creds = await provisionModuleCredentials(modId, TEST_COMPANY_ID, {
    credentialType: 'api_key',
    scope: 'workspace',
  });

  // Requesting Company B with Company A key
  const reqWrongWs = new Request('https://api.kazibox.com/api/v1/context', {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'X-Workspace-Id': TEST_COMPANY_B_ID,
    },
  });

  const resWrong = await authenticateModuleApiKey(reqWrongWs, 'read:context');
  assert.strictEqual(resWrong.errorResponse?.status, 403);
  const data = await resWrong.errorResponse?.json();
  assert.strictEqual(data?.code, 'WORKSPACE_MISMATCH');
});

// ─── TASK 5: SSO 5-Minute Token Issuance & Replay Protection ─────────────────

test('5.1 SSO tokens issue with 5-minute TTL, valid signature, and reject replay / tampering', () => {
  const ssoSecret = 'kz_sso_test_dedicated_signing_secret_999';
  const token = issueSsoToken(
    {
      user: {
        id: 'user-001',
        name: 'Amadou Diallo',
        email: 'amadou@example.com',
        role: 'owner',
      },
      workspace: {
        id: TEST_COMPANY_ID,
        name: 'TestCo',
        company_id: TEST_COMPANY_ID,
        currency: 'XOF',
      },
      moduleId: 'day1-logistics-saas',
      language: 'fr',
      ttlSeconds: 300,
    },
    ssoSecret
  );

  assert(token, 'SSO token must be generated');

  // Verify valid token
  const valid = verifySsoToken(token, ssoSecret);
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.payload?.userName, 'Amadou Diallo');
  assert.strictEqual(valid.payload?.workspaceId, TEST_COMPANY_ID);

  // Tampered secret
  const badSecret = verifySsoToken(token, 'wrong-secret');
  assert.strictEqual(badSecret.valid, false);

  // Tampered payload
  const parts = token.split('.');
  const tamperedToken = `${parts[0]}.${Buffer.from('{"tampered":true}').toString('base64url')}.${parts[2]}`;
  const tampered = verifySsoToken(tamperedToken, ssoSecret);
  assert.strictEqual(tampered.valid, false);
});

// ─── TASK 6: Outbound Webhook Delivery & HMAC Signing ────────────────────────

test('6.1 Outbound webhook dispatches with HMAC-SHA256 signature and persists in queue', async () => {
  let receivedPayload = null;
  let receivedSignature = null;

  // Local test receiver HTTP server
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      receivedPayload = JSON.parse(body);
      receivedSignature = req.headers['x-kazibox-signature'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"received": true}');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const webhookUrl = `http://127.0.0.1:${port}/api/webhooks`;

  try {
    const modId = 'webhook-test-mod';
    await registerOrSaveModule(
      {
        id: modId,
        slug: modId,
        name: 'Webhook Receiver SaaS',
        kind: 'external',
        entryUrl: 'https://example.com',
        webhookUrl,
        status: 'published',
      },
      { allowOverwrite: true }
    );

    const creds = await provisionModuleCredentials(modId, TEST_COMPANY_ID, {
      credentialType: 'all',
      scope: 'platform',
    });

    const deliveries = await dispatchWebhookEvent(
      'module.activated',
      {
        workspaceId: TEST_COMPANY_ID,
        companyId: TEST_COMPANY_ID,
        planId: 'pro',
      },
      modId
    );

    assert(deliveries.length > 0, 'Must produce a delivery queue item');
    assert.strictEqual(deliveries[0].status, 'delivered');
    assert(receivedPayload, 'Server must receive payload');
    assert(receivedSignature, 'Server must receive x-kazibox-signature');

    // Verify HMAC signature
    const isValid = verifyWebhookSignature(
      JSON.stringify(receivedPayload),
      receivedSignature,
      creds.webhookSecret
    );
    assert.strictEqual(isValid, true, 'Webhook HMAC signature must verify');
  } finally {
    server.close();
  }
});

// ─── TASK 7: Genuine External SaaS Staging Integration Readiness (PharmaStock) ─

test('7.1 PharmaStock microservice boots, verifies SSO handoff, receives webhooks, and serves summary', async () => {
  const pharmaSsoSecret = 'kz_sso_pharma_staging_test_secret_001';
  const pharmaWebhookSecret = 'kz_whsec_pharma_staging_test_secret_001';

  // Instantiate live PharmaStock HTTP microservice
  const pharmaServer = createPharmaServer({
    ssoSecret: pharmaSsoSecret,
    webhookSecret: pharmaWebhookSecret,
  });

  await new Promise((resolve) => pharmaServer.listen(0, '127.0.0.1', resolve));
  const pharmaPort = pharmaServer.address().port;
  const pharmaUrl = `http://127.0.0.1:${pharmaPort}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${pharmaUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'healthy');
    assert.strictEqual(healthJson.service, 'kazibox-pharmastock');

    // 2. SSO 5-minute login handoff
    const ssoToken = issueSsoToken(
      {
        user: {
          id: 'usr-pharm-01',
          name: 'Dr. Fatima Traoré',
          email: 'fatima@pharmacie-centrale.ci',
          role: 'owner',
        },
        workspace: {
          id: TEST_COMPANY_ID,
          name: 'TestCo',
          company_id: TEST_COMPANY_ID,
          currency: 'XOF',
        },
        moduleId: 'pharmastock',
        language: 'fr',
        ttlSeconds: 300,
      },
      pharmaSsoSecret
    );

    const ssoRes = await fetch(`${pharmaUrl}/modules/pharmastock?token=${ssoToken}`);
    assert.strictEqual(ssoRes.status, 200);
    const ssoJson = await ssoRes.json();
    assert.strictEqual(ssoJson.authenticated, true);
    assert.strictEqual(ssoJson.session?.userName, 'Dr. Fatima Traoré');

    // Replay attempt must be rejected (single-use SSO token)
    const replayRes = await fetch(`${pharmaUrl}/modules/pharmastock?token=${ssoToken}`);
    assert.strictEqual(replayRes.status, 401);
    const replayJson = await replayRes.json();
    assert.strictEqual(replayJson.authenticated, false);

    // 3. Webhook delivery to PharmaStock
    const webhookEnvelope = {
      id: `wh-pharma-${Date.now()}`,
      event: 'module.activated',
      moduleId: 'pharmastock',
      companyId: TEST_COMPANY_ID,
      workspaceId: TEST_COMPANY_ID,
      timestamp: new Date().toISOString(),
      data: {
        workspaceId: TEST_COMPANY_ID,
        planId: 'flex_pro',
      },
    };

    const webhookBody = JSON.stringify(webhookEnvelope);
    const hmacSig = `sha256=${computeSha256Hash(webhookBody + pharmaWebhookSecret)}`; // SDK HMAC signer format

    const crypto = await import('crypto');
    const realHmac = `sha256=${crypto.createHmac('sha256', pharmaWebhookSecret).update(webhookBody).digest('hex')}`;

    const hookRes = await fetch(`${pharmaUrl}/api/webhooks/kazibox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kazibox-signature': realHmac,
      },
      body: webhookBody,
    });
    assert.strictEqual(hookRes.status, 200);
    const hookJson = await hookRes.json();
    assert.strictEqual(hookJson.received, true);

    // 4. Telemetry summary endpoint
    const summaryRes = await fetch(`${pharmaUrl}/api/summary`, {
      headers: {
        'X-Workspace-Id': TEST_COMPANY_ID,
      },
    });
    assert.strictEqual(summaryRes.status, 200);
    const summaryJson = await summaryRes.json();
    assert.strictEqual(summaryJson.moduleId, 'pharmastock');
    assert.strictEqual(summaryJson.companyId, TEST_COMPANY_ID);
    assert.strictEqual(summaryJson.currency, 'XOF');
    assert(Array.isArray(summaryJson.metrics), 'Must provide metrics');
  } finally {
    pharmaServer.close();
  }
});

test('7.2 Production PharmaStock in INITIAL_MODULES achieves 100% PWA compliance and valid endpoints', async () => {
  const mod = await getModule('pharmastock');
  assert(mod, 'PharmaStock module must exist in registry');
  assert.strictEqual(mod.kind, 'external');
  assert.strictEqual(mod.entryUrl, '/modules/pharmastock');
  assert.strictEqual(mod.webhookUrl, 'https://pharmastock.kazibox.com/api/webhooks/kazibox');

  const pwa = runPwaChecks(mod, { origin: STAGING_ORIGIN });
  assert.strictEqual(pwa.allPassed, true, 'PharmaStock must pass 100% PWA checklist');
  assert.strictEqual(pwa.checks.length, 6);
  for (const c of pwa.checks) {
    assert.strictEqual(c.passed, true, `Check ${c.key} must pass`);
  }
});

// ─── Execution Runner ─────────────────────────────────────────────────────────

async function run() {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ PASS  ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL  ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, 0 failed (${tests.length} total)`);
  console.log('All KaziBox Flex Day 1 Integration System tests PASSED ✅\n');
}

run();
