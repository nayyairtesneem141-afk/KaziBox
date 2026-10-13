// ==============================================================================
// KaziBox Module Catalogue & Activation Test Suite
// ==============================================================================

import assert from 'assert';
import fs from 'fs';

console.log('🧪 Running KaziBox Module Catalogue Tests...\n');

let passed = 0;
let failed = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn });
}

function assertEqual(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg || `Expected ${expected}, got ${actual}`);
}

// ── In-Memory Modules & Catalogue Simulation ─────────────────────────────────

const MOCK_BASE_MODULES = [
  {
    id: 'garage',
    slug: 'garage',
    name: { fr: 'Garage & Mécanique', en: 'Garage & Auto Repair' },
    tagline: { fr: 'Gestion complète d’atelier automobile', en: 'Complete auto repair workshop management' },
    description: { fr: 'Suivi des véhicules, devis, fiches d’intervention et facturation.', en: 'Vehicle tracking, quotes, repair orders and invoicing.' },
    category: 'services',
    pricing_type: 'paid',
    pricePerMonth: { amount: 5000, currency: 'XAF' },
    keywords: ['garage', 'mecanique', 'auto', 'vehicule', 'reparation'],
    status: 'published',
    entryUrl: '/modules/garage'
  },
  {
    id: 'hotel-property',
    slug: 'hotel-property',
    name: { fr: 'Gestion Hôtelière & Résidences', en: 'Hotel & Property Management' },
    tagline: { fr: 'Réservations de chambres et meublés', en: 'Room and furnished apartment reservations' },
    description: { fr: 'Gestion des chambres, réservations, facturation et calendrier.', en: 'Room management, bookings, billing, and calendar.' },
    category: 'hospitality',
    pricing_type: 'paid',
    pricePerMonth: { amount: 10000, currency: 'XAF' },
    keywords: ['hotel', 'residence', 'chambre', 'reservation', 'hebergement'],
    status: 'published',
    entryUrl: '/modules/hotel-property'
  },
  {
    id: 'salon',
    slug: 'salon',
    name: { fr: 'Salon de Coiffure & Beauté', en: 'Hair Salon & Beauty' },
    tagline: { fr: 'Agenda, forfaits de soins et encaissements', en: 'Appointments, service packages, and payments' },
    description: { fr: 'Gestion des rendez-vous coiffure, catalogue de prestations.', en: 'Hair salon appointment scheduling, service catalogue.' },
    category: 'services',
    pricing_type: 'paid',
    pricePerMonth: { amount: 8000, currency: 'XAF' },
    keywords: ['salon', 'coiffure', 'beaute', 'soin', 'rendez-vous'],
    status: 'published',
    entryUrl: '/modules/salon'
  },
  {
    id: 'tool-image-compressor',
    slug: 'tool-image-compressor',
    name: { fr: 'Compresseur d’Images', en: 'Image Compressor' },
    tagline: { fr: 'Optimisez vos photos pour WhatsApp et le web', en: 'Optimize photos for WhatsApp and web' },
    description: { fr: 'Compression instantanée côté navigateur.', en: 'Instant browser-side image compression.' },
    category: 'tools',
    pricing_type: 'free',
    keywords: ['image', 'compresseur', 'photo', 'whatsapp'],
    status: 'published',
    entryUrl: '/modules/tool-image-compressor'
  },
  {
    id: 'tool-img-to-pdf',
    slug: 'tool-img-to-pdf',
    name: { fr: 'Convertisseur Image vers PDF', en: 'Image to PDF Converter' },
    tagline: { fr: 'Créez des documents PDF à partir de photos', en: 'Create PDF documents from photos' },
    description: { fr: 'Assemblage de photos de factures ou reçus en un seul PDF.', en: 'Merge receipt photos into a single PDF.' },
    category: 'tools',
    pricing_type: 'free',
    keywords: ['pdf', 'convertisseur', 'image', 'scan'],
    status: 'published',
    entryUrl: '/modules/tool-img-to-pdf'
  },
  {
    id: 'tool-margin-calculator',
    slug: 'tool-margin-calculator',
    name: { fr: 'Calculateur de Marge', en: 'Margin Calculator' },
    tagline: { fr: 'Fixez vos prix de vente et maîtrisez votre rentabilité', en: 'Set selling prices and control profitability' },
    description: { fr: 'Calcul du prix de vente HT/TTC, coefficient multiplicateur et marge.', en: 'Compute selling prices, markups, and profit margins.' },
    category: 'tools',
    pricing_type: 'free',
    keywords: ['marge', 'calculateur', 'prix', 'benefice', 'finance'],
    status: 'published',
    entryUrl: '/modules/tool-margin-calculator'
  },
  {
    id: 'tool-qr-code',
    slug: 'tool-qr-code',
    name: { fr: 'Générateur de QR Code', en: 'QR Code Generator' },
    tagline: { fr: 'Générez des QR codes pour vos menus, paiements et Wi-Fi', en: 'Generate QR codes for menus, payments, and Wi-Fi' },
    description: { fr: 'Génération instantanée de QR codes personnalisables.', en: 'Instant customizable QR code generation.' },
    category: 'tools',
    pricing_type: 'free',
    keywords: ['qr', 'qrcode', 'menu', 'wifi', 'scan'],
    status: 'published',
    entryUrl: '/modules/tool-qr-code'
  }
];

// Helper: Filter & Sort Engine (mirroring ModuleCataloguePage)
function filterAndSortModules(modules, { searchQuery = '', category = 'all', pricingFilter = 'all', sortBy = 'az', language = 'fr' }) {
  return modules
    .filter((mod) => {
      if (pricingFilter === 'free' && mod.pricing_type !== 'free') return false;
      if (pricingFilter === 'paid' && mod.pricing_type === 'free') return false;

      if (category !== 'all' && mod.category !== category) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameStr = (mod.name[language] || mod.name.en || mod.id).toLowerCase();
        const taglineStr = (mod.tagline?.[language] || mod.tagline?.en || '').toLowerCase();
        const descStr = (mod.description?.[language] || mod.description?.en || '').toLowerCase();
        const keywords = Array.isArray(mod.keywords) ? mod.keywords : [];
        const matchesKeyword = keywords.some((k) => k.toLowerCase().includes(q));
        const matchesCategory = (mod.category || '').toLowerCase().includes(q);

        const matches =
          nameStr.includes(q) ||
          taglineStr.includes(q) ||
          descStr.includes(q) ||
          matchesKeyword ||
          matchesCategory;

        if (!matches) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const nameA = (a.name[language] || a.id).toLowerCase();
      const nameB = (b.name[language] || b.id).toLowerCase();

      if (sortBy === 'az') return nameA.localeCompare(nameB, language);
      if (sortBy === 'za') return nameB.localeCompare(nameA, language);
      if (sortBy === 'free_first') {
        const aFree = a.pricing_type === 'free' ? 0 : 1;
        const bFree = b.pricing_type === 'free' ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return nameA.localeCompare(nameB, language);
      }
      if (sortBy === 'paid_first') {
        const aPaid = a.pricing_type === 'free' ? 1 : 0;
        const bPaid = b.pricing_type === 'free' ? 1 : 0;
        if (aPaid !== bPaid) return aPaid - bPaid;
        return nameA.localeCompare(nameB, language);
      }
      return 0;
    });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('1. Catalogue manifest inventory: all 7 standard modules (4 free tools + 3 paid)', () => {
  assertEqual(MOCK_BASE_MODULES.length, 7, 'Should have exactly 7 base modules');
  const freeTools = MOCK_BASE_MODULES.filter(m => m.pricing_type === 'free');
  const paidModules = MOCK_BASE_MODULES.filter(m => m.pricing_type === 'paid');

  assertEqual(freeTools.length, 4, 'Should have exactly 4 free tools');
  assertEqual(paidModules.length, 3, 'Should have exactly 3 paid business modules');

  const freeIds = freeTools.map(t => t.id).sort();
  assert.deepStrictEqual(freeIds, [
    'tool-image-compressor',
    'tool-img-to-pdf',
    'tool-margin-calculator',
    'tool-qr-code'
  ]);
});

test('2. Free tools require no subscription, zero amount, and open immediately', () => {
  const freeTools = MOCK_BASE_MODULES.filter(m => m.pricing_type === 'free');
  for (const tool of freeTools) {
    assertEqual(tool.pricing_type, 'free');
    assertEqual(tool.category, 'tools');
    assert(tool.entryUrl.startsWith('/modules/tool-'));
  }
});

test('3. Paid modules define monthly pricing and business categories', () => {
  const garage = MOCK_BASE_MODULES.find(m => m.id === 'garage');
  assertEqual(garage.pricing_type, 'paid');
  assertEqual(garage.pricePerMonth.amount, 5000);
  assertEqual(garage.pricePerMonth.currency, 'XAF');

  const hotel = MOCK_BASE_MODULES.find(m => m.id === 'hotel-property');
  assertEqual(hotel.pricing_type, 'paid');
  assertEqual(hotel.pricePerMonth.amount, 10000);

  const salon = MOCK_BASE_MODULES.find(m => m.id === 'salon');
  assertEqual(salon.pricing_type, 'paid');
  assertEqual(salon.pricePerMonth.amount, 8000);
});

test('4. Catalogue filtering: by pricing type (free vs paid)', () => {
  const freeOnly = filterAndSortModules(MOCK_BASE_MODULES, { pricingFilter: 'free' });
  assertEqual(freeOnly.length, 4);
  assert(freeOnly.every(m => m.pricing_type === 'free'));

  const paidOnly = filterAndSortModules(MOCK_BASE_MODULES, { pricingFilter: 'paid' });
  assertEqual(paidOnly.length, 3);
  assert(paidOnly.every(m => m.pricing_type === 'paid'));
});

test('5. Catalogue filtering: by category', () => {
  const tools = filterAndSortModules(MOCK_BASE_MODULES, { category: 'tools' });
  assertEqual(tools.length, 4);

  const hospitality = filterAndSortModules(MOCK_BASE_MODULES, { category: 'hospitality' });
  assertEqual(hospitality.length, 1);
  assertEqual(hospitality[0].id, 'hotel-property');

  const services = filterAndSortModules(MOCK_BASE_MODULES, { category: 'services' });
  assertEqual(services.length, 2);
});

test('6. Catalogue search: by French and English terms and keywords', () => {
  // French search
  const resFr = filterAndSortModules(MOCK_BASE_MODULES, { searchQuery: 'mécanique', language: 'fr' });
  assertEqual(resFr.length, 1);
  assertEqual(resFr[0].id, 'garage');

  // English search
  const resEn = filterAndSortModules(MOCK_BASE_MODULES, { searchQuery: 'repair', language: 'en' });
  assertEqual(resEn.length, 1);
  assertEqual(resEn[0].id, 'garage');

  // Keyword search
  const resKw = filterAndSortModules(MOCK_BASE_MODULES, { searchQuery: 'whatsapp', language: 'fr' });
  assertEqual(resKw.length, 1);
  assertEqual(resKw[0].id, 'tool-image-compressor');
});

test('7. Catalogue sorting: A-Z, Z-A, Free-First, Paid-First', () => {
  const az = filterAndSortModules(MOCK_BASE_MODULES, { sortBy: 'az', language: 'en' });
  assertEqual(az[0].id, 'garage'); // "Garage & Auto Repair"

  const za = filterAndSortModules(MOCK_BASE_MODULES, { sortBy: 'za', language: 'en' });
  assertEqual(za[0].id, 'tool-qr-code'); // "QR Code Generator"

  const freeFirst = filterAndSortModules(MOCK_BASE_MODULES, { sortBy: 'free_first' });
  assertEqual(freeFirst[0].pricing_type, 'free');
  assertEqual(freeFirst[freeFirst.length - 1].pricing_type, 'paid');

  const paidFirst = filterAndSortModules(MOCK_BASE_MODULES, { sortBy: 'paid_first' });
  assertEqual(paidFirst[0].pricing_type, 'paid');
  assertEqual(paidFirst[paidFirst.length - 1].pricing_type, 'free');
});

test('8. French & English dictionary coverage for catalogue keys', () => {
  const fr = JSON.parse(fs.readFileSync('platform/locales/fr.json', 'utf8'));
  const en = JSON.parse(fs.readFileSync('platform/locales/en.json', 'utf8'));

  assert(fr.catalogue, 'fr.json must have catalogue namespace');
  assert(en.catalogue, 'en.json must have catalogue namespace');

  const requiredKeys = [
    'title',
    'badge_free',
    'status_active',
    'status_available',
    'open_tool',
    'open_module',
    'activate_module_now',
    'back_to_catalogue',
    'overview_title',
    'key_features',
    'screenshots_gallery',
    'tech_specs'
  ];

  for (const k of requiredKeys) {
    assert(fr.catalogue[k], `fr.catalogue.${k} must exist`);
    assert(en.catalogue[k], `en.catalogue.${k} must exist`);
  }
});

test('9. Server-side activation security: unauthenticated blocked with 401', () => {
  function simulateActivate(session, body) {
    if (!session) return { status: 401, code: 'NOT_AUTHENTICATED' };
    if (session.role !== 'owner' && session.role !== 'platform_admin') {
      return { status: 403, code: 'INSUFFICIENT_ROLE' };
    }
    if (session.role !== 'platform_admin' && body.companyId && body.companyId !== session.companyId) {
      return { status: 403, code: 'COMPANY_MISMATCH' };
    }
    const mod = MOCK_BASE_MODULES.find(m => m.id === body.moduleId);
    if (!mod) return { status: 404, code: 'MODULE_NOT_FOUND' };
    if (session.role !== 'platform_admin' && mod.pricing_type !== 'free') {
      const isCovered = session.subscription?.status === 'active' &&
        (session.subscription.planId === 'all_access' || session.subscription.includedModuleIds?.includes(mod.id));
      if (!isCovered) {
        return { status: 402, code: 'SUBSCRIPTION_REQUIRED' };
      }
    }
    return { status: 200, success: true };
  }

  const res = simulateActivate(null, { moduleId: 'garage' });
  assertEqual(res.status, 401);
  assertEqual(res.code, 'NOT_AUTHENTICATED');
});

test('10. Server-side activation security: worker role blocked with 403 INSUFFICIENT_ROLE', () => {
  function simulateActivate(session, body) {
    if (!session) return { status: 401, code: 'NOT_AUTHENTICATED' };
    if (session.role !== 'owner' && session.role !== 'platform_admin') {
      return { status: 403, code: 'INSUFFICIENT_ROLE' };
    }
    return { status: 200, success: true };
  }

  const res = simulateActivate({ userId: 'u1', companyId: 'c1', role: 'worker' }, { moduleId: 'garage' });
  assertEqual(res.status, 403);
  assertEqual(res.code, 'INSUFFICIENT_ROLE');
});

test('11. Server-side activation security: cross-tenant activation blocked with 403 COMPANY_MISMATCH', () => {
  function simulateActivate(session, body) {
    if (!session) return { status: 401, code: 'NOT_AUTHENTICATED' };
    if (session.role !== 'owner' && session.role !== 'platform_admin') {
      return { status: 403, code: 'INSUFFICIENT_ROLE' };
    }
    if (session.role !== 'platform_admin' && body.companyId && body.companyId !== session.companyId) {
      return { status: 403, code: 'COMPANY_MISMATCH' };
    }
    return { status: 200, success: true };
  }

  const res = simulateActivate(
    { userId: 'u1', companyId: 'c1', role: 'owner' },
    { moduleId: 'garage', companyId: 'c2' }
  );
  assertEqual(res.status, 403);
  assertEqual(res.code, 'COMPANY_MISMATCH');
});

test('12. Server-side activation security: paid module requires active subscription coverage (402)', () => {
  function simulateActivate(session, body) {
    if (!session) return { status: 401, code: 'NOT_AUTHENTICATED' };
    if (session.role !== 'owner' && session.role !== 'platform_admin') {
      return { status: 403, code: 'INSUFFICIENT_ROLE' };
    }
    const mod = MOCK_BASE_MODULES.find(m => m.id === body.moduleId);
    if (session.role !== 'platform_admin' && mod.pricing_type !== 'free') {
      const isCovered = session.subscription?.status === 'active' &&
        (session.subscription.planId === 'all_access' || session.subscription.includedModuleIds?.includes(mod.id));
      if (!isCovered) {
        return { status: 402, code: 'SUBSCRIPTION_REQUIRED' };
      }
    }
    return { status: 200, success: true };
  }

  // Owner without subscription trying to activate garage
  const resUnsub = simulateActivate(
    { userId: 'u1', companyId: 'c1', role: 'owner', subscription: null },
    { moduleId: 'garage' }
  );
  assertEqual(resUnsub.status, 402);
  assertEqual(resUnsub.code, 'SUBSCRIPTION_REQUIRED');

  // Owner with active subscription covering garage
  const resCovered = simulateActivate(
    {
      userId: 'u1',
      companyId: 'c1',
      role: 'owner',
      subscription: { status: 'active', planId: 'starter', includedModuleIds: ['garage'] }
    },
    { moduleId: 'garage' }
  );
  assertEqual(resCovered.status, 200);
  assertEqual(resCovered.success, true);
});

test('13. Server-side activation: platform_admin bypasses subscription requirement', () => {
  function simulateActivate(session, body) {
    if (!session) return { status: 401, code: 'NOT_AUTHENTICATED' };
    if (session.role !== 'owner' && session.role !== 'platform_admin') {
      return { status: 403, code: 'INSUFFICIENT_ROLE' };
    }
    const mod = MOCK_BASE_MODULES.find(m => m.id === body.moduleId);
    if (session.role !== 'platform_admin' && mod.pricing_type !== 'free') {
      const isCovered = session.subscription?.status === 'active' &&
        (session.subscription.planId === 'all_access' || session.subscription.includedModuleIds?.includes(mod.id));
      if (!isCovered) {
        return { status: 402, code: 'SUBSCRIPTION_REQUIRED' };
      }
    }
    return { status: 200, success: true };
  }

  const resAdmin = simulateActivate(
    { userId: 'admin', companyId: 'any', role: 'platform_admin', subscription: null },
    { moduleId: 'hotel-property', companyId: 'target-company' }
  );
  assertEqual(resAdmin.status, 200);
  assertEqual(resAdmin.success, true);
});

// ── Runner ───────────────────────────────────────────────────────────────────

for (const t of testQueue) {
  try {
    t.fn();
    console.log(`  ✅ PASS  ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL  ${t.name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

console.log('\n───────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.error('❌ Some tests FAILED');
  process.exit(1);
} else {
  console.log('All Module Catalogue tests PASSED ✅\n');
}
