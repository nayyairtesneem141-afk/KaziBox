/**
 * KaziBox — PWA Compliance & Strict HTTPS Transport Validation Test Suite
 *
 * Verifies:
 * 1. Relative internal module URLs (e.g. '/m/demo') resolve against HTTPS origin and pass https_enforced.
 * 2. Relative URLs resolved against an insecure HTTP origin fail https_enforced.
 * 3. Localhost HTTP origin passes only when allowLocalhost is permitted in development.
 * 4. External HTTPS endpoints pass strict HTTPS transport.
 * 5. External plain HTTP endpoints fail strict HTTPS transport.
 * 6. URLs with embedded credentials (user:pass@host) are rejected.
 * 7. Private/reserved hostnames (.internal, metadata, link-local) are strictly rejected.
 * 8. Demo module retrieved via getModule('demo') achieves 100% PWA compliance across all 6 requirements.
 * 9. Core internal business modules (hotel-property, garage-auto, etc.) remain 100% PWA compliant.
 * 10. Demo module metadata (id: demo, slug: demo, price: 5000 XOF, kind: internal) remains strictly preserved.
 */

import assert from 'assert';
import { runPwaChecks, isValidEndpointUrl, resolveEffectiveOrigin } from '../lib/registry';
import { getModule, getModules } from '../lib/modules';

console.log('───────────────────────────────────────────────────────');
console.log('Running KaziBox PWA HTTPS Transport & Compliance Suite');
console.log('───────────────────────────────────────────────────────\n');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// ─── Test 1: Relative URLs resolve against HTTPS origin and pass ───────────────

test('1. Relative internal URLs resolve against HTTPS origin and pass strict HTTPS transport', () => {
  const result = isValidEndpointUrl('/m/demo', true, { origin: 'https://kazibox-staging.vercel.app' });
  assert.strictEqual(result, true, 'Relative URL on HTTPS origin must pass validation');

  const pwaResult = runPwaChecks(
    {
      id: 'demo',
      slug: 'demo',
      entryUrl: '/m/demo',
      webhookUrl: 'https://api.kazibox.com/webhooks/demo',
      pwa: {
        scope: '/m/demo',
        startUrl: '/m/demo',
        themeColor: '#8B5CF6',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192' },
          { src: '/icons/icon-512.png', sizes: '512x512' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', purpose: 'maskable' },
        ],
      },
      languages: ['fr', 'en'],
    },
    { origin: 'https://kazibox-staging.vercel.app' }
  );

  const httpsCheck = pwaResult.checks.find((c) => c.key === 'https_enforced');
  assert.strictEqual(httpsCheck?.passed, true, 'https_enforced check must pass for relative URL on HTTPS origin');
});

// ─── Test 2: Insecure HTTP origin fails strict HTTPS transport ────────────────

test('2. Relative internal URLs resolved against insecure HTTP origin fail strict HTTPS transport', () => {
  const result = isValidEndpointUrl('/m/demo', true, {
    origin: 'http://insecure-platform.example.com',
    allowLocalhost: false,
  });
  assert.strictEqual(result, false, 'Relative URL resolved against plain HTTP origin must be rejected');

  const pwaResult = runPwaChecks(
    {
      id: 'demo',
      slug: 'demo',
      entryUrl: '/m/demo',
      webhookUrl: 'https://api.kazibox.com/webhooks/demo',
      pwa: {
        scope: '/m/demo',
        startUrl: '/m/demo',
        themeColor: '#8B5CF6',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192' },
          { src: '/icons/icon-512.png', sizes: '512x512' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', purpose: 'maskable' },
        ],
      },
      languages: ['fr', 'en'],
    },
    { origin: 'http://insecure-platform.example.com', allowLocalhost: false }
  );

  const httpsCheck = pwaResult.checks.find((c) => c.key === 'https_enforced');
  assert.strictEqual(httpsCheck?.passed, false, 'https_enforced check must fail when origin is plain HTTP');
  assert.strictEqual(httpsCheck?.details, 'HTTPS requis.');
  assert.strictEqual(pwaResult.allPassed, false, 'PWA checklist cannot pass when HTTPS fails');
});

// ─── Test 2B: Unknown/unconfigured origin fails closed ────────────────────────

test('2B. Unknown or unconfigured deployment origin fails closed without automatic HTTPS pass', () => {
  const origEnv = process.env.NODE_ENV;
  const origVercel = process.env.VERCEL_URL;
  const origApp = process.env.NEXT_PUBLIC_APP_URL;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    assert.strictEqual(resolveEffectiveOrigin(), null, 'resolveEffectiveOrigin must return null when origin is unknown');
    assert.strictEqual(
      isValidEndpointUrl('/m/demo', true, {}),
      false,
      'Relative URL must fail closed when deployment origin is unknown'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origVercel !== undefined) process.env.VERCEL_URL = origVercel;
    if (origApp !== undefined) process.env.NEXT_PUBLIC_APP_URL = origApp;
  }
});

// ─── Test 3: Localhost HTTP in development ────────────────────────────────────

test('3. Localhost HTTP passes only when allowLocalhost is explicitly enabled for development', () => {
  // Disallowed when allowLocalhost: false
  assert.strictEqual(
    isValidEndpointUrl('/m/demo', true, { origin: 'http://localhost:3000', allowLocalhost: false }),
    false,
    'Localhost HTTP must be rejected when allowLocalhost is false'
  );

  // Allowed when allowLocalhost: true
  assert.strictEqual(
    isValidEndpointUrl('/m/demo', true, { origin: 'http://localhost:3000', allowLocalhost: true }),
    true,
    'Localhost HTTP must pass when allowLocalhost is true in dev'
  );
});

// ─── Test 4: External HTTPS endpoints pass ────────────────────────────────────

test('4. External HTTPS endpoints pass strict HTTPS validation', () => {
  assert.strictEqual(isValidEndpointUrl('https://cargo.example.com/sso', false), true);
  assert.strictEqual(isValidEndpointUrl('https://api.example.com/webhooks', false), true);
  assert.strictEqual(isValidEndpointUrl('https://sub.domain.co.uk/path?param=1', false), true);
});

// ─── Test 5: External HTTP endpoints fail ─────────────────────────────────────

test('5. External plain HTTP endpoints fail strict HTTPS validation', () => {
  assert.strictEqual(isValidEndpointUrl('http://cargo.example.com/sso', false), false);
  assert.strictEqual(isValidEndpointUrl('http://insecure-saas.com/webhook', false), false);
});

// ─── Test 6: Embedded credentials rejected ────────────────────────────────────

test('6. URLs with embedded credentials are strictly rejected', () => {
  assert.strictEqual(isValidEndpointUrl('https://admin:password123@example.com/sso', false), false);
  assert.strictEqual(isValidEndpointUrl('https://token@example.com/webhook', false), false);
});

// ─── Test 7: Private/reserved hostnames (.internal, metadata) rejected ─────────

test('7. Private/reserved hostnames (.internal, cloud metadata, link-local) are strictly rejected', () => {
  assert.strictEqual(isValidEndpointUrl('https://api.kazibox.internal/webhooks/demo', false), false);
  assert.strictEqual(isValidEndpointUrl('https://metadata.google.internal/computeMetadata/v1/', false), false);
  assert.strictEqual(isValidEndpointUrl('https://169.254.169.254/latest/meta-data/', false), false);
  assert.strictEqual(isValidEndpointUrl('https://app.local/webhook', false), false);
});

// ─── Test 8: Production getModule('demo') achieves 100% PWA compliance ────────

test('8. Production getModule("demo") achieves 100% PWA compliance across all 6 requirements', async () => {
  const mod = await getModule('demo');
  assert(mod, 'Demo module must exist');

  const pwaResult = runPwaChecks(mod, { origin: 'https://kazibox-staging.vercel.app' });

  assert.strictEqual(pwaResult.checks.length, 6, 'Checklist must evaluate exactly 6 requirements');
  assert.strictEqual(pwaResult.allPassed, true, 'All 6 PWA requirements must pass for Demo module');

  const expectedKeys = [
    'manifest_present',
    'icons_compliant',
    'service_worker',
    'https_enforced',
    'responsive_touch',
    'bilingual_fr_en',
  ];

  for (const key of expectedKeys) {
    const item = pwaResult.checks.find((c) => c.key === key);
    assert(item, `Requirement "${key}" must be present in checks`);
    assert.strictEqual(item.passed, true, `Requirement "${key}" must pass, got: ${item.details}`);
  }

  const httpsCheck = pwaResult.checks.find((c) => c.key === 'https_enforced');
  assert.strictEqual(httpsCheck.details, 'Toutes les URL d’entrée et webhooks sont chiffrés.');
});

// ─── Test 9: Core internal modules remain 100% PWA compliant ───────────────────

test('9. Core internal modules (hotel-property, garage-auto, etc.) remain 100% PWA compliant', async () => {
  const modules = await getModules();
  const hotel = modules.find((m) => m.id === 'hotel-property');
  assert(hotel, 'Hotel module must exist');
  const hotelPwa = runPwaChecks(hotel, { origin: 'https://kazibox.com' });
  assert.strictEqual(hotelPwa.allPassed, true, 'Hotel Property must pass 100% PWA compliance');

  const garage = modules.find((m) => m.id === 'garage' || m.id === 'garage-auto');
  assert(garage, 'Garage module must exist');
  const garagePwa = runPwaChecks(garage, { origin: 'https://kazibox.com' });
  assert.strictEqual(garagePwa.allPassed, true, 'Garage Auto must pass 100% PWA compliance');
});

// ─── Test 10: Demo identity, pricing, and status remain strictly preserved ────

test('10. Demo module metadata (id, slug, price, kind, status) remains strictly preserved', async () => {
  const mod = await getModule('demo');
  assert(mod, 'Demo module must exist');
  assert.strictEqual(mod.id, 'demo', 'Demo ID must be "demo"');
  assert.strictEqual(mod.slug, 'demo', 'Demo slug must be "demo"');
  assert.strictEqual(mod.kind, 'internal', 'Demo kind must be "internal"');
  assert.strictEqual(mod.status, 'published', 'Demo status must be "published"');
  assert.strictEqual(mod.pricePerMonth?.amount, 5000, 'Demo price must be strictly 5000 XOF');
  assert.strictEqual(mod.pricePerMonth?.currency, 'XOF', 'Demo currency must be XOF');
  assert.strictEqual(mod.entryUrl, '/m/demo', 'Demo entryUrl must be "/m/demo"');
  assert.strictEqual(mod.webhookUrl, 'https://api.kazibox.com/webhooks/demo', 'Demo webhookUrl must be public HTTPS');
});

// ─── Execution ────────────────────────────────────────────────────────────────

async function runAll() {
  let passedCount = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ PASS  ${t.name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ FAIL  ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Results: ${passedCount} passed, 0 failed (${tests.length} total)`);
  console.log('All PWA HTTPS Validation tests PASSED ✅\n');
}

runAll();

