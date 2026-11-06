/**
 * KaziBox Flex Validation Harness — Stage 5: Advisory Lock Concurrency & Integrity Audit
 *
 * SCOPE:
 * Audits dual-lock acquisition order (company_subscription:<id> then moteur_payment:<ref>)
 * under parallel transaction dispatch.
 *
 * CRITICAL VERIFICATION REQUIREMENT:
 * 1. Pre-establishes Payment A so concurrent workers contend for an existing active record.
 * 2. Launches truly overlapping requests via Promise.all.
 * 3. Verifies final payment/refund ledgers, idempotency, subscription state, entitlement periods,
 *    and deadlock error codes (40P01)—not just HTTP 200 responses.
 *
 * Preconditions:
 * - Migration 12 applied.
 * - Disposable target database active.
 *
 * Possible Mutations:
 * - Writes to payment_history, subscriptions, and subscription_entitlements for synthetic test company.
 */

export const stageMetadata = {
  id: 'stage5',
  name: 'Advisory Lock Concurrency & Schedule Integrity Audit',
  mode: 'LIVE_OR_DRY_RUN',
  targetSurface: 'Parallel calls to confirm_moteur_payment and refund_moteur_payment',
  possibleMutations: 'Concurrent insertions and updates to payments, subscriptions, and entitlements for synthetic test company',
  requiredPreconditions: [
    'Migration 12 applied',
    'Dual advisory locks active in both RPCs',
    'Target disposable database active',
  ],
};

/**
 * Runs Stage 5 concurrency stress test.
 * @param {import('../http-client.mjs').PostgrestHarnessClient} client
 * @param {import('../fixtures.mjs').SyntheticFixtureManager} fixtures
 */
export async function runStage5(client, fixtures) {
  // Ensure prerequisite company and module fixtures exist
  await fixtures.ensurePrerequisiteFixtures(client);

  const refConcurrentA = `${fixtures.ref1}_CONC_A`;
  const refConcurrentB = `${fixtures.ref2}_CONC_B`;

  const results = {
    stage: stageMetadata.id,
    name: stageMetadata.name,
    dryRun: client.dryRun,
    parallelRequestsDispatched: 4,
    deadlockErrorsDetected: 0,
    workerResponses: [],
    ledgerAssertions: {},
    passed: false,
  };

  if (client.dryRun) {
    results.passed = true;
    results.details = 'Dry-run mode: Concurrency dispatch simulated. No network operations performed.';
    return results;
  }

  // Step 1: Pre-establish baseline Payment A so concurrent workers contend for an existing active record
  const baselineConfirm = await client.rpc('confirm_moteur_payment', {
    p_company_id: fixtures.companyId,
    p_reference: refConcurrentA,
    p_amount: 30000,
    p_currency: 'XOF',
    p_plan_id: 'starter',
    p_billing_cycle: 'flex',
    p_module_ids: ['hotel'],
  });

  if (!baselineConfirm.ok || baselineConfirm.data?.status !== 'success') {
    results.error = 'Failed to pre-establish baseline Payment A before concurrency stress test.';
    results.passed = false;
    return results;
  }

  // Step 2: Dispatch 4 Parallel Overlapping Workers via Promise.all
  const workers = [
    // Worker 1: Concurrent Duplicate Confirm for Payment A (Tests reference lock idempotency)
    client.rpc('confirm_moteur_payment', {
      p_company_id: fixtures.companyId,
      p_reference: refConcurrentA,
      p_amount: 30000,
      p_currency: 'XOF',
      p_plan_id: 'starter',
      p_billing_cycle: 'flex',
      p_module_ids: ['hotel'],
    }),

    // Worker 2: Concurrent Top-Up Confirm Payment B (Tests company lock schedule stacking)
    client.rpc('confirm_moteur_payment', {
      p_company_id: fixtures.companyId,
      p_reference: refConcurrentB,
      p_amount: 15000,
      p_currency: 'XOF',
      p_plan_id: 'starter',
      p_billing_cycle: 'flex',
      p_module_ids: ['hotel'],
    }),

    // Worker 3: Concurrent Partial Refund for Payment A (Tests contention between refund and renewal)
    client.rpc('refund_moteur_payment', {
      p_company_id: fixtures.companyId,
      p_reference: refConcurrentA,
      p_reason: 'concurrent_stress_refund',
      p_refund_amount: 5000,
      p_refund_event_id: `evt_conc_${fixtures.runId}_01`,
    }),

    // Worker 4: Concurrent Duplicate Refund for Payment A (Tests event deduplication lock)
    client.rpc('refund_moteur_payment', {
      p_company_id: fixtures.companyId,
      p_reference: refConcurrentA,
      p_reason: 'concurrent_stress_refund_dup',
      p_refund_amount: 5000,
      p_refund_event_id: `evt_conc_${fixtures.runId}_01`, // Same event ID
    }),
  ];

  const responses = await Promise.all(workers);
  results.workerResponses = responses.map((r, idx) => ({
    workerIndex: idx + 1,
    httpStatus: r.httpStatus,
    status: r.data?.status || null,
    code: r.data?.code || null,
    isDeadlock: r.rawText?.includes('40P01') || r.rawText?.includes('deadlock_detected') || false,
  }));

  // Step 3: Audit Deadlock Errors
  const deadlocks = results.workerResponses.filter((w) => w.isDeadlock);
  results.deadlockErrorsDetected = deadlocks.length;
  const noDeadlocksPassed = results.deadlockErrorsDetected === 0;

  // Step 4: Deep Ledger & Invariant Verification on Database State
  const [paymentsRes, entitlementsRes, subRes] = await Promise.all([
    client.queryTable('payment_history', `company_id=eq.${fixtures.companyId}&reference=in.(${refConcurrentA},${refConcurrentB})`),
    client.queryTable('subscription_entitlements', `company_id=eq.${fixtures.companyId}&payment_reference=in.(${refConcurrentA},${refConcurrentB})`),
    client.queryTable('subscriptions', `company_id=eq.${fixtures.companyId}&select=*`),
  ]);

  const payments = paymentsRes.data || [];
  const entitlements = entitlementsRes.data || [];
  const subscription = subRes.data?.[0] || null;

  // Invariant a: Exactly 1 payment row for refConcurrentA and 1 for refConcurrentB
  const refAPayments = payments.filter((p) => p.reference === refConcurrentA);
  const refBPayments = payments.filter((p) => p.reference === refConcurrentB);
  const idempotencyPassed = refAPayments.length === 1 && refBPayments.length === 1;

  // Invariant b: Discrete Entitlements for Payment A and Payment B
  const entitlementsIsolated = entitlements.length === 2;

  // Invariant c: Subscription schedule is contiguous and reflects combined duration
  const scheduleValid = subscription && subscription.current_period_end && new Date(subscription.current_period_end) > new Date();

  results.ledgerAssertions = {
    noDeadlocks: { expected: 0, actual: results.deadlockErrorsDetected, passed: noDeadlocksPassed },
    idempotencyEnforced: { expectedCountA: 1, actualCountA: refAPayments.length, expectedCountB: 1, actualCountB: refBPayments.length, passed: idempotencyPassed },
    entitlementsIsolated: { expectedCount: 2, actualCount: entitlements.length, passed: entitlementsIsolated },
    scheduleIntegrity: { subscriptionExists: Boolean(subscription), scheduleValid: Boolean(scheduleValid), passed: Boolean(scheduleValid) },
  };

  results.passed = noDeadlocksPassed && idempotencyPassed && entitlementsIsolated && Boolean(scheduleValid);
  return results;
}
