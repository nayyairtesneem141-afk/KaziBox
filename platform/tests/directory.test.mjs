// ==============================================================================
// KaziBox Task: Business Directory Domain, Workflow & RBAC Test Suite
// ==============================================================================

import assert from 'assert';

console.log('🧪 Running KaziBox Business Directory Tests...\n');

let passed = 0;
let failed = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn });
}

function assertEqual(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg || `Expected ${expected}, got ${actual}`);
}

function assertDeepEqual(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg);
}

// ── In-Memory Directory Engine ───────────────────────────────────────────────

class MockDirectoryEngine {
  constructor() {
    this.entries = new Map();
  }

  generateSlug(name) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  createEntry(data, session) {
    if (!session) {
      return { status: 401, error: 'NOT_AUTHENTICATED' };
    }
    if (session.role === 'worker') {
      return { status: 403, error: 'INSUFFICIENT_ROLE' };
    }
    if (!data.name || !data.category || !data.country || !data.city || !data.phone || !data.email) {
      return { status: 422, error: 'VALIDATION_ERROR' };
    }

    const companyId = session.role === 'platform_admin' && data.companyId ? data.companyId : session.companyId;
    const baseSlug = this.generateSlug(data.name);
    const slug = `${baseSlug}-${this.entries.size + 1}`;

    const entry = {
      id: `dir-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      companyId: companyId || null,
      name: data.name.trim(),
      slug,
      tagline: data.tagline || { fr: '', en: '' },
      description: data.description || { fr: '', en: '' },
      category: data.category,
      country: data.country.toUpperCase(),
      city: data.city.trim(),
      address: data.address || '',
      phone: data.phone.trim(),
      email: data.email.trim().toLowerCase(),
      status: 'pending_review',
      isActive: true,
      isVerified: false,
      isFeatured: false,
      submittedBy: session.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.entries.set(entry.id, entry);
    return { status: 201, entry };
  }

  updateEntry(id, updates, session) {
    if (!session) return { status: 401, error: 'NOT_AUTHENTICATED' };
    if (session.role === 'worker') return { status: 403, error: 'INSUFFICIENT_ROLE' };

    const entry = this.entries.get(id);
    if (!entry) return { status: 404, error: 'NOT_FOUND' };

    const isPlatformAdmin = session.role === 'platform_admin';
    const isOwnerOrManager = entry.companyId === session.companyId && (session.role === 'owner' || session.role === 'manager');

    if (!isPlatformAdmin && !isOwnerOrManager) {
      return { status: 403, error: 'TENANT_MISMATCH' };
    }

    // Tenant cannot self-promote to verified, featured, or published
    const safeUpdates = { ...updates };
    if (!isPlatformAdmin) {
      delete safeUpdates.isVerified;
      delete safeUpdates.isFeatured;
      delete safeUpdates.status;
      delete safeUpdates.rejectionReason;
    }

    Object.assign(entry, safeUpdates, { updatedAt: new Date().toISOString() });
    return { status: 200, entry };
  }

  reviewEntry(id, action, session, payload = {}) {
    if (!session) return { status: 401, error: 'NOT_AUTHENTICATED' };
    if (session.role !== 'platform_admin') return { status: 403, error: 'INSUFFICIENT_ROLE' };

    const entry = this.entries.get(id);
    if (!entry) return { status: 404, error: 'NOT_FOUND' };

    const now = new Date().toISOString();

    switch (action) {
      case 'approve':
        entry.status = 'approved';
        entry.reviewedBy = session.userId;
        entry.reviewedAt = now;
        delete entry.rejectionReason;
        break;

      case 'reject':
        if (!payload.rejectionReason || !payload.rejectionReason.trim()) {
          return { status: 422, error: 'REJECTION_REASON_REQUIRED' };
        }
        entry.status = 'rejected';
        entry.rejectionReason = payload.rejectionReason;
        entry.reviewedBy = session.userId;
        entry.reviewedAt = now;
        break;

      case 'publish':
        entry.status = 'published';
        entry.isActive = true;
        entry.publishedAt = now;
        entry.reviewedBy = session.userId;
        entry.reviewedAt = now;
        break;

      case 'suspend':
        entry.status = 'suspended';
        break;

      case 'activate':
        entry.isActive = true;
        break;

      case 'hide':
        entry.isActive = false;
        break;

      case 'verify':
        entry.isVerified = !entry.isVerified;
        break;

      case 'feature':
        entry.isFeatured = !entry.isFeatured;
        break;

      default:
        return { status: 422, error: 'INVALID_ACTION' };
    }

    entry.updatedAt = now;
    return { status: 200, entry };
  }

  getPublicList(filters = {}) {
    const all = Array.from(this.entries.values());
    return all.filter((e) => {
      // Public only sees published and active
      if (e.status !== 'published' || !e.isActive) return false;
      if (filters.country && filters.country !== 'all' && e.country !== filters.country) return false;
      if (filters.category && filters.category !== 'all' && e.category !== filters.category) return false;
      if (filters.city && !e.city.toLowerCase().includes(filters.city.toLowerCase())) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !e.city.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('1. Registration: Valid submission creates directory entry in pending_review status', () => {
  const engine = new MockDirectoryEngine();
  const session = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-palmeraie-01' };

  const res = engine.createEntry(
    {
      name: 'Hôtel Palmeraie Abidjan',
      category: 'hospitality',
      country: 'CI',
      city: 'Abidjan',
      address: 'Boulevard de la Palmeraie',
      phone: '+225 27 22 00 00',
      email: 'contact@palmeraie.ci',
      tagline: { fr: 'Hôtel 4 étoiles', en: '4-star hotel' },
    },
    session
  );

  assertEqual(res.status, 201);
  assertEqual(res.entry.status, 'pending_review');
  assertEqual(res.entry.companyId, 'comp-palmeraie-01');
  assertEqual(res.entry.isVerified, false);
  assertEqual(res.entry.isFeatured, false);
});

test('2. RBAC: Workers cannot register directory entries (rejected with 403)', () => {
  const engine = new MockDirectoryEngine();
  const workerSession = { userId: 'usr-worker-01', role: 'worker', companyId: 'comp-palmeraie-01' };

  const res = engine.createEntry(
    {
      name: 'Boutique Express',
      category: 'retail',
      country: 'SN',
      city: 'Dakar',
      phone: '+221 33 000 00 00',
      email: 'test@boutique.sn',
    },
    workerSession
  );

  assertEqual(res.status, 403);
  assertEqual(res.error, 'INSUFFICIENT_ROLE');
});

test('3. Validation: Fails when mandatory fields are missing', () => {
  const engine = new MockDirectoryEngine();
  const session = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  const res = engine.createEntry(
    {
      name: 'Garage Express',
      // missing category, country, city, phone, email
    },
    session
  );

  assertEqual(res.status, 422);
  assertEqual(res.error, 'VALIDATION_ERROR');
});

test('4. Tenant Isolation: Company A cannot edit Company B listing', () => {
  const engine = new MockDirectoryEngine();
  const ownerA = { userId: 'usr-owner-A', role: 'owner', companyId: 'comp-A' };
  const ownerB = { userId: 'usr-owner-B', role: 'owner', companyId: 'comp-B' };

  const { entry } = engine.createEntry(
    {
      name: 'Entreprise A',
      category: 'services',
      country: 'CI',
      city: 'Abidjan',
      phone: '+225 00 00 00 00',
      email: 'contact@a.ci',
    },
    ownerA
  );

  // Owner B attempts to edit Company A entry
  const editRes = engine.updateEntry(entry.id, { name: 'Entreprise A Hacked' }, ownerB);
  assertEqual(editRes.status, 403);
  assertEqual(editRes.error, 'TENANT_MISMATCH');
  assertEqual(engine.entries.get(entry.id).name, 'Entreprise A');
});

test('5. Tenant Self-Promotion Guard: Non-admins cannot self-promote to verified, featured or published', () => {
  const engine = new MockDirectoryEngine();
  const ownerA = { userId: 'usr-owner-A', role: 'owner', companyId: 'comp-A' };

  const { entry } = engine.createEntry(
    {
      name: 'Entreprise A',
      category: 'services',
      country: 'CI',
      city: 'Abidjan',
      phone: '+225 00 00 00 00',
      email: 'contact@a.ci',
    },
    ownerA
  );

  const hackAttempt = engine.updateEntry(
    entry.id,
    {
      name: 'Entreprise A Valid',
      status: 'published',
      isVerified: true,
      isFeatured: true,
    },
    ownerA
  );

  assertEqual(hackAttempt.status, 200);
  assertEqual(hackAttempt.entry.name, 'Entreprise A Valid');
  assertEqual(hackAttempt.entry.status, 'pending_review', 'Status must NOT be changed to published by tenant');
  assertEqual(hackAttempt.entry.isVerified, false, 'Verified badge must NOT be granted by tenant');
  assertEqual(hackAttempt.entry.isFeatured, false, 'Featured badge must NOT be granted by tenant');
});

test('6. Moderation: Non-platform admins cannot approve or review entries (rejected with 403)', () => {
  const engine = new MockDirectoryEngine();
  const owner = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  const { entry } = engine.createEntry(
    {
      name: 'Garage Pro',
      category: 'automotive',
      country: 'CM',
      city: 'Douala',
      phone: '+237 00 00 00 00',
      email: 'garage@pro.cm',
    },
    owner
  );

  const reviewRes = engine.reviewEntry(entry.id, 'approve', owner);
  assertEqual(reviewRes.status, 403);
  assertEqual(reviewRes.error, 'INSUFFICIENT_ROLE');
});

test('7. Moderation Workflow: Admin approves, publishes, and toggles badges', () => {
  const engine = new MockDirectoryEngine();
  const admin = { userId: 'usr-admin-01', role: 'platform_admin' };
  const owner = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  const { entry } = engine.createEntry(
    {
      name: 'Salon Élégance',
      category: 'beauty',
      country: 'SN',
      city: 'Dakar',
      phone: '+221 77 000 00 00',
      email: 'salon@dakar.sn',
    },
    owner
  );

  // 1. Approve
  const appRes = engine.reviewEntry(entry.id, 'approve', admin);
  assertEqual(appRes.status, 200);
  assertEqual(appRes.entry.status, 'approved');

  // 2. Publish
  const pubRes = engine.reviewEntry(entry.id, 'publish', admin);
  assertEqual(pubRes.status, 200);
  assertEqual(pubRes.entry.status, 'published');
  assertEqual(pubRes.entry.isActive, true);

  // 3. Toggle Verified
  const verRes = engine.reviewEntry(entry.id, 'verify', admin);
  assertEqual(verRes.entry.isVerified, true);

  // 4. Toggle Featured
  const featRes = engine.reviewEntry(entry.id, 'feature', admin);
  assertEqual(featRes.entry.isFeatured, true);
});

test('8. Moderation Rejection: Requires explicit rejection reason', () => {
  const engine = new MockDirectoryEngine();
  const admin = { userId: 'usr-admin-01', role: 'platform_admin' };
  const owner = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  const { entry } = engine.createEntry(
    {
      name: 'Fret Rapide',
      category: 'logistics',
      country: 'CD',
      city: 'Kinshasa',
      phone: '+243 81 000 00 00',
      email: 'fret@kin.cd',
    },
    owner
  );

  // Missing reason
  const rejFail = engine.reviewEntry(entry.id, 'reject', admin, { rejectionReason: '' });
  assertEqual(rejFail.status, 422);
  assertEqual(rejFail.error, 'REJECTION_REASON_REQUIRED');

  // Valid reason
  const rejSuccess = engine.reviewEntry(entry.id, 'reject', admin, {
    rejectionReason: 'Numéro de téléphone non attribuable',
  });
  assertEqual(rejSuccess.status, 200);
  assertEqual(rejSuccess.entry.status, 'rejected');
  assertEqual(rejSuccess.entry.rejectionReason, 'Numéro de téléphone non attribuable');
});

test('9. Public Visibility: Only published and active entries appear in catalogue search', () => {
  const engine = new MockDirectoryEngine();
  const admin = { userId: 'usr-admin-01', role: 'platform_admin' };
  const owner = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  // Entry 1: pending
  engine.createEntry(
    { name: 'Pending Hotel', category: 'hospitality', country: 'CI', city: 'Abidjan', phone: '1', email: 'p@h.ci' },
    owner
  );

  // Entry 2: published & active
  const { entry: publishedEntry } = engine.createEntry(
    { name: 'Published Garage', category: 'automotive', country: 'CI', city: 'Abidjan', phone: '2', email: 'g@g.ci' },
    owner
  );
  engine.reviewEntry(publishedEntry.id, 'publish', admin);

  // Entry 3: published but hidden (isActive = false)
  const { entry: hiddenEntry } = engine.createEntry(
    { name: 'Hidden Salon', category: 'beauty', country: 'SN', city: 'Dakar', phone: '3', email: 's@s.sn' },
    owner
  );
  engine.reviewEntry(hiddenEntry.id, 'publish', admin);
  engine.reviewEntry(hiddenEntry.id, 'hide', admin);

  const publicList = engine.getPublicList();
  assertEqual(publicList.length, 1, 'Only published and active entries should appear');
  assertEqual(publicList[0].name, 'Published Garage');
});

test('10. Search & Multi-Facet Filtering: Filter by country, category and keyword', () => {
  const engine = new MockDirectoryEngine();
  const admin = { userId: 'usr-admin-01', role: 'platform_admin' };
  const owner = { userId: 'usr-owner-01', role: 'owner', companyId: 'comp-01' };

  const entries = [
    { name: 'Hôtel Palmeraie', category: 'hospitality', country: 'CI', city: 'Abidjan', phone: '1', email: '1@ci' },
    { name: 'Garage Dakar Express', category: 'automotive', country: 'SN', city: 'Dakar', phone: '2', email: '2@sn' },
    { name: 'Clinique Douala Santé', category: 'health', country: 'CM', city: 'Douala', phone: '3', email: '3@cm' },
    { name: 'Kinshasa Logistics', category: 'logistics', country: 'CD', city: 'Kinshasa', phone: '4', email: '4@cd' },
  ];

  for (const e of entries) {
    const { entry } = engine.createEntry(e, owner);
    engine.reviewEntry(entry.id, 'publish', admin);
  }

  // Country filter
  const ciOnly = engine.getPublicList({ country: 'CI' });
  assertEqual(ciOnly.length, 1);
  assertEqual(ciOnly[0].country, 'CI');

  // Category filter
  const autoOnly = engine.getPublicList({ category: 'automotive' });
  assertEqual(autoOnly.length, 1);
  assertEqual(autoOnly[0].category, 'automotive');

  // Search filter
  const dakarSearch = engine.getPublicList({ search: 'Dakar' });
  assertEqual(dakarSearch.length, 1);
  assertEqual(dakarSearch[0].city, 'Dakar');
});

// ── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  for (const { name, fn } of testQueue) {
    try {
      await fn();
      console.log(`  ✅ PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL  ${name}\n         ${err.message}`);
      failed++;
    }
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All Business Directory workflow & security tests PASSED ✅\n');
  }
}

run();
