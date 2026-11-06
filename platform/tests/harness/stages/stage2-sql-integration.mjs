/**
 * KaziBox Flex Validation Harness — Stage 2: SQL Integration Test Inspector
 *
 * SCOPE & STATIC AUDIT:
 * Statically inspects "supabase/tests/06_moteur_rpc_integration_test.sql" on disk.
 * Checks for transaction boundaries (BEGIN; ... ROLLBACK;) and expected test assertions.
 *
 * IMPORTANT LIMITATIONS (WHAT THIS STAGE CANNOT PROVE):
 * 1. This stage performs STATIC TEXT INSPECTION ONLY. It does NOT execute SQL statements.
 * 2. Regex verification of BEGIN/ROLLBACK does not prove runtime rollback execution or database engine driver behavior.
 * 3. Does not test PostgREST HTTP routing or the 6-parameter authoritative overload.
 *
 * Preconditions:
 * - Migrations 01, 06, 10, 11, 12 applied to target database.
 * - Multi-statement script must be run via Supabase SQL Editor or psql.
 *
 * Possible Mutations:
 * - NONE in this harness stage (Static inspection of local file).
 */

import fs from 'node:fs';
import path from 'node:path';

export const stageMetadata = {
  id: 'stage2',
  name: 'SQL Integration Suite Static Audit',
  mode: 'READ_ONLY_INSPECTION',
  targetSurface: 'supabase/tests/06_moteur_rpc_integration_test.sql',
  possibleMutations: 'NONE (Static inspection of local file on disk)',
  requiredPreconditions: [
    'Migrations 01, 06, 10, 11, and 12 applied',
    'PostgreSQL 15+ execution environment (SQL Editor or psql)',
  ],
  knownLimitations: [
    'Static file analysis cannot guarantee that the database engine will roll back under runtime errors',
    'PostgREST HTTP does not support multi-statement anonymous DO blocks; must be run in SQL Editor',
  ],
};

const TEST_BLOCKS = [
  { test: 1, name: 'Confirm Payment Success', assertion: 'Status = success, 1 payment record, active sub & module' },
  { test: 2, name: 'Idempotent Duplicate Confirmation', assertion: 'Status = duplicate, code = ALREADY_PROCESSED' },
  { test: 3, name: 'Validation Rejection', assertion: 'Rejects missing company, negative amount, invalid module' },
  { test: 4, name: 'Renewal Without Losing Remaining Days', assertion: 'Status = success, period extended' },
  { test: 5, name: 'Refund of Older Payment Preserves Active Subscription', assertion: 'Status = success, code = REFUNDED_NEWER_PAYMENT_ACTIVE' },
  { test: 6, name: 'Refund of Current Payment Revokes Only Tied Entitlements', assertion: 'Status = success, sub cancelled, independent module salon remains active' },
  { test: 7, name: 'Duplicate Refund', assertion: 'Status = duplicate, code = ALREADY_REFUNDED' },
];

/**
 * Runs Stage 2 static audit and execution guide.
 * @param {import('../http-client.mjs').PostgrestHarnessClient} client
 * @param {Object} context
 */
export async function runStage2(client, context = {}) {
  const rootDir = context.rootDir || process.cwd();
  const sqlTestPath = path.join(rootDir, 'supabase', 'tests', '06_moteur_rpc_integration_test.sql');

  const results = {
    stage: stageMetadata.id,
    name: stageMetadata.name,
    dryRun: client.dryRun,
    testFileExists: false,
    transactionRollbackKeywordsDetected: false,
    testBlocksDetected: [],
    compatibilityNotes: [],
    executionGuide: {},
  };

  if (!fs.existsSync(sqlTestPath)) {
    results.error = `Test file not found at ${sqlTestPath}`;
    return results;
  }

  results.testFileExists = true;
  const content = fs.readFileSync(sqlTestPath, 'utf8');

  // Verify explicit BEGIN and ROLLBACK keywords are present in file
  const hasBegin = /^\s*BEGIN\s*;/mi.test(content);
  const hasRollback = /^\s*ROLLBACK\s*;/mi.test(content);
  results.transactionRollbackKeywordsDetected = hasBegin && hasRollback;

  // Verify test block presence
  for (const block of TEST_BLOCKS) {
    const regex = new RegExp(`Test\\s+${block.test}:`, 'i');
    results.testBlocksDetected.push({
      testNumber: block.test,
      name: block.name,
      found: regex.test(content),
      expectedAssertion: block.assertion,
    });
  }

  // Compatibility Notes against Migration 12
  results.compatibilityNotes = [
    'Tests 5 and 6 invoke public.refund_moteur_payment(p_company_id, p_reference, p_reason).',
    'Migration 12 Lines 757-777 provide a 3-argument signature delegating to the 6-parameter RPC.',
    'Static file analysis indicates intended rollback structure via line 177 ROLLBACK;',
    'Runtime rollback verification requires querying public.companies for test ID 00000000-0000-0000-0000-000000000001 post-run.',
  ];

  results.executionGuide = {
    mechanism: 'Execute content manually in Supabase Dashboard SQL Editor or via psql.',
    reason: 'Multi-statement anonymous PL/pgSQL transaction blocks cannot be dispatched via PostgREST HTTP.',
    postRunVerificationSql: "SELECT COUNT(*) FROM public.companies WHERE id = '00000000-0000-0000-0000-000000000001';",
  };

  return results;
}
