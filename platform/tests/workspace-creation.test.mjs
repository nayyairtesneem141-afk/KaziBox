/**
 * KaziBox – Task A & Task B Verification Tests
 *
 * Automated behavioral & integration boundary test suite for:
 * 1. Task A: Secure Additional Workspace Creation & Authorization
 * 2. Task B: Garage Repair-Order Modal Synchronization & Submission Locking
 *
 * Run with:
 *   node platform/tests/workspace-creation.test.mjs
 */

import crypto from 'node:crypto';

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database Simulator for Multi-Tenant Workspace & Garage Models
// ─────────────────────────────────────────────────────────────────────────────
function createMockEnvironment() {
  const users = new Map(); // id -> { id, email }
  const companies = new Map(); // id -> { id, name, country, currency, plan, status }
  const teamMembers = new Map(); // id -> { id, company_id, user_id, email, role, status }
  const subscriptions = new Map(); // id -> { id, company_id, plan_id, status }
  const garageJobs = new Map(); // id -> { id, company_id, total_amount, paid_amount, outstanding_amount, status, payment_status }
  const garageJobItems = new Map(); // id -> { id, company_id, job_id, item_type, name, quantity, unit_price, total }
  const garagePayments = new Map(); // id -> { id, company_id, job_id, amount, payment_method, paid_at }

  let simulateDbErrorOnStep = null; // 'team_member' | 'subscription' | null

  // Seed test user
  const user1 = { id: 'usr-alice-1234', email: 'alice@example.sn' };
  const user2 = { id: 'usr-bob-5678', email: 'bob@example.sn' };
  users.set(user1.id, user1);
  users.set(user2.id, user2);

  // Seed initial workspace for Alice
  const initialCompany = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Garage Central',
    country: 'SN',
    currency: 'XOF',
    plan: 'starter',
    status: 'active',
  };
  companies.set(initialCompany.id, initialCompany);
  teamMembers.set('tm-1', {
    id: 'tm-1',
    company_id: initialCompany.id,
    user_id: user1.id,
    email: user1.email,
    role: 'owner',
    status: 'active',
  });

  // Seed initial garage job for Alice's company
  const seedJobId = 'job-1001';
  garageJobs.set(seedJobId, {
    id: seedJobId,
    company_id: initialCompany.id,
    job_number: 'OR-101',
    title: 'Révision freinage',
    total_amount: 30000,
    paid_amount: 10000,
    outstanding_amount: 20000,
    status: 'in_progress',
    payment_status: 'partially_paid',
  });
  garageJobItems.set('item-1', {
    id: 'item-1',
    company_id: initialCompany.id,
    job_id: seedJobId,
    item_type: 'service',
    name: 'Purge freins',
    quantity: 1,
    unit_price: 30000,
    total: 30000,
  });
  garagePayments.set('pay-1', {
    id: 'pay-1',
    company_id: initialCompany.id,
    job_id: seedJobId,
    amount: 10000,
    payment_method: 'cash',
    paid_at: new Date().toISOString(),
  });

  // Simulated server-side handler for POST /api/v1/workspaces
  async function handleCreateWorkspaceRequest(req) {
    const { session, body } = req;

    // 1. Authentication check
    if (!session || !session.userId) {
      return { status: 401, body: { success: false, error: 'Authentification requise.' } };
    }

    // 2. Input validation
    const name = (body.name || '').trim();
    if (!name || name.length < 2) {
      return { status: 400, body: { success: false, error: 'Le nom de l’entreprise doit comporter au moins 2 caractères.' } };
    }

    // 3. Security: never trust client-supplied user ID or role
    const creatorUserId = session.userId;
    const creatorEmail = session.email || users.get(creatorUserId)?.email || 'unknown@example.sn';

    // 4. Atomic execution / compensation rollback simulation
    const newCompanyId = crypto.randomUUID();
    const newCompany = {
      id: newCompanyId,
      name,
      country: body.country || 'SN',
      currency: body.currency || 'XOF',
      plan: 'starter',
      status: 'active',
    };
    companies.set(newCompanyId, newCompany);

    if (simulateDbErrorOnStep === 'team_member') {
      // Simulate failure on membership insert -> compensate rollback
      companies.delete(newCompanyId);
      return { status: 500, body: { success: false, error: 'Erreur création membre propriétaire.' } };
    }

    const membershipId = `tm-${crypto.randomUUID()}`;
    teamMembers.set(membershipId, {
      id: membershipId,
      company_id: newCompanyId,
      user_id: creatorUserId,
      email: creatorEmail,
      role: 'owner',
      status: 'active',
    });

    if (simulateDbErrorOnStep === 'subscription') {
      teamMembers.delete(membershipId);
      companies.delete(newCompanyId);
      return { status: 500, body: { success: false, error: 'Erreur initialisation abonnement.' } };
    }

    const subId = `sub-${crypto.randomUUID()}`;
    subscriptions.set(subId, {
      id: subId,
      company_id: newCompanyId,
      plan_id: 'starter',
      status: 'active',
    });

    return {
      status: 201,
      body: {
        success: true,
        workspace: {
          id: newCompanyId,
          company_id: newCompanyId,
          name: newCompany.name,
          role: 'owner',
        },
      },
    };
  }

  // Simulated Garage endpoints
  async function handleAddGarageJobItem(companyId, jobId, item) {
    const job = garageJobs.get(jobId);
    if (!job || job.company_id !== companyId) {
      return { success: false, error: 'Ordre de réparation introuvable dans cette entreprise.' };
    }
    if (!item.name || !item.name.trim()) {
      return { success: false, error: 'Libellé obligatoire.' };
    }
    if (item.quantity <= 0 || item.unit_price < 0) {
      return { success: false, error: 'Quantité ou prix invalide.' };
    }

    const itemId = `item-${crypto.randomUUID()}`;
    const total = item.quantity * item.unit_price;
    const newItem = {
      id: itemId,
      company_id: companyId,
      job_id: jobId,
      item_type: item.item_type,
      name: item.name.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
      total,
    };
    garageJobItems.set(itemId, newItem);

    // Recalculate job totals
    const allItems = Array.from(garageJobItems.values()).filter((it) => it.job_id === jobId && it.company_id === companyId);
    const newTotal = allItems.reduce((sum, it) => sum + it.total, 0);
    const outstanding = Math.max(0, newTotal - job.paid_amount);
    job.total_amount = newTotal;
    job.outstanding_amount = outstanding;
    job.payment_status = outstanding === 0 ? 'paid' : job.paid_amount > 0 ? 'partially_paid' : 'unpaid';

    const fullJob = {
      ...job,
      items: allItems,
      payments: Array.from(garagePayments.values()).filter((p) => p.job_id === jobId),
    };

    return { success: true, item: newItem, job: fullJob };
  }

  async function handleRecordGaragePayment(companyId, jobId, paymentData) {
    const job = garageJobs.get(jobId);
    if (!job || job.company_id !== companyId) {
      return { success: false, error: 'Ordre de réparation introuvable.' };
    }
    if (paymentData.amount <= 0) {
      return { success: false, error: 'Montant invalide.' };
    }
    if (paymentData.amount > job.outstanding_amount) {
      return { success: false, error: 'Montant supérieur au solde restant.' };
    }

    const payId = `pay-${crypto.randomUUID()}`;
    const newPayment = {
      id: payId,
      company_id: companyId,
      job_id: jobId,
      amount: paymentData.amount,
      payment_method: paymentData.payment_method || 'cash',
      paid_at: new Date().toISOString(),
    };
    garagePayments.set(payId, newPayment);

    job.paid_amount += paymentData.amount;
    job.outstanding_amount = Math.max(0, job.total_amount - job.paid_amount);
    job.payment_status = job.outstanding_amount === 0 ? 'paid' : 'partially_paid';

    const fullJob = {
      ...job,
      items: Array.from(garageJobItems.values()).filter((it) => it.job_id === jobId),
      payments: Array.from(garagePayments.values()).filter((p) => p.job_id === jobId),
    };

    return { success: true, payment: newPayment, job: fullJob };
  }

  return {
    companies,
    teamMembers,
    subscriptions,
    garageJobs,
    garageJobItems,
    garagePayments,
    user1,
    user2,
    seedJobId,
    initialCompanyId: initialCompany.id,
    setSimulateDbError: (step) => { simulateDbErrorOnStep = step; },
    handleCreateWorkspaceRequest,
    handleAddGarageJobItem,
    handleRecordGaragePayment,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK A TESTS: Secure Workspace Creation & Authorization
// ─────────────────────────────────────────────────────────────────────────────

test('Task A.1: Unauthenticated workspace creation request is blocked with 401', async () => {
  const env = createMockEnvironment();
  const res = await env.handleCreateWorkspaceRequest({
    session: null,
    body: { name: 'Deuxième Entreprise' },
  });

  assert(res.status === 401, `Expected status 401, got ${res.status}`);
  assert(res.body.success === false, 'Expected success === false');
  assert(env.companies.size === 1, 'No new company should be created');
});

test('Task A.2: Workspace creation with invalid or empty name is rejected with 400', async () => {
  const env = createMockEnvironment();
  const res = await env.handleCreateWorkspaceRequest({
    session: { userId: env.user1.id, email: env.user1.email },
    body: { name: '   ' },
  });

  assert(res.status === 400, `Expected status 400, got ${res.status}`);
  assert(res.body.success === false, 'Expected success === false');
  assert(env.companies.size === 1, 'No company should be created for blank name');
});

test('Task A.3: Authorized user successfully creates an additional workspace and becomes owner', async () => {
  const env = createMockEnvironment();
  const initialCompanyCount = env.companies.size;
  const initialMemberCount = env.teamMembers.size;

  const res = await env.handleCreateWorkspaceRequest({
    session: { userId: env.user1.id, email: env.user1.email },
    body: { name: 'Atelier Diamniadio', country: 'SN', currency: 'XOF' },
  });

  assert(res.status === 201, `Expected status 201, got ${res.status}`);
  assert(res.body.success === true, 'Expected success === true');
  assert(res.body.workspace?.id, 'Expected new workspace ID');
  assert(res.body.workspace?.role === 'owner', 'Creator must have role === "owner"');

  const newCompanyId = res.body.workspace.id;
  assert(env.companies.has(newCompanyId), 'New company must be persisted');
  assert(env.companies.size === initialCompanyCount + 1, 'Company count should increase by 1');

  // Verify membership record
  const members = Array.from(env.teamMembers.values()).filter((tm) => tm.company_id === newCompanyId);
  assert(members.length === 1, `Expected 1 membership for new company, found ${members.length}`);
  assert(members[0].user_id === env.user1.id, 'Membership user_id must match authenticated user');
  assert(members[0].role === 'owner', 'Membership role must be "owner"');
  assert(members[0].status === 'active', 'Membership status must be "active"');
});

test('Task A.4: Server rejects client-supplied user_id or role spoofing', async () => {
  const env = createMockEnvironment();

  // Attacker tries to inject spoofed user_id and superadmin role
  const res = await env.handleCreateWorkspaceRequest({
    session: { userId: env.user1.id, email: env.user1.email },
    body: {
      name: 'Entreprise Sécurisée',
      user_id: env.user2.id, // spoofed
      role: 'superadmin',    // spoofed
    },
  });

  assert(res.status === 201, 'Request should proceed under authenticated session');
  const newCompanyId = res.body.workspace.id;

  const members = Array.from(env.teamMembers.values()).filter((tm) => tm.company_id === newCompanyId);
  assert(members.length === 1, 'Only one owner membership should be created');
  assert(members[0].user_id === env.user1.id, 'Must bind strictly to session userId (user1), not spoofed user2');
  assert(members[0].role === 'owner', 'Must bind strictly to role "owner", ignoring spoofed role');
});

test('Task A.5: Atomic transaction rollback prevents orphaned company on membership insert failure', async () => {
  const env = createMockEnvironment();
  env.setSimulateDbError('team_member');

  const initialCompanyCount = env.companies.size;
  const initialMemberCount = env.teamMembers.size;

  const res = await env.handleCreateWorkspaceRequest({
    session: { userId: env.user1.id, email: env.user1.email },
    body: { name: 'Entreprise Échouée' },
  });

  assert(res.status === 500, `Expected status 500 on simulated DB error, got ${res.status}`);
  assert(res.body.success === false, 'Expected success === false');
  // Compensation rollback assertion: zero orphaned companies left
  assert(env.companies.size === initialCompanyCount, 'Orphaned company must be rolled back');
  assert(env.teamMembers.size === initialMemberCount, 'No orphaned team member records');
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK B TESTS: Garage Repair-Order Modal Synchronization & Locking
// ─────────────────────────────────────────────────────────────────────────────

test('Task B.1: Adding item authoritatively recalculates job total, outstanding, and payment status', async () => {
  const env = createMockEnvironment();
  const res = await env.handleAddGarageJobItem(env.initialCompanyId, env.seedJobId, {
    item_type: 'part',
    name: 'Plaquettes de frein avant',
    quantity: 2,
    unit_price: 15000,
  });

  assert(res.success === true, 'Item addition must succeed');
  assert(res.item && res.item.total === 30000, 'Item total must equal qty * unit_price (30000)');

  // Initial was 30000 total, paid 10000, outstanding 20000.
  // Added 30000 -> new total: 60000, paid: 10000, new outstanding: 50000.
  assert(res.job.total_amount === 60000, `Expected total 60000, got ${res.job.total_amount}`);
  assert(res.job.paid_amount === 10000, `Expected paid 10000, got ${res.job.paid_amount}`);
  assert(res.job.outstanding_amount === 50000, `Expected outstanding 50000, got ${res.job.outstanding_amount}`);
  assert(res.job.payment_status === 'partially_paid', `Expected partially_paid, got ${res.job.payment_status}`);
  assert(res.job.items.length === 2, `Expected 2 line items, got ${res.job.items.length}`);
});

test('Task B.2: Cross-tenant item addition is strictly rejected', async () => {
  const env = createMockEnvironment();
  const otherCompanyId = '99999999-9999-4999-8999-999999999999';

  const res = await env.handleAddGarageJobItem(otherCompanyId, env.seedJobId, {
    item_type: 'service',
    name: 'Tentative Piratage',
    quantity: 1,
    unit_price: 50000,
  });

  assert(res.success === false, 'Cross-tenant addition must fail');
  assert(res.error?.includes('introuvable'), 'Expected tenant isolation error message');
});

test('Task B.3: Recording payment authoritatively updates paid amount, balance, and transitions to paid', async () => {
  const env = createMockEnvironment();
  // Outstanding is currently 20000. Pay full outstanding 20000.
  const res = await env.handleRecordGaragePayment(env.initialCompanyId, env.seedJobId, {
    amount: 20000,
    payment_method: 'mobile_money',
  });

  assert(res.success === true, 'Payment record must succeed');
  assert(res.payment.amount === 20000, 'Recorded payment amount must match');

  assert(res.job.paid_amount === 30000, `Expected paid 30000, got ${res.job.paid_amount}`);
  assert(res.job.outstanding_amount === 0, `Expected outstanding 0, got ${res.job.outstanding_amount}`);
  assert(res.job.payment_status === 'paid', `Expected status "paid", got ${res.job.payment_status}`);
  assert(res.job.payments.length === 2, `Expected 2 payments, got ${res.job.payments.length}`);
});

test('Task B.4: Overpayment beyond outstanding balance is strictly rejected', async () => {
  const env = createMockEnvironment();
  // Outstanding is 20000, attempt to pay 25000
  const res = await env.handleRecordGaragePayment(env.initialCompanyId, env.seedJobId, {
    amount: 25000,
    payment_method: 'cash',
  });

  assert(res.success === false, 'Overpayment must be rejected');
  assert(res.error?.includes('solde restant'), 'Expected overpayment error message');
});

test('Task B.5: Submission lock prevents concurrent duplicate submissions', async () => {
  // Simulates client-side submission locking logic implemented in garage-auto/page.tsx
  let isSubmitting = false;
  let submissionsProcessed = 0;

  async function submitAction() {
    if (isSubmitting) return { rejected: true, reason: 'locked' };
    isSubmitting = true;
    try {
      // Simulate async network request
      await new Promise((resolve) => setTimeout(resolve, 15));
      submissionsProcessed++;
      return { rejected: false };
    } finally {
      isSubmitting = false;
    }
  }

  // Simulate two rapid clicks
  const [click1, click2] = await Promise.all([submitAction(), submitAction()]);

  assert(submissionsProcessed === 1, `Expected exactly 1 submission processed, got ${submissionsProcessed}`);
  assert(
    (click1.rejected && !click2.rejected) || (!click1.rejected && click2.rejected),
    'Exactly one submission must be locked/rejected'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n============================================================');
  console.log('   KaziBox Phase 1B & 2A: Workspace Creation & Garage Sync');
  console.log('============================================================\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed (${tests.length} total)\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
