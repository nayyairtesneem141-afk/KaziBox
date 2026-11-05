# @kazibox/minimal-saas — Fleet & Courier Dispatch

This module serves as the **second reference SaaS integration** for the KaziBox ecosystem.
It demonstrates that an external SaaS application can be built, connected, and activated using **only** the published `@kazibox/sdk`, documented APIs, and standard integration contracts — without requiring manual modifications to the KaziBox platform core.

---

## 1. Architectural Role

```
┌─────────────────────────────────────────────────────────────────┐
│                    KaziBox Platform Core                        │
│  - Multi-tenant workspace shell & RBAC                          │
│  - Unified subscription & billing                               │
│  - Consolidated financial dashboard                             │
└───────────────┬───────────────────────────────▲─────────────────┘
                │ 1. 5-Min SSO Handoff          │ 3. Shared Ledger Sync
                │    (?token=...)               │    (Revenue & Expenses)
                │ 2. Webhooks                   │ 4. Telemetry Metrics
                │    (x-kazibox-signature)      │    (summaryUrl)
┌───────────────▼───────────────────────────────┴─────────────────┐
│              Minimal SaaS (Fleet & Courier Dispatch)            │
│  - @kazibox/sdk client & adapters                               │
│  - Replay-protected SSO handler (createSsoHandler)              │
│  - Deduplicated webhook handler (createWebhookHandler)          │
│  - Telemetry summary handler (createSummaryHandler)             │
│  - Strict tenant isolation (companyId)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Checklist (How It Was Built)

### Step 1: Define `ModuleManifest` (`src/manifest.ts`)
- Configured identity (`id`, `name`, `slug`, `accentColor`, `logo`).
- Declared PWA config (`startUrl`, `themeColor`, 192x192, 512x512, and maskable icons) passing the 6-point compliance audit.
- Declared endpoints: `entryUrl`, `summaryUrl`, and `webhookUrl`.
- Declared required scopes: `read:context`, `write:finance`, `write:events`.

### Step 2: Implement Domain Logic with Multi-Tenant Isolation (`src/service.ts`)
- All database/memory maps are partitioned strictly by `companyId`.
- Operational actions (`recordTrip`, `recordFuel`) are idempotent on `reference`.
- Synchronizes with KaziBox platform ledger via `KaziBoxClient.recordRevenue()` and `KaziBoxClient.recordExpense()`.
- Calculates telemetry summary conforming to `ModuleSummary` and `ConsolidatedMetric`.

### Step 3: Mount Reusable SDK Handlers on HTTP Server (`src/server.ts`)
- **SSO Handoff**: Mounted `createSsoHandler` with `FileLockIdempotencyStore` / `MemoryIdempotencyStore` to reject replay attempts and extract authenticated session.
- **Webhooks**: Mounted `createWebhookHandler` with HMAC-SHA256 signature verification (`x-kazibox-signature`) and 24-hour event deduplication.
- **Telemetry**: Mounted `createSummaryHandler` requiring `X-Workspace-Id` header and optional Bearer API key.

---

## 3. Environment Configuration

```ini
PORT=3002
KAZIBOX_API_KEY=kz_live_fleet_courier_api_key_123
KAZIBOX_API_URL=http://127.0.0.1:3000
KAZIBOX_SSO_SECRET=shared_sso_secret_key_min_32_chars
KAZIBOX_WEBHOOK_SECRET=shared_webhook_secret_key_min_32_chars
```

---

## 4. Verification

Run the integration test suite:
```bash
node platform/tests/saas-integration-kit.test.mjs
```
