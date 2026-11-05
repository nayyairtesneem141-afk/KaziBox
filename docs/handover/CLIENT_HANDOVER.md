# KaziBox SaaS Integration Kit & Reference Implementations — Client Handover

Scope: `@kazibox/sdk`, `@kazibox/pharmastock`, `@kazibox/minimal-saas` (Fleet & Courier Dispatch), platform `/api/v1/*` routes used by modules.

> **CRITICAL COMPLIANCE STATEMENT:**
> - **NO production changes** were made.
> - **NO DNS records** were modified.
> - **NO deployments** were initiated.
> - **NO database migrations or SQL scripts** were executed against any database.
> - **NO live external services** were modified.
> - Payment collection and refunds (Moteur) remain **strictly disabled** (sandbox only).
> - **Staging deployment and public network verification are PENDING** client hosting provisioning.
> - All work was performed locally within the workspace repository.

---

## 1. Architecture & Persistence Model

```
KaziBox Platform (Next.js)                     Vertical SaaS Modules (PharmaStock / Fleet & Courier)
 /api/v1/context            <---- SDK ------   KaziBoxClient (Bearer API key + X-Workspace-Id)
 /api/v1/finance/revenue    <---- SDK ------   recordRevenue  (idempotent by reference)
 /api/v1/finance/expenses   <---- SDK ------   recordExpense  (idempotent by reference)
 /api/v1/events             <---- SDK ------   emitEvent
 shell sidebar --5-min SSO token (?token=)-->  GET /modules/<slug> | /sso (persistent replay check)
 platform ------signed webhook-------------->  POST /api/webhooks/kazibox (persistent deduplication)
 platform <------ summary pull -------------   GET /api/summary
```

- **Authoritative Tenant Key:** `companyId` (SSO `workspaceId` is mapped directly to `companyId` and transmitted in `X-Workspace-Id` HTTP headers).
- **Reference Implementations:**
  1. **PharmaStock** (`modules/pharmastock`): Comprehensive vertical microservice featuring prescription sales, batch FIFO stock deduction, expiry threshold alerts, and atomic local file persistence (`FilePharmaStorageAdapter`).
  2. **Fleet & Courier Dispatch** (`modules/minimal-saas`): Minimal second reference microservice proving that external developers can connect future compatible SaaS applications in ~300 lines of code using **only** `@kazibox/sdk` and documented APIs without modifying platform core files.
- **Process Restart Persistence:**
  - **SSO Replay Protection:** Implemented via `FileLockIdempotencyStore` / `MemoryIdempotencyStore`. Single-use JTI claims persist across process restarts for the full token TTL (5 minutes).
  - **Webhook Idempotency:** Implemented via `FileLockIdempotencyStore` / `MemoryIdempotencyStore`. Event IDs persist across process restarts for 24 hours.
  - **Tenant Provisioning Log:** Persisted to disk (`tenant-provisioning.json`) to survive process recycling.
- **Single-Instance Deployment Constraint:**
  - Local file locks (`FileLockIdempotencyStore`) and atomic file renames (`FilePharmaStorageAdapter`) are safe and durable **ONLY on a single filesystem volume attached to a single active Node process**.
  - Multi-instance horizontal scaling requires replacing file-based storage with a shared distributed transactional store (e.g. PostgreSQL with advisory locks or Redis with Redlock).

---

## 2. Complete Integration Workflow Validation

The complete lifecycle from initial configuration to live tenant operations was validated end-to-end:

```
[1. Manifest Definition] ──> [2. Registration / Audit] ──> [3. Workspace Subscription]
         │                                                            │
         ▼                                                            ▼
[6. Ledger Sync] <── [5. SSO Handoff Launch] <── [4. Webhook Provisioning]
   (Rev/Exp)              (?token=...)                 (module.activated)
         │
         ▼
[7. Telemetry Pull] ──> [8. Deactivation]
  (GET /api/summary)      (module.deactivated)
```

1. **Manifest Definition:** The SaaS defines a standard `ModuleManifest` including identity, bilingual labels (FR/EN), scopes, entry route, `summaryUrl`, `webhookUrl`, pricing, and PWA metadata.
2. **Registration & PWA Audit:** Submitted via `POST /api/v1/modules/register` where the platform automatically executes the mandatory 6-point PWA compliance audit and issues API credentials (`kz_...`).
3. **Workspace Subscription:** Tenant workspace activates the module in the KaziBox catalogue or workspace administration.
4. **Webhook Provisioning (`module.activated`):** Platform dispatches an HMAC-SHA256 signed webhook (`x-kazibox-signature`). The SaaS handler verifies the signature, enforces 24-hour idempotency, and provisions the tenant partition.
5. **SSO Handoff Launch:** User clicks the module in the KaziBox sidebar. Platform issues a 5-minute cryptographic token and redirects to `${entryUrl}?token=...`. The SaaS validates the token, claims the JTI atomically in `IdempotencyStore`, and establishes a local authenticated session. Subsequent presentations of the same token are rejected (`REPLAY_DETECTED`).
6. **Shared Ledger Sync:** When business events occur in the SaaS (e.g., pharmacy sale, courier delivery, fuel purchase), the SaaS calls `client.recordRevenue` and `client.recordExpense` with a unique reference. The platform ledger deduplicates on reference (returning HTTP 201 on creation, HTTP 200 `isDuplicate: true` on retry).
7. **Telemetry Pull (`summaryUrl`):** Platform periodically queries `GET ${summaryUrl}` with `X-Workspace-Id: <companyId>`. The SaaS returns formatted telemetry (`ModuleSummary`), which KaziBox renders on the executive dashboard.
8. **Lifecycle Deactivation (`module.deactivated`):** If a subscription is canceled or module deactivated, platform dispatches a signed webhook. The SaaS suspends write operations for that tenant.

---

## 3. Second Reference SaaS Integration (`@kazibox/minimal-saas`)

To prove independent reusability without developer trial-and-error, a second reference SaaS was built in `modules/minimal-saas` (`Fleet & Courier Dispatch`):

- **Package:** `@kazibox/minimal-saas`
- **Location:** `modules/minimal-saas` (ESM module, TypeScript 2022)
- **Manifest:** `minimalSaasManifest` with ID `fleet-courier`, category `logistics`, bilingual FR/EN text, and full PWA assets.
- **Service:** `MinimalSaasService` managing trips (revenue) and fuel logs (expense) strictly partitioned by `companyId`.
- **Server:** `createMinimalServer` exposing live HTTP endpoints:
  - `GET /api/health`: Health status, module name, uptime.
  - `GET /api/manifest`: Serves compliant `ModuleManifest`.
  - `GET /modules/fleet-courier?token=...`: Validates SSO handoff with replay rejection.
  - `POST /api/webhooks/kazibox`: Verifies HMAC-SHA256 signature and deduplicates events.
  - `GET /api/summary`: Serves operational metrics to platform shell.
  - `POST /api/trips` & `POST /api/fuel`: Records business activities with idempotent shared ledger sync.
  - `GET /api/data`: Audits multi-tenant isolation over HTTP.

---

## 4. Developer Intervention Analysis & Automation Roadmap

To make the Kit independently reusable by clients connecting future SaaS applications, the development steps are categorized into **unavoidable SaaS-side work** vs. **what the Integration Kit automates**:

### A. Unavoidable SaaS-Side Development (Inherent to Any SaaS)
These steps belong to the SaaS product itself and cannot be removed by KaziBox:
1. **Core Business Domain Logic:** Writing application-specific business features (e.g., medical batches, taxi meters, hotel room reservations, invoicing).
2. **Tenant Database Scoping:** Ensuring every database table in the SaaS includes and filters by `company_id` / `workspace_id`.
3. **Mounting Framework Endpoints:** Wiring the HTTP routes in the SaaS backend framework (Node HTTP, Express, Fastify, Next.js, Django, Laravel, Spring).
4. **Calling Ledger Sync on Transactions:** Invoking `recordRevenue` and `recordExpense` when revenue-generating operations happen.
5. **Hosting & Deployment:** Hosting the SaaS microservice on a server or container with persistent storage and public HTTPS endpoints.

### B. What the Integration Kit ALREADY Automates
The Kit eliminates complex infrastructure work through `@kazibox/sdk`:
1. **HMAC-SHA256 Webhook Signing & Verification:** `createWebhookHandler` handles cryptographic verification, timing attack defense (`timingSafeEqual`), and JSON parsing automatically.
2. **24-Hour Webhook Deduplication:** Deduplicates event IDs using `FileLockIdempotencyStore` / `MemoryIdempotencyStore`.
3. **5-Minute Cryptographic SSO Token Handling:** `createSsoHandler` validates token structure, signature, and expiration.
4. **Single-Use Replay Protection:** Automatically claims token `jti` in atomic idempotency store to prevent replay attacks across restarts.
5. **6-Point PWA Compliance Audit:** `validatePwaCompliance` validates manifests, icons, scopes, HTTPS transport, and bilingual strings.
6. **Platform Shared Ledger Idempotency:** Deduplicates revenue and expense entries by `reference`.
7. **Telemetry Normalization:** `createSummaryHandler` formats and validates `ModuleSummary` and `ConsolidatedMetric` contracts.

### C. No-Code Admin Registry & Self-Service Onboarding (Implemented)
The Platform Admin Registry (`/admin/registry` and `/admin/registry/[id]`) now provides complete no-code SaaS onboarding for `platform_admin` users without source code edits or SQL interventions:
1. **No-Code Registration & Structured Editing UI (`/admin/registry` & `/admin/registry/[id]`):**
   - Full structured forms for registering and updating external SaaS applications (bilingual FR/EN names & descriptions, unique slug validation with `409` duplicate guard, category, developer, version, icon, `appUrl`, `entryUrl`, `webhookUrl`, `summaryUrl`, pricing, scopes, subscribed events, and PWA configuration).
   - Persistent storage backed by `public.modules` (conforming to `01_schema.sql` NOT NULL columns and status check constraints) plus atomic local disk persistence (`.cache/kazibox-platform-store.json`) across server restarts.
2. **Cryptographic Credential Provisioning & One-Time Reveal:**
   - Generates and rotates `KAZIBOX_API_KEY` (`kz_live_...`, SHA-256 hashed), `KAZIBOX_SSO_SECRET` (`kz_sso_...`, AES-256-GCM encrypted at rest), and `KAZIBOX_WEBHOOK_SECRET` (`kz_whsec_...`, AES-256-GCM encrypted at rest), displaying plaintext values strictly once with a ready-to-paste `.env` snippet.
3. **Real Outbound Webhook Dispatch & Live Endpoint Test Tool:**
   - Outbound webhooks perform real HTTP `POST` delivery signed with the module's provisioned `webhookSecret`, with automatic retries, idempotency, and a **`📡 Tester le Webhook`** button in `/admin/registry/[id]`.
4. **Dynamic Module Resolution & Telemetry:**
   - Newly registered modules resolve dynamically across `/api/v1/modules/[slug]/launch` (SSO handoff), `/api/v1/modules/[slug]/summary` (remote HTTP summary fetch), `getModuleSummaries`, and `authenticateModuleApiKey` (supporting multi-tenant `scope: 'platform'` keys with `X-Workspace-Id` isolation).

---

## 5. Out-of-Scope Features (Require Client Approval Before Implementation)

The following features constitute additional scope and **must NOT be implemented without prior client approval and budget allocation**:

1. **No-Code / Low-Code SaaS Application Builder:**
   Automatically generating SaaS business applications or visual drag-and-drop workflow builders.
2. **Production Payment Gateway & Live Mobile Money Processing:**
   Enabling live payment collection, customer billing, or automated mobile money payouts via Moteur Pay (payments remain strictly in sandbox mode).
3. **Distributed Multi-Instance Idempotency & Database Storage Adapters:**
   Implementing distributed locking (e.g. Redis Redlock or PostgreSQL advisory locks) and migrating from local file storage to a managed database cluster.
4. **Public Developer Marketplace & Self-Service OAuth2 Portal:**
   Building a public developer portal with third-party developer accounts, self-service app submissions, public OAuth2 consent flows, and revenue-share billing.
5. **Automated Cloud Infrastructure Provisioning:**
   Auto-provisioning DigitalOcean Droplets, Kubernetes clusters, or block storage volumes via Cloud APIs.
6. **Production Database Schema Alterations or Live Migrations:**
   Executing SQL migrations against remote production databases.

---

## 6. Verification & Test Execution Summary

### Verified Local Tests (Executed & Confirmed in this Repo)

| Test Suite / Command | Exact Command | Exit Code | Result / Counts |
|---|---|---|---|
| **TypeScript Monorepo Compilation** | `node scripts/compile-ts.cjs` | **0** | Cleanly compiled `@kazibox/sdk`, `@kazibox/pharmastock`, and `@kazibox/minimal-saas` |
| **SaaS Integration Kit Test Suite** | `node platform/tests/saas-integration-kit.test.mjs` | **0** | **55 passed, 0 failed** (includes Section 10 tests for `@kazibox/minimal-saas`) |
| **Platform API Security & RBAC** | `node platform/tests/security.test.mjs` | **0** | **48 passed, 0 failed** |
| **Read-Only Entitlements** | `node platform/tests/read-only-entitlements.test.mjs` | **0** | **10 passed, 0 failed** |
| **Module Catalogue Suite** | `node platform/tests/catalogue.test.mjs` | **0** | **13 passed, 0 failed** |
| **Business Directory Suite** | `node platform/tests/directory.test.mjs` | **0** | **10 passed, 0 failed** |
| **KaziBox Flex Integration Suite** | `node platform/tests/kazibox-flex.test.mjs` | **0** | **23 passed, 0 failed** |
| **Flex Refunds & Webhooks Suite** | `node platform/tests/kazibox-flex-refunds-and-webhooks.test.mjs` | **0** | **30 passed, 0 failed** |
| **Moteur Core Billing Suite** | `node platform/tests/moteur.test.mjs` | **0** | **56 passed, 0 failed** |
| **Moteur Duplicate Regressions** | `node platform/tests/moteur-duplicate-regression.test.mjs` | **0** | **6 passed, 0 failed** |
| **Moteur Webhook Route Integration** | `node --loader ./platform/tests/loader.mjs platform/tests/moteur-webhook-route-integration.test.mjs` | **0** | **21 passed, 0 failed** |
| **Moteur Checkout Regressions** | `node --loader ./platform/tests/loader.mjs platform/tests/moteur-checkout-regression.test.mjs` | **0** | **50 passed, 0 failed** |
| **Registration Recovery Suite** | `node --loader ./platform/tests/loader.mjs platform/tests/registration-recovery.test.mjs` | **0** | **11 passed, 0 failed** |
| **Workspace Creation Suite** | `node --loader ./platform/tests/loader.mjs platform/tests/workspace-creation.test.mjs` | **0** | **10 passed, 0 failed** |
| **Garage Domain Test Suite** | `node --loader ./platform/tests/loader.mjs scripts/test-garage-domain.mjs` | **0** | **18 passed, 0 failed** |
| **Salon Domain Test Suite** | `node --loader ./platform/tests/loader.mjs scripts/test-salon-domain.mjs` | **0** | **41 passed, 0 failed** |
| **Platform Next.js Production Build** | `npm run build` (`next build`) | **0** | **40/40 static pages & all API routes compiled cleanly** |

### Staging Tests NOT YET Performed (Requires Deployed Staging Infrastructure)
1. **Docker Container Image Build:** Docker CLI is not installed on this local Windows host. Containers must be built in CI/CD runner or on staging VPS.
2. **Remote Supabase Staging Database Migrations:** No migrations were executed on remote staging databases.
3. **Cross-Machine Public Internet Smoke Testing:** Live HTTP calls over public TLS across independent hosts have not yet taken place.

---

## 7. Recommended Next Steps for Staging Deployment

1. **Deploy Staging Platform:** Deploy Next.js build to staging environment with sandbox Moteur configuration.
2. **Deploy Reference SaaS Services:**
   - Deploy PharmaStock on a single Droplet with attached Block Storage (`/data`).
   - Deploy Fleet & Courier Dispatch on staging.
3. **Execute Live Integration Smoke Tests:**
   - Register modules via `/api/v1/modules/register`.
   - Perform live SSO launch from KaziBox shell to verify session creation and replay rejection.
   - Dispatch test webhooks to verify real-time provisioning.
   - Perform live revenue transactions and confirm ledger sync.
