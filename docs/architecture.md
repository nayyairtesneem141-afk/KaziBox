# KaziBox — System Architecture & Modular Integration Guide

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
