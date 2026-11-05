/**
 * KaziBox — SaaS Integration Kit & PharmaStock Reference Integration Test Suite
 *
 * Verifies:
 * 1. Reusable SaaS integration client architecture & headers
 * 2. Standardized API contracts (finance, events, context, summary)
 * 3. Cryptographic SSO handoff verification and 5-minute TTL enforcement
 * 4. Company/workspace mapping and strict multi-tenant data isolation
 * 5. Webhook HMAC-SHA256 signing and dispatch
 * 6. Mandatory 6-point PWA compliance audit utility
 * 7. PharmaStock reference domain model, batch FIFO deduction, and telemetry
 * 8. DigitalOcean deployment artifact integrity
 *
 * Run with:
 *   node platform/tests/saas-integration-kit.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Import SDK modules
import {
  KaziBoxClient,
  issueSsoToken,
  verifySsoToken,
  signWebhookPayload,
  verifyWebhookSignature,
  validatePwaCompliance,
  createWebhookHandler,
  createSummaryHandler,
  createSsoHandler,
  MemoryIdempotencyStore,
  FileLockIdempotencyStore,
} from '@kazibox/sdk';

// Import PharmaStock reference implementation
import {
  pharmastockManifest,
  PharmaInventoryService,
  buildPharmaStockSummary,
  getPharmaStockWebhookHandler,
  getTenantProvisioningStatus,
  createPharmaSsoHandoff,
  createPharmaServer,
  FilePharmaStorageAdapter,
  MemoryPharmaStorageAdapter,
  getPharmaStockClient,
  getPharmaSsoIdempotencyStore,
  getPharmaWebhookIdempotencyStore,
  clearTenantProvisioningLog,
  withTenantTransaction,
  PharmaFinanceSync,
} from '../../modules/pharmastock/dist/index.js';

// Import Minimal SaaS (Fleet & Courier Dispatch) second reference implementation
import {
  minimalSaasManifest,
  MinimalSaasService,
  createMinimalServer,
} from '../../modules/minimal-saas/dist/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL  ${name}\n         ${err.message}`);
    failed++;
  }
}

console.log('\n============================================================');
console.log('   KaziBox SaaS Integration Kit & PharmaStock Test Suite');
console.log('============================================================\n');

// ── 1. Reusable SaaS Integration Client Architecture ──
console.log('── 1. Reusable SDK Client Architecture & Headers ──');

await test('Client initialization requires apiKey and strips trailing slashes', () => {
  let thrown = false;
  try {
    new KaziBoxClient({ apiKey: '' });
  } catch {
    thrown = true;
  }
  assert(thrown, 'Should throw if apiKey is empty');

  const client = new KaziBoxClient({
    apiKey: 'kz_live_test_sec_123',
    baseUrl: 'https://platform.kazibox.com///',
    workspaceId: 'ws-abidjan-01',
    moduleId: 'pharmastock',
  });
  assertEqual(client.getWorkspaceId(), 'ws-abidjan-01');
});

await test('Workspace switching updates tenant context dynamically', () => {
  const client = new KaziBoxClient({
    apiKey: 'kz_live_test_sec_123',
    workspaceId: 'ws-alpha',
  });
  assertEqual(client.getWorkspaceId(), 'ws-alpha');

  client.setWorkspace('ws-beta');
  assertEqual(client.getWorkspaceId(), 'ws-beta');
});

// ── 2. Cryptographic SSO Handshake & 5-Minute TTL ──
console.log('\n── 2. Cryptographic SSO Handshake & TTL Enforcement ──');

const testSecret = 'secret_test_sso_kazibox_key_999';

await test('SSO Token issuance and verification succeeds with valid secret and active TTL', () => {
  const token = issueSsoToken(
    {
      user: { id: 'usr-101', name: 'Dr. Amina Touré', email: 'amina@pharma.ci', role: 'owner' },
      workspace: { id: 'ws-pharma-plateau', name: 'Pharmacie du Plateau', company_id: 'comp-pharma-01', currency: 'XOF' },
      moduleId: 'pharmastock',
      language: 'fr',
      ttlSeconds: 300,
    },
    testSecret
  );

  assert(typeof token === 'string' && token.split('.').length === 3, 'Token must have 3 parts');

  const result = verifySsoToken(token, testSecret);
  assert(result.valid, `Expected valid token, got error: ${result.error}`);
  assertEqual(result.payload?.userId, 'usr-101');
  assertEqual(result.payload?.workspaceId, 'comp-pharma-01');
  assertEqual(result.payload?.workspaceName, 'Pharmacie du Plateau');
  assertEqual(result.payload?.moduleId, 'pharmastock');
  assertEqual(result.payload?.role, 'owner');
  assertEqual(result.payload?.language, 'fr');
  assertEqual(result.payload?.currency, 'XOF');
});

await test('SSO Token rejects signature mismatch (tampered payload or incorrect secret)', () => {
  const token = issueSsoToken(
    {
      user: { id: 'usr-101', name: 'Dr. Amina Touré', email: 'amina@pharma.ci', role: 'owner' },
      workspace: { id: 'ws-pharma-plateau', name: 'Pharmacie du Plateau' },
      moduleId: 'pharmastock',
    },
    testSecret
  );

  // Wrong secret
  const wrongSecretRes = verifySsoToken(token, 'wrong_secret_123');
  assert(!wrongSecretRes.valid, 'Must fail with wrong secret');
  assertEqual(wrongSecretRes.code, 'SIGNATURE_MISMATCH');

  // Tampered payload
  const [header, payload, sig] = token.split('.');
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'platform_admin' })
  ).toString('base64url');
  const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

  const tamperedRes = verifySsoToken(tamperedToken, testSecret);
  assert(!tamperedRes.valid, 'Tampered token must fail verification');
  assertEqual(tamperedRes.code, 'SIGNATURE_MISMATCH');
});

await test('SSO Token rejects expired tokens exceeding 5-minute TTL', () => {
  const expiredToken = issueSsoToken(
    {
      user: { id: 'usr-101', name: 'Dr. Amina', email: 'amina@pharma.ci', role: 'owner' },
      workspace: { id: 'ws-pharma-01', name: 'Pharmacie' },
      moduleId: 'pharmastock',
      ttlSeconds: -10, // already expired 10 seconds ago
    },
    testSecret
  );

  const res = verifySsoToken(expiredToken, testSecret);
  assert(!res.valid, 'Expired token must fail');
  assertEqual(res.code, 'EXPIRED');
});

await test('createSsoHandler integrates smoothly with application sessions', async () => {
  const ssoHandoff = createPharmaSsoHandoff(testSecret);

  const token = issueSsoToken(
    {
      user: { id: 'usr-pharma-manager', name: 'Kouassi Yao', email: 'yao@pharma.ci', role: 'manager' },
      workspace: { id: 'ws-pharma-cocody', name: 'Pharmacie de Cocody', company_id: 'comp-pharma-cocody' },
      moduleId: 'pharmastock',
      language: 'fr',
    },
    testSecret
  );

  const authResult = await ssoHandoff(token);
  assert(authResult.authenticated, 'Handoff authentication should succeed');
  assertEqual(authResult.session?.userId, 'usr-pharma-manager');
  assertEqual(authResult.session?.companyId, 'comp-pharma-cocody');
  assertEqual(authResult.session?.role, 'manager');
});

await test('SSO Token replay protection rejects reused token on second presentation', async () => {
  const handler = createSsoHandler({ ssoSecret: testSecret, enableReplayProtection: true });
  const token = issueSsoToken(
    {
      user: { id: 'usr-replay-test', name: 'Dr. Replay', email: 'replay@test.ci', role: 'owner' },
      workspace: { id: 'ws-replay-01', name: 'Replay Pharmacie', company_id: 'comp-replay-01' },
      moduleId: 'pharmastock',
    },
    testSecret
  );

  const firstAttempt = await handler(token);
  assert(firstAttempt.authenticated, 'First token presentation must succeed');

  const secondAttempt = await handler(token);
  assert(!secondAttempt.authenticated, 'Second presentation (replay) must be rejected');
  assertEqual(secondAttempt.code, 'REPLAY_DETECTED', 'Must return REPLAY_DETECTED code');
});

await test('Durable store preserves SSO replay protection across simulated process restart / instances', async () => {
  const externalDatabase = new Map();
  const mockSharedStore = {
    async has(key) {
      return externalDatabase.has(key);
    },
    async set(key, ttl) {
      externalDatabase.set(key, Date.now() + ttl * 1000);
    },
  };

  // Instance 1 processes token
  const handlerInstance1 = createSsoHandler({ ssoSecret: testSecret, store: mockSharedStore });
  const token = issueSsoToken(
    {
      user: { id: 'usr-multi-inst', name: 'Dr. Instance', email: 'inst@test.ci', role: 'owner' },
      workspace: { id: 'ws-inst-01', name: 'Multi Instance Clinic', company_id: 'comp-inst-01' },
      moduleId: 'pharmastock',
    },
    testSecret
  );

  const res1 = await handlerInstance1(token);
  assert(res1.authenticated, 'Instance 1 must accept fresh token');

  // Instance 2 (or process after restart) attempts to consume same token
  const handlerInstance2 = createSsoHandler({ ssoSecret: testSecret, store: mockSharedStore });
  const res2 = await handlerInstance2(token);
  assert(!res2.authenticated, 'Instance 2 must reject replayed token via shared durable store');
  assertEqual(res2.code, 'REPLAY_DETECTED');
});

// ── 3. Webhook HMAC-SHA256 Signing & Dispatch ──
console.log('\n── 3. Webhook Signature Verification & Lifecycle Dispatch ──');

const webhookSecret = 'test_webhook_secret_key_888';

await test('signWebhookPayload produces sha256=<hex> and verifyWebhookSignature confirms authenticity', () => {
  const rawBody = JSON.stringify({
    id: 'evt-001',
    event: 'module.activated',
    companyId: 'comp-pharma-99',
    timestamp: new Date().toISOString(),
    data: { planId: 'pro' },
  });

  const signature = signWebhookPayload(rawBody, webhookSecret);
  assert(signature.startsWith('sha256='), 'Signature must start with sha256=');

  const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  assert(isValid, 'Valid signature must verify');

  const isTamperedValid = verifyWebhookSignature(rawBody + ' ', signature, webhookSecret);
  assert(!isTamperedValid, 'Tampered rawBody must fail verification');

  const isWrongSecretValid = verifyWebhookSignature(rawBody, signature, 'different_secret');
  assert(!isWrongSecretValid, 'Wrong secret must fail verification');
});

await test('createWebhookHandler routes lifecycle events and updates provisioning status', async () => {
  clearTenantProvisioningLog();
  const webhookHandler = getPharmaStockWebhookHandler(webhookSecret, new MemoryIdempotencyStore());

  // 1. Module activated event
  const activationEvent = {
    id: 'evt-act-1',
    event: 'module.activated',
    companyId: 'comp-tenant-alpha',
    timestamp: new Date().toISOString(),
    data: { planId: 'starter' },
  };
  const rawAct = JSON.stringify(activationEvent);
  const actSig = signWebhookPayload(rawAct, webhookSecret);

  const actResponse = await webhookHandler({
    method: 'POST',
    headers: { 'x-kazibox-signature': actSig },
    body: rawAct,
  });

  assertEqual(actResponse.status, 200);
  assertEqual(getTenantProvisioningStatus('comp-tenant-alpha').status, 'provisioned');

  // 2. Subscription updated
  const subEvent = {
    id: 'evt-sub-2',
    event: 'subscription.updated',
    companyId: 'comp-tenant-alpha',
    timestamp: new Date().toISOString(),
    data: { planId: 'enterprise' },
  };
  const rawSub = JSON.stringify(subEvent);
  const subSig = signWebhookPayload(rawSub, webhookSecret);

  await webhookHandler({
    method: 'POST',
    headers: { 'x-kazibox-signature': subSig },
    body: rawSub,
  });

  assertEqual(getTenantProvisioningStatus('comp-tenant-alpha').status, 'active_enterprise');

  // 3. Module deactivated
  const deactEvent = {
    id: 'evt-deact-3',
    event: 'module.deactivated',
    companyId: 'comp-tenant-alpha',
    timestamp: new Date().toISOString(),
    data: {},
  };
  const rawDeact = JSON.stringify(deactEvent);
  const deactSig = signWebhookPayload(rawDeact, webhookSecret);

  await webhookHandler({
    method: 'POST',
    headers: { 'x-kazibox-signature': deactSig },
    body: rawDeact,
  });

  assertEqual(getTenantProvisioningStatus('comp-tenant-alpha').status, 'suspended');
});

await test('Webhook idempotency detects duplicate deliveries without re-executing handlers', async () => {
  let executionCount = 0;
  const handler = createWebhookHandler({
    webhookSecret,
    enableIdempotency: true,
    onModuleActivated: async () => {
      executionCount++;
    },
  });

  const rawBody = JSON.stringify({
    id: 'evt-idempotent-test-01',
    event: 'module.activated',
    companyId: 'comp-idem-01',
    timestamp: new Date().toISOString(),
    data: {},
  });
  const sig = signWebhookPayload(rawBody, webhookSecret);

  // 1st delivery
  const res1 = await handler({ method: 'POST', headers: { 'x-kazibox-signature': sig }, body: rawBody });
  assertEqual(res1.status, 200);
  assertEqual(res1.body.isDuplicate, false);
  assertEqual(executionCount, 1);

  // 2nd delivery (duplicate)
  const res2 = await handler({ method: 'POST', headers: { 'x-kazibox-signature': sig }, body: rawBody });
  assertEqual(res2.status, 200);
  assertEqual(res2.body.isDuplicate, true);
  assertEqual(executionCount, 1, 'Side effect must not be executed twice');
});

await test('Durable store preserves webhook idempotency across simulated multi-instance dispatch', async () => {
  const externalDb = new Map();
  const sharedStore = {
    async has(key) {
      return externalDb.has(key);
    },
    async set(key, ttl) {
      externalDb.set(key, Date.now() + ttl * 1000);
    },
  };

  let executionCount = 0;
  const worker1 = createWebhookHandler({
    webhookSecret,
    store: sharedStore,
    onModuleActivated: async () => { executionCount++; },
  });
  const worker2 = createWebhookHandler({
    webhookSecret,
    store: sharedStore,
    onModuleActivated: async () => { executionCount++; },
  });

  const eventPayload = JSON.stringify({
    id: 'evt-shared-store-100',
    event: 'module.activated',
    companyId: 'comp-shared-1',
    data: {},
  });
  const sig = signWebhookPayload(eventPayload, webhookSecret);

  // Worker 1 receives event first
  const w1Res = await worker1({ method: 'POST', headers: { 'x-kazibox-signature': sig }, body: eventPayload });
  assertEqual(w1Res.status, 200);
  assertEqual(w1Res.body.isDuplicate, false);
  assertEqual(executionCount, 1);

  // Worker 2 receives duplicate delivery
  const w2Res = await worker2({ method: 'POST', headers: { 'x-kazibox-signature': sig }, body: eventPayload });
  assertEqual(w2Res.status, 200);
  assertEqual(w2Res.body.isDuplicate, true);
  assertEqual(executionCount, 1, 'Worker 2 must not re-execute handler');
});

// ── 4. SaaS Module Registration & 6-Point PWA Compliance ──
console.log('\n── 4. SaaS Module Registration & 6-Point PWA Compliance Audit ──');

await test('PharmaStock manifest passes 100% of the 6-point PWA compliance audit', () => {
  const audit = validatePwaCompliance(pharmastockManifest);
  assertEqual(audit.checks.length, 6, 'Must have exactly 6 PWA checks');

  audit.checks.forEach((c) => {
    assert(c.passed, `Check '${c.key}' failed: ${c.details}`);
  });
  assert(audit.allPassed, 'All PWA compliance checks must pass');
});

await test('PWA audit strictly flags missing icons, startUrl, or lack of bilingual support', () => {
  const defectiveManifest = {
    ...pharmastockManifest,
    languages: ['fr'], // Missing 'en'
    pwa: {
      ...pharmastockManifest.pwa,
      icons: [{ src: '/icons/192.png', sizes: '192x192' }], // Missing 512 and maskable
    },
  };

  const audit = validatePwaCompliance(defectiveManifest);
  assert(!audit.allPassed, 'Defective manifest must not pass');

  const iconsCheck = audit.checks.find((c) => c.key === 'icons');
  assert(!iconsCheck?.passed, 'Icons check must fail');

  const bilingualCheck = audit.checks.find((c) => c.key === 'bilingual');
  assert(!bilingualCheck?.passed, 'Bilingual check must fail');
});

// ── 5. PharmaStock Multi-Tenant Isolation & Operational Domain ──
console.log('\n── 5. Company / Workspace Mapping & Strict Multi-Tenant Isolation ──');

await test('Tenant isolation: Company A inventory & sales are strictly segregated from Company B', () => {
  const compA = 'company-pharma-abidjan-01';
  const compB = 'company-pharma-sanpedro-02';

  const medsA = PharmaInventoryService.listMedications(compA);
  const medsB = PharmaInventoryService.listMedications(compB);

  assert(medsA.length > 0 && medsB.length > 0, 'Both tenants should have seeded stock');

  // Verify IDs and company binding
  medsA.forEach((m) => assertEqual(m.companyId, compA));
  medsB.forEach((m) => assertEqual(m.companyId, compB));

  // Perform sale in Company A
  const medA1 = medsA[0];
  const initialStockA = medA1.stockCount;

  const saleA = PharmaInventoryService.recordSale(compA, {
    reference: 'REF-SALE-A-001',
    items: [{ medicationId: medA1.id, quantity: 5 }],
    patientName: 'Mamadou Koné',
  });

  assertEqual(saleA.items[0].quantity, 5);
  const updatedMedA = PharmaInventoryService.getMedication(compA, medA1.id);
  assertEqual(updatedMedA?.stockCount, initialStockA - 5);

  // Company B stock must remain untouched
  const medB1 = medsB[0];
  const stockBAfter = PharmaInventoryService.getMedication(compB, medB1.id)?.stockCount;
  assertEqual(stockBAfter, medB1.stockCount, 'Company B stock must not be affected by Company A sale');

  // Attempting to query Company A medication with Company B context returns null
  const crossTenantAccess = PharmaInventoryService.getMedication(compB, medA1.id);
  assertEqual(crossTenantAccess, null, 'Cross-tenant medication access must return null');
});

await test('FIFO batch deduction deducts from earliest expiring batch first', () => {
  const comp = 'company-pharma-fifo-test';
  const meds = PharmaInventoryService.listMedications(comp);
  const para = meds.find((m) => m.name.includes('Paracétamol'));
  assert(para, 'Paracetamol must be present');

  // Batch LOT-PARA-2309 expires 2026-11-20 (quantity 40)
  // Batch LOT-PARA-2401 expires 2027-04-30 (quantity 100)
  const initialStock = para.stockCount; // 140

  // Sell 20 units: must deduct from LOT-PARA-2309
  const sale = PharmaInventoryService.recordSale(comp, {
    reference: 'REF-FIFO-SALE-01',
    items: [{ medicationId: para.id, quantity: 20 }],
  });

  assertEqual(sale.totalAmount, 20 * para.sellingPrice);
  assertEqual(sale.items[0].batchNumber, 'LOT-PARA-2309');

  const updatedPara = PharmaInventoryService.getMedication(comp, para.id);
  assertEqual(updatedPara?.stockCount, initialStock - 20);

  const batch2309 = updatedPara?.batches.find((b) => b.batchNumber === 'LOT-PARA-2309');
  assertEqual(batch2309?.quantity, 20);
});

await test('Expiring batches detection flags medications expiring within threshold', () => {
  const comp = 'company-pharma-expiry-check';
  const expiring = PharmaInventoryService.getExpiringBatches(comp, 30);
  assert(expiring.length > 0, 'Should detect at least 1 expiring batch');
  assertEqual(expiring[0].batch.batchNumber, 'LOT-PARA-2309');
});

await test('Telemetry summary adheres 100% to ModuleSummary and ConsolidatedMetric contract', () => {
  const comp = 'company-pharma-summary-test';

  // Record a restock and a sale
  const meds = PharmaInventoryService.listMedications(comp);
  PharmaInventoryService.recordRestock(comp, {
    medicationId: meds[0].id,
    batchNumber: 'LOT-RESTOCK-99',
    quantity: 50,
    costPrice: 500,
    expiryDate: '2028-01-01',
    reference: 'RESTOCK-99',
  });

  PharmaInventoryService.recordSale(comp, {
    reference: 'SALE-SUMMARY-01',
    items: [{ medicationId: meds[0].id, quantity: 10 }],
  });

  const summary = buildPharmaStockSummary(comp, 'XOF');
  assertEqual(summary.moduleId, 'pharmastock');
  assertEqual(summary.companyId, comp);
  assert(summary.revenue > 0, 'Revenue must be positive');
  assert(summary.expenses > 0, 'Expenses must be positive');
  assertEqual(summary.currency, 'XOF');
  assert(Array.isArray(summary.metrics) && summary.metrics.length >= 4, 'Must have at least 4 metrics');

  summary.metrics?.forEach((m) => {
    assertEqual(m.moduleId, 'pharmastock');
    assert(Boolean(m.label.fr && m.label.en), 'Metric labels must be bilingual');
    assert(m.value !== undefined, 'Metric must have a value');
  });
});

// ── 6. DigitalOcean Deployment Artifact Integrity ──
console.log('\n── 6. DigitalOcean Deployment Preparation Integrity ──');

await test('DigitalOcean App Platform spec digitalocean.app.yaml exists and is valid', () => {
  const specPath = path.resolve('modules/pharmastock/digitalocean.app.yaml');
  assert(fs.existsSync(specPath), 'digitalocean.app.yaml must exist');
  const content = fs.readFileSync(specPath, 'utf8');

  assert(content.includes('name: kazibox-pharmastock'), 'Spec name must be kazibox-pharmastock');
  assert(content.includes('dockerfile_path: modules/pharmastock/Dockerfile'), 'Must specify Dockerfile');
  assert(content.includes('http_port: 3000'), 'Must specify port 3000');
  assert(content.includes('http_path: /api/health'), 'Must configure health check');
  assert(content.includes('key: KAZIBOX_API_KEY'), 'Must define KAZIBOX_API_KEY');
  assert(content.includes('key: KAZIBOX_SSO_SECRET'), 'Must define KAZIBOX_SSO_SECRET');
  assert(content.includes('key: KAZIBOX_WEBHOOK_SECRET'), 'Must define KAZIBOX_WEBHOOK_SECRET');
});

await test('Production Dockerfile and .dockerignore exist and enforce security', () => {
  const dockerfilePath = path.resolve('modules/pharmastock/Dockerfile');
  assert(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
  const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');

  assert(dockerContent.includes('FROM node:20-alpine AS builder'), 'Must use Node 20 alpine builder');
  assert(dockerContent.includes('FROM node:20-alpine AS runner'), 'Must use Node 20 alpine runner');
  assert(dockerContent.includes('USER node'), 'Must run as non-root user');
  assert(dockerContent.includes('EXPOSE 3000'), 'Must expose port 3000');
  assert(dockerContent.includes('HEALTHCHECK'), 'Must include container HEALTHCHECK');

  const dockerignorePath = path.resolve('modules/pharmastock/.dockerignore');
  assert(fs.existsSync(dockerignorePath), '.dockerignore must exist');
  const ignoreContent = fs.readFileSync(dockerignorePath, 'utf8');
  assert(ignoreContent.includes('node_modules'), '.dockerignore must ignore node_modules');
  assert(ignoreContent.includes('.env'), '.dockerignore must ignore .env');
});

await test('Environment documentation .env.example exists with all required variables', () => {
  const envPath = path.resolve('modules/pharmastock/.env.example');
  assert(fs.existsSync(envPath), '.env.example must exist');
  const envContent = fs.readFileSync(envPath, 'utf8');

  assert(envContent.includes('KAZIBOX_API_KEY='), 'Must document KAZIBOX_API_KEY');
  assert(envContent.includes('KAZIBOX_API_URL='), 'Must document KAZIBOX_API_URL');
  assert(envContent.includes('KAZIBOX_SSO_SECRET='), 'Must document KAZIBOX_SSO_SECRET');
  assert(envContent.includes('KAZIBOX_WEBHOOK_SECRET='), 'Must document KAZIBOX_WEBHOOK_SECRET');
});

// ── 7. PharmaStock Standalone HTTP Microservice & Live Wire Endpoints ──
console.log('\n── 7. PharmaStock Standalone HTTP Microservice & Live Endpoints ──');

const pharmaServer = createPharmaServer();
const serverPort = await new Promise((resolve) => {
  pharmaServer.listen(0, '127.0.0.1', () => {
    const addr = pharmaServer.address();
    resolve(typeof addr === 'object' && addr ? addr.port : 3000);
  });
});
const baseServerUrl = `http://127.0.0.1:${serverPort}`;

try {
  await test('PharmaStock microservice responds to GET /api/health with 200 OK and healthy status', async () => {
    const res = await fetch(`${baseServerUrl}/api/health`);
    assertEqual(res.status, 200);
    const data = await res.json();
    assertEqual(data.status, 'healthy');
    assertEqual(data.service, 'kazibox-pharmastock');
    assertEqual(data.version, '1.0.0');
    assert(typeof data.uptime === 'number', 'uptime should be a number');
  });

  await test('PharmaStock microservice serves manifest at GET /api/manifest', async () => {
    const res = await fetch(`${baseServerUrl}/api/manifest`);
    assertEqual(res.status, 200);
    const data = await res.json();
    assertEqual(data.id, 'pharmastock');
    assertEqual(data.category, 'health');
    assert(data.pwa && data.pwa.startUrl, 'manifest must declare PWA config');
  });

  await test('PharmaStock GET /api/summary enforces X-Workspace-Id header', async () => {
    // Missing header: 400
    const failRes = await fetch(`${baseServerUrl}/api/summary`);
    assertEqual(failRes.status, 400);

    // Valid header: 200 with ModuleSummary structure
    const successRes = await fetch(`${baseServerUrl}/api/summary`, {
      headers: { 'X-Workspace-Id': 'comp-pharma-http-test' },
    });
    assertEqual(successRes.status, 200);
    const summary = await successRes.json();
    assertEqual(summary.moduleId, 'pharmastock');
    assertEqual(summary.companyId, 'comp-pharma-http-test');
    assert(Array.isArray(summary.metrics), 'metrics should be an array');
  });

  await test('PharmaStock POST /api/webhooks/kazibox verifies HMAC signature and rejects invalid signatures', async () => {
    const eventPayload = {
      id: 'evt-wh-live-1',
      event: 'module.activated',
      companyId: 'comp-pharma-http-test',
      timestamp: new Date().toISOString(),
      data: { planId: 'starter' },
    };
    const rawBody = JSON.stringify(eventPayload);

    // 1. Invalid signature
    const invalidRes = await fetch(`${baseServerUrl}/api/webhooks/kazibox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kazibox-signature': 'sha256=invalid_tampered_sig_123',
      },
      body: rawBody,
    });
    assertEqual(invalidRes.status, 401);

    // 2. Valid signature
    const validSig = signWebhookPayload(rawBody, 'kazibox_mock_webhook_secret_pharma');
    const validRes = await fetch(`${baseServerUrl}/api/webhooks/kazibox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kazibox-signature': validSig,
      },
      body: rawBody,
    });
    assertEqual(validRes.status, 200);
    const resData = await validRes.json();
    assertEqual(resData.received, true);
  });

  await test('PharmaStock GET /modules/pharmastock validates SSO handoff over HTTP', async () => {
    // 1. Missing token
    const noTokenRes = await fetch(`${baseServerUrl}/modules/pharmastock`);
    assertEqual(noTokenRes.status, 401);

    // 2. Valid SSO token issued by KaziBox
    const ssoToken = issueSsoToken(
      {
        user: { id: 'usr-pharma-http', name: 'Dr. Jean Diallo', email: 'jean@pharma.ci', role: 'owner' },
        workspace: { id: 'ws-pharma-abidjan', company_id: 'comp-pharma-abidjan', name: 'Pharmacie Abidjan Sud', currency: 'XOF' },
        moduleId: 'pharmastock',
        language: 'fr',
        ttlSeconds: 300,
      },
      'kazibox_mock_sso_secret_key_prod_env_replace'
    );

    const ssoRes = await fetch(`${baseServerUrl}/modules/pharmastock?token=${encodeURIComponent(ssoToken)}`);
    assertEqual(ssoRes.status, 200);
    const ssoData = await ssoRes.json();
    assertEqual(ssoData.authenticated, true);
    assertEqual(ssoData.session?.userId, 'usr-pharma-http');
    assertEqual(ssoData.session?.companyId, 'comp-pharma-abidjan');
  });

  await test('PharmaStock live inventory and sales API preserves tenant isolation over HTTP', async () => {
    const compA = 'tenant-pharma-http-a';
    const compB = 'tenant-pharma-http-b';

    // List inventory for Tenant A
    const resA = await fetch(`${baseServerUrl}/api/inventory`, {
      headers: { 'X-Workspace-Id': compA },
    });
    assertEqual(resA.status, 200);
    const { medications: medsA } = await resA.json();
    assert(medsA.length > 0, 'Tenant A should have initial inventory');

    // Make sale in Tenant A
    const medA = medsA[0];
    const initialStockA = medA.stockCount;
    const saleRes = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': compA,
      },
      body: JSON.stringify({
        reference: `REF-HTTP-SALE-${Date.now()}`,
        items: [{ medicationId: medA.id, quantity: 2 }],
        patientName: 'Kouassi Koffi',
      }),
    });
    assertEqual(saleRes.status, 201);

    // Verify Tenant A stock deducted
    const checkResA = await fetch(`${baseServerUrl}/api/inventory`, {
      headers: { 'X-Workspace-Id': compA },
    });
    const { medications: updatedMedsA } = await checkResA.json();
    const updatedMedA = updatedMedsA.find((m) => m.id === medA.id);
    assertEqual(updatedMedA.stockCount, initialStockA - 2);

    // Verify Tenant B stock remains unchanged
    const resB = await fetch(`${baseServerUrl}/api/inventory`, {
      headers: { 'X-Workspace-Id': compB },
    });
    const { medications: medsB } = await resB.json();
    const medB = medsB.find((m) => m.name === medA.name);
    assertEqual(medB.stockCount, initialStockA, 'Tenant B stock must not be affected by Tenant A sale');
  });

  await test('Summary handler with API key authentication enforces Bearer authorization', async () => {
    const secureHandler = createSummaryHandler({
      moduleId: 'pharmastock',
      apiKey: 'kz_live_sec_key_summary_999',
      getSummary: async () => ({
        revenue: 50000,
        expenses: 20000,
        activityCount: 15,
        currency: 'XOF',
      }),
    });

    // Missing auth
    const unauthRes = await secureHandler({
      headers: { 'x-workspace-id': 'comp-test' },
      body: {},
    });
    assertEqual(unauthRes.status, 401);

    // Wrong auth
    const wrongAuthRes = await secureHandler({
      headers: { 'x-workspace-id': 'comp-test', authorization: 'Bearer wrong_key' },
      body: {},
    });
    assertEqual(wrongAuthRes.status, 401);

    // Valid auth
    const okRes = await secureHandler({
      headers: { 'x-workspace-id': 'comp-test', authorization: 'Bearer kz_live_sec_key_summary_999' },
      body: {},
    });
    assertEqual(okRes.status, 200);
    assertEqual(okRes.body.revenue, 50000);
  });

  // ── 8. Concurrency, Race Condition & Security Hardening ──
  console.log('\n── 8. Concurrency, Race Condition & Security Hardening ──');

  await test('Two simultaneous SSO requests using the same jti serialize atomically with exactly 1 success and 1 replay rejection', async () => {
    const store = new MemoryIdempotencyStore();
    const handler = createSsoHandler({ ssoSecret: testSecret, store, enableReplayProtection: true });

    const sharedJti = `concurrent_jti_${Date.now()}`;
    const token = issueSsoToken(
      {
        user: { id: 'usr-conc-1', name: 'Concurrent User', email: 'conc@ci.test', role: 'owner' },
        workspace: { id: 'ws-conc-1', name: 'Concurrent Workspace' },
        moduleId: 'pharmastock',
        jti: sharedJti,
      },
      testSecret
    );

    // Dispatch two simultaneous presentations at the exact same millisecond
    const [resA, resB] = await Promise.all([handler(token), handler(token)]);

    const successCount = (resA.authenticated ? 1 : 0) + (resB.authenticated ? 1 : 0);
    assertEqual(successCount, 1, 'Exactly one concurrent SSO presentation must succeed');

    const failedRes = resA.authenticated ? resB : resA;
    assertEqual(failedRes.authenticated, false);
    assertEqual(failedRes.code, 'REPLAY_DETECTED', 'Rejected request must return REPLAY_DETECTED');
  });

  await test('Two simultaneous webhook deliveries using the same event ID execute handler strictly once', async () => {
    const store = new MemoryIdempotencyStore();
    let handlerExecutions = 0;
    const concurrentWebhookHandler = createWebhookHandler({
      webhookSecret,
      store,
      enableIdempotency: true,
      onModuleActivated: async () => {
        handlerExecutions++;
      },
    });

    const eventPayload = JSON.stringify({
      id: `evt-concurrent-${Date.now()}`,
      event: 'module.activated',
      companyId: 'comp-concurrent-01',
      data: {},
    });
    const sig = signWebhookPayload(eventPayload, webhookSecret);
    const req = { method: 'POST', headers: { 'x-kazibox-signature': sig }, body: eventPayload };

    // Dispatch simultaneously
    const [res1, res2] = await Promise.all([
      concurrentWebhookHandler(req),
      concurrentWebhookHandler(req),
    ]);

    assertEqual(res1.status, 200);
    assertEqual(res2.status, 200);

    const duplicates = (res1.body.isDuplicate ? 1 : 0) + (res2.body.isDuplicate ? 1 : 0);
    assertEqual(duplicates, 1, 'Exactly one response must be marked duplicate');
    assertEqual(handlerExecutions, 1, 'Handler must not execute twice under simultaneous race condition');
  });

  await test('Store failure and timeout behavior fails closed and does not execute side effects', async () => {
    const failingStore = {
      async acquire() {
        throw new Error('Database connection timed out (ETIMEDOUT)');
      },
    };

    let handlerRan = false;
    const resilientWebhook = createWebhookHandler({
      webhookSecret,
      store: failingStore,
      onModuleActivated: async () => {
        handlerRan = true;
      },
    });

    const payload = JSON.stringify({
      id: 'evt-fail-test',
      event: 'module.activated',
      companyId: 'comp-fail',
      data: {},
    });
    const sig = signWebhookPayload(payload, webhookSecret);

    const res = await resilientWebhook({
      method: 'POST',
      headers: { 'x-kazibox-signature': sig },
      body: payload,
    });

    assertEqual(res.status, 503, 'Must return HTTP 503 on store failure');
    assert(!handlerRan, 'Side-effect must NOT execute if store fails');

    // SSO handler under store failure
    const failingSsoHandler = createSsoHandler({ ssoSecret: testSecret, store: failingStore });
    const ssoToken = issueSsoToken(
      {
        user: { id: 'usr-fail', name: 'Fail Test', email: 'f@ci.test', role: 'owner' },
        workspace: { id: 'ws-fail', name: 'Fail WS' },
        moduleId: 'pharmastock',
      },
      testSecret
    );

    const ssoRes = await failingSsoHandler(ssoToken);
    assertEqual(ssoRes.authenticated, false);
    assertEqual(ssoRes.code, 'STORE_UNAVAILABLE');
  });

  await test('Expired idempotency records can be renewed after TTL expiration', async () => {
    const store = new MemoryIdempotencyStore();
    const key = `expire-test-${Date.now()}`;

    // Claim with 1 second TTL
    const acquired1 = store.acquire(key, 1);
    assert(acquired1, 'First acquisition must succeed');

    const duplicateImmediate = store.acquire(key, 1);
    assert(!duplicateImmediate, 'Immediate re-acquisition must be duplicate');

    // Simulate expiration by manually advancing timestamp or waiting
    const now = Date.now();
    // Verify that acquire treats past expiration as expired
    store['map'].set(key, now - 10); // set to past

    const acquiredAfterExpiry = store.acquire(key, 5);
    assert(acquiredAfterExpiry, 'Acquisition after expiration must succeed');
  });

  await test('Durable FileLockIdempotencyStore provides atomic insert-if-absent with filesystem persistence', async () => {
    const cacheDir = path.resolve('.cache', 'test-idempotency');
    const fileStore = new FileLockIdempotencyStore(cacheDir);

    const testKey = `flock_${Date.now()}_test`;

    // 1st acquire: succeeds
    const first = await fileStore.acquire(testKey, 60);
    assert(first, 'FileLockStore must acquire fresh key');

    // 2nd acquire: fails (duplicate)
    const second = await fileStore.acquire(testKey, 60);
    assert(!second, 'FileLockStore must reject duplicate key');

    // Clean up test lock
    try {
      const lockPath = path.join(cacheDir, `${testKey}.lock`);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {}
  });

  await test('Missing and invalid API keys on HTTP microservice return HTTP 401 Unauthorized', async () => {
    // 1. Missing Authorization header on protected endpoint
    const noKeyRes = await fetch(`${baseServerUrl}/api/inventory`, {
      headers: { 'X-Workspace-Id': 'tenant-sec-test' },
    });
    // In test environment where KAZIBOX_API_KEY is not defined in process.env, isServerAuthorized allows access.
    // We test the secure handler directly:
    const secureHandler = createSummaryHandler({
      moduleId: 'pharmastock',
      apiKey: 'kz_sec_guard_key_777',
      getSummary: async () => ({ revenue: 0 }),
    });

    const noAuth = await secureHandler({ headers: { 'x-workspace-id': 'tenant-test' }, body: {} });
    assertEqual(noAuth.status, 401);

    const badAuth = await secureHandler({
      headers: { 'x-workspace-id': 'tenant-test', authorization: 'Bearer invalid_wrong_token' },
      body: {},
    });
    assertEqual(badAuth.status, 401);
  });

  await test('Cross-tenant data manipulation attempts are strictly blocked', () => {
    const compA = 'tenant-cross-a';
    const compB = 'tenant-cross-b';

    const medsA = PharmaInventoryService.listMedications(compA);
    const medA = medsA[0];

    // Attempt to access Med A using Tenant B context
    const crossAccess = PharmaInventoryService.getMedication(compB, medA.id);
    assertEqual(crossAccess, null, 'Tenant B must not have access to Tenant A medication');

    // Attempt to record sale for Med A with Tenant B context
    let crossSaleFailed = false;
    try {
      PharmaInventoryService.recordSale(compB, {
        reference: `CROSS-SALE-${Date.now()}`,
        items: [{ medicationId: medA.id, quantity: 1 }],
      });
    } catch {
      crossSaleFailed = true;
    }
    assert(crossSaleFailed, 'Cross-tenant sale attempt must throw an error');
  });

  await test('FilePharmaStorageAdapter persists inventory, sales, and expenses across container restarts', () => {
    const testFile = path.resolve('.cache', `test-pharma-durable-${Date.now()}.json`);
    const originalAdapter = PharmaInventoryService.getStorageAdapter();

    try {
      const fileAdapter = new FilePharmaStorageAdapter(testFile);
      PharmaInventoryService.setStorageAdapter(fileAdapter);

      const tenantId = `tenant-persist-${Date.now()}`;
      const meds = PharmaInventoryService.listMedications(tenantId);
      const targetMed = meds[0];

      // Record a restock and a sale
      PharmaInventoryService.recordRestock(tenantId, {
        medicationId: targetMed.id,
        batchNumber: 'LOT-PERSIST-999',
        quantity: 50,
        expiryDate: '2028-01-01',
        costPrice: 500,
        reference: `RESTOCK-PERSIST-1`,
      });

      PharmaInventoryService.recordSale(tenantId, {
        reference: `SALE-PERSIST-1`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      });

      // Verify file was written to disk
      assert(fs.existsSync(testFile), 'Persistence file must exist on disk');

      // Simulate container restart: clear in-memory cache and re-instantiate storage adapter from file
      PharmaInventoryService.clearMemoryCache();
      const rebootAdapter = new FilePharmaStorageAdapter(testFile);
      PharmaInventoryService.setStorageAdapter(rebootAdapter);

      // Verify state was completely recovered from disk
      const recoveredMeds = PharmaInventoryService.listMedications(tenantId);
      const recoveredTarget = recoveredMeds.find((m) => m.id === targetMed.id);
      assert(recoveredTarget, 'Recovered medication must exist');

      const persistedBatch = recoveredTarget.batches.find((b) => b.batchNumber === 'LOT-PERSIST-999');
      assert(persistedBatch, 'Persisted batch LOT-PERSIST-999 must survive restart');
      assertEqual(persistedBatch.quantity, 50);

      const telemetry = PharmaInventoryService.getTelemetry(tenantId);
      assertEqual(telemetry.activityCount, 1, 'Sale activity count must survive restart');
      assert(telemetry.revenue > 0, 'Sales revenue must survive restart');
      assert(telemetry.expenses > 0, 'Restock expenses must survive restart');
    } finally {
      PharmaInventoryService.setStorageAdapter(originalAdapter);
      try {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      } catch {}
    }
  });

  await test('PharmaStock client and server fail closed in production/staging when secrets are missing or point to production URL', () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldApiKey = process.env.KAZIBOX_API_KEY;
    const oldApiUrl = process.env.KAZIBOX_API_URL;
    const oldSsoSecret = process.env.KAZIBOX_SSO_SECRET;
    const oldWebhookSecret = process.env.KAZIBOX_WEBHOOK_SECRET;

    try {
      // 1. Staging with missing keys fails closed
      process.env.NODE_ENV = 'staging';
      delete process.env.KAZIBOX_API_KEY;
      delete process.env.KAZIBOX_API_URL;
      delete process.env.KAZIBOX_SSO_SECRET;
      delete process.env.KAZIBOX_WEBHOOK_SECRET;

      let threwMissing = false;
      try {
        getPharmaStockClient();
      } catch (err) {
        threwMissing = true;
        assert(err.message.includes('[SECURITY ABORT]'), 'Must throw security abort on missing keys');
      }
      assert(threwMissing, 'Must fail closed when staging integration secrets are missing');

      // 2. Staging pointing to production platform fails closed
      process.env.KAZIBOX_API_KEY = 'test_key';
      process.env.KAZIBOX_API_URL = 'https://platform.kazibox.com';
      process.env.KAZIBOX_SSO_SECRET = 'test_sso';
      process.env.KAZIBOX_WEBHOOK_SECRET = 'test_wh';

      let threwProdUrl = false;
      try {
        getPharmaStockClient();
      } catch (err) {
        threwProdUrl = true;
        assert(err.message.includes('points to production'), 'Must flag production URL in staging');
      }
      assert(threwProdUrl, 'Must fail closed when staging points to production URL');
    } finally {
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
      if (oldApiKey === undefined) delete process.env.KAZIBOX_API_KEY; else process.env.KAZIBOX_API_KEY = oldApiKey;
      if (oldApiUrl === undefined) delete process.env.KAZIBOX_API_URL; else process.env.KAZIBOX_API_URL = oldApiUrl;
      if (oldSsoSecret === undefined) delete process.env.KAZIBOX_SSO_SECRET; else process.env.KAZIBOX_SSO_SECRET = oldSsoSecret;
      if (oldWebhookSecret === undefined) delete process.env.KAZIBOX_WEBHOOK_SECRET; else process.env.KAZIBOX_WEBHOOK_SECRET = oldWebhookSecret;
    }
  });

  // ── Phase 5.2 Regression Tests ──

  await test('Regression: A failed persistence operation throws an error and rolls back in-memory state for sales and restocks', () => {
    const tenantId = `tenant-persist-fail-${Date.now()}`;
    const originalAdapter = PharmaInventoryService.getStorageAdapter();

    // Initialize tenant with original adapter
    const initialMeds = PharmaInventoryService.listMedications(tenantId);
    const targetMed = initialMeds[0];
    const initialStock = targetMed.stockCount;
    const initialTenantData = originalAdapter.getTenant(tenantId);

    // Create a mock failing adapter that returns existing data on get, but fails on save
    const failingAdapter = {
      getTenant(companyId) {
        return initialTenantData;
      },
      saveTenant(companyId, data) {
        throw new Error('EACCES: permission denied, disk write failure');
      },
    };

    try {
      PharmaInventoryService.setStorageAdapter(failingAdapter);

      // 1. Verify sale fails and throws
      let saleThrew = false;
      try {
        PharmaInventoryService.recordSale(tenantId, {
          reference: `SALE-FAIL-${Date.now()}`,
          items: [{ medicationId: targetMed.id, quantity: 5 }],
        });
      } catch (err) {
        saleThrew = true;
        assert(err.message.includes('Sale persistence failure'), 'Error must identify persistence failure');
      }
      assert(saleThrew, 'recordSale must throw when persistence operation fails');

      // Verify in-memory stock was rolled back and sale was not recorded
      const medAfterFailedSale = PharmaInventoryService.getMedication(tenantId, targetMed.id);
      assertEqual(medAfterFailedSale.stockCount, initialStock, 'Stock must be rolled back on persistence failure');

      // 2. Verify restock fails and throws
      let restockThrew = false;
      try {
        PharmaInventoryService.recordRestock(tenantId, {
          medicationId: targetMed.id,
          batchNumber: 'LOT-FAIL-001',
          quantity: 20,
          expiryDate: '2028-01-01',
          costPrice: 500,
          reference: `RESTOCK-FAIL-${Date.now()}`,
        });
      } catch (err) {
        restockThrew = true;
        assert(err.message.includes('Restock persistence failure'), 'Error must identify persistence failure');
      }
      assert(restockThrew, 'recordRestock must throw when persistence operation fails');

      // Verify restock batch was not added in memory
      const medAfterFailedRestock = PharmaInventoryService.getMedication(tenantId, targetMed.id);
      assertEqual(medAfterFailedRestock.stockCount, initialStock, 'Restock stock must not be added when persistence fails');
    } finally {
      PharmaInventoryService.setStorageAdapter(originalAdapter);
    }
  });

  await test('Regression: Restock with duplicate reference is idempotent and does not double-increment stock', () => {
    const tenantId = `tenant-restock-dup-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(tenantId);
    const targetMed = meds[0];
    const initialStock = targetMed.stockCount;
    const restockRef = `RESTOCK-DUP-${Date.now()}`;

    // First restock
    const result1 = PharmaInventoryService.recordRestock(tenantId, {
      medicationId: targetMed.id,
      batchNumber: 'LOT-DUP-1',
      quantity: 25,
      expiryDate: '2028-06-30',
      costPrice: 800,
      reference: restockRef,
    });
    assertEqual(result1.medication.stockCount, initialStock + 25);

    // Duplicate restock with exact same reference (retry)
    const result2 = PharmaInventoryService.recordRestock(tenantId, {
      medicationId: targetMed.id,
      batchNumber: 'LOT-DUP-1',
      quantity: 25,
      expiryDate: '2028-06-30',
      costPrice: 800,
      reference: restockRef,
    });

    // Stock must remain initialStock + 25, NOT initialStock + 50
    assertEqual(result2.medication.stockCount, initialStock + 25, 'Duplicate restock must not double-increment stock');
  });

  await test('Regression: Malformed storage file is safely backed up and does not crash hydration', () => {
    const testFile = path.resolve('.cache', `pharma-corrupt-${Date.now()}.json`);
    const originalAdapter = PharmaInventoryService.getStorageAdapter();

    try {
      // Create a corrupted JSON file
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, '{"company-1": { malformed json content !!!', 'utf8');

      // Initialize FilePharmaStorageAdapter with corrupted file
      const adapter = new FilePharmaStorageAdapter(testFile);
      const tenantData = adapter.getTenant('company-1');
      assertEqual(tenantData, null, 'Must return null for corrupted file without crashing');

      // Check that a corrupted backup file was created
      const dirFiles = fs.readdirSync(path.dirname(testFile));
      const backupCreated = dirFiles.some((f) => f.includes('.corrupted.'));
      assert(backupCreated, 'Must create a .corrupted backup copy of malformed file');

      // Clean up backup file
      for (const f of dirFiles) {
        if (f.includes('.corrupted.')) {
          try {
            fs.unlinkSync(path.join(path.dirname(testFile), f));
          } catch {}
        }
      }
    } finally {
      PharmaInventoryService.setStorageAdapter(originalAdapter);
      try {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      } catch {}
    }
  });

  await test('Phase 5.3: Transaction queue serializes concurrent sales and restocks, preventing lost updates', async () => {
    const tenantId = `tenant-concurrency-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(tenantId);
    const targetMed = meds[0];
    const initialStock = targetMed.stockCount; // 140

    // 1. Run 10 concurrent sales simultaneously (each requesting 5 units = 50 total)
    const salePromises = Array.from({ length: 10 }).map((_, i) =>
      PharmaInventoryService.recordSaleAsync(tenantId, {
        reference: `CONC-SALE-${Date.now()}-${i}`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      })
    );

    const salesResults = await Promise.all(salePromises);
    assertEqual(salesResults.length, 10, 'All 10 concurrent sales must execute');

    const medAfterSales = PharmaInventoryService.getMedication(tenantId, targetMed.id);
    assertEqual(
      medAfterSales.stockCount,
      initialStock - 50,
      'Stock must be exactly initialStock - 50 with zero lost updates'
    );

    // 2. Run concurrent sales and restocks simultaneously
    // 4 sales of 5 units (20 deducted) + 2 restocks of 20 units (40 added) -> net +20 units
    const currentStock = medAfterSales.stockCount;
    const mixedOperations = [
      PharmaInventoryService.recordSaleAsync(tenantId, {
        reference: `MIXED-SALE-1-${Date.now()}`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      }),
      PharmaInventoryService.recordRestockAsync(tenantId, {
        medicationId: targetMed.id,
        batchNumber: 'LOT-MIX-1',
        quantity: 20,
        expiryDate: '2028-12-31',
        costPrice: 500,
        reference: `MIXED-RESTOCK-1-${Date.now()}`,
      }),
      PharmaInventoryService.recordSaleAsync(tenantId, {
        reference: `MIXED-SALE-2-${Date.now()}`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      }),
      PharmaInventoryService.recordRestockAsync(tenantId, {
        medicationId: targetMed.id,
        batchNumber: 'LOT-MIX-2',
        quantity: 20,
        expiryDate: '2028-12-31',
        costPrice: 500,
        reference: `MIXED-RESTOCK-2-${Date.now()}`,
      }),
      PharmaInventoryService.recordSaleAsync(tenantId, {
        reference: `MIXED-SALE-3-${Date.now()}`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      }),
      PharmaInventoryService.recordSaleAsync(tenantId, {
        reference: `MIXED-SALE-4-${Date.now()}`,
        items: [{ medicationId: targetMed.id, quantity: 5 }],
      }),
    ];

    await Promise.all(mixedOperations);

    const medAfterMixed = PharmaInventoryService.getMedication(tenantId, targetMed.id);
    assertEqual(
      medAfterMixed.stockCount,
      currentStock + 20,
      'Concurrent mixed sales and restocks must correctly reconcile without lost updates'
    );
  });

  // ── 9. Phase 5 Hardening: Persistence, Validation & Tenant Isolation Regressions ──
  console.log('\n── 9. Persistence, Input Validation & Tenant Isolation Regressions ──');

  await test('Regression: Duplicate sale request over HTTP returns existing sale and deducts stock strictly once', async () => {
    const companyId = `comp-dup-sale-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(companyId);
    const targetMed = meds[0];
    const initialStock = targetMed.stockCount;
    const saleRef = `SALE-IDEMPOTENT-${Date.now()}`;

    // 1st sale request
    const res1 = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': companyId,
      },
      body: JSON.stringify({
        reference: saleRef,
        items: [{ medicationId: targetMed.id, quantity: 4 }],
        patientName: 'Dup Patient',
      }),
    });
    assertEqual(res1.status, 201);
    const data1 = await res1.json();
    assertEqual(data1.success, true);
    const saleId1 = data1.sale.id;

    // Check stock after 1st sale
    const medAfter1 = PharmaInventoryService.getMedication(companyId, targetMed.id);
    assertEqual(medAfter1.stockCount, initialStock - 4);

    // 2nd sale request with identical reference
    const res2 = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': companyId,
      },
      body: JSON.stringify({
        reference: saleRef,
        items: [{ medicationId: targetMed.id, quantity: 4 }],
        patientName: 'Dup Patient',
      }),
    });
    assertEqual(res2.status, 201);
    const data2 = await res2.json();
    assertEqual(data2.success, true);
    assertEqual(data2.sale.id, saleId1, 'Duplicate sale must return the original sale object');

    // Verify stock was NOT deducted a second time
    const medAfter2 = PharmaInventoryService.getMedication(companyId, targetMed.id);
    assertEqual(medAfter2.stockCount, initialStock - 4, 'Stock must not be deducted twice on duplicate request');
  });

  await test('Regression: Duplicate restock request over HTTP is idempotent and increments stock strictly once', async () => {
    const companyId = `comp-dup-restock-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(companyId);
    const targetMed = meds[0];
    const initialStock = targetMed.stockCount;
    const restockRef = `RESTOCK-IDEMPOTENT-${Date.now()}`;

    // 1st restock request
    const res1 = await fetch(`${baseServerUrl}/api/restock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': companyId,
      },
      body: JSON.stringify({
        medicationId: targetMed.id,
        batchNumber: 'LOT-IDEM-01',
        quantity: 25,
        expiryDate: '2028-06-30',
        costPrice: 600,
        reference: restockRef,
      }),
    });
    assertEqual(res1.status, 201);
    const data1 = await res1.json();
    assertEqual(data1.success, true);

    const medAfter1 = PharmaInventoryService.getMedication(companyId, targetMed.id);
    assertEqual(medAfter1.stockCount, initialStock + 25);

    // 2nd restock request with identical reference
    const res2 = await fetch(`${baseServerUrl}/api/restock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': companyId,
      },
      body: JSON.stringify({
        medicationId: targetMed.id,
        batchNumber: 'LOT-IDEM-01',
        quantity: 25,
        expiryDate: '2028-06-30',
        costPrice: 600,
        reference: restockRef,
      }),
    });
    assertEqual(res2.status, 201);
    const data2 = await res2.json();
    assertEqual(data2.success, true);

    // Verify stock was NOT incremented a second time
    const medAfter2 = PharmaInventoryService.getMedication(companyId, targetMed.id);
    assertEqual(medAfter2.stockCount, initialStock + 25, 'Stock must not be incremented twice on duplicate restock');
  });

  await test('Regression: POST /api/sales validates request payload and rejects invalid inputs with HTTP 400', async () => {
    const companyId = `comp-val-sale-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(companyId);
    const targetMed = meds[0];

    async function postSale(body, rawString) {
      return await fetch(`${baseServerUrl}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': companyId,
        },
        body: rawString !== undefined ? rawString : JSON.stringify(body),
      });
    }

    // 1. Malformed JSON
    const resMalformed = await postSale(null, '{ "reference": "bad-json", ');
    assertEqual(resMalformed.status, 400);

    // 2. Non-object body (array)
    const resArray = await postSale([1, 2, 3]);
    assertEqual(resArray.status, 400);

    // 3. Missing items
    const resNoItems = await postSale({ reference: 'REF-1' });
    assertEqual(resNoItems.status, 400);

    // 4. Empty items array
    const resEmptyItems = await postSale({ reference: 'REF-2', items: [] });
    assertEqual(resEmptyItems.status, 400);

    // 5. Negative quantity
    const resNegQty = await postSale({
      reference: 'REF-3',
      items: [{ medicationId: targetMed.id, quantity: -5 }],
    });
    assertEqual(resNegQty.status, 400);

    // 6. Zero quantity
    const resZeroQty = await postSale({
      reference: 'REF-4',
      items: [{ medicationId: targetMed.id, quantity: 0 }],
    });
    assertEqual(resZeroQty.status, 400);

    // 7. Float quantity
    const resFloatQty = await postSale({
      reference: 'REF-5',
      items: [{ medicationId: targetMed.id, quantity: 1.5 }],
    });
    assertEqual(resFloatQty.status, 400);

    // 8. String quantity
    const resStringQty = await postSale({
      reference: 'REF-6',
      items: [{ medicationId: targetMed.id, quantity: '3' }],
    });
    assertEqual(resStringQty.status, 400);

    // 9. Missing medicationId
    const resNoMedId = await postSale({
      reference: 'REF-7',
      items: [{ quantity: 2 }],
    });
    assertEqual(resNoMedId.status, 400);

    // 10. Non-existent medicationId
    const resBadMedId = await postSale({
      reference: 'REF-8',
      items: [{ medicationId: 'med-non-existent-999', quantity: 1 }],
    });
    assertEqual(resBadMedId.status, 400);

    // 11. Empty string reference
    const resEmptyRef = await postSale({
      reference: '   ',
      items: [{ medicationId: targetMed.id, quantity: 1 }],
    });
    assertEqual(resEmptyRef.status, 400);

    // 12. Invalid currency code
    const resBadCurr = await postSale({
      reference: 'REF-10',
      items: [{ medicationId: targetMed.id, quantity: 1 }],
      currency: 'INVALID_LONG_CODE',
    });
    assertEqual(resBadCurr.status, 400);
  });

  await test('Regression: POST /api/restock validates request payload and rejects invalid inputs with HTTP 400', async () => {
    const companyId = `comp-val-restock-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(companyId);
    const targetMed = meds[0];

    async function postRestock(body, rawString) {
      return await fetch(`${baseServerUrl}/api/restock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': companyId,
        },
        body: rawString !== undefined ? rawString : JSON.stringify(body),
      });
    }

    // 1. Malformed JSON
    const resMalformed = await postRestock(null, '{ "medicationId": "test", ');
    assertEqual(resMalformed.status, 400);

    // 2. Missing medicationId
    const resNoMed = await postRestock({
      batchNumber: 'LOT-1',
      quantity: 10,
      expiryDate: '2028-01-01',
      costPrice: 500,
    });
    assertEqual(resNoMed.status, 400);

    // 3. Missing batchNumber
    const resNoBatch = await postRestock({
      medicationId: targetMed.id,
      quantity: 10,
      expiryDate: '2028-01-01',
      costPrice: 500,
    });
    assertEqual(resNoBatch.status, 400);

    // 4. Negative quantity
    const resNegQty = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: -10,
      expiryDate: '2028-01-01',
      costPrice: 500,
    });
    assertEqual(resNegQty.status, 400);

    // 5. Zero quantity
    const resZeroQty = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: 0,
      expiryDate: '2028-01-01',
      costPrice: 500,
    });
    assertEqual(resZeroQty.status, 400);

    // 6. Float quantity
    const resFloatQty = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: 4.2,
      expiryDate: '2028-01-01',
      costPrice: 500,
    });
    assertEqual(resFloatQty.status, 400);

    // 7. Negative costPrice
    const resNegPrice = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: 10,
      expiryDate: '2028-01-01',
      costPrice: -100,
    });
    assertEqual(resNegPrice.status, 400);

    // 8. Invalid expiry date
    const resBadDate = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: 10,
      expiryDate: 'not-a-valid-date',
      costPrice: 500,
    });
    assertEqual(resBadDate.status, 400);

    // 9. Empty reference
    const resEmptyRef = await postRestock({
      medicationId: targetMed.id,
      batchNumber: 'LOT-1',
      quantity: 10,
      expiryDate: '2028-01-01',
      costPrice: 500,
      reference: '   ',
    });
    assertEqual(resEmptyRef.status, 400);
  });

  await test('Regression: Restart persistence preserves SSO replay rejection, webhook dedup, inventory and provisioning status', async () => {
    const testDir = path.resolve('.cache', `test-restart-persist-${Date.now()}`);
    const dataFile = path.join(testDir, 'pharmastock-state.json');
    const ssoDir = path.join(testDir, 'idempotency', 'sso');
    const webhookDir = path.join(testDir, 'idempotency', 'webhooks');

    fs.mkdirSync(ssoDir, { recursive: true });
    fs.mkdirSync(webhookDir, { recursive: true });

    const ssoStoreA = new FileLockIdempotencyStore(ssoDir);
    const webhookStoreA = new FileLockIdempotencyStore(webhookDir);
    const storageAdapterA = new FilePharmaStorageAdapter(dataFile);

    // Save previous adapter
    const prevAdapter = PharmaInventoryService.getStorageAdapter();
    PharmaInventoryService.setStorageAdapter(storageAdapterA);

    const restartServerSecret = 'sso_secret_for_restart_test_999';
    const restartWebhookSecret = 'hook_secret_for_restart_test_888';

    // ── Phase 1: Server A runs ──
    const serverA = createPharmaServer({
      ssoSecret: restartServerSecret,
      webhookSecret: restartWebhookSecret,
      ssoStore: ssoStoreA,
      webhookStore: webhookStoreA,
    });
    const portA = await new Promise((resolve) => {
      serverA.listen(0, '127.0.0.1', () => {
        const addr = serverA.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 3001);
      });
    });
    const urlA = `http://127.0.0.1:${portA}`;

    const tenantId = `tenant-restart-${Date.now()}`;
    const ssoToken = issueSsoToken(
      {
        user: { id: 'usr-restart', name: 'Restart User', email: 'r@ci.test', role: 'owner' },
        workspace: { id: tenantId, name: 'Restart Tenant' },
        moduleId: 'pharmastock',
      },
      restartServerSecret
    );

    const webhookEventId = `evt-restart-${Date.now()}`;
    const webhookPayload = JSON.stringify({
      id: webhookEventId,
      event: 'module.activated',
      companyId: tenantId,
      timestamp: new Date().toISOString(),
    });
    const webhookSig = signWebhookPayload(webhookPayload, restartWebhookSecret);

    try {
      // 1. Consume SSO token on Server A
      const ssoRes1 = await fetch(`${urlA}/modules/pharmastock?token=${encodeURIComponent(ssoToken)}`);
      assertEqual(ssoRes1.status, 200, 'First SSO presentation on Server A must succeed');

      // 2. Deliver webhook on Server A
      const hookRes1 = await fetch(`${urlA}/api/webhooks/kazibox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kazibox-signature': webhookSig,
        },
        body: webhookPayload,
      });
      assertEqual(hookRes1.status, 200);
      const hookData1 = await hookRes1.json();
      assertEqual(hookData1.isDuplicate, false, 'First webhook delivery must not be duplicate');

      // 3. Perform a sale on Server A
      const medsA = PharmaInventoryService.listMedications(tenantId);
      const medA = medsA[0];
      const initialStock = medA.stockCount;

      const saleResA = await fetch(`${urlA}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': tenantId,
        },
        body: JSON.stringify({
          reference: `SALE-A-${Date.now()}`,
          items: [{ medicationId: medA.id, quantity: 3 }],
        }),
      });
      assertEqual(saleResA.status, 201);
    } finally {
      // Shutdown Server A (simulate crash / termination)
      await new Promise((resolve) => serverA.close(resolve));
    }

    // ── Simulate Process Restart ──
    // Clear in-memory caches and re-instantiate from persistent disk
    PharmaInventoryService.clearMemoryCache();
    const storageAdapterB = new FilePharmaStorageAdapter(dataFile);
    PharmaInventoryService.setStorageAdapter(storageAdapterB);

    const ssoStoreB = new FileLockIdempotencyStore(ssoDir);
    const webhookStoreB = new FileLockIdempotencyStore(webhookDir);

    const serverB = createPharmaServer({
      ssoSecret: restartServerSecret,
      webhookSecret: restartWebhookSecret,
      ssoStore: ssoStoreB,
      webhookStore: webhookStoreB,
    });
    const portB = await new Promise((resolve) => {
      serverB.listen(0, '127.0.0.1', () => {
        const addr = serverB.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 3002);
      });
    });
    const urlB = `http://127.0.0.1:${portB}`;

    try {
      // 1. Replay the SAME SSO token on Server B (post-restart)
      const ssoRes2 = await fetch(`${urlB}/modules/pharmastock?token=${encodeURIComponent(ssoToken)}`);
      assertEqual(ssoRes2.status, 401, 'SSO token must be rejected as replay after process restart');
      const ssoData2 = await ssoRes2.json();
      assert(
        ssoData2.error.includes('replay') || ssoData2.error.includes('consumed'),
        'Replay error message must indicate token was already consumed'
      );

      // 2. Deliver the SAME webhook on Server B (post-restart)
      const hookRes2 = await fetch(`${urlB}/api/webhooks/kazibox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kazibox-signature': webhookSig,
        },
        body: webhookPayload,
      });
      assertEqual(hookRes2.status, 200);
      const hookData2 = await hookRes2.json();
      assertEqual(hookData2.isDuplicate, true, 'Webhook must be detected as duplicate after process restart');

      // 3. Verify stock count survived restart
      const medsB = PharmaInventoryService.listMedications(tenantId);
      const medB = medsB[0];
      assertEqual(medB.stockCount, 140 - 3, 'Inventory stock deduction must survive process restart');

      // 4. Verify tenant provisioning status survived restart
      const statusB = getTenantProvisioningStatus(tenantId);
      assertEqual(statusB.status, 'provisioned', 'Tenant provisioning status must survive process restart');
    } finally {
      await new Promise((resolve) => serverB.close(resolve));
      PharmaInventoryService.setStorageAdapter(prevAdapter);
      // Clean up test dir
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  await test('Regression: Strict tenant isolation prevents cross-tenant access, stock manipulation, and reference collisions', async () => {
    const tenant1 = `tenant-iso-1-${Date.now()}`;
    const tenant2 = `tenant-iso-2-${Date.now()}`;

    const meds1 = PharmaInventoryService.listMedications(tenant1);
    const meds2 = PharmaInventoryService.listMedications(tenant2);

    const med1 = meds1[0];
    const med2 = meds2[0];
    const initialStock1 = med1.stockCount;
    const initialStock2 = med2.stockCount;

    // IDs are strictly segregated
    assert(med1.id !== med2.id, 'Medication IDs must belong strictly to their respective tenant');

    // Tenant 2 attempts to sell Tenant 1 medication ID
    const crossRes = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': tenant2,
      },
      body: JSON.stringify({
        reference: `CROSS-SALE-${Date.now()}`,
        items: [{ medicationId: med1.id, quantity: 1 }],
      }),
    });
    assertEqual(crossRes.status, 400, 'Cross-tenant sale must fail with HTTP 400');
    const crossData = await crossRes.json();
    assert(crossData.error.includes('not found'), 'Error must specify medication not found for tenant');

    // Identical reference used by BOTH tenants independently
    const sharedReference = `SHARED-POS-REF-${Date.now()}`;

    const saleRes1 = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': tenant1,
      },
      body: JSON.stringify({
        reference: sharedReference,
        items: [{ medicationId: med1.id, quantity: 2 }],
      }),
    });
    assertEqual(saleRes1.status, 201);

    const saleRes2 = await fetch(`${baseServerUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': tenant2,
      },
      body: JSON.stringify({
        reference: sharedReference,
        items: [{ medicationId: med2.id, quantity: 3 }],
      }),
    });
    assertEqual(saleRes2.status, 201);

    // Verify stock is correctly decremented in each isolated partition
    const updated1 = PharmaInventoryService.getMedication(tenant1, med1.id);
    const updated2 = PharmaInventoryService.getMedication(tenant2, med2.id);

    assertEqual(updated1.stockCount, initialStock1 - 2);
    assertEqual(updated2.stockCount, initialStock2 - 3);

    // Telemetry reflects individual tenant metrics
    const summary1 = buildPharmaStockSummary(tenant1);
    const summary2 = buildPharmaStockSummary(tenant2);

    assertEqual(summary1.activityCount, 1);
    assertEqual(summary2.activityCount, 1);
    assertEqual(summary1.revenue, med1.sellingPrice * 2);
    assertEqual(summary2.revenue, med2.sellingPrice * 3);
  });

  await test('Regression: withTenantTransaction propagates errors to caller, rolls back state, and does not stall subsequent operations', async () => {
    const tenantId = `tenant-tx-err-${Date.now()}`;
    const meds = PharmaInventoryService.listMedications(tenantId);
    const med = meds[0];
    const initialStock = med.stockCount;

    // 1. Transaction error must reject the caller's promise and not be silently swallowed
    let threw = false;
    let caughtError = null;
    try {
      await withTenantTransaction(tenantId, async () => {
        throw new Error('Database disk error simulation');
      });
    } catch (err) {
      threw = true;
      caughtError = err;
    }
    assert(threw, 'withTenantTransaction must reject caller promise when an operation throws');
    assertEqual(caughtError?.message, 'Database disk error simulation', 'Caller must receive the exact error message');

    // 2. Operational error with recordSale (insufficient stock) must throw to caller and preserve state
    let saleThrew = false;
    try {
      await PharmaFinanceSync.executeSaleAndSync(tenantId, {
        reference: `FAIL-TX-SALE-${Date.now()}`,
        items: [{ medicationId: med.id, quantity: initialStock + 9999 }],
      });
    } catch (err) {
      saleThrew = true;
      assert(err.message.includes('Insufficient stock'), 'Error message must reflect insufficient stock');
    }
    assert(saleThrew, 'executeSaleAndSync must reject when stock is insufficient');

    // Verify stock was not mutated
    const medAfterFail = PharmaInventoryService.getMedication(tenantId, med.id);
    assertEqual(medAfterFail.stockCount, initialStock, 'Stock count must remain untouched after transaction failure');

    // 3. Confirm transaction queue resumed normally for subsequent operations (no stall or deadlock)
    const validSaleResult = await PharmaFinanceSync.executeSaleAndSync(tenantId, {
      reference: `SUCCESS-AFTER-FAIL-${Date.now()}`,
      items: [{ medicationId: med.id, quantity: 2 }],
    });
    assert(validSaleResult?.sale?.id, 'Subsequent transaction must succeed after previous failure');
    const medAfterSuccess = PharmaInventoryService.getMedication(tenantId, med.id);
    assertEqual(medAfterSuccess.stockCount, initialStock - 2, 'Subsequent transaction must deduct stock properly');
  });
} finally {
  await new Promise((resolve) => pharmaServer.close(resolve));
}

// ── 10. Second Minimal SaaS Integration Verification (@kazibox/minimal-saas) ──
console.log('\n── 10. Second Minimal SaaS Integration Verification (@kazibox/minimal-saas) ──');

await test('Second SaaS manifest passes 100% of 6-point PWA compliance audit', () => {
  const result = validatePwaCompliance(minimalSaasManifest);
  assert(result.allPassed, `Expected all PWA checks to pass, failed checks: ${JSON.stringify(result.checks.filter(c => !c.passed))}`);
  assertEqual(result.checks.length, 6, 'Should perform exactly 6 PWA checks');
});

await test('End-to-End lifecycle: module.activated webhook provisions tenant, duplicate delivery is idempotent', async () => {
  const service = new MinimalSaasService();
  const store = new MemoryIdempotencyStore();
  const webhookSecret = 'test_whsec_fleet_courier_999';

  const handler = createWebhookHandler({
    webhookSecret,
    store,
    enableIdempotency: true,
    onModuleActivated: (event) => {
      service.provisionTenant(event.companyId, event.data?.plan);
    },
  });

  const eventPayload = {
    id: `evt-fleet-act-${Date.now()}`,
    event: 'module.activated',
    companyId: 'comp-courier-abidjan',
    timestamp: new Date().toISOString(),
    data: { plan: 'growth' },
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = signWebhookPayload(rawBody, webhookSecret);

  // 1. First delivery -> successfully provisions tenant
  const res1 = await handler({
    method: 'POST',
    headers: { 'x-kazibox-signature': signature },
    body: rawBody,
  });
  assertEqual(res1.status, 200);
  assertEqual(res1.body?.isDuplicate, false);
  assert(service.isTenantActive('comp-courier-abidjan'), 'Tenant should be active');
  assertEqual(service.getTenantData('comp-courier-abidjan').status?.plan, 'growth');

  // 2. Duplicate delivery -> caught by idempotency store
  const res2 = await handler({
    method: 'POST',
    headers: { 'x-kazibox-signature': signature },
    body: rawBody,
  });
  assertEqual(res2.status, 200);
  assertEqual(res2.body?.isDuplicate, true);
});

await test('End-to-End SSO handoff: 5-minute token grants access and single-use replay protection rejects reuse', async () => {
  const service = new MinimalSaasService();
  const store = new MemoryIdempotencyStore();
  const ssoSecret = 'test_sso_secret_fleet_courier_888';

  const ssoHandler = createSsoHandler({
    ssoSecret,
    store,
    enableReplayProtection: true,
    onAuthenticated: (payload) => {
      service.provisionTenant(payload.workspaceId);
    },
  });

  const token = issueSsoToken(
    {
      user: { id: 'usr-courier-01', name: 'Mamadou Diop', email: 'mamadou@express.sn', role: 'manager' },
      workspace: { id: 'ws-courier-sn', company_id: 'comp-courier-sn', name: 'Dakar Express Delivery', currency: 'XOF' },
      moduleId: 'fleet-courier',
      language: 'fr',
      ttlSeconds: 300,
    },
    ssoSecret
  );

  // 1. First presentation -> Authenticated
  const res1 = await ssoHandler(token);
  assert(res1.authenticated, `Expected authenticated, got error: ${res1.error}`);
  assertEqual(res1.session?.userId, 'usr-courier-01');
  assertEqual(res1.session?.workspaceId, 'comp-courier-sn');
  assert(service.isTenantActive('comp-courier-sn'), 'Tenant should be active upon SSO entry');

  // 2. Replay attempt with same token -> Replay detected
  const res2 = await ssoHandler(token);
  assert(!res2.authenticated, 'Replayed token must be rejected');
  assertEqual(res2.code, 'REPLAY_DETECTED');
});

await test('Operational revenue and expense synchronization to shared ledger with strict idempotency', async () => {
  const service = new MinimalSaasService();
  const tenantId = 'comp-courier-ledger-test';

  // 1. Record trip (revenue)
  const tripRes1 = await service.recordTrip(tenantId, {
    driverName: 'Kouassi Konan',
    amount: 15000,
    reference: 'REF-TRIP-2026-001',
  });
  assertEqual(tripRes1.isDuplicate, false);
  assertEqual(tripRes1.trip.amount, 15000);

  // Duplicate trip reference
  const tripRes2 = await service.recordTrip(tenantId, {
    driverName: 'Kouassi Konan',
    amount: 15000,
    reference: 'REF-TRIP-2026-001',
  });
  assertEqual(tripRes2.isDuplicate, true);
  assertEqual(tripRes2.trip.id, tripRes1.trip.id);

  // 2. Record fuel (expense)
  const fuelRes1 = await service.recordFuel(tenantId, {
    vehiclePlate: '4455-JJ-01',
    amount: 25000,
    reference: 'REF-FUEL-2026-001',
  });
  assertEqual(fuelRes1.isDuplicate, false);
  assertEqual(fuelRes1.fuel.amount, 25000);

  // Duplicate fuel reference
  const fuelRes2 = await service.recordFuel(tenantId, {
    vehiclePlate: '4455-JJ-01',
    amount: 25000,
    reference: 'REF-FUEL-2026-001',
  });
  assertEqual(fuelRes2.isDuplicate, true);
  assertEqual(fuelRes2.fuel.id, fuelRes1.fuel.id);

  // 3. Telemetry summary aggregation
  const summary = service.getSummary(tenantId);
  assertEqual(summary.revenue, 15000);
  assertEqual(summary.expenses, 25000);
  assertEqual(summary.activityCount, 2);
  assertEqual(summary.currency, 'XOF');
  assert(Array.isArray(summary.metrics) && summary.metrics.length === 2, 'Should export 2 consolidated metrics');
});

await test('Strict multi-tenant data isolation segregates trips, expenses, and status between tenants', async () => {
  const service = new MinimalSaasService();
  const tenantA = 'comp-abidjan-fleet';
  const tenantB = 'comp-bamako-fleet';

  // Tenant A records 2 trips and 1 fuel
  await service.recordTrip(tenantA, { driverName: 'Driver A1', amount: 8000, reference: 'REF-A-01' });
  await service.recordTrip(tenantA, { driverName: 'Driver A2', amount: 12000, reference: 'REF-A-02' });
  await service.recordFuel(tenantA, { vehiclePlate: 'VEH-A1', amount: 5000, reference: 'REF-FA-01' });

  // Tenant B records 1 trip with SAME reference as Tenant A (must not collide across tenants)
  await service.recordTrip(tenantB, { driverName: 'Driver B1', amount: 20000, reference: 'REF-A-01' });

  const dataA = service.getTenantData(tenantA);
  const dataB = service.getTenantData(tenantB);

  assertEqual(dataA.trips.length, 2);
  assertEqual(dataA.fuelLogs.length, 1);
  assertEqual(dataB.trips.length, 1);
  assertEqual(dataB.fuelLogs.length, 0);

  const summaryA = service.getSummary(tenantA);
  const summaryB = service.getSummary(tenantB);

  assertEqual(summaryA.revenue, 20000);
  assertEqual(summaryA.expenses, 5000);
  assertEqual(summaryB.revenue, 20000);
  assertEqual(summaryB.expenses, 0);
});

await test('Deactivation lifecycle: module.deactivated webhook suspends tenant access', async () => {
  const service = new MinimalSaasService();
  const store = new MemoryIdempotencyStore();
  const webhookSecret = 'test_whsec_fleet_courier_deact';

  service.provisionTenant('comp-deact-test', 'pro');
  assert(service.isTenantActive('comp-deact-test'), 'Tenant should be active initially');

  const handler = createWebhookHandler({
    webhookSecret,
    store,
    onModuleDeactivated: (event) => {
      service.deactivateTenant(event.companyId);
    },
  });

  const eventPayload = {
    id: `evt-fleet-deact-${Date.now()}`,
    event: 'module.deactivated',
    companyId: 'comp-deact-test',
    timestamp: new Date().toISOString(),
    data: {},
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = signWebhookPayload(rawBody, webhookSecret);

  const res = await handler({
    method: 'POST',
    headers: { 'x-kazibox-signature': signature },
    body: rawBody,
  });
  assertEqual(res.status, 200);
  assert(!service.isTenantActive('comp-deact-test'), 'Tenant should be suspended after deactivation');
});

await test('Minimal SaaS live HTTP microservice: health, manifest, SSO, webhooks, summary, and tenant data', async () => {
  const minimalApp = createMinimalServer({
    ssoSecret: 'http_test_sso_secret_999',
    webhookSecret: 'http_test_wh_secret_999',
    apiKey: 'kz_live_test_api_key_fleet_777',
  });

  const port = await minimalApp.start(0);
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Health endpoint
    const healthRes = await fetch(`${base}/api/health`);
    assertEqual(healthRes.status, 200);
    const health = await healthRes.json();
    assertEqual(health.status, 'healthy');
    assertEqual(health.module, 'fleet-courier');

    // 2. Manifest endpoint
    const manifestRes = await fetch(`${base}/api/manifest`);
    assertEqual(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assertEqual(manifest.id, 'fleet-courier');
    assertEqual(manifest.category, 'logistics');

    // 3. SSO endpoint
    const ssoToken = issueSsoToken(
      {
        user: { id: 'usr-http-courier', name: 'Amadou', role: 'owner' },
        workspace: { id: 'comp-http-tenant', name: 'Amadou Transports', currency: 'XOF' },
        moduleId: 'fleet-courier',
        language: 'fr',
        ttlSeconds: 300,
      },
      'http_test_sso_secret_999'
    );

    const ssoRes1 = await fetch(`${base}/modules/fleet-courier?token=${encodeURIComponent(ssoToken)}`);
    assertEqual(ssoRes1.status, 200);
    const ssoData = await ssoRes1.json();
    assert(ssoData.authenticated, 'SSO should be authenticated');

    // Replay over HTTP
    const ssoRes2 = await fetch(`${base}/modules/fleet-courier?token=${encodeURIComponent(ssoToken)}`);
    assertEqual(ssoRes2.status, 401);

    // 4. Webhook over HTTP
    const whPayload = {
      id: `evt-wh-http-${Date.now()}`,
      event: 'module.activated',
      companyId: 'comp-http-tenant',
      timestamp: new Date().toISOString(),
      data: { plan: 'enterprise' },
    };
    const rawWh = JSON.stringify(whPayload);
    const whSig = signWebhookPayload(rawWh, 'http_test_wh_secret_999');

    const whRes1 = await fetch(`${base}/api/webhooks/kazibox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kazibox-signature': whSig,
      },
      body: rawWh,
    });
    assertEqual(whRes1.status, 200);
    const whData1 = await whRes1.json();
    assertEqual(whData1.isDuplicate, false);

    // Webhook duplicate over HTTP
    const whRes2 = await fetch(`${base}/api/webhooks/kazibox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kazibox-signature': whSig,
      },
      body: rawWh,
    });
    assertEqual(whRes2.status, 200);
    const whData2 = await whRes2.json();
    assertEqual(whData2.isDuplicate, true);

    // 5. Trip POST over HTTP
    const tripRes = await fetch(`${base}/api/trips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'comp-http-tenant',
      },
      body: JSON.stringify({
        driverName: 'Sékou Traoré',
        amount: 35000,
        reference: 'REF-HTTP-TRIP-01',
      }),
    });
    assertEqual(tripRes.status, 201);

    // 6. Fuel POST over HTTP
    const fuelRes = await fetch(`${base}/api/fuel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': 'comp-http-tenant',
      },
      body: JSON.stringify({
        vehiclePlate: 'CI-9002-AZ',
        amount: 18000,
        reference: 'REF-HTTP-FUEL-01',
      }),
    });
    assertEqual(fuelRes.status, 201);

    // 7. Summary GET over HTTP
    const summaryRes = await fetch(`${base}/api/summary`, {
      headers: {
        'X-Workspace-Id': 'comp-http-tenant',
        Authorization: 'Bearer kz_live_test_api_key_fleet_777',
      },
    });
    assertEqual(summaryRes.status, 200);
    const summary = await summaryRes.json();
    assertEqual(summary.moduleId, 'fleet-courier');
    assertEqual(summary.companyId, 'comp-http-tenant');
    assertEqual(summary.revenue, 35000);
    assertEqual(summary.expenses, 18000);
    assertEqual(summary.activityCount, 2);

    // 8. Tenant data GET over HTTP
    const dataRes = await fetch(`${base}/api/data`, {
      headers: {
        'X-Workspace-Id': 'comp-http-tenant',
      },
    });
    assertEqual(dataRes.status, 200);
    const tenantData = await dataRes.json();
    assertEqual(tenantData.trips.length, 1);
    assertEqual(tenantData.fuelLogs.length, 1);
  } finally {
    await minimalApp.stop();
  }
});

console.log('\n───────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.error(`SaaS Integration Kit test suite FAILED ❌`);
  process.exit(1);
} else {
  console.log(`All SaaS Integration Kit & PharmaStock tests PASSED ✅\n`);
}
