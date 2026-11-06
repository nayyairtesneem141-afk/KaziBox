/**
 * KaziBox Flex Validation Harness — Synthetic Test Fixtures & Targeted Cleanup
 *
 * CRITICAL SAFETY RULES:
 * 1. Generates unique per-run UUIDs and references to prevent cross-run collisions.
 * 2. Uses strictly synthetic test entities (prefixed with SYNTH-).
 * 3. Never executes broad DELETE queries. All cleanup is strictly targeted by unique runId.
 * 4. Cleanup defaults to a dry-run report; actual deletion requires ENABLE_FIXTURE_CLEANUP="true".
 * 5. Provides explicit, targeted fixture initialization so foreign-key dependencies are satisfied.
 */

import crypto from 'node:crypto';

export class SyntheticFixtureManager {
  /**
   * @param {string} [customRunId]
   */
  constructor(customRunId) {
    // Generate unique 8-character hex run identifier
    this.runId = customRunId || crypto.randomBytes(4).toString('hex');
    
    // Deterministic, valid UUID format reserved for this test run
    this.companyId = `00000000-0000-0000-0000-${this.runId.padStart(12, '0')}`;
    this.companyName = `Synthetic Test Workspace [${this.runId}]`;

    // Unique per-run payment references
    this.ref1 = `SYNTH-${this.runId}-PAY-001`;
    this.ref2 = `SYNTH-${this.runId}-PAY-002`;
    this.ref3 = `SYNTH-${this.runId}-PAY-003`;
    this.refLegacy = `SYNTH-${this.runId}-LEGACY-004`;

    // Unique per-run refund event IDs
    this.eventRefund1 = `evt_synth_${this.runId}_ref_001`;
    this.eventRefund2 = `evt_synth_${this.runId}_ref_002`;

    // Canonical catalogue modules
    this.modules = ['hotel', 'garage', 'salon'];
    this.isSeeded = false;
  }

  /**
   * Returns metadata about the synthetic fixtures created for this run.
   */
  getDescriptor() {
    return {
      runId: this.runId,
      companyId: this.companyId,
      companyName: this.companyName,
      references: [this.ref1, this.ref2, this.ref3, this.refLegacy],
      refundEvents: [this.eventRefund1, this.eventRefund2],
      targetedCleanupQuery: `company_id=eq.${this.companyId}`,
      isSeeded: this.isSeeded,
    };
  }

  /**
   * Returns initial workspace and module rows to seed for the run.
   */
  getSeedPayloads() {
    return {
      company: {
        id: this.companyId,
        name: this.companyName,
        country: 'CI',
        currency: 'XOF',
        plan: 'starter',
        status: 'active',
      },
      modules: [
        { id: 'hotel', slug: 'hotel', name: { fr: 'Hôtel' }, description: { fr: 'Test' }, category: 'hospitality', icon: 'building', developer: 'KaziBox', version: '1.0.0' },
        { id: 'garage', slug: 'garage', name: { fr: 'Garage' }, description: { fr: 'Test' }, category: 'automotive', icon: 'wrench', developer: 'KaziBox', version: '1.0.0' },
        { id: 'salon', slug: 'salon', name: { fr: 'Salon' }, description: { fr: 'Test' }, category: 'beauty', icon: 'scissors', developer: 'KaziBox', version: '1.0.0' },
      ],
    };
  }

  /**
   * Seeds the minimum valid isolated fixtures (company and catalogue modules)
   * required to satisfy foreign key constraints before running mutating tests.
   * @param {import('./http-client.mjs').PostgrestHarnessClient} client
   * @returns {Promise<{ seeded: boolean, details: any }>}
   */
  async ensurePrerequisiteFixtures(client) {
    if (this.isSeeded) {
      return { seeded: true, details: 'Already seeded in this session' };
    }

    const { company, modules } = this.getSeedPayloads();

    // 1. Seed modules first (satisfies company_modules module_id foreign key)
    const modRes = await client.insertTable('modules', modules);

    // 2. Seed synthetic company (satisfies company_id foreign keys across all billing tables)
    const compRes = await client.insertTable('companies', company);

    this.isSeeded = modRes.ok && compRes.ok;
    return {
      seeded: this.isSeeded,
      details: {
        modulesInserted: modRes.ok,
        companyInserted: compRes.ok,
        companyId: this.companyId,
      },
    };
  }

  /**
   * Generates a dry-run report detailing the exact rows targeted for cleanup.
   * @param {Object} [summary]
   */
  generateCleanupDryRunReport(summary = {}) {
    return {
      dryRun: true,
      runId: this.runId,
      targetedScope: {
        companyId: this.companyId,
        references: [this.ref1, this.ref2, this.ref3, this.refLegacy],
      },
      proposedDeletions: [
        { table: 'subscription_entitlements', filter: `company_id=eq.${this.companyId}` },
        { table: 'entitlement_schedule_adjustments', filter: `company_id=eq.${this.companyId}` },
        { table: 'payment_refund_events', filter: `company_id=eq.${this.companyId}` },
        { table: 'unmapped_payment_events', filter: `company_id=eq.${this.companyId}` },
        { table: 'payment_history', filter: `company_id=eq.${this.companyId}` },
        { table: 'company_modules', filter: `company_id=eq.${this.companyId}` },
        { table: 'subscriptions', filter: `company_id=eq.${this.companyId}` },
        { table: 'companies', filter: `id=eq.${this.companyId}` },
      ],
      notice: 'No records were deleted. To execute actual deletion, set ENABLE_FIXTURE_CLEANUP="true".',
    };
  }

  /**
   * Executes targeted cleanup ONLY if explicit confirmation is enabled.
   * @param {import('./http-client.mjs').PostgrestHarnessClient} client
   * @param {boolean} allowCleanup
   */
  async executeTargetedCleanup(client, allowCleanup) {
    if (!allowCleanup) {
      return this.generateCleanupDryRunReport();
    }

    const filter = `company_id=eq.${this.companyId}`;
    const results = {};

    // Strict order respecting foreign key constraints
    const tablesToClean = [
      'subscription_entitlements',
      'entitlement_schedule_adjustments',
      'payment_refund_events',
      'unmapped_payment_events',
      'payment_history',
      'company_modules',
      'subscriptions',
    ];

    for (const table of tablesToClean) {
      try {
        const res = await client.deleteTable(table, filter);
        results[table] = res.count || 0;
      } catch (err) {
        results[table] = `ERROR: ${err.message}`;
      }
    }

    try {
      const res = await client.deleteTable('companies', `id=eq.${this.companyId}`);
      results['companies'] = res.count || 0;
    } catch (err) {
      results['companies'] = `ERROR: ${err.message}`;
    }

    return {
      dryRun: false,
      runId: this.runId,
      cleanupResults: results,
    };
  }
}
