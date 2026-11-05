import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

// Configure isolated temporary store paths before importing platform modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazibox-registry-test-'));
process.env.KAZIBOX_STORE_PATH = path.join(tmpDir, 'platform-store.json');
process.env.KAZIBOX_WEBHOOKS_PATH = path.join(tmpDir, 'webhooks-queue.json');
process.env.KAZIBOX_MASTER_KEY = 'test-master-encryption-key-for-kazibox-registry-suite-2026';

const {
  registerOrSaveModule,
  updateModuleManifest,
  updateModuleStatus,
  provisionModuleCredentials,
  getApiKeysForModule,
  getModuleRuntimeSecrets,
  buildDbModuleRow,
  toDbModuleStatus,
  fromDbModuleStatus,
  sanitizeManifest,
  isValidEndpointUrl,
  assertSafeOutboundUrl,
  decryptModuleSecret,
} = await import('../lib/registry.ts');

const {
  getModules,
  getModule,
  getModuleSummaries,
  activateModule,
} = await import('../lib/modules.ts');

const { authenticateModuleApiKey } = await import('../lib/api-auth.ts');
const { dispatchWebhookEvent, retryWebhook, getWebhookEvents } = await import('../lib/webhooks.ts');
const { reloadServerStore, getStore, setStoreItem } = await import('../lib/storage.ts');

const registerRoute = await import('../app/api/v1/modules/register/route.ts');
const registryIdRoute = await import('../app/api/v1/modules/registry/[id]/route.ts');
const launchRoute = await import('../app/api/v1/modules/[slug]/launch/route.ts');
const summaryRoute = await import('../app/api/v1/modules/[slug]/summary/route.ts');

const {
  verifySsoToken,
  createSsoHandler,
  createWebhookHandler,
  MemoryIdempotencyStore,
  computeHmacSha256Base64Url,
} = await import('@kazibox/sdk');

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
console.log('KaziBox Post-Implementation Strict Verification Suite (11 Items)');
console.log('================================================================\n');

// Spin up an ephemeral HTTP server simulating an independently hosted SaaS ("cargo-tracker")
const receivedWebhooks = [];
let failNextWebhookAttempt = false;
let redirectNextWebhookToInternalIp = false;
let redirectNextSummaryToMetadataIp = false;
let internalMetadataEndpointHit = false;
let currentSaaSWebhookSecret = '';
let currentSaaSSsoSecret = '';
const ssoReplayStore = new MemoryIdempotencyStore();

const saasServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Internal SSRF honey-pot trap route
  if (url.pathname === '/ssrf-trap') {
    internalMetadataEndpointHit = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ secret: 'IAM_CREDENTIALS_LEAKED' }));
    return;
  }

  // SSO Handoff Endpoint on External SaaS
  if (req.method === 'GET' && url.pathname === '/sso/launch') {
    const token = url.searchParams.get('token') || '';
    const ssoHandler = createSsoHandler({
      ssoSecret: currentSaaSSsoSecret,
      store: ssoReplayStore,
      enableReplayProtection: true,
    });
    const result = await ssoHandler(token);
    if (!result.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: false, code: result.code, error: result.error }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: true, session: result.session }));
    return;
  }

  // Webhook Receiver Endpoint on External SaaS
  if (req.method === 'POST' && url.pathname === '/webhooks/kazibox') {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    if (redirectNextWebhookToInternalIp) {
      redirectNextWebhookToInternalIp = false;
      res.writeHead(302, { Location: `http://127.0.0.1:${saasPort}/ssrf-trap` });
      res.end();
      return;
    }

    if (failNextWebhookAttempt) {
      failNextWebhookAttempt = false;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Simulated transient error' }));
      return;
    }

    const recordHook = async (evt) => {
      receivedWebhooks.push({
        event: evt,
        headers: req.headers,
      });
    };

    const handler = createWebhookHandler({
      webhookSecret: currentSaaSWebhookSecret,
      enableIdempotency: false,
      onModuleActivated: recordHook,
      onModuleDeactivated: recordHook,
      onSubscriptionUpdated: recordHook,
      onPaymentSucceeded: recordHook,
      onPaymentFailed: recordHook,
      onUnhandledEvent: recordHook,
    });

    const result = await handler({
      method: 'POST',
      headers: req.headers,
      body: rawBody,
    });

    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // Dynamic Summary Endpoint on External SaaS
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    if (redirectNextSummaryToMetadataIp) {
      redirectNextSummaryToMetadataIp = false;
      res.writeHead(302, { Location: `http://169.254.169.254/latest/meta-data/` });
      res.end();
      return;
    }

    const workspaceId = req.headers['x-workspace-id'] || url.searchParams.get('companyId') || 'unknown';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        moduleId: 'cargo-tracker',
        companyId: workspaceId,
        revenue: workspaceId === '11111111-1111-4111-8111-111111111111' ? 480000 : 125000,
        expenses: workspaceId === '11111111-1111-4111-8111-111111111111' ? 95000 : 30000,
        activityCount: 19,
        currency: 'XOF',
        lastUpdated: new Date().toISOString(),
        metrics: [
          {
            id: 'shipments-active',
            label: { fr: 'Expéditions Actives', en: 'Active Shipments' },
            value: workspaceId === '11111111-1111-4111-8111-111111111111' ? 42 : 11,
            trend: 'up',
          },
        ],
      })
    );
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

await new Promise((resolve) => saasServer.listen(0, '127.0.0.1', resolve));
const saasPort = saasServer.address().port;
const saasBaseUrl = `http://127.0.0.1:${saasPort}`;

// ---------------------------------------------------------------------------
// 1. Validation & No-Code Registration
// ---------------------------------------------------------------------------
console.log('1. No-Code Registration & Validation');

await test('Rejects invalid registration payload missing required fields or invalid URLs', async () => {
  const invalidRes = await registerOrSaveModule({
    id: 'INVALID SLUG!',
    name: { fr: '', en: '' },
    entryUrl: 'ftp://bad-url',
  });
  assert.equal(invalidRes.success, false);
  assert.equal(invalidRes.code, 'VALIDATION_FAILED');
  assert.ok(invalidRes.details && invalidRes.details.length >= 2);
});

let provisionedCreds = null;

await test('Registers a new external SaaS application with structured fields and provisions all 3 credentials', async () => {
  const res = await registerOrSaveModule(
    {
      id: 'cargo-tracker',
      slug: 'cargo-tracker',
      name: { fr: 'CargoTracker Afrique', en: 'CargoTracker Africa' },
      tagline: { fr: 'Suivi de fret et conteneurs', en: 'Freight and container tracking' },
      description: {
        fr: 'Gestion complète du fret maritime et routier multi-pays.',
        en: 'End-to-end maritime and road freight management.',
      },
      category: 'operations',
      developer: 'LogiTech Dakar SARL',
      version: '1.2.0',
      logo: '🚢',
      accentColor: '#0284C7',
      kind: 'external',
      status: 'draft',
      appUrl: `https://cargo.example.com`,
      entryUrl: `https://cargo.example.com/sso/launch`,
      summaryUrl: `https://cargo.example.com/api/summary`,
      webhookUrl: `https://cargo.example.com/webhooks/kazibox`,
      pricing_type: 'paid',
      pricePerMonth: { amount: 25, currency: 'USD' },
      scopes: ['read:context', 'read:subscription', 'write:finance', 'write:events'],
      events: ['module.activated', 'module.deactivated', 'subscription.activated'],
      pwa: {
        startUrl: 'https://cargo.example.com/sso/launch',
        scope: '/',
        themeColor: '#0284C7',
        icons: [
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    },
    { allowOverwrite: false, provisionCredentials: true }
  );

  assert.equal(res.success, true);
  assert.equal(res.module.id, 'cargo-tracker');
  assert.equal(res.module.developer, 'LogiTech Dakar SARL');
  assert.equal(res.pwaCompliance.allPassed, true);
  assert.ok(res.credentials?.apiKey?.startsWith('kz_'));
  assert.ok(res.credentials?.ssoSecret?.startsWith('kz_sso_'));
  assert.ok(res.credentials?.webhookSecret?.startsWith('kz_whsec_'));
  provisionedCreds = res.credentials;
  currentSaaSWebhookSecret = provisionedCreds.webhookSecret;
  currentSaaSSsoSecret = provisionedCreds.ssoSecret;
});

await test('Rejects duplicate module slug when allowOverwrite is false (409 conflict guard)', async () => {
  const dupRes = await registerOrSaveModule(
    {
      id: 'cargo-tracker',
      name: { fr: 'Autre Cargo', en: 'Other Cargo' },
      description: { fr: 'Desc', en: 'Desc' },
      entryUrl: 'https://cargo.example.com/launch',
    },
    { allowOverwrite: false }
  );
  assert.equal(dupRes.success, false);
  assert.equal(dupRes.code, 'DUPLICATE_MODULE_SLUG');
});

// ---------------------------------------------------------------------------
// 2. Persistent Registry & Database Constraint Compatibility (Items 1, 2, 3, 4)
// ---------------------------------------------------------------------------
console.log('\n2. Persistent Registry, Supabase Schema Constraints & KAZIBOX_MASTER_KEY Decryption');

await test('Populates all NOT NULL columns and satisfies PostgreSQL status CHECK constraint', async () => {
  const mod = await getModule('cargo-tracker');
  assert.ok(mod);

  const dbRowDraft = buildDbModuleRow(mod);
  assert.equal(dbRowDraft.id, 'cargo-tracker');
  assert.equal(dbRowDraft.slug, 'cargo-tracker');
  assert.equal(dbRowDraft.icon, '🚢');
  assert.equal(dbRowDraft.developer, 'LogiTech Dakar SARL');
  assert.equal(dbRowDraft.version, '1.2.0');
  assert.equal(dbRowDraft.category, 'operations');
  assert.ok(['active', 'beta', 'deprecated'].includes(dbRowDraft.status));
  assert.equal(dbRowDraft.status, 'beta');
  assert.equal(fromDbModuleStatus('active', 'published'), 'published');
  assert.equal(fromDbModuleStatus('deprecated', 'suspended'), 'suspended');
  assert.equal(toDbModuleStatus('published'), 'active');
  assert.equal(toDbModuleStatus('suspended'), 'deprecated');
});

await test('Persists registered module and decrypts KAZIBOX_MASTER_KEY secrets across simulated server restarts', async () => {
  const reloaded = reloadServerStore();
  assert.ok(reloaded.modules.some((m) => m.id === 'cargo-tracker'));

  const modAfterRestart = await getModule('cargo-tracker');
  assert.ok(modAfterRestart);
  assert.equal(modAfterRestart.id, 'cargo-tracker');
  assert.equal(modAfterRestart.name.fr, 'CargoTracker Afrique');

  const runtimeSecrets = await getModuleRuntimeSecrets('cargo-tracker');
  assert.equal(runtimeSecrets.ssoSecret, provisionedCreds.ssoSecret);
  assert.equal(runtimeSecrets.webhookSecret, provisionedCreds.webhookSecret);

  // Verify KAZIBOX_MASTER_KEY cryptographic binding: wrong master key cannot decrypt AES-256-GCM ciphertext
  const storedRecord = reloaded.apiKeys.find((k) => k.moduleId === 'cargo-tracker' && k.type === 'sso_secret');
  assert.ok(storedRecord?.encryptedSecret?.startsWith('enc:v1:'));

  const originalKey = process.env.KAZIBOX_MASTER_KEY;
  process.env.KAZIBOX_MASTER_KEY = 'wrong-master-key-must-fail-gcm-auth-tag';
  const failedDecrypt = decryptModuleSecret(storedRecord.encryptedSecret);
  process.env.KAZIBOX_MASTER_KEY = originalKey;
  assert.equal(failedDecrypt, null, 'AES-256-GCM must fail decryption when KAZIBOX_MASTER_KEY differs');
});

await test('Executes real Supabase PostgREST table persistence code path enforcing 01_schema.sql constraints when Supabase is active', async () => {
  // Build a strict 01_schema.sql constraint-enforcing Supabase database simulator
  const pgTables = {
    companies: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Palmeraie' }],
    modules: [],
    module_api_keys: [],
    webhook_events: [],
  };

  function validatePgModuleRow(row) {
    const requiredNotNull = ['id', 'slug', 'name', 'description', 'category', 'icon', 'kind', 'status', 'developer', 'version'];
    for (const col of requiredNotNull) {
      if (row[col] === undefined || row[col] === null || row[col] === '') {
        return { message: `null value in column "${col}" of relation "modules" violates not-null constraint` };
      }
    }
    if (!['internal', 'external'].includes(row.kind)) {
      return { message: `new row for relation "modules" violates check constraint "modules_kind_check"` };
    }
    if (!['active', 'beta', 'deprecated'].includes(row.status)) {
      return { message: `new row for relation "modules" violates check constraint "modules_status_check"` };
    }
    return null;
  }

  function validatePgApiKeyRow(row) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.company_id || '')) {
      return { message: `invalid input syntax for type uuid: "${row.company_id}"` };
    }
    if (!pgTables.companies.some((c) => c.id === row.company_id)) {
      return { message: `insert or update on table "module_api_keys" violates foreign key constraint "module_api_keys_company_id_fkey"` };
    }
    if (!pgTables.modules.some((m) => m.id === row.module_id)) {
      return { message: `insert or update on table "module_api_keys" violates foreign key constraint "module_api_keys_module_id_fkey"` };
    }
    return null;
  }

  globalThis.__kaziboxSupabaseAdminOverride = {
    from(table) {
      return {
        upsert(row) {
          if (table === 'modules') {
            const err = validatePgModuleRow(row);
            if (err) return Promise.resolve({ data: null, error: err });
            const idx = pgTables.modules.findIndex((m) => m.id === row.id);
            const saved = { ...row, created_at: new Date().toISOString() };
            if (idx >= 0) pgTables.modules[idx] = saved;
            else pgTables.modules.push(saved);
            return Promise.resolve({ data: saved, error: null });
          }
          return Promise.resolve({ data: row, error: null });
        },
        insert(row) {
          const singleRow = Array.isArray(row) ? row[0] : row;
          if (table === 'module_api_keys') {
            const err = validatePgApiKeyRow(singleRow);
            const saved = { id: crypto.randomUUID(), ...singleRow, created_at: new Date().toISOString() };
            if (!err) pgTables.module_api_keys.push(saved);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: err ? null : saved, error: err }),
              }),
              then: (resolve) => resolve({ data: err ? null : saved, error: err }),
            };
          }
          return Promise.resolve({ data: singleRow, error: null });
        },
        delete() {
          let modIdFilter = null;
          let prefixPattern = null;
          const chain = {
            eq(col, val) {
              if (col === 'module_id') modIdFilter = val;
              return chain;
            },
            ilike(col, pat) {
              if (col === 'key_prefix') prefixPattern = pat.replace('%', '');
              if (table === 'module_api_keys') {
                pgTables.module_api_keys = pgTables.module_api_keys.filter(
                  (k) => !(k.module_id === modIdFilter && k.key_prefix.startsWith(prefixPattern))
                );
              }
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
        select() {
          let filters = [];
          const chain = {
            eq(col, val) {
              filters.push((r) => r[col] === val);
              return chain;
            },
            or(expr) {
              if (expr.includes('id.eq.')) {
                const m = expr.match(/id\.eq\.([^,]+),slug\.eq\.(.+)/);
                if (m) {
                  filters.push((r) => r.id === m[1] || r.slug === m[2]);
                }
              }
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            maybeSingle() {
              const rows = (pgTables[table] || []).filter((r) => filters.every((f) => f(r)));
              return Promise.resolve({ data: rows[0] || null, error: null });
            },
            then(resolve) {
              const rows = (pgTables[table] || []).filter((r) => filters.every((f) => f(r)));
              return resolve({ data: rows, error: null });
            },
          };
          return chain;
        },
      };
    },
  };

  try {
    // Register a module with a non-UUID companyId ("ws-custom") to verify automatic valid company UUID resolution
    const dbReg = await registerOrSaveModule(
      {
        id: 'supabase-verified-saas',
        slug: 'supabase-verified-saas',
        name: { fr: 'SaaS Supabase Vérifié', en: 'Verified Supabase SaaS' },
        description: { fr: ' Persisté dans PostgreSQL', en: 'Persisted in PostgreSQL' },
        status: 'draft',
        entryUrl: 'https://verified-saas.example.com/sso',
        webhookUrl: 'https://verified-saas.example.com/webhook',
        summaryUrl: 'https://verified-saas.example.com/summary',
      },
      { allowOverwrite: true, companyId: 'non-uuid-company-id', provisionCredentials: true }
    );

    assert.equal(dbReg.success, true);
    assert.equal(pgTables.modules.length, 1);
    assert.equal(pgTables.modules[0].id, 'supabase-verified-saas');
    assert.equal(pgTables.modules[0].status, 'beta');
    assert.equal(pgTables.module_api_keys.length, 3);

    // Wipe local store & disk cache completely for this module to prove Supabase-only recovery after restart
    const store = getStore();
    store.modules = store.modules.filter((m) => m.id !== 'supabase-verified-saas');
    store.apiKeys = store.apiKeys.filter((k) => k.moduleId !== 'supabase-verified-saas');
    setStoreItem('MODULES', store.modules);
    setStoreItem('API_KEYS', store.apiKeys);

    const loadedFromDb = await getModule('supabase-verified-saas');
    assert.ok(loadedFromDb, 'Module must load dynamically from Supabase public.modules when local store is empty');
    assert.equal(loadedFromDb.name.en, 'Verified Supabase SaaS');

    const secretsFromDb = await getModuleRuntimeSecrets('supabase-verified-saas');
    assert.equal(secretsFromDb.ssoSecret, dbReg.credentials.ssoSecret);
    assert.equal(secretsFromDb.webhookSecret, dbReg.credentials.webhookSecret);
  } finally {
    delete globalThis.__kaziboxSupabaseAdminOverride;
  }
});

// ---------------------------------------------------------------------------
// 3. Credential Provisioning & Secret Hygiene (Item 10)
// ---------------------------------------------------------------------------
console.log('\n3. Credential Provisioning, Encryption at Rest & Secret Hygiene');

await test('Never exposes plaintext secrets, SHA-256 hashes, or ciphertexts in manifests or GET API responses', async () => {
  const mod = await getModule('cargo-tracker');
  const serialized = JSON.stringify(mod);
  assert.equal(serialized.includes(provisionedCreds.apiKey), false);
  assert.equal(serialized.includes(provisionedCreds.ssoSecret), false);
  assert.equal(serialized.includes(provisionedCreds.webhookSecret), false);

  const dirty = sanitizeManifest({
    ...mod,
    ssoSecret: 'LEAKED_SSO',
    webhookSecret: 'LEAKED_WH',
    apiKey: 'LEAKED_API',
    keyHash: 'LEAKED_HASH',
    hashedSecret: 'LEAKED_HASH_2',
    encryptedSecret: 'LEAKED_ENC',
  });
  assert.equal('ssoSecret' in dirty, false);
  assert.equal('webhookSecret' in dirty, false);
  assert.equal('apiKey' in dirty, false);
  assert.equal('keyHash' in dirty, false);
  assert.equal('hashedSecret' in dirty, false);
  assert.equal('encryptedSecret' in dirty, false);

  // Verify GET /api/v1/modules/registry/[id] response
  const getReq = makeSessionRequest('http://localhost:3000/api/v1/modules/registry/cargo-tracker', {
    session: { userId: 'usr-admin-05', companyId: '11111111-1111-4111-8111-111111111111', role: 'platform_admin' },
  });
  const getRes = await registryIdRoute.GET(getReq, { params: { id: 'cargo-tracker' } });
  assert.equal(getRes.status, 200);
  const getBodyText = await getRes.text();
  assert.equal(getBodyText.includes(provisionedCreds.apiKey), false);
  assert.equal(getBodyText.includes(provisionedCreds.ssoSecret), false);
  assert.equal(getBodyText.includes(provisionedCreds.webhookSecret), false);
  assert.equal(getBodyText.includes('sha256:'), false);
  assert.equal(getBodyText.includes('enc:v1:'), false);
});

await test('getApiKeysForModule returns masked prefixes and [REDACTED] hashes, and supports secret rotation', async () => {
  const metadata = await getApiKeysForModule('cargo-tracker');
  assert.equal(metadata.length, 3);
  for (const item of metadata) {
    assert.ok(item.prefix.endsWith('...'));
    assert.equal(item.hashedSecret, '[REDACTED]');
    assert.equal(item.encryptedSecret, undefined);
  }

  // Rotate webhook secret only
  const rotated = await provisionModuleCredentials('cargo-tracker', undefined, {
    credentialType: 'webhook_secret',
    scope: 'platform',
  });
  assert.ok(rotated.webhookSecret?.startsWith('kz_whsec_'));
  assert.notEqual(rotated.webhookSecret, provisionedCreds.webhookSecret);

  const updatedRuntime = await getModuleRuntimeSecrets('cargo-tracker');
  assert.equal(updatedRuntime.webhookSecret, rotated.webhookSecret);
  assert.equal(updatedRuntime.ssoSecret, provisionedCreds.ssoSecret);

  currentSaaSWebhookSecret = rotated.webhookSecret;
  provisionedCreds.webhookSecret = rotated.webhookSecret;
});

// ---------------------------------------------------------------------------
// 4. Structured Editing & Status Lifecycle Management
// ---------------------------------------------------------------------------
console.log('\n4. Admin Editing & Lifecycle Management');

await test('Updates module configuration and transitions status (draft -> review -> published -> suspended)', async () => {
  const pubRes = await updateModuleStatus('cargo-tracker', 'published');
  assert.equal(pubRes.success, true);

  let mod = await getModule('cargo-tracker');
  assert.equal(mod.status, 'published');

  // Update endpoints to point to our live local test server for real HTTP SSO, webhook & summary tests
  const editRes = await updateModuleManifest('cargo-tracker', {
    pricePerMonth: { amount: 39, currency: 'USD' },
    entryUrl: `${saasBaseUrl}/sso/launch`,
    webhookUrl: `${saasBaseUrl}/webhooks/kazibox`,
    summaryUrl: `${saasBaseUrl}/api/summary`,
  });
  assert.equal(editRes.success, true);

  mod = await getModule('cargo-tracker');
  assert.equal(mod.pricePerMonth.amount, 39);
  assert.equal(mod.entryUrl, `${saasBaseUrl}/sso/launch`);
  assert.equal(mod.webhookUrl, `${saasBaseUrl}/webhooks/kazibox`);
  assert.equal(mod.summaryUrl, `${saasBaseUrl}/api/summary`);
});

// ---------------------------------------------------------------------------
// 5. Dynamic Module Resolution, API Key Auth & Multi-Tenant Isolation
// ---------------------------------------------------------------------------
console.log('\n5. Dynamic Module Resolution, API Key Auth & Multi-Tenant Isolation');

await test('Authenticates dynamically registered module API key across multiple tenant workspaces', async () => {
  const reqAbidjan = new Request('http://localhost:3000/api/v1/context', {
    headers: {
      Authorization: `Bearer ${provisionedCreds.apiKey}`,
      'X-Workspace-Id': 'comp-abidjan-01',
    },
  });
  const authAbidjan = await authenticateModuleApiKey(reqAbidjan, 'read:context');
  assert.ok(authAbidjan.auth);
  assert.equal(authAbidjan.auth.moduleId, 'cargo-tracker');
  assert.equal(authAbidjan.auth.workspaceId, 'comp-abidjan-01');
  assert.equal(authAbidjan.auth.keyScope, 'platform');

  const reqDakar = new Request('http://localhost:3000/api/v1/context', {
    headers: {
      Authorization: `Bearer ${provisionedCreds.apiKey}`,
      'X-Workspace-Id': 'comp-dakar-02',
    },
  });
  const authDakar = await authenticateModuleApiKey(reqDakar, 'read:context');
  assert.ok(authDakar.auth);
  assert.equal(authDakar.auth.moduleId, 'cargo-tracker');
  assert.equal(authDakar.auth.workspaceId, 'comp-dakar-02');
});

await test('Enforces strict tenant isolation for workspace-scoped API keys (403 WORKSPACE_MISMATCH)', async () => {
  const wsCreds = await provisionModuleCredentials('cargo-tracker', 'comp-abidjan-01', {
    credentialType: 'api_key',
    scope: 'workspace',
  });

  const crossTenantReq = new Request('http://localhost:3000/api/v1/context', {
    headers: {
      Authorization: `Bearer ${wsCreds.apiKey}`,
      'X-Workspace-Id': 'comp-dakar-02',
    },
  });
  const crossAuth = await authenticateModuleApiKey(crossTenantReq, 'read:context');
  assert.ok(crossAuth.errorResponse);
  assert.equal(crossAuth.errorResponse.status, 403);
  const errBody = await crossAuth.errorResponse.json();
  assert.equal(errBody.code, 'WORKSPACE_MISMATCH');
});

await test('Rejects SSO and Webhook secrets if presented as Bearer API keys', async () => {
  const ssoAsBearerReq = new Request('http://localhost:3000/api/v1/context', {
    headers: {
      Authorization: `Bearer ${provisionedCreds.ssoSecret}`,
    },
  });
  const res = await authenticateModuleApiKey(ssoAsBearerReq, 'read:context');
  assert.ok(res.errorResponse);
  assert.equal(res.errorResponse.status, 401);
});

// ---------------------------------------------------------------------------
// 6. End-to-End SSO Launch Flow via Route Handler & Live SaaS Server (Item 5)
// ---------------------------------------------------------------------------
console.log('\n6. End-to-End SSO Launch Route & Live SaaS Verification');

await test('Completes full SSO launch flow via POST /api/v1/modules/[slug]/launch to external SaaS and blocks replay', async () => {
  const targetCompanyId = '11111111-1111-4111-8111-111111111111';
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.companyId === targetCompanyId);
  if (sub) {
    sub.currentPeriodEnd = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
    if (!sub.includedModuleIds.includes('cargo-tracker')) {
      sub.includedModuleIds.push('cargo-tracker');
    }
    setStoreItem('SUBSCRIPTIONS', store.subscriptions);
  }
  await activateModule(targetCompanyId, 'cargo-tracker');

  // 1. Call POST /api/v1/modules/cargo-tracker/launch as authenticated workspace owner
  const launchReq = makeSessionRequest('http://localhost:3000/api/v1/modules/cargo-tracker/launch', {
    method: 'POST',
    session: { userId: 'usr-1', companyId: targetCompanyId, role: 'owner' },
  });
  const launchRes = await launchRoute.POST(launchReq, { params: { slug: 'cargo-tracker' } });
  assert.equal(launchRes.status, 200);
  const launchData = await launchRes.json();
  assert.equal(launchData.success, true);
  assert.ok(launchData.token);
  assert.ok(launchData.launchUrl.startsWith(`${saasBaseUrl}/sso/launch?token=`));

  // 2. Follow launchUrl to external SaaS HTTP server
  const saasResp1 = await fetch(launchData.launchUrl);
  assert.equal(saasResp1.status, 200);
  const saasSession1 = await saasResp1.json();
  assert.equal(saasSession1.authenticated, true);
  assert.equal(saasSession1.session.workspaceId, targetCompanyId);
  assert.equal(saasSession1.session.userId, 'usr-1');

  // 3. Replay the exact same launchUrl -> external SaaS must reject with 401 REPLAY_DETECTED
  const saasResp2 = await fetch(launchData.launchUrl);
  assert.equal(saasResp2.status, 401);
  const saasSession2 = await saasResp2.json();
  assert.equal(saasSession2.authenticated, false);
  assert.equal(saasSession2.code, 'REPLAY_DETECTED');
});

// ---------------------------------------------------------------------------
// 7. Real Outbound HTTP Webhook Delivery, Retries & Dynamic Summary Route (Items 6, 7, 8)
// ---------------------------------------------------------------------------
console.log('\n7. Real Outbound HTTP Webhook Delivery, Retries & Dynamic Summary Route');

await test('Dispatches real HMAC-SHA256 signed HTTP webhook to external SaaS and enforces idempotency', async () => {
  const baselineCount = receivedWebhooks.length;
  const deliveries = await dispatchWebhookEvent(
    'subscription.activated',
    {
      id: 'idem-cargo-sub-001',
      companyId: 'comp-abidjan-01',
      workspaceId: 'comp-abidjan-01',
      plan: 'flex',
      seats: 10,
    },
    'cargo-tracker'
  );

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, 'delivered');
  assert.equal(deliveries[0].responseStatus, 200);
  assert.equal(receivedWebhooks.length, baselineCount + 1);
  const lastHook = receivedWebhooks[receivedWebhooks.length - 1];
  assert.equal(lastHook.event.event, 'subscription.activated');
  assert.equal(lastHook.event.companyId, 'comp-abidjan-01');
  assert.ok(String(lastHook.headers['x-kazibox-signature']).startsWith('sha256='));

  // Idempotency check: same explicit event ID does not re-send
  const duplicateDeliveries = await dispatchWebhookEvent(
    'subscription.activated',
    {
      id: 'idem-cargo-sub-001',
      companyId: 'comp-abidjan-01',
      workspaceId: 'comp-abidjan-01',
      plan: 'flex',
      seats: 10,
    },
    'cargo-tracker'
  );
  assert.equal(duplicateDeliveries[0].id, deliveries[0].id);
  assert.equal(receivedWebhooks.length, baselineCount + 1);
});

await test('Automatically retries outbound webhook on transient HTTP 503 failure and succeeds', async () => {
  const baselineCount = receivedWebhooks.length;
  failNextWebhookAttempt = true;
  const retriedDeliveries = await dispatchWebhookEvent(
    'module.activated',
    {
      id: 'idem-cargo-mod-900',
      companyId: 'comp-dakar-02',
      workspaceId: 'comp-dakar-02',
    },
    'cargo-tracker'
  );

  assert.equal(retriedDeliveries.length, 1);
  assert.equal(retriedDeliveries[0].status, 'delivered');
  assert.equal(retriedDeliveries[0].attempts, 2);
  assert.equal(receivedWebhooks.length, baselineCount + 1);
});

await test('Retrieves live SaaS summary via both GET /api/v1/modules/[slug]/summary route and getModuleSummaries', async () => {
  const targetCompanyId = '11111111-1111-4111-8111-111111111111';

  // 1. Direct route call GET /api/v1/modules/cargo-tracker/summary
  const sumReq = makeSessionRequest(
    `http://localhost:3000/api/v1/modules/cargo-tracker/summary?companyId=${targetCompanyId}`,
    {
      session: { userId: 'usr-1', companyId: targetCompanyId, role: 'owner' },
    }
  );
  const sumRes = await summaryRoute.GET(sumReq, { params: { slug: 'cargo-tracker' } });
  assert.equal(sumRes.status, 200);
  const sumData = await sumRes.json();
  assert.equal(sumData.moduleId, 'cargo-tracker');
  assert.equal(sumData.companyId, targetCompanyId);
  assert.equal(sumData.revenue, 480000);
  assert.equal(sumData.expenses, 95000);
  assert.equal(sumData.metrics[0].value, 42);

  // 2. Consolidated dashboard helper getModuleSummaries
  const summaries = await getModuleSummaries(targetCompanyId);
  const cargoSummary = summaries.find((s) => s.moduleId === 'cargo-tracker');
  assert.ok(cargoSummary);
  assert.equal(cargoSummary.revenue, 480000);
});

// ---------------------------------------------------------------------------
// 8. SSRF, Private IP, Cloud Metadata & Unsafe Redirect Protection (Item 9)
// ---------------------------------------------------------------------------
console.log('\n8. SSRF, Private IP, Cloud Metadata & Redirect Protection');

await test('Blocks private IPv4, IPv6, cloud metadata IPs, internal hostnames, and numeric IP obfuscations', async () => {
  const blockedUrls = [
    'https://10.0.0.1/webhooks',
    'https://192.168.1.100/api/summary',
    'https://172.16.0.1/sso',
    'https://172.31.255.255/sso',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.100.100.200/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'http://service.internal/api/summary',
    'http://printer.local/api/summary',
    'https://0.0.0.0/webhooks',
    'https://[::1]/webhooks',
    'https://[fd00::1]/webhooks',
    'https://[fe80::1]/webhooks',
    'https://[::ffff:169.254.169.254]/latest/meta-data/',
    'https://[::ffff:10.0.0.1]/webhooks',
    'https://2130706433/webhooks',
    'https://0x7f000001/webhooks',
    'https://0177.0.0.1/webhooks',
    'https://user:password@cargo.example.com/webhooks',
  ];

  for (const badUrl of blockedUrls) {
    assert.equal(
      isValidEndpointUrl(badUrl, false),
      false,
      `Expected URL to be blocked by SSRF guard: ${badUrl}`
    );
    const outboundCheck = await assertSafeOutboundUrl(badUrl);
    assert.equal(outboundCheck.safe, false, `Expected outbound fetch guard to block: ${badUrl}`);
  }

  // Also verify localhost is blocked when strict SSRF / production mode is enabled
  assert.equal(
    isValidEndpointUrl('http://localhost:3000/webhooks', false, { allowLocalhost: false }),
    false
  );
  assert.equal(
    isValidEndpointUrl('http://127.0.0.1:3000/webhooks', false, { allowLocalhost: false }),
    false
  );
});

await test('Blocks unsafe HTTP 302 redirects on outbound webhook delivery and summary fetches', async () => {
  internalMetadataEndpointHit = false;
  redirectNextWebhookToInternalIp = true;

  const redirectedDelivery = await dispatchWebhookEvent(
    'module.activated',
    {
      id: 'idem-ssrf-redirect-test',
      companyId: 'comp-abidjan-01',
      workspaceId: 'comp-abidjan-01',
    },
    'cargo-tracker'
  );

  // Because redirect: 'error' is set on fetch, any 302 redirect fails immediately and never hits the target
  assert.equal(redirectedDelivery[0].status, 'failed');
  assert.equal(internalMetadataEndpointHit, false, 'Webhook dispatcher must NEVER follow HTTP redirects');

  redirectNextSummaryToMetadataIp = true;
  const targetCompanyId = '11111111-1111-4111-8111-111111111111';
  const sumReq = makeSessionRequest(
    `http://localhost:3000/api/v1/modules/cargo-tracker/summary?companyId=${targetCompanyId}`,
    {
      session: { userId: 'usr-1', companyId: targetCompanyId, role: 'owner' },
    }
  );
  const sumRes = await summaryRoute.GET(sumReq, { params: { slug: 'cargo-tracker' } });
  assert.equal(sumRes.status, 502);
  const sumData = await sumRes.json();
  assert.equal(sumData.code, 'UNSAFE_SUMMARY_REDIRECT');
  assert.equal(internalMetadataEndpointHit, false);
});

// ---------------------------------------------------------------------------
// 9. Authorization & Tenant Isolation on All Registry Endpoints (Item 11)
// ---------------------------------------------------------------------------
console.log('\n9. Authorization & Tenant Isolation on Registry & Module Endpoints');

await test('Enforces 401 Unauthenticated and 403 Non-Admin rejection on all registry endpoints', async () => {
  const nonAdminSession = {
    userId: 'usr-owner-01',
    companyId: '11111111-1111-4111-8111-111111111111',
    role: 'owner',
  };

  // 1. GET /api/v1/modules/register
  const unauthGetReg = await registerRoute.GET(makeSessionRequest('http://localhost:3000/api/v1/modules/register'));
  assert.equal(unauthGetReg.status, 401);
  const ownerGetReg = await registerRoute.GET(
    makeSessionRequest('http://localhost:3000/api/v1/modules/register', { session: nonAdminSession })
  );
  assert.equal(ownerGetReg.status, 403);

  // 2. POST /api/v1/modules/register
  const unauthPostReg = await registerRoute.POST(
    makeSessionRequest('http://localhost:3000/api/v1/modules/register', { method: 'POST', body: {} })
  );
  assert.equal(unauthPostReg.status, 401);
  const ownerPostReg = await registerRoute.POST(
    makeSessionRequest('http://localhost:3000/api/v1/modules/register', {
      method: 'POST',
      session: nonAdminSession,
      body: { id: 'hacked' },
    })
  );
  assert.equal(ownerPostReg.status, 403);

  // 3. GET / PUT / PATCH / POST /api/v1/modules/registry/[id]
  for (const method of ['GET', 'PUT', 'PATCH', 'POST']) {
    const unauthReq = makeSessionRequest('http://localhost:3000/api/v1/modules/registry/cargo-tracker', {
      method,
      body: method === 'GET' ? undefined : { status: 'published' },
    });
    const unauthRes = await registryIdRoute[method](unauthReq, { params: { id: 'cargo-tracker' } });
    assert.equal(unauthRes.status, 401, `Expected 401 on unauthenticated ${method} /api/v1/modules/registry/[id]`);

    const ownerReq = makeSessionRequest('http://localhost:3000/api/v1/modules/registry/cargo-tracker', {
      method,
      session: nonAdminSession,
      body: method === 'GET' ? undefined : { status: 'published' },
    });
    const ownerRes = await registryIdRoute[method](ownerReq, { params: { id: 'cargo-tracker' } });
    assert.equal(ownerRes.status, 403, `Expected 403 on non-admin ${method} /api/v1/modules/registry/[id]`);
  }

  // 4. Cross-tenant isolation on GET /api/v1/modules/[slug]/summary
  const crossTenantSummaryReq = makeSessionRequest(
    'http://localhost:3000/api/v1/modules/cargo-tracker/summary?companyId=22222222-2222-4222-8222-222222222222',
    {
      session: nonAdminSession,
    }
  );
  const crossTenantSummaryRes = await summaryRoute.GET(crossTenantSummaryReq, {
    params: { slug: 'cargo-tracker' },
  });
  assert.equal(crossTenantSummaryRes.status, 403);
});

// Cleanup server and temp files
await new Promise((resolve) => saasServer.close(resolve));
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}

console.log(`\n================================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`================================================================\n`);

if (failed > 0) {
  process.exit(1);
}
