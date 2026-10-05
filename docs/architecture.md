# KaziBox — System Architecture & Modular Integration Guide

## 1. Monorepo Organization & Workspaces
KaziBox is engineered as a clean TypeScript npm monorepo with strict package boundaries:

- **/platform**: The primary Next.js (App Router) web application and PWA shell. Manages authentication, workspace tenancy, team access control, platform settings, notification dispatch, and module navigation orchestration.
- **/packages/ui (`@kazibox/ui`)**: Shared design system components. Enforces accessible UX, 44px+ touch targets, brand colors (White #FFFFFF, Primary Purple #6D28D9, Soft Purple #F3E8FF, Badge Yellow #FACC15 with Dark Text #1F2937), rounded card aesthetics, and subtle depth.
- **/packages/sdk (`@kazibox/sdk`)**: Shared TypeScript interfaces, integration contracts, role specifications, and standardized dashboard data exchange definitions. Used both by the core platform and external third-party module developers.
- **/modules/demo (`@kazibox/module-demo`)**: A starter template demonstrating how future modules plug into the platform shell while conforming to the PWA and SDK contract.
- **/docs**: Specifications, brief, and architectural documentation.

## 2. Multi-Tenancy & Data Model
- **Company / Workspace Tenancy**: Every tenant is identified by a unique `company_id`. All resources (team members, preferences, module subscriptions, notifications) are scoped to `company_id`.
- **Role-Based Access Control (RBAC)**:
  - `platform_admin`: Superuser across platform infrastructure.
  - `owner`: Workspace creator. Full access to workspace settings, billing, team management, and all activated modules.
  - `manager`: Operational supervisor. Access to modules, workspace settings, and notifications; cannot manage billing.
  - `worker`: Frontline staff. Access strictly limited to operational module workflows; no access to Team or Billing.
- **Supabase-Ready Data Layer**:
  - Located in `/platform/lib/` (`auth.ts`, `workspace.ts`, `team.ts`, `notifications.ts`).
  - Currently backed by a typed, persistent mock data store that mimics Supabase JavaScript client responses.
  - When Supabase is connected, these methods map 1:1 to `supabase.auth` and `supabase.from('...')` queries without modifying any UI screen or component.

## 3. Modular Integration Contract (Module API)
Each business module (e.g. Hotel, Garage, Taxi/Fleet) is an independent package or service that connects via the KaziBox SDK:
1. **Module Manifest (`ModuleManifest`)**:
   - `id`: unique namespace (e.g., `hotel-property`).
   - `name`: localized module title.
   - `icon`: visual brand identifier.
   - `route`: root path prefix within the workspace shell (`/modules/[moduleId]`).
   - `requiredPermissions`: role levels required for administration vs. operational usage.
2. **Consolidated Dashboard Exchange (`DashboardWidgetContract`)**:
   - Modules publish summary telemetry (daily gross revenue, daily expenses, pending tasks/alerts).
   - The platform home dashboard aggregates these telemetry points into a consolidated executive overview.
3. **PWA Compliance**:
   - Every module must maintain responsive touch targets >= 44px, standalone display compatibility, and offline status indicators.
4. **Isolated Financial Streams**:
   - SaaS subscription payments are handled through KaziBox centralized billing.
   - Merchant revenues (guest hotel bookings, garage repair payments) flow directly into tenant-configured payment gateways.

## 4. Internationalization (i18n)
- Bilingual by default: French (`fr`) as the primary locale, English (`en`) as the secondary locale.
- Managed via `/platform/locales/fr.json` and `/platform/locales/en.json`.
- Dynamic translation helper `t(key)` supports nested keys with automatic fallback.
- Future languages (e.g., Spanish, Portuguese, Arabic) require only an additional JSON locale file without code changes.
