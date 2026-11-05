# KaziBox SaaS Integration Kit & Developer Guide

The **KaziBox SaaS Integration Kit** enables any external or internal vertical SaaS software (such as PharmaStock, Fleet & Courier Dispatch, Hotel & Property Management, Automotive Garages, and Salons) to connect seamlessly to the KaziBox African multi-tenant platform.

This guide provides the complete, authoritative specification for connecting SaaS applications using `@kazibox/sdk`.

---

## 1. Architectural Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │                      KaziBox Platform                       │
 │  • Multi-tenant workspace shell                             │
 │  • Unified subscription & billing (Moteur Pay sandbox)      │
 │  • Centralized authentication & RBAC                        │
 │  • Consolidated financial dashboard                         │
 └──────────────┬──────────────────────────────▲───────────────┘
                │ 1. 5-Min SSO Handoff         │ 3. Shared Ledger Sync
                │    (?token=...)              │    (Revenue & Expenses)
                │ 2. Webhooks                  │ 4. Telemetry Metrics
                │    (x-kazibox-signature)     │    (summaryUrl)
 ┌──────────────▼──────────────────────────────┴───────────────┐
 │               Vertical SaaS Module (External / Decoupled)   │
 │  • @kazibox/sdk Integration Kit                             │
 │  • Business domain logic (Inventory, Fleets, Bookings)      │
 │  • Strict tenant isolation bound to company_id              │
 │  • Standalone deployment (DigitalOcean / Docker / Node.js)  │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Installation & Quickstart

### A. Installing the SDK

In your Node.js 20+ project or monorepo workspace:

```bash
# In npm / yarn / pnpm project
npm install @kazibox/sdk
```

Or in a monorepo `package.json`:
```json
{
  "dependencies": {
    "@kazibox/sdk": "*"
  }
}
```

### B. Environment Configuration

Create a `.env` file in your SaaS service root:

```ini
NODE_ENV=production
PORT=3002

# KaziBox Platform Credentials
KAZIBOX_API_KEY=kz_live_your_module_api_key_here
KAZIBOX_API_URL=https://platform.kazibox.com

# Cryptographic Shared Secrets (provided upon module registration)
KAZIBOX_SSO_SECRET=your_32_character_minimum_sso_shared_secret
KAZIBOX_WEBHOOK_SECRET=your_32_character_minimum_webhook_shared_secret

# Optional: Custom idempotency store directory for single-instance persistence
IDEMPOTENCY_DATA_DIR=/data/idempotency
```

---

## 3. Core Integration Contracts

### Contract 1: Module Manifest (`ModuleManifest`)

Every SaaS module publishes a standard manifest defining its identity, permissions, entry routes, telemetry endpoints, and PWA configuration:

```typescript
import { ModuleManifest } from '@kazibox/sdk';

export const mySaaSManifest: ModuleManifest = {
  id: 'fleet-courier',
  slug: 'fleet-courier',
  name: { fr: 'Flotte & Coursiers Express', en: 'Fleet & Courier Dispatch' },
  version: '1.0.0',
  tagline: {
    fr: 'Gestion de flotte et livraisons express',
    en: 'Fleet supervision and express delivery dispatch'
  },
  logo: '🚚',
  accentColor: '#0D9488',
  entryUrl: '/modules/fleet-courier',
  menuItems: [
    { label: { fr: 'Courses', en: 'Trips & Dispatches' }, path: '/modules/fleet-courier' },
    { label: { fr: 'Carburant', en: 'Fuel Logs' }, path: '/modules/fleet-courier/expenses' }
  ],
  scopes: ['read:context', 'write:finance', 'write:events', 'read:subscription'],
  languages: ['fr', 'en'],
  summaryUrl: 'https://fleet-courier.kazibox.internal/api/summary',
  webhookUrl: 'https://fleet-courier.kazibox.internal/api/webhooks/kazibox',
  pwa: {
    scope: '/modules/fleet-courier',
    startUrl: '/modules/fleet-courier',
    themeColor: '#0D9488',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  },
  kind: 'external',
  status: 'published',
  developer: 'KaziBox Ecosystem Partner',
  category: 'logistics',
  pricing_type: 'paid',
  pricePerMonth: { amount: 12000, currency: 'XOF' }
};
```

---

### Contract 2: Client Initialization (`KaziBoxClient`)

Instantiate `KaziBoxClient` to interact with KaziBox platform ledger and context APIs:

```typescript
import { KaziBoxClient } from '@kazibox/sdk';

export const client = new KaziBoxClient({
  apiKey: process.env.KAZIBOX_API_KEY!,
  baseUrl: process.env.KAZIBOX_API_URL || 'https://platform.kazibox.com',
  workspaceId: 'comp-abidjan-01', // Active tenant context
  moduleId: 'fleet-courier',
  ssoSecret: process.env.KAZIBOX_SSO_SECRET!,
  webhookSecret: process.env.KAZIBOX_WEBHOOK_SECRET!,
  timeoutMs: 10000,
});

// Dynamically set tenant context before operational calls:
client.setWorkspace('comp-dakar-02');
```

---

### Contract 3: Single Sign-On (SSO) 5-Minute Handoff

When a user opens your SaaS module from the KaziBox workspace, they are redirected to your `entryUrl` with a cryptographic 5-minute HMAC-SHA256 token:
`https://your-saas.com/modules/fleet-courier?token=<token>`

Use `createSsoHandler` with `FileLockIdempotencyStore` for automatic single-use replay protection:

```typescript
import { createSsoHandler, FileLockIdempotencyStore } from '@kazibox/sdk';

const idempotencyStore = new FileLockIdempotencyStore('/data/idempotency/sso');

export const ssoHandler = createSsoHandler({
  ssoSecret: process.env.KAZIBOX_SSO_SECRET!,
  store: idempotencyStore,
  enableReplayProtection: true, // Atomically claims token JTI
  onAuthenticated: async (session) => {
    // session: { userId, userName, userEmail, workspaceId, workspaceName, role, language, currency }
    console.log(`User ${session.userName} authenticated for tenant ${session.workspaceId}`);
  }
});

// In your HTTP request router:
const result = await ssoHandler(tokenFromQueryParam);
if (!result.authenticated) {
  // result.code: 'EXPIRED' | 'SIGNATURE_MISMATCH' | 'REPLAY_DETECTED' | 'MISSING_TOKEN'
  return res.status(401).json({ error: result.error, code: result.code });
}

// Establish local session cookie or JWT for result.session
```

---

### Contract 4: Real-Time Webhook Processing

KaziBox dispatches real-time webhooks signed with `x-kazibox-signature: sha256=<hex>` for platform lifecycle events.
Use `createWebhookHandler` with `FileLockIdempotencyStore` for signature verification and 24-hour event deduplication:

```typescript
import { createWebhookHandler, FileLockIdempotencyStore } from '@kazibox/sdk';

const webhookStore = new FileLockIdempotencyStore('/data/idempotency/webhooks');

export const webhookHandler = createWebhookHandler({
  webhookSecret: process.env.KAZIBOX_WEBHOOK_SECRET!,
  store: webhookStore,
  enableIdempotency: true, // 24-hour atomic deduplication on event.id
  onModuleActivated: async (event) => {
    // event: { id, event: 'module.activated', companyId, timestamp, data }
    await provisionTenant(event.companyId, event.data?.plan);
  },
  onModuleDeactivated: async (event) => {
    await suspendTenant(event.companyId);
  },
  onSubscriptionUpdated: async (event) => {
    await updateTenantPlan(event.companyId, event.data?.plan);
  }
});

// In your HTTP router (POST /api/webhooks/kazibox):
const response = await webhookHandler({
  method: 'POST',
  headers: req.headers,
  body: rawBodyString, // Must use raw body string for HMAC verification
});
res.status(response.status).json(response.body);
```

---

### Contract 5: Shared Ledger Sync (Revenue & Expenses)

To reflect customer transactions on the unified workspace dashboard without letting KaziBox hold or touch merchant funds, emit financial events:

```typescript
// 1. Record operational revenue (idempotent on reference)
const revRes = await client.recordRevenue({
  amount: 35000,
  currency: 'XOF',
  source: 'Course Express — Chauffeur Diop',
  reference: 'REF-TRIP-2026-0042',
  occurredAt: new Date().toISOString(),
});
// revRes.status: 201 on first creation, 200 on duplicate reference (isDuplicate: true)

// 2. Record operational expense (idempotent on reference)
const expRes = await client.recordExpense({
  amount: 18000,
  currency: 'XOF',
  category: 'Carburant',
  reference: 'REF-FUEL-2026-0019',
  occurredAt: new Date().toISOString(),
});
```

---

### Contract 6: Consolidated Telemetry Summary (`summaryUrl`)

KaziBox queries your `summaryUrl` endpoint via `GET` with the `X-Workspace-Id` header to render real-time summary cards on the workspace dashboard:

```typescript
import { createSummaryHandler } from '@kazibox/sdk';

export const summaryHandler = createSummaryHandler({
  moduleId: 'fleet-courier',
  apiKey: process.env.KAZIBOX_API_KEY, // Optional Bearer API key protection
  getSummary: async (companyId: string) => {
    const data = await getTenantMetrics(companyId);
    return {
      revenue: data.totalRevenue,
      expenses: data.totalExpenses,
      activityCount: data.totalTrips,
      currency: 'XOF',
      lastUpdated: new Date().toISOString(),
      metrics: [
        {
          id: 'trips-today',
          moduleId: 'fleet-courier',
          label: { fr: 'Courses du Jour', en: 'Today’s Trips' },
          value: data.tripsToday,
          trend: 'up',
        },
        {
          id: 'fuel-spend',
          moduleId: 'fleet-courier',
          label: { fr: 'Carburant Consommé', en: 'Fuel Spent' },
          value: data.fuelExpenses,
          currency: 'XOF',
          trend: 'neutral',
        }
      ]
    };
  }
});
```

---

## 4. Mandatory 6-Point PWA Compliance Checklist

Before publishing in the KaziBox Platform Registry, run `validatePwaCompliance(manifest)` to verify:

```typescript
import { validatePwaCompliance } from '@kazibox/sdk';

const audit = validatePwaCompliance(mySaaSManifest);
if (!audit.allPassed) {
  console.error('PWA Checks Failed:', audit.checks.filter(c => !c.passed));
}
```

The 6 mandatory checks are:
1. **Web App Manifest**: Valid `pwa` declaration, startUrl, themeColor.
2. **App Icons Set**: Required 192x192, 512x512, and maskable PNG icons.
3. **Service Worker Scope**: Declared `pwa.scope` with offline fallback.
4. **Transport Security**: Strict HTTPS for all external endpoints (`summaryUrl`, `webhookUrl`).
5. **Ergonomic Touch Targets**: Minimum 44x44px touch bounding boxes.
6. **Bilingual FR/EN Day-One**: Full localized translations for French and English.

---

## 5. Registering & Managing Your SaaS with KaziBox (No-Code Admin Registry & API)

Platform administrators (`role === 'platform_admin'`) can onboard and manage KaziBox-compatible SaaS applications through either the **No-Code Admin Registry UI** or the **Admin Registry API**, without editing source code, SQL migrations, or environment files on KaziBox.

### A. No-Code Admin Registry UI (`/admin/registry`)

1. Sign in as a `platform_admin` and open **`/admin/registry`**.
2. Click **`+ Enregistrer un nouveau SaaS`** to open the structured registration modal:
   - **Identity & Bilingual Labels**: Module Name (FR/EN), Unique Slug (`id`), Short Taglines (FR/EN), Descriptions (FR/EN), Category, Developer/Company Name, Version, Icon (`logo`), and Accent Color.
   - **Integration Endpoints**: Application Base URL (`appUrl`), SSO Launch Entry URL (`entryUrl`), Webhook Endpoint (`webhookUrl`), and Summary Telemetry Endpoint (`summaryUrl`).
   - **Pricing & Subscription**: Pricing Model (`paid` / `free`), Monthly Reference Price, and Currency (`USD`, `XOF`, `EUR`, `CDF`).
   - **Permissions & Events**: Checkboxes for SDK Scopes (`profile:read`, `company:read`, `billing:read`, `events:write`, `notifications:write`, `Summary:read`, `Webhook:receive`) and Subscribed Webhook Events (`subscription.activated`, `subscription.cancelled`, `module.installed`, `module.suspended`, `payment.completed`, `payment.failed`, `invoice.paid`).
   - **PWA Configuration**: Start URL, Service Worker Scope, Theme Color, and 192x192 / 512x512 / Maskable Icon paths.
3. Click **`Enregistrer & Générer les Identifiants`**:
   - KaziBox validates all fields, checks for duplicate slugs (`409 DUPLICATE_MODULE_SLUG`), runs the 6-point PWA compliance audit, persists the module to `public.modules` (and atomic local disk cache), and provisions 3 cryptographic secrets.
4. **Copy One-Time Credentials**:
   - A one-time reveal modal displays:
     - `KAZIBOX_API_KEY` (`kz_live_<slug>_...`) — stored as SHA-256 hash (`sha256:<hex>`).
     - `KAZIBOX_SSO_SECRET` (`kz_sso_<slug>_...`) — stored encrypted at rest (AES-256-GCM) and used by `/api/v1/modules/[slug]/launch` to sign 5-minute SSO handoff tokens for this module.
     - `KAZIBOX_WEBHOOK_SECRET` (`kz_whsec_<slug>_...`) — stored encrypted at rest (AES-256-GCM) and used by the KaziBox webhook dispatcher to sign outbound HTTP payloads (`x-kazibox-signature: sha256=<hex>`) sent to this module's `webhookUrl`.
   - Click **Copier le bloc `.env`** and paste it into your SaaS service's `.env` file.
5. **Manage, Edit, Rotate Secrets & Test Webhooks (`/admin/registry/[id]`)**:
   - Open any module from `/admin/registry` to edit its configuration via the **Formulaire No-Code** (or **JSON Avancé** tab), transition its status (`draft`, `review`, `published`, `suspended`), rotate individual or all credentials (`+ Générer Clé API`, `🔄 Régénérer Secret SSO`, `🔄 Régénérer Secret Webhook`), or click **`📡 Tester le Webhook`** to send a live signed HTTP webhook to the module's `webhookUrl`.

### B. Programmatic Registration & Management API

1. **Register a New SaaS (`POST /api/v1/modules/register`)**:
   Requires `platform_admin` session:
   ```json
   {
     "id": "fleet-courier",
     "slug": "fleet-courier",
     "name": { "fr": "Flotte & Coursiers Express", "en": "Fleet & Courier Dispatch" },
     "description": { "fr": "Gestion de flotte et livraisons", "en": "Fleet and courier management" },
     "appUrl": "https://fleet-courier.example.com",
     "entryUrl": "https://fleet-courier.example.com/modules/fleet-courier",
     "summaryUrl": "https://fleet-courier.example.com/api/summary",
     "webhookUrl": "https://fleet-courier.example.com/api/webhooks/kazibox",
     "category": "operations",
     "pricingType": "paid",
     "pricePerMonth": { "amount": 12000, "currency": "XOF" },
     "scopes": ["profile:read", "company:read", "events:write", "Summary:read", "Webhook:receive"],
     "events": ["subscription.activated", "subscription.cancelled", "module.installed"],
     "pwa": { ... }
   }
   ```
   - Returns `201 Created` with `{ data: { module, pwa, credentials: { apiKey, ssoSecret, webhookSecret }, credentialsMetadata } }`.
   - Returns `409 Conflict` (`DUPLICATE_MODULE_SLUG`) if the slug already exists unless `"allowOverwrite": true` is specified.
   - Returns `422 Unprocessable Entity` (`VALIDATION_FAILED`) if required fields or URLs are invalid.

2. **Manage an Existing SaaS (`/api/v1/modules/registry/[id]`)**:
   - `GET /api/v1/modules/registry/[id]`: Returns sanitized module manifest, 6-point PWA report, and masked `credentialsMetadata` (never exposes plaintext secrets).
   - `PUT /api/v1/modules/registry/[id]`: Updates module configuration and manifest in `public.modules` and disk store.
   - `PATCH /api/v1/modules/registry/[id]`: Updates status (`{ "status": "draft" | "review" | "published" | "suspended" }`). Transitioning to `published` enforces the 6-point PWA compliance check.
   - `POST /api/v1/modules/registry/[id]`:
     - `{ "action": "provision_credentials", "type": "api_key" | "sso_secret" | "webhook_secret" | "all" }`: Provisions/rotates credentials and returns the plaintext values once.
     - `{ "action": "test_webhook", "companyId": "..." }`: Dispatches a live HMAC-SHA256 signed HTTP POST to the module's `webhookUrl` and returns the delivery status and HTTP response code.

---

## 6. Multi-Tenant Isolation Guidelines

1. **Authoritative Key**: The tenant identifier is always `company_id` (transmitted as `workspaceId` in SSO and `X-Workspace-Id` in HTTP headers).
2. **Strict Scoping**: Every database table, cache key, and storage directory in the SaaS module MUST include and index `company_id`.
3. **Cross-Tenant Guard**: Verify that caller workspace matches authenticated session workspace before executing any mutation.

---

## 7. Working Reference Implementations

Two complete, battle-tested reference implementations are available in this repository:

1. **PharmaStock** (`modules/pharmastock`):
   - Full pharmacy inventory microservice with batch FIFO deduction, prescription sales, and expiry alerts.
   - Microservice server with `FilePharmaStorageAdapter` and `FileLockIdempotencyStore`.
2. **Fleet & Courier Dispatch** (`modules/minimal-saas`):
   - Minimal transport & courier dispatch service demonstrating how to build an external SaaS integration in ~300 lines of code using only `@kazibox/sdk`.
   - Exposes `/api/health`, `/api/manifest`, SSO handoff, webhooks, summary telemetry, and trip/fuel ledger sync.
