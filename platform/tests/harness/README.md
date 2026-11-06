# KaziBox Flex Disposable Database Validation Harness

Zero-dependency validation harness for inspecting and validating **Migration 12 (`12_kazibox_flex_entitlements_and_refunds.sql`)**, PostgREST RPC overload routing, discrete entitlement ledgers, and dual advisory lock concurrency against a dedicated disposable Supabase/PostgreSQL test instance.

---

## 1. Safety Architecture & Safeguards

This harness implements multi-layered safeguards designed to prevent unintended execution:

1. **Default Read-Only / Dry-Run Mode**:
   - The harness defaults strictly to `DRY_RUN=true`.
   - Simulated responses are generated locally without dispatching network packets.
   - Live network mutations require the explicit environment variable: `EXECUTE_LIVE_MUTATIONS="true"`.
2. **Explicit Operator Confirmation Gate**:
   - The runner **refuses to start** unless `CONFIRM_DISPOSABLE_ENVIRONMENT="true"` is set.
   - *Note*: Setting this flag confirms operator intent for a disposable test environment, but does not itself verify target project isolation.
3. **Fail-Closed Project Blacklist & URL Parsing**:
   - Explicitly rejects connections to known KaziBox environments:
     - `vkixehivjytpuhrjlaud` (Existing KaziBox preview/shared project)
     - `lvfoklqxqwgpktylphbu` (Central Moteur edge gateway project)
   - Automatically inspects local `.env.local` and `.env.preview.local` files to extract any configured project URLs and blacklists them dynamically.
   - Fails closed on unrecognized, malformed, or ambiguous URL structures.
4. **Fail-Closed Stage Orchestration**:
   - If Stage 1 detects that required tables or RPCs are missing from the remote database, `run.mjs` halts immediately before executing any mutating stages (Stages 3, 4, 5).
   - If any mutating stage fails, subsequent stages are blocked from running.
5. **Zero Credential Logging**:
   - Authorization headers, API keys, and database passwords are automatically masked (`[REDACTED]`).
   - Credentials must never be passed as CLI arguments.
6. **Network Request Timeouts**:
   - Every live `fetch` path enforces an explicit 10,000ms timeout (`AbortSignal.timeout`) to prevent indefinite connection hangs.
7. **Targeted Synthetic Fixtures & Opt-In Cleanup**:
   - Each run generates a unique hex `runId` (e.g. `c4b18f0a`).
   - Fixtures are isolated to `00000000-0000-0000-0000-<runId>`.
   - Broad `DELETE FROM ...` queries are strictly prohibited; cleanup only targets records matching the unique `company_id`.
   - Cleanup defaults to a dry-run report; actual deletion requires `ENABLE_FIXTURE_CLEANUP="true"`.

---

## 2. Environment Setup

Store credentials in a private, gitignored local file (e.g. `platform/.env.test.local`) or export them directly in your private terminal. **Never commit this file or paste secrets into chat.**

```bash
# Required Disposable Environment Configuration
export DISPOSABLE_SUPABASE_URL="https://<disposable-project-ref>.supabase.co"
export DISPOSABLE_SERVICE_ROLE_KEY="<disposable-service-role-key>"
export CONFIRM_DISPOSABLE_ENVIRONMENT="true"

# Optional: To enable live network operations (default is false / dry-run)
# export EXECUTE_LIVE_MUTATIONS="true"

# Optional: To enable post-run targeted synthetic fixture cleanup (default is false / dry-run)
# export ENABLE_FIXTURE_CLEANUP="true"
```

---

## 3. Stages Overview

| Stage | Name | Surface | Mode | Preconditions | Possible Mutations |
| :---: | :--- | :--- | :---: | :--- | :--- |
| **Stage 1** | **Migration State Inspector** | PostgREST OpenAPI & Local Files | **Read-Only** | Target DB running | **NONE**. Inspects metadata; does NOT apply migrations. |
| **Stage 2** | **SQL Integration Audit** | `06_moteur_rpc_integration_test.sql` | **Read-Only** | Migrations 01–12 applied | **NONE**. Statically inspects local SQL text. |
| **Stage 3** | **PostgREST RPC Routing** | `POST /rest/v1/rpc/refund_moteur_payment` | **Mutating** | Migration 12 applied | Seeds company fixture; logs unmapped events. |
| **Stage 4** | **Financial & Entitlement Ledgers** | Core RPCs & Ledger Tables | **Mutating** | Migration 12 applied | Writes payments, entitlements, adjustments, and unmapped events. |
| **Stage 5** | **Advisory Lock Concurrency** | Parallel RPC workers | **Mutating** | Migration 12 applied | Concurrent writes to synthetic workspace subscriptions & payments. |

---

## 4. Usage Instructions

### Step A: Dry-Run Inspection (Default & Safe)
Run the harness in dry-run mode to inspect proposed actions and payload structures without making network requests:

```bash
# Run all stages in dry-run mode
node platform/tests/harness/run.mjs --stage=all

# Run a specific stage in dry-run mode
node platform/tests/harness/run.mjs --stage=1
node platform/tests/harness/run.mjs --stage=3
```

### Step B: Inspect Cleanup Scope
To preview the exact rows and tables that would be targeted for cleanup:

```bash
node platform/tests/harness/run.mjs --cleanup-dry-run
```

### Step C: Applying Migrations (Separate Explicit Step)
Stage 1 does **not** apply migrations. When working with a disposable hosted project:
1. Open the disposable project's **SQL Editor** in the Supabase Dashboard.
2. Execute the migrations in dependency order:
   - `supabase/migrations/01_schema.sql`
   - `supabase/seed.sql` (Catalogue modules)
   - `supabase/migrations/06_moteur_billing_idempotency.sql`
   - `supabase/migrations/10_moteur_module_alias_resolution.sql`
   - `supabase/migrations/11_kazibox_flex_duration.sql`
   - `supabase/migrations/12_kazibox_flex_entitlements_and_refunds.sql`
3. Verify that `NOTIFY pgrst, 'reload schema';` executed cleanly.

### Step D: Running Live Validation (Requires Approval & Flags)
Only once migrations are applied and live execution is explicitly intended:

```bash
export EXECUTE_LIVE_MUTATIONS="true"
node platform/tests/harness/run.mjs --stage=all
```

---

## 5. Scope & Limitations

1. **Stage 1 (OpenAPI Metadata Limitations)**:
   - Verifies table and RPC route existence via the PostgREST OpenAPI endpoint.
   - Cannot verify column presence, column data types, PostgreSQL `CHECK` constraints (e.g. `'partially_refunded'` status), or overloaded function signatures in `pg_proc`.
2. **Stage 2 (Static Text Analysis Limitations)**:
   - Inspects the local `.sql` file on disk to confirm that `BEGIN;` and `ROLLBACK;` keywords enclose the test blocks.
   - Does not execute SQL statements and cannot verify runtime rollback behavior or driver transaction handling.
   - Multi-statement PL/pgSQL scripts must be run via the Supabase SQL Editor or `psql`.
3. **PostgREST Response Architecture**:
   - PostgREST returns HTTP 200 with JSON `{ "status": "invalid" }` or `{ "status": "unmatched" }` when stored procedures return handled JSONB results.
   - PostgREST returns HTTP 404 (`PGRST202`) when parameter signatures do not match any available overload in the schema cache.
   - The harness captures `httpStatus` and `jsonResult` as separate assertions.
