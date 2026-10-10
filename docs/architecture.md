# KaziBox — System Architecture & Modular Integration Guide
KAZIBOX — PHASE 4
SUPABASE PRODUCTION DATA LAYER MIGRATION

We are now starting Phase 4.

You already know the KaziBox codebase and the architecture you built in the previous phases.

The architecture document is the source of truth.

IMPORTANT:
Do not redesign the architecture.
Do not rename established concepts.
Do not create duplicate models.
Do not rebuild working UI.

The objective of Phase 4 is to replace the current typed persistent mock data store with a real Supabase/Postgres backend while preserving the existing KaziBox contracts, UI, module architecture, API contracts, and security model.

==================================================
ARCHITECTURE THAT MUST BE PRESERVED
==================================================

KaziBox is one platform with multiple modules.

The monorepo structure remains:

/platform
/packages/ui
/packages/sdk
/modules/demo
/docs

The platform remains responsible for:

- authentication
- company/workspace tenancy
- RBAC
- team access
- settings
- notifications
- centralized billing
- module orchestration

The SDK remains the shared contract between the platform and modules.

The Demo Module remains an example of an external module.

Do NOT turn modules into separate applications.

==================================================
1. TENANCY — IMPORTANT
==================================================

The established tenant identifier is:

company_id

Do NOT introduce a competing workspace_id tenancy model.

The architecture explicitly defines every tenant as a unique company_id.

All tenant-owned records must be securely scoped to company_id.

Preserve the existing application terminology and types where possible.

If the application internally uses workspace terminology for UI purposes, that is fine, but the existing database/authorization architecture must continue using the established company/tenant model rather than creating a second tenancy system.

==================================================
2. EXISTING DATA LAYER
==================================================

The existing data-access layer is already located in:

/platform/lib/

including:

auth.ts
workspace.ts
team.ts
notifications.ts
modules.ts
billing.ts
registry.ts
finance.ts

These currently use a typed persistent mock data store designed to mimic Supabase client responses.

The architecture specifically intends these methods to map approximately 1:1 to:

supabase.auth
supabase.from(...)

Do NOT rewrite the UI to talk directly to Supabase everywhere.

Instead:

UI
↓
existing platform/lib services
↓
Supabase

Preserve the current service boundaries.

==================================================
3. SUPABASE SETUP
==================================================

Add/configure the official Supabase integration required by the existing Next.js architecture.

Use appropriate:

- browser client
- server client
- middleware/session handling where required
- server-side privileged operations where appropriate

Do not expose the Supabase service-role key to the browser.

Required environment variables must be documented.

Do not commit secrets.

==================================================
4. DATABASE SCHEMA
==================================================

Create the real PostgreSQL schema corresponding to the existing KaziBox models.

Before creating a new table, inspect the existing types and mock-store structures.

The database should support the existing concepts:

- companies / tenants
- profiles/users where required
- team members
- roles
- modules
- module subscriptions
- billing
- notifications
- finance records
- webhook events
- module API key metadata
- activity/events where already represented

Do not invent duplicate concepts.

Use the existing architecture and TypeScript types as the source of truth.

Use:

company_id

as the tenant boundary.

Use proper foreign keys and constraints.

==================================================
5. RBAC
==================================================

Preserve the existing four-role architecture:

platform_admin
owner
manager
worker

The rules are:

platform_admin:
- platform infrastructure
- Module Registry
- platform-level administration

owner:
- workspace/company settings
- centralized billing
- team management
- activated modules

manager:
- active modules
- workspace settings
- notifications
- NO billing management
- NO module catalogue activation

worker:
- operational module workflows only
- NO Team
- NO Billing

These permissions must not exist only in React.

They must be enforced through server-side authorization and Supabase RLS where applicable.

==================================================
6. ROW LEVEL SECURITY
==================================================

This is the highest-priority security task in Phase 4.

Enable RLS on all tenant-owned tables.

Every policy must respect company_id and authenticated membership.

A member of Company A must never be able to access Company B's:

- team
- settings
- notifications
- module subscriptions
- finance records
- billing records
- activity
- other tenant-owned data

Do not rely on frontend filtering.

Do not trust a company_id supplied by the browser without authorization.

Implement secure membership checks.

Be careful about recursive RLS policies.

Use secure helper functions / SECURITY DEFINER functions where appropriate.

Platform-level data must have separate authorization rules for platform_admin.

==================================================
7. AUTHENTICATION
==================================================

Replace mock authentication persistence with real Supabase Auth.

Preserve the existing authentication UI.

Implement:

- registration
- login
- logout
- session persistence
- current authenticated user
- protected routes

Map the authenticated Supabase user to the existing KaziBox profile/team/company model.

Do not break the existing auth.ts API consumed by the rest of the platform.

==================================================
8. COMPANY / TEAM
==================================================

Persist the existing company and team architecture.

A user must only see companies they are actually associated with.

Preserve the existing roles and access checks.

Team management must update real Supabase records.

Verify that changing membership/role does not accidentally grant access across tenants.

==================================================
9. MODULES
==================================================

Persist the existing module registry and module subscription architecture.

Preserve the ModuleManifest contract.

The database must support:

- module metadata
- internal/external kind
- status
- developer
- pricing
- manifest/configuration
- module subscription/activation
- company association

The Module Registry remains restricted to:

platform_admin

Do not move module registry authorization into frontend-only logic.

==================================================
10. MODULE ACCESS
==================================================

Preserve:

hasModuleAccess(companyId, moduleId)

and the existing subscription rules:

- active
- expiring_soon
- all_access
- includedModuleIds

Do not change the public behavior of:

<RequireAccess moduleId="...">

The real database should now become the source of truth for subscription/access state.

==================================================
11. BILLING
==================================================

Preserve the existing centralized billing architecture.

One company has one consolidated KaziBox subscription.

Plans remain:

- Single Module
- Bundle
- All Access
- Build Your Own

Do not create billing inside individual modules.

Do not implement real payment provider integration in this phase unless it is already explicitly implemented and required by the current code.

The existing mocked checkout/integration hooks may remain placeholders.

Persist the subscription state correctly in Supabase.

==================================================
12. SHARED FINANCE
==================================================

Preserve the existing shared finance architecture.

There must be ONE shared finance ledger.

Do NOT create:

hotel_revenue
hotel_expenses
garage_revenue
garage_expenses
taxi_revenue
etc.

Use the existing finance model:

workspace/company
+
module
+
type
+
amount
+
currency
+
reference
+
occurredAt

The existing architecture requires idempotency so the same reference cannot create duplicate financial rows.

Preserve that behavior at the database/service layer.

The existing public finance functions must continue working:

getFinanceSummary
getFinanceByModule
getFinanceTimeline

The global dashboard must continue using:

getModuleSummaries

and the shared finance functions.

==================================================
13. INTEGRATION API
==================================================

Preserve the existing Phase 3 public integration API:

GET  /api/v1/context
POST /api/v1/finance/revenue
POST /api/v1/finance/expenses
POST /api/v1/events
GET  /api/v1/subscription

These APIs must now read/write real persistent data where applicable.

Do not break the existing contracts.

Continue requiring idempotency references for finance ingestion.

Verify tenant/module authorization before accepting data.

A module must never be able to submit finance records for another company.

==================================================
14. SSO / MODULE TOKEN
==================================================

Preserve:

issueModuleToken
verifyModuleToken

and the existing token claims:

userId
workspaceId/company context
role
language
currency
moduleId
iat
exp

The existing development HMAC implementation may remain where appropriate, but ensure secrets remain server-side.

Do not expose signing secrets in browser bundles.

Do not redesign the entire SSO architecture in Phase 4.

The existing architecture already specifies migration toward RS256/JWKS for production.

If that production migration is not required for this phase, clearly document it as a remaining production-hardening item rather than silently changing the contract.

==================================================
15. WEBHOOKS
==================================================

Persist the existing webhook event/queue architecture where required.

Preserve:

subscription.activated
subscription.expired
module.activated
module.deactivated
user.role_changed

Preserve:

x-kazibox-signature:
sha256=<hex_digest>

Do not weaken webhook verification.

Do not expose webhook secrets.

==================================================
16. MODULE API KEYS
==================================================

Preserve the existing security architecture:

The plaintext module secret is shown only once.

The database retains only:

- secure prefix
- SHA-256 hash

Never store plaintext module secrets.

Never expose them through normal database reads.

==================================================
17. DEMO MODULE
==================================================

The Demo Module must continue working exactly through the existing public contracts.

It currently consumes:

issueModuleToken
verifyModuleToken
/api/v1/context
/api/v1/subscription
/api/v1/finance/*
getDemoSummary

After Phase 4, these should use the real persistent backend.

The existing:

Add Test Revenue
Add Test Expense

functionality must create real shared finance records.

Verify that the global dashboard updates correctly.

==================================================
18. REMOVE MOCK PERSISTENCE CAREFULLY
==================================================

Do not simply delete the mock store.

First implement the Supabase-backed versions of the existing /platform/lib methods.

Then replace the mock implementation behind those service boundaries.

The UI should require minimal or ideally zero changes.

After migration:

UI
↓
platform/lib/*
↓
Supabase

The UI should NOT become:

UI
↓
random Supabase queries

Keep the architecture clean.

==================================================
19. MIGRATION / SEED DATA
==================================================

Create proper Supabase SQL migrations.

Create seed data where necessary for:

- initial module definitions
- Demo Module
- existing platform configuration

Do not put real customer data into seeds.

Document how to run migrations and seeds.

==================================================
20. TESTING
==================================================

Run:

npm run build

Then test:

AUTH
- register
- login
- logout
- refresh/session persistence

TENANCY
- Company A sees A
- Company B sees B
- A cannot see B
- B cannot see A

RBAC
- platform_admin
- owner
- manager
- worker

MODULES
- catalogue
- activation
- My Modules
- access guard
- Demo Module

FINANCE
- revenue
- expenses
- idempotency
- module filtering
- global totals
- dashboard

BILLING
- subscription persistence
- access based on subscription

API
- context
- finance revenue
- finance expenses
- events
- subscription

SECURITY
- direct unauthorized API attempts
- direct Supabase queries where practical
- cross-company access attempts
- role escalation attempts

PWA/UI
- French
- English
- mobile
- desktop

==================================================
21. IMPORTANT REGRESSION RULE
==================================================

Do not redesign the existing application.

Do not change the visual system.

Do not change ModuleManifest.

Do not change the public SDK contracts.

Do not break existing API routes.

Do not build Hotel yet.

Do not build Garage yet.

Do not build Taxi yet.

Phase 4 is about making the existing KaziBox core REAL and SECURE.

==================================================
22. AI DEVELOPMENT REQUIREMENT
==================================================

Use AI aggressively to accelerate implementation.

However, review all generated:

- SQL
- RLS policies
- authentication
- authorization
- API handlers
- database queries
- secret handling

Do not blindly accept generated security code.

Prefer small, testable migrations rather than one giant rewrite.

==================================================
23. COMPLETION REPORT
==================================================

When finished, provide:

1. Exact migrations created
2. Tables created/changed
3. RLS policies created
4. Auth implementation changes
5. Company/team changes
6. Module changes
7. Billing changes
8. Finance changes
9. API changes
10. Webhook changes
11. Files changed
12. Environment variables required
13. Mock data removed/replaced
14. Tests performed
15. Cross-company security test results
16. npm run build result
17. Remaining production-hardening items

Do not claim Phase 4 is complete if RLS and cross-company isolation have not been tested.

START PHASE 4 IMPLEMENTATION NOW.

Work incrementally and keep the existing architecture intact.
## 1. Monorepo Organization & Workspaces
KaziBox is engineered as a clean TypeScript npm monorepo with strict package boundaries:

- **/platform**: The primary Next.js (App Router) web application and PWA shell. Manages authentication, workspace tenancy, team access control, platform settings, notification dispatch, centralized billing, and module orchestration.
- **/packages/ui (`@kazibox/ui`)**: Shared design system components. Enforces accessible UX, 44px+ touch targets, brand colors (White #FFFFFF, Primary Purple #6D28D9, Soft Purple #F3E8FF, Badge Yellow #FACC15 with Dark Text #1F2937), rounded card aesthetics, and subtle depth.
- **/packages/sdk (`@kazibox/sdk`)**: Shared TypeScript interfaces, integration contracts, role specifications, and standardized telemetry data exchange definitions. Used both by the core platform and external third-party module developers.
- **/modules/demo (`@kazibox/module-demo`)**: A starter template demonstrating how external modules plug into the platform shell while conforming to the PWA and SDK contract.
- **/docs**: Specifications, brief, and architectural documentation.

## 2. Multi-Tenancy & Role-Based Access Control (RBAC)
- **Company / Workspace Tenancy**: Every tenant is identified by a unique `company_id`. All resources (team members, preferences, module subscriptions, notifications) are strictly scoped to `company_id`.
- **Role-Based Access Control (RBAC)**:
  - `platform_admin`: Superuser across platform infrastructure. The **only** role allowed access to the Module Registry (`/admin/registry`).
  - `owner`: Workspace creator. Full access to workspace settings, centralized billing, team management, and all activated modules.
  - `manager`: Operational supervisor. Access to active modules, workspace settings, and notifications; **cannot manage billing or activate modules in the catalogue**.
  - `worker`: Frontline staff. Access strictly limited to active operational module workflows; no access to Team or Billing.
- **Supabase-Ready Data Layer**:
  - Located in `/platform/lib/` (`auth.ts`, `workspace.ts`, `team.ts`, `notifications.ts`, `modules.ts`, `billing.ts`, `registry.ts`).
  - Currently backed by a typed, persistent mock data store that mimics Supabase JavaScript client responses.
  - When Supabase is connected, these methods map 1:1 to `supabase.auth` and `supabase.from('...')` queries without modifying any UI screen or component.

---

## 3. Module Manifest Specification (`ModuleManifest`)
Each module publishes a declarative manifest adhering to `@kazibox/sdk`:

```typescript
export interface ModuleManifest {
  id: string;               // Unique namespace identifier (e.g., 'hotel-property')
  slug: string;             // URL-safe routing slug (e.g., 'hotel-property')
  name: string | { en: string; fr: string };
  version: string;          // Semantic version string (e.g., '1.2.0')
  tagline: string | { en: string; fr: string };
  logo: string;             // Emoji, SVG URL, or image path
  accentColor: string;      // Hex color for branding (e.g., '#6D28D9')
  entryUrl: string;         // Route within the platform shell (e.g., '/modules/hotel-property')
  menuItems: Array<{
    label: string | { en: string; fr: string };
    icon?: string;
    path: string;
    requiredRole?: UserRole;
  }>;
  scopes: string[];         // Required permissions (e.g., ['read:bookings', 'write:bookings'])
  languages: string[];      // Supported locales (must include at least ['fr', 'en'])
  summaryUrl: string;       // Endpoint for consolidated telemetry exchange
  webhookUrl: string;       // Platform event callback URL for activation/deactivation
  pwa: {
    scope: string;
    startUrl: string;
    themeColor: string;
    icons: Array<{
      src: string;
      sizes: string;
      type?: string;
      purpose?: string;
    }>;
  };

  // Administrative metadata
  kind?: 'internal' | 'external';
  status: 'draft' | 'review' | 'published' | 'suspended';
  developer?: string;
  pricePerMonth?: { amount: number; currency: string };
  features?: { en: string[]; fr: string[] } | string[];
  description?: { en: string; fr: string } | string;
  screenshots?: string[];
  demoVideoUrl?: string;
}
```

---

## 4. How Modules Are Registered
Modules are managed dynamically via the **Module Registry** (`/admin/registry`), strictly reserved for `platform_admin`.

1. **Registration & Manifest Ingestion**:
   - Internal and external third-party modules declare their configuration via the `ModuleManifest` specification.
   - The manifest JSON viewer/editor allows updating URLs, scopes, and parameters dynamically.
2. **PWA Compliance Checklist (Mandatory Gate)**:
   - A module **cannot** transition to `published` until all 6 criteria pass:
     1. *Manifest present*: Scope, start_url, and theme_color defined.
     2. *Icons compliant*: Includes 192px, 512px, and adaptive maskable icons.
     3. *Service Worker registered*: Cache strategy configured for offline resilience.
     4. *Strict HTTPS transport*: Secure endpoints for entry and webhooks.
     5. *Responsive touch targets*: Mobile ergonomics >= 44px touch targets.
     6. *Native bilingual support*: Both French (default) and English supported from Day 1.
   - Validated automatically via `runPwaChecks(manifest)`.
3. **API Key Generation & Secret Isolation**:
   - Platform admin generates API credentials per module.
   - The plaintext secret (`kz_live_sec_...`) is displayed **once** upon creation for the developer to copy.
   - Only a secure prefix (`kz_live_...`) and SHA-256 hash are retained in the database.
4. **Lifecycle State Transitions**:
   - `draft` ➔ `review` ➔ `published` (enabled only if 100% PWA compliant) ➔ `suspended`.

---

## 5. How Access Is Checked
Module access control is unified at both the data and UI layers:

1. **Access Query (`hasModuleAccess`)**:
   ```typescript
   export async function hasModuleAccess(companyId: string, moduleId: string): Promise<boolean>
   ```
   - Checks whether the workspace has an active subscription (`status === 'active' || status === 'expiring_soon'`).
   - If `planId === 'all_access'`, access is granted to all published modules.
   - Otherwise, checks whether `moduleId` is in `subscription.includedModuleIds`.
2. **Route Guard Component (`<RequireAccess moduleId="...">`)**:
   - Wraps every module route (e.g. `/modules/[slug]`).
   - If the workspace does not have access:
     - For workspace **owners**: renders an informative prompt with a direct call-to-action redirecting to the centralized billing plan selection (`/billing?plan=single&module=${moduleId}`).
     - For **managers and workers**: displays an access-restricted notice advising them to contact the workspace owner.
3. **Module Shell Isolation**:
   - Inside module routes, menu shortcuts "Mon Abonnement", "Renouveler", and "Changer de formule" **strictly redirect to `/billing`**.
   - Modules never duplicate or contain their own billing logic.

---

## 6. How Centralized Billing Works
Billing is fully centralized at the workspace level:

1. **One Consolidated Subscription**:
   - The workspace operates under **one single subscription and one single payment** regardless of whether it uses 1 or 5 modules.
   - Four structured plans:
     - **Single Module**: 1 core business module (15 000 XOF/month or 150 000 XOF/year).
     - **Bundle**: Up to 3 modules combined (35 000 XOF/month or 350 000 XOF/year).
     - **All Access**: Full access to all current and future catalogue modules (55 000 XOF/month or 550 000 XOF/year).
     - **Build Your Own (Custom)**: Pick individual modules; live calculator dynamically calculates totals with volume unit rates.
   - Monthly / yearly toggle with an annual discount (2 months free / 20% discount).
2. **Isolated Financial Streams (Core Architectural Rule)**:
   - **SaaS Subscription Flow**: Workspace owners pay KaziBox for platform and module access.
   - **Customer Merchant Flow**: End-customer business transactions (hotel room bookings, garage repairs, taxi rides) flow **directly to the merchant’s own payment gateway or cash register**. KaziBox never touches, taxes, or bundles end-customer operational funds.
3. **Mocked African Checkout & Integration Points**:
   - **Mobile Money**: Operator picker (Wave, Orange Money, MTN MoMo, Moov) and phone number input.
   - **Card**: Visa / Mastercard options.
   - **Waiting for Approval**: Simulates USSD push notification prompting the user for phone pin confirmation.
   - **Code Hooks**: Marked with `// TODO: Connect pawaPay Mobile Money API here (POST /v1/charges)` and `// TODO: Connect Card provider (Stripe / Paystack) here`.
4. **Subscription Lifecycle & Data Retention**:
   - Module activation occurs immediately upon subscription validation.
   - Module deactivation asks for confirmation and preserves tenant data: *"Vos données sont conservées pendant 30 jours"* / *"Your data is kept for 30 days"*.
   - In-app notifications are automatically dispatched for module activation, deactivation, subscription activation, renewals, and payment alerts.

---

## 7. Internationalization (i18n)
- Bilingual by default: French (`fr`) as the primary locale, English (`en`) as the secondary locale.
- Managed via `/platform/locales/fr.json` and `/platform/locales/en.json`.
- Dynamic translation helper `t(key)` supports nested keys with automatic fallback.
- No hardcoded UI strings in components.

---

## 8. Integration API & SSO Login Handoff (Phase 3)
1. **Public Integration API Handlers (`/api/v1/*`)**:
   - `GET /api/v1/context`: Tenant metadata, authenticated user, assigned role, language, and activated modules.
   - `POST /api/v1/finance/revenue`: Ingestion of merchant operational revenue with mandatory idempotency reference.
   - `POST /api/v1/finance/expenses`: Ingestion of operational expenses with idempotency reference.
   - `POST /api/v1/events`: Ingestion of domain activity events for audit and cross-module telemetry.
   - `GET /api/v1/subscription`: Real-time subscription validity check for the calling module.
2. **SSO Handoff Mechanism (`issueModuleToken` & `verifyModuleToken`)**:
   - Short-lived signed tokens (5 minutes TTL).
   - Encodes `userId`, `workspaceId`, `role`, `language`, `currency`, `moduleId`, `iat`, `exp`.
   - Verified via HMAC-SHA256 signature (migrating to asymmetric RS256 / JWKS in production Supabase).
   - Real signing keys reside strictly in server environment variables, never in browser bundles.

---

## 9. Shared Finance Ledger & Consolidated Dashboard
1. **Shared Finance Model (`/platform/lib/finance.ts`)**:
   - Records are strictly consolidated at the platform level (`workspaceId`, `moduleId`, `type`, `amount`, `currency`, `reference`, `occurredAt`).
   - Modules never write directly into each other's database tables.
   - Idempotency guarantees that re-transmitting the same reference never creates duplicate financial rows.
2. **Consolidated Dashboard (`/dashboard` & `/home`)**:
   - Filterable by date range (*Today*, *7 days*, *30 days*, *Custom*, *All*).
   - Consolidates total revenue, expenses, net margins, and active modules.
   - Queries exclusively through the public `getModuleSummaries` contract and shared finance functions (`getFinanceSummary`, `getFinanceByModule`, `getFinanceTimeline`).
   - Rendered with dynamic responsive SVG area/line trends and per-module metric breakdown cards.

---

## 10. Webhooks Engine & Queue
1. **Lifecycle Event Dispatches**:
   - `subscription.activated`, `subscription.expired`, `module.activated`, `module.deactivated`, `user.role_changed`.
2. **Payload Cryptographic Verification**:
   - Inbound requests signed via `x-kazibox-signature: sha256=<hex_digest>`.
3. **Queue & Administration (`/admin/webhooks`)**:
   - Gated strictly for `platform_admin`.
   - Tracks delivery status (`delivered`, `pending`, `failed`), attempt counts, and enables manual event retries.

---

## 11. Reference Demo Module (`/modules/demo` & `/m/demo`)
1. **Contract Isolation**:
   - Consumes exclusively the public contracts (`issueModuleToken` / `verifyModuleToken`, `/api/v1/context`, `/api/v1/subscription`, `/api/v1/finance/*`).
   - Exposes `getDemoSummary` conforming to `ModuleSummary` contract for platform dashboard ingestion.
2. **PWA Compliance**:
   - Registered in Module Registry with 100% score on the 6-point checklist.


