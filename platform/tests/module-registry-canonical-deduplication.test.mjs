/**
 * KaziBox — Module Registry Canonical Deduplication & Security Hardening Test Suite
 *
 * Verifies:
 * 1. getModules() returns no duplicate canonical IDs.
 * 2. Demo module appears exactly ONCE in getModules().
 * 3. Demo module price remains strictly 5,000 XOF (internal reference module).
 * 4. getModule('demo') returns the canonical record with 5,000 XOF.
 * 5. getModule('demo-module') resolves alias to the canonical record with 5,000 XOF.
 * 6. Existing unrelated modules (hotel-property, garage-auto, hair-salon, pharmastock, etc.) remain intact.
 * 7. Secure input validation in getModule(): rejects commas, parentheses, dots, and PostgREST syntax injection.
 * 8. Production getModules() with live Supabase mock: prioritizes canonical Demo regardless of DB row order.
 * 9. Production getModule() with live Supabase mock: simultaneous canonical and alias records cleanly resolve to canonical.
 * 10. Production getModule() with live Supabase mock: missing canonical record falls back to alias record.
 * 11. Production getModules() and getModule() handle database errors explicitly and fail closed.
 */

import assert from 'assert';
import { getModules, getModule, CANONICAL_ALIAS_MAP, toCanonicalModuleId } from '../lib/modules';

console.log('───────────────────────────────────────────────────────');
console.log('Running KaziBox Module Registry Canonical Deduplication Suite');
console.log('───────────────────────────────────────────────────────\n');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createMockSupabase(handlers = {}) {
  return {
    from: (table) => {
      assert.strictEqual(table, 'modules');
      return {
        select: () => {
          const defaultPromise = handlers.onSelectAll
            ? Promise.resolve().then(() => handlers.onSelectAll())
            : Promise.resolve({ data: [], error: null });

          return Object.assign(defaultPromise, {
            or: (orClause) => ({
              maybeSingle: async () => {
                if (handlers.onMaybeSingle) {
                  return handlers.onMaybeSingle(orClause);
                }
                return { data: null, error: null };
              },
            }),
          });
        },
      };
    },
  };
}

// ─── Test 1: No duplicate canonical IDs in getModules() (Fallback) ───────────

test('1. getModules() returns no duplicate canonical IDs in offline fallback', async () => {
  const modules = await getModules();
  assert(Array.isArray(modules), 'getModules() must return an array');
  assert(modules.length > 0, 'getModules() must return at least 1 module');

  const seenCanonicalIds = new Set();
  const duplicates = [];

  for (const m of modules) {
    const canonicalId = toCanonicalModuleId(m.id);
    if (seenCanonicalIds.has(canonicalId)) {
      duplicates.push({ id: m.id, slug: m.slug, canonicalId });
    }
    seenCanonicalIds.add(canonicalId);
  }

  assert.strictEqual(
    duplicates.length,
    0,
    `Found duplicate canonical IDs in getModules(): ${JSON.stringify(duplicates)}`
  );

  const rawIds = modules.map((m) => m.id);
  const uniqueRawIds = new Set(rawIds);
  assert.strictEqual(
    rawIds.length,
    uniqueRawIds.size,
    `Found duplicate raw module IDs in getModules(): ${rawIds}`
  );
});

// ─── Test 2: Demo module appears exactly once in getModules() (Fallback) ─────

test('2. Demo appears exactly ONCE in getModules() (Fallback)', async () => {
  const modules = await getModules();
  const demoEntries = modules.filter(
    (m) => m.id === 'demo' || m.slug === 'demo' || m.id === 'demo-module' || m.slug === 'demo-module'
  );

  assert.strictEqual(
    demoEntries.length,
    1,
    `Expected exactly 1 Demo entry in getModules(), found ${demoEntries.length}: ${JSON.stringify(
      demoEntries.map((m) => ({ id: m.id, slug: m.slug, price: m.pricePerMonth }))
    )}`
  );

  const demo = demoEntries[0];
  assert.strictEqual(demo.id, 'demo', 'Demo entry ID must be canonical "demo"');
  assert.strictEqual(demo.slug, 'demo', 'Demo entry slug must be canonical "demo"');
});

// ─── Test 3: Demo module price is strictly 5,000 XOF ──────────────────────────

test('3. Demo price remains strictly 5,000 XOF (Internal Demo Module)', async () => {
  const modules = await getModules();
  const demo = modules.find((m) => m.id === 'demo');

  assert(demo, 'Canonical Demo module must be present in getModules()');
  assert.strictEqual(
    demo.pricePerMonth?.amount,
    5000,
    `Demo price amount must be 5000, got ${demo.pricePerMonth?.amount}`
  );
  assert.strictEqual(
    demo.pricePerMonth?.currency,
    'XOF',
    `Demo currency must be XOF, got ${demo.pricePerMonth?.currency}`
  );
  assert.strictEqual(demo.kind, 'internal', 'Demo kind must be "internal"');
  assert.strictEqual(demo.entryUrl, '/m/demo', 'Demo entryUrl must be "/m/demo"');
});

// ─── Test 4: getModule('demo') returns the canonical 5,000 XOF record ──────────

test('4. getModule("demo") returns the canonical 5,000 XOF record', async () => {
  const mod = await getModule('demo');
  assert(mod, 'getModule("demo") must return a record');
  assert.strictEqual(mod.id, 'demo');
  assert.strictEqual(mod.slug, 'demo');
  assert.strictEqual(mod.pricePerMonth?.amount, 5000);
  assert.strictEqual(mod.pricePerMonth?.currency, 'XOF');
  assert.strictEqual(mod.kind, 'internal');
  assert.strictEqual(mod.entryUrl, '/m/demo');
});

// ─── Test 5: getModule('demo-module') resolves alias to canonical 5,000 XOF ────

test('5. getModule("demo-module") resolves alias to canonical 5,000 XOF record', async () => {
  const mod = await getModule('demo-module');
  assert(mod, 'getModule("demo-module") must resolve via canonical alias map');
  assert.strictEqual(mod.id, 'demo', 'Resolved module ID must be canonical "demo"');
  assert.strictEqual(
    mod.pricePerMonth?.amount,
    5000,
    `Resolved module price must be 5000 XOF, got ${mod.pricePerMonth?.amount}`
  );
  assert.strictEqual(mod.pricePerMonth?.currency, 'XOF');
  assert.strictEqual(mod.kind, 'internal');
  assert.strictEqual(mod.entryUrl, '/m/demo');
});

// ─── Test 6: Existing unrelated modules remain unaffected ─────────────────────

test('6. Existing unrelated modules remain unaffected and properly configured', async () => {
  const modules = await getModules();
  const moduleMap = new Map(modules.map((m) => [m.id, m]));

  // Garage Auto
  const garage = moduleMap.get('garage-auto') || moduleMap.get('garage');
  assert(garage, 'Garage auto must exist');
  assert.strictEqual(garage.pricePerMonth?.amount, 15000);
  assert.strictEqual(garage.pricePerMonth?.currency, 'XOF');

  // Hotel Property
  const hotel = moduleMap.get('hotel-property');
  assert(hotel, 'Hotel property must exist');
  assert.strictEqual(hotel.pricePerMonth?.amount, 15000);
  assert.strictEqual(hotel.pricePerMonth?.currency, 'XOF');

  // Hair Salon
  const salon = moduleMap.get('hair-salon') || moduleMap.get('salon');
  assert(salon, 'Hair salon must exist');
  assert.strictEqual(salon.pricePerMonth?.amount, 10000);
  assert.strictEqual(salon.pricePerMonth?.currency, 'XOF');

  // PharmaStock (External SaaS)
  const pharma = moduleMap.get('pharmastock');
  assert(pharma, 'PharmaStock must exist');
  assert.strictEqual(pharma.kind, 'external', 'PharmaStock must remain external');
  assert.strictEqual(pharma.pricePerMonth?.amount, 15000);
  assert.strictEqual(pharma.pricePerMonth?.currency, 'XOF');

  // Pharmacy (Internal vertical)
  const pharmacy = moduleMap.get('pharmacy');
  assert(pharmacy, 'Pharmacy must exist');
  assert.strictEqual(pharmacy.pricePerMonth?.amount, 20000);

  // Free utilities
  const qrCode = moduleMap.get('tool-qr-code');
  assert(qrCode, 'Tool QR code must exist');
  assert.strictEqual(qrCode.pricing_type, 'free');

  const compressor = moduleMap.get('tool-image-compressor');
  assert(compressor, 'Tool image compressor must exist');
  assert.strictEqual(compressor.pricing_type, 'free');
});

// ─── Test 7: Secure input validation in getModule() ───────────────────────────

test('7. Secure input validation in getModule() rejects malformed PostgREST syntax', async () => {
  // Invalid characters / PostgREST operator injection
  assert.strictEqual(await getModule('demo,kind.eq.external'), null, 'Must reject comma injection');
  assert.strictEqual(await getModule('demo)'), null, 'Must reject closing parenthesis');
  assert.strictEqual(await getModule('(demo'), null, 'Must reject opening parenthesis');
  assert.strictEqual(await getModule('demo.json'), null, 'Must reject dots');
  assert.strictEqual(await getModule('demo;drop table'), null, 'Must reject semicolons');
  assert.strictEqual(await getModule('demo module'), null, 'Must reject spaces');
  assert.strictEqual(await getModule('demo!@#$%^&*'), null, 'Must reject symbols');
  assert.strictEqual(await getModule(''), null, 'Must reject empty string');
  assert.strictEqual(await getModule(null), null, 'Must reject null');
  assert.strictEqual(await getModule(undefined), null, 'Must reject undefined');
  assert.strictEqual(await getModule(12345), null, 'Must reject non-string types');

  // Legitimate identifier characters must pass validation
  assert.notStrictEqual(await getModule('demo'), null, 'Valid slug "demo" must pass');
  assert.notStrictEqual(await getModule('demo-module'), null, 'Valid slug with hyphen must pass');
  assert.notStrictEqual(await getModule('garage-auto'), null, 'Valid slug "garage-auto" must pass');
  assert.notStrictEqual(await getModule('tool-qr-code'), null, 'Valid slug "tool-qr-code" must pass');
});

// ─── Test 8: Production getModules() with live Supabase mock (both row orders) ─

test('8. Production getModules() prioritizes canonical Demo across both DB row orders', async () => {
  const originalOverride = globalThis.__kaziboxSupabaseAdminOverride;

  try {
    // Case A: Canonical 'demo' row appears FIRST in DB result
    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onSelectAll: () => ({
        data: [
          { id: 'demo', slug: 'demo', name: 'Demo Module by KaziBox', status: 'active' },
          { id: 'demo-module', slug: 'demo-module', name: 'Demo Module (External)', status: 'active', pricing: { amount: 8000 } },
          { id: 'garage', slug: 'garage', name: 'Garage & Mécanique', status: 'active' },
        ],
        error: null,
      }),
    });

    const modulesA = await getModules();
    const demoA = modulesA.filter((m) => m.id === 'demo');
    assert.strictEqual(demoA.length, 1, 'Order A: exactly 1 demo card must exist');
    assert.strictEqual(demoA[0].pricePerMonth.amount, 5000, 'Order A: price must be 5000 XOF');

    // Case B: Alias 'demo-module' row appears FIRST in DB result
    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onSelectAll: () => ({
        data: [
          { id: 'demo-module', slug: 'demo-module', name: 'Demo Module (External)', status: 'active', pricing: { amount: 8000 } },
          { id: 'demo', slug: 'demo', name: 'Demo Module by KaziBox', status: 'active' },
          { id: 'garage', slug: 'garage', name: 'Garage & Mécanique', status: 'active' },
        ],
        error: null,
      }),
    });

    const modulesB = await getModules();
    const demoB = modulesB.filter((m) => m.id === 'demo');
    assert.strictEqual(demoB.length, 1, 'Order B: exactly 1 demo card must exist');
    assert.strictEqual(demoB[0].pricePerMonth.amount, 5000, 'Order B: price must be 5000 XOF');
  } finally {
    if (originalOverride !== undefined) {
      globalThis.__kaziboxSupabaseAdminOverride = originalOverride;
    } else {
      delete globalThis.__kaziboxSupabaseAdminOverride;
    }
  }
});

// ─── Test 9: Production getModule() with simultaneous DB records ──────────────

test('9. Production getModule() returns canonical record when both exist in DB', async () => {
  const originalOverride = globalThis.__kaziboxSupabaseAdminOverride;

  try {
    const executedQueries = [];

    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onMaybeSingle: (orClause) => {
        executedQueries.push(orClause);
        if (orClause.includes('id.eq.demo')) {
          return {
            data: { id: 'demo', slug: 'demo', name: 'Demo Module by KaziBox', status: 'active' },
            error: null,
          };
        }
        if (orClause.includes('id.eq.demo-module')) {
          return {
            data: { id: 'demo-module', slug: 'demo-module', name: 'Demo Module (External)', status: 'active' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    // Query for alias 'demo-module': must query canonical 'demo' first and return it
    const mod = await getModule('demo-module');
    assert(mod, 'Must return a record');
    assert.strictEqual(mod.id, 'demo', 'Must return canonical ID "demo"');
    assert.strictEqual(mod.pricePerMonth?.amount, 5000, 'Must have canonical 5000 XOF price');
    assert.strictEqual(executedQueries.length, 1, 'Must NOT execute second alias query when canonical exists');
    assert(executedQueries[0].includes('id.eq.demo'), 'First query must target canonical ID');
  } finally {
    if (originalOverride !== undefined) {
      globalThis.__kaziboxSupabaseAdminOverride = originalOverride;
    } else {
      delete globalThis.__kaziboxSupabaseAdminOverride;
    }
  }
});

// ─── Test 10: Production getModule() fallback to alias when canonical missing ─

test('10. Production getModule() falls back to alias when canonical record is missing from DB', async () => {
  const originalOverride = globalThis.__kaziboxSupabaseAdminOverride;

  try {
    const executedQueries = [];

    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onMaybeSingle: (orClause) => {
        executedQueries.push(orClause);
        if (orClause.includes('id.eq.demo,')) {
          // Canonical record missing in DB
          return { data: null, error: null };
        }
        if (orClause.includes('id.eq.demo-module')) {
          // Legacy alias record exists in DB
          return {
            data: { id: 'demo-module', slug: 'demo-module', name: 'Legacy Demo Partner', status: 'active' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    const mod = await getModule('demo-module');
    assert(mod, 'Must resolve fallback record');
    assert.strictEqual(mod.id, 'demo-module', 'Must return alias record when canonical is missing from DB');
    assert.strictEqual(executedQueries.length, 2, 'Must query canonical first, then fallback to alias');
    assert(executedQueries[0].includes('id.eq.demo'), 'First query must check canonical');
    assert(executedQueries[1].includes('id.eq.demo-module'), 'Second query must check alias');
  } finally {
    if (originalOverride !== undefined) {
      globalThis.__kaziboxSupabaseAdminOverride = originalOverride;
    } else {
      delete globalThis.__kaziboxSupabaseAdminOverride;
    }
  }
});

// ─── Test 11: Production getModules() and getModule() handle DB errors gracefully ───

test('11. Production getModules() and getModule() log DB errors and fall back gracefully', async () => {
  const originalOverride = globalThis.__kaziboxSupabaseAdminOverride;
  const originalConsoleError = console.error;
  const loggedErrors = [];

  try {
    console.error = (...args) => {
      loggedErrors.push(args.join(' '));
    };

    // 1. getModules() database query error: logs error, falls back to canonical base catalogue
    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onSelectAll: () => ({
        data: null,
        error: { message: 'Database connection timeout' },
      }),
    });

    const modules = await getModules();
    assert(Array.isArray(modules), 'Must return an array of modules');
    assert(modules.length > 0, 'Must not return misleading empty array on DB error');
    const demo = modules.find((m) => m.id === 'demo');
    assert(demo, 'Canonical Demo must be present in fallback catalogue');
    assert.strictEqual(demo.pricePerMonth?.amount, 5000, 'Demo fallback price must be 5000 XOF');
    assert(
      loggedErrors.some((log) => log.includes('[MODULES_FETCH_ERROR]') && log.includes('Database connection timeout')),
      'Must explicitly log [MODULES_FETCH_ERROR] with diagnostic details'
    );

    // 2. getModule('demo') database query error: logs error, falls back to canonical base store record
    globalThis.__kaziboxSupabaseAdminOverride = createMockSupabase({
      onMaybeSingle: () => ({
        data: null,
        error: { message: 'PostgREST internal error' },
      }),
    });

    const mod = await getModule('demo');
    assert(mod, 'Must fall back to base store record for known canonical module');
    assert.strictEqual(mod.id, 'demo');
    assert.strictEqual(mod.pricePerMonth?.amount, 5000);
    assert(
      loggedErrors.some((log) => log.includes('[MODULE_LOOKUP_ERROR]') && log.includes('PostgREST internal error')),
      'Must explicitly log [MODULE_LOOKUP_ERROR] with diagnostic details'
    );

    // 3. getModule('unknown-custom-module') database query error: returns null safely without throwing
    const unknownMod = await getModule('unknown-custom-module');
    assert.strictEqual(unknownMod, null, 'Must return null safely for unknown module when DB fails');
  } finally {
    console.error = originalConsoleError;
    if (originalOverride !== undefined) {
      globalThis.__kaziboxSupabaseAdminOverride = originalOverride;
    } else {
      delete globalThis.__kaziboxSupabaseAdminOverride;
    }
  }
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
  console.log('All Module Registry Canonical Deduplication tests PASSED ✅\n');
}

runAll();
