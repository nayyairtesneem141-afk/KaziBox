/**
 * KaziBox Flex Validation Harness — Stage 1: Migration State & DDL Inspector
 *
 * CRITICAL SCOPE RESTRICTION:
 * This stage is STRICTLY READ-ONLY. It does NOT execute DDL migrations.
 * It inspects schema availability via PostgREST OpenAPI metadata and verifies local migration file integrity.
 *
 * IMPORTANT LIMITATIONS (WHAT THIS STAGE CANNOT PROVE):
 * 1. Cannot prove column presence or data types (only detects top-level table presence).
 * 2. Cannot prove PostgreSQL CHECK constraints (e.g. 'partially_refunded' or 'flex' cycle checks).
 * 3. Cannot prove overloaded function signatures in pg_proc (OpenAPI collapses overloads to a single path).
 * 4. Cannot prove partial unique indexes or RLS policy definitions.
 *
 * Preconditions:
 * - Disposable database initialized.
 *
 * Possible Mutations:
 * - NONE (Strictly read-only inspection).
 */

import fs from 'node:fs';
import path from 'node:path';

export const stageMetadata = {
  id: 'stage1',
  name: 'Migration State & DDL Inspector',
  mode: 'READ_ONLY',
  targetSurface: 'PostgREST OpenAPI & Local Migration Files',
  possibleMutations: 'NONE (Read-only inspection)',
  requiredPreconditions: [
    'Target disposable database active',
    'PostgREST service running',
    'Local migration files 01, 06, 10, 11, 12 present on disk',
  ],
  knownLimitations: [
    'Verifies table and RPC route presence via OpenAPI, but cannot prove column types or CHECK constraints',
    'Cannot distinguish between multiple function overloads (collapsed into single OpenAPI path)',
    'Does not apply migrations; schema must be provisioned via SQL Editor/psql beforehand',
  ],
};

const REQUIRED_TABLES = [
  'companies',
  'modules',
  'company_modules',
  'subscriptions',
  'payment_history',
  'subscription_entitlements',
  'entitlement_schedule_adjustments',
  'payment_refund_events',
  'unmapped_payment_events',
  'pricing_tiers',
];

const REQUIRED_RPCS = [
  'confirm_moteur_payment',
  'refund_moteur_payment',
];

const MIGRATION_CHECKLIST = [
  { file: '01_schema.sql', mandatory: true, purpose: 'Core tenancy, modules, payments base schema' },
  { file: '02_rls_and_policies.sql', mandatory: false, purpose: 'Row Level Security and security policies' },
  { file: 'seed.sql', mandatory: false, purpose: 'Global modules catalogue seed' },
  { file: '06_moteur_billing_idempotency.sql', mandatory: true, purpose: 'Payment reference idempotency & status check' },
  { file: '10_moteur_module_alias_resolution.sql', mandatory: true, purpose: 'Structured payment terms & canonical salon' },
  { file: '11_kazibox_flex_duration.sql', mandatory: true, purpose: 'Commercial month flex duration & pricing_tiers' },
  { file: '12_kazibox_flex_entitlements_and_refunds.sql', mandatory: true, purpose: 'Target: Ledgers, check constraints & overloads' },
];

/**
 * Runs Stage 1 verification.
 * @param {import('../http-client.mjs').PostgrestHarnessClient} client
 * @param {Object} context
 */
export async function runStage1(client, context = {}) {
  const rootDir = context.rootDir || process.cwd();
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  const results = {
    stage: stageMetadata.id,
    name: stageMetadata.name,
    dryRun: client.dryRun,
    localFilesVerified: false,
    remoteSchemaVerified: false,
    missingTables: [],
    missingRpcs: [],
    migrationChecklistStatus: [],
    details: {},
  };

  // 1. Verify Local Migration Files on Disk
  const fileStatuses = [];
  let allMandatoryFilesPresent = true;

  for (const item of MIGRATION_CHECKLIST) {
    const fullPath = item.file === 'seed.sql'
      ? path.join(rootDir, 'supabase', 'seed.sql')
      : path.join(migrationsDir, item.file);

    const exists = fs.existsSync(fullPath);
    if (!exists && item.mandatory) {
      allMandatoryFilesPresent = false;
    }
    fileStatuses.push({
      file: item.file,
      exists,
      mandatory: item.mandatory,
      purpose: item.purpose,
    });
  }

  results.localFilesVerified = allMandatoryFilesPresent;
  results.migrationChecklistStatus = fileStatuses;

  // 2. Inspect Remote Schema State via PostgREST OpenAPI (without DDL execution)
  const schemaRes = await client.inspectSchema();
  if (schemaRes.ok) {
    const definitions = schemaRes.definitions || {};
    const paths = schemaRes.paths || {};

    results.missingTables = REQUIRED_TABLES.filter((t) => !definitions[t]);
    results.missingRpcs = REQUIRED_RPCS.filter((rpc) => !paths[`/rpc/${rpc}`]);
    
    // In dry-run mode, remoteSchemaVerified reflects simulated schema presence
    results.remoteSchemaVerified = results.missingTables.length === 0 && results.missingRpcs.length === 0;
    results.details = {
      detectedTables: Object.keys(definitions).filter((t) => REQUIRED_TABLES.includes(t)),
      detectedRpcs: Object.keys(paths).filter((p) => p.startsWith('/rpc/')).map((p) => p.replace('/rpc/', '')),
    };
  } else {
    results.remoteSchemaVerified = false;
    results.details = {
      error: schemaRes.error || 'Failed to query PostgREST schema endpoint',
      httpStatus: schemaRes.httpStatus,
    };
  }

  return results;
}
