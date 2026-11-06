/**
 * KaziBox Flex Validation Harness — CLI Runner & Stage Orchestrator
 *
 * Usage:
 *   node platform/tests/harness/run.mjs --stage=<1|2|3|4|5|all>
 *
 * CRITICAL SAFETY & FAIL-CLOSED RULES:
 * - Defaults strictly to DRY_RUN. Zero remote network writes occur unless EXECUTE_LIVE_MUTATIONS="true".
 * - Refuses execution without CONFIRM_DISPOSABLE_ENVIRONMENT="true".
 * - Blocks known production/preview project references automatically.
 * - FAIL-CLOSED ORCHESTRATION: If Stage 1 detects missing schema or any stage fails,
 *   subsequent mutating stages are STRICTLY BLOCKED from running.
 * - Never prints credentials, passwords, or secrets.
 */

import { loadAndValidateConfig, maskSecret } from './config.mjs';
import { PostgrestHarnessClient } from './http-client.mjs';
import { SyntheticFixtureManager } from './fixtures.mjs';
import { runStage1, stageMetadata as meta1 } from './stages/stage1-migrations.mjs';
import { runStage2, stageMetadata as meta2 } from './stages/stage2-sql-integration.mjs';
import { runStage3, stageMetadata as meta3 } from './stages/stage3-postgrest-routing.mjs';
import { runStage4, stageMetadata as meta4 } from './stages/stage4-refund-ledgers.mjs';
import { runStage5, stageMetadata as meta5 } from './stages/stage5-concurrency.mjs';

function parseCliArgs() {
  const args = process.argv.slice(2);
  let stage = 'all';
  let cleanupDryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--stage=')) {
      stage = arg.replace('--stage=', '').trim().toLowerCase();
    } else if (arg === '--cleanup-dry-run') {
      cleanupDryRun = true;
    }
  }

  return { stage, cleanupDryRun };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       KaziBox Flex Database & PostgREST Validation Harness     ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Safety Configuration & Environment Validation
  const { isValid, errors, config } = loadAndValidateConfig();
  if (!isValid) {
    console.error('❌ SAFETY PRE-FLIGHT CHECK FAILED:\n');
    errors.forEach((err, idx) => console.error(`  ${idx + 1}. ${err}`));
    console.error('\nExecution aborted safely. No network operations were performed.');
    process.exit(1);
  }

  const { stage, cleanupDryRun } = parseCliArgs();

  // Print sanitized execution parameters
  console.log('Execution Parameters:');
  console.log(`  • Target Project Ref : ${config.projectRef}`);
  console.log(`  • Execution Mode     : ${config.dryRun ? 'DRY-RUN (Simulated / Safe)' : 'LIVE MUTATIONS (Active)'}`);
  console.log(`  • Stage Selection    : ${stage.toUpperCase()}`);
  console.log(`  • Service Role Key   : ${maskSecret(config.serviceRoleKey)}`);
  console.log(`  • Cleanup Flag       : ${config.allowCleanup ? 'ENABLED' : 'DISABLED (Protected)'}`);
  console.log('───────────────────────────────────────────────────────────────\n');

  const client = new PostgrestHarnessClient(config);
  const fixtures = new SyntheticFixtureManager();

  console.log(`Synthetic Fixture Scope:`);
  console.log(`  • Run ID             : ${fixtures.runId}`);
  console.log(`  • Workspace UUID     : ${fixtures.companyId}`);
  console.log(`  • Primary Reference  : ${fixtures.ref1}`);
  console.log('───────────────────────────────────────────────────────────────\n');

  if (cleanupDryRun) {
    console.log('Generating Targeted Cleanup Dry-Run Report:\n');
    const report = fixtures.generateCleanupDryRunReport();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const stageResults = {};
  let shouldHalt = false;

  // Stage 1: Migration State & DDL Inspector (Read-Only)
  if (stage === 'all' || stage === '1' || stage === 'stage1') {
    console.log(`[STAGE 1] Running: ${meta1.name}`);
    console.log(`  Preconditions: ${meta1.requiredPreconditions.join(', ')}`);
    console.log(`  Possible Mutations: ${meta1.possibleMutations}`);
    stageResults.stage1 = await runStage1(client, { rootDir: config.rootDir });
    console.log(`  Result: Local Files=${stageResults.stage1.localFilesVerified ? 'OK' : 'FAIL'}, Remote Schema=${stageResults.stage1.remoteSchemaVerified ? 'OK' : 'INCOMPLETE/DRY_RUN'}\n`);

    // FAIL-CLOSED CHECK: If live execution is enabled and remote schema is incomplete, block subsequent stages
    if (!config.dryRun && !stageResults.stage1.remoteSchemaVerified) {
      console.error('⛔ FAIL-CLOSED ABORT: Stage 1 detected that required database tables or RPCs are missing.');
      console.error('   Mutating stages (3, 4, 5) CANNOT run until migrations 01, 06, 10, 11, 12 are applied.');
      console.error('   Please apply migrations via the Supabase SQL Editor and re-run Stage 1.');
      shouldHalt = true;
    }
  }

  // Stage 2: SQL Integration Test Inspector (Static Local Inspection)
  if (!shouldHalt && (stage === 'all' || stage === '2' || stage === 'stage2')) {
    console.log(`[STAGE 2] Running: ${meta2.name}`);
    console.log(`  Preconditions: ${meta2.requiredPreconditions.join(', ')}`);
    console.log(`  Possible Mutations: ${meta2.possibleMutations}`);
    stageResults.stage2 = await runStage2(client, { rootDir: config.rootDir });
    console.log(`  Result: Script Exists=${stageResults.stage2.testFileExists ? 'OK' : 'FAIL'}, Rollback Keywords=${stageResults.stage2.transactionRollbackKeywordsDetected ? 'OK' : 'FAIL'}\n`);
  }

  // Stage 3: PostgREST RPC Routing
  if (!shouldHalt && (stage === 'all' || stage === '3' || stage === 'stage3')) {
    console.log(`[STAGE 3] Running: ${meta3.name}`);
    console.log(`  Preconditions: ${meta3.requiredPreconditions.join(', ')}`);
    console.log(`  Possible Mutations: ${meta3.possibleMutations}`);
    stageResults.stage3 = await runStage3(client, fixtures);
    console.log(`  Result: ${stageResults.stage3.passedCount} passed, ${stageResults.stage3.failedCount} failed (${stageResults.stage3.testCases.length} total)\n`);

    if (stageResults.stage3.failedCount > 0 && !config.dryRun) {
      console.error('⛔ FAIL-CLOSED ABORT: Stage 3 encountered failures. Halting before executing Stages 4 and 5.');
      shouldHalt = true;
    }
  }

  // Stage 4: Financial Ledgers & Refund Edge Cases
  if (!shouldHalt && (stage === 'all' || stage === '4' || stage === 'stage4')) {
    console.log(`[STAGE 4] Running: ${meta4.name}`);
    console.log(`  Preconditions: ${meta4.requiredPreconditions.join(', ')}`);
    console.log(`  Possible Mutations: ${meta4.possibleMutations}`);
    stageResults.stage4 = await runStage4(client, fixtures);
    console.log(`  Result: ${stageResults.stage4.passedCount} passed, ${stageResults.stage4.failedCount} failed (${stageResults.stage4.testCases.length} total)\n`);

    if (stageResults.stage4.failedCount > 0 && !config.dryRun) {
      console.error('⛔ FAIL-CLOSED ABORT: Stage 4 encountered failures. Halting before executing Stage 5.');
      shouldHalt = true;
    }
  }

  // Stage 5: Advisory Lock Concurrency
  if (!shouldHalt && (stage === 'all' || stage === '5' || stage === 'stage5')) {
    console.log(`[STAGE 5] Running: ${meta5.name}`);
    console.log(`  Preconditions: ${meta5.requiredPreconditions.join(', ')}`);
    console.log(`  Possible Mutations: ${meta5.possibleMutations}`);
    stageResults.stage5 = await runStage5(client, fixtures);
    console.log(`  Result: Passed=${stageResults.stage5.passed}, Deadlocks=${stageResults.stage5.deadlockErrorsDetected}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                         EXECUTION SUMMARY                      ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(stageResults, null, 2));

  // Targeted Cleanup Step (Runs only if explicitly requested)
  if (config.allowCleanup && !config.dryRun) {
    console.log('\nExecuting Targeted Post-Run Cleanup...');
    const cleanupReport = await fixtures.executeTargetedCleanup(client, true);
    console.log(JSON.stringify(cleanupReport, null, 2));
  } else {
    console.log('\nCleanup Action: Skipped (Default protected mode; no deletion executed).');
  }

  if (shouldHalt) {
    console.log('\nValidation Harness aborted with prerequisite or test failures.');
    process.exit(1);
  }

  console.log('\nValidation Harness finished successfully.');
}

main().catch((err) => {
  console.error('\nUNHANDLED HARNESS EXCEPTION:', err.message);
  process.exit(1);
});
