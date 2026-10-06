# KaziBox — Third-Party Module Developer & Integration Guide

Welcome to the KaziBox Developer Ecosystem. This guide covers how to build, register, authenticate, and connect a business SaaS module to the KaziBox African multi-tenant platform.

---

## 1. Core Principles

1. **Modular Architecture**: KaziBox provides the workspace shell, unified billing, authentication, and consolidated reporting. Your module handles vertical business operations (e.g., Garage repairs, Pharmacy prescriptions, Salon bookings).
2. **Strict Financial Stream Isolation**: KaziBox never taxes or touches end-customer operational transactions. Customer payments flow 100% to your merchant accounts. Only the software subscription fee is handled by KaziBox.
3. **Mandatory PWA Standard**: Every module must be installable and mobile-responsive (manifest, service worker, icons, >= 44px touch targets).

---

## 2. Module Manifest Contract (`ModuleManifest`)

Every module declares its metadata in a declarative JSON manifest adhering to `@kazibox/sdk`:

```json
{
  "id": "my-salon",
  "slug": "my-salon",
  "name": {
    "fr": "Salon & Coiffure Pro",
    "en": "Hair Salon & Spa Pro"
  },
  "version": "1.0.0",
  "tagline": {
    "fr": "Rendez-vous, prestations, gestion des coiffeurs et caisse",
    "en": "Bookings, styling services, staff commission and register"
  },
  "logo": "✂️",
  "accentColor": "#EC4899",
  "entryUrl": "/modules/my-salon",
  "menuItems": [
    { "label": { "fr": "Rendez-vous", "en": "Appointments" }, "path": "/modules/my-salon/appointments" },
    { "label": { "fr": "Prestations", "en": "Services" }, "path": "/modules/my-salon/services" }
  ],
  "scopes": ["read:context", "write:finance", "write:events", "read:subscription"],
  "languages": ["fr", "en"],
  "summaryUrl": "https://mysalon.com/api/summary",
  "webhookUrl": "https://mysalon.com/api/webhooks/kazibox",
  "pwa": {
    "scope": "/modules/my-salon",
    "startUrl": "/modules/my-salon",
    "themeColor": "#EC4899",
    "icons": [
      { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
      { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
    ]
  }
}
```

---

## 3. Registering Your Module & Generating API Keys

1. Navigate to the **Platform Admin Registry** (`/admin/registry`).
2. Add your module manifest JSON.
3. Validate the **6-point PWA Checklist** (Manifest, Icons, Service Worker, HTTPS, Touch Targets, Bilingual Support).
4. Generate an API Key. Copy the plaintext secret (`kz_live_..._sec_...`). It is shown strictly **once**.

---

## 4. Single Sign-On (SSO) Login Handoff

When a user opens your module from the sidebar, the platform passes a 5-minute SSO token via URL parameter: `https://yourmodule.com?token=eyJ...`.

### Token Verification Code Example (Node.js):
```typescript
import { createHmac } from 'crypto';

export function verifyKaziBoxToken(token: string, ssoSecret: string) {
  const [headerB64, payloadB64, signature] = token.split('.');
  
  // Verify HMAC signature
  const expectedSignature = createHmac('sha256', ssoSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  // Verify TTL (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload; // { userId, userName, workspaceId, role, currency, language, moduleId }
}
```

---

## 5. Integration API Endpoints

All endpoints require your module API key in the `Authorization` header:
`Authorization: Bearer kz_live_...`

### A. GET `/api/v1/context`
Fetches tenant context, current user, active role, language, and subscribed modules.
- **Required Scope**: `read:context`
- **Request Example**:
```bash
curl -X GET "https://platform.kazibox.com/api/v1/context" \
  -H "Authorization: Bearer kz_live_demo_sec_9999999999" \
  -H "X-Workspace-Id: ws-palmeraie-01"
```
- **Response (200 OK)**:
```json
{
  "workspace": {
    "id": "ws-palmeraie-01",
    "company_id": "ws-palmeraie-01",
    "name": "Hôtel & Résidence Palmeraie",
    "country": "Côte d’Ivoire",
    "currency": "XOF",
    "language": "fr"
  },
  "user": {
    "id": "usr-owner-01",
    "name": "Mamadou Diallo",
    "email": "owner@palmeraie.com",
    "role": "owner"
  },
  "role": "owner",
  "language": "fr",
  "currency": "XOF",
  "activatedModules": ["hotel-property", "demo"]
}
```

---

### B. POST `/api/v1/finance/revenue`
Records operational revenue in the workspace shared ledger for the consolidated dashboard.
- **Required Scope**: `write:finance`
- **Idempotency**: Providing the same `reference` returns the existing record (HTTP 200).
- **Request Example**:
```bash
curl -X POST "https://platform.kazibox.com/api/v1/finance/revenue" \
  -H "Authorization: Bearer kz_live_demo_sec_9999999999" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "demo",
    "amount": 25000,
    "currency": "XOF",
    "source": "Prestation coupe et brushing",
    "occurredAt": "2026-10-06T10:30:00Z",
    "reference": "REF-INV-2026-0091"
  }'
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "isDuplicate": false,
  "record": {
    "id": "fin-rev-1728219...",
    "workspaceId": "ws-palmeraie-01",
    "moduleId": "demo",
    "type": "revenue",
    "amount": 25000,
    "currency": "XOF",
    "reference": "REF-INV-2026-0091"
  }
}
```

---

### C. POST `/api/v1/finance/expenses`
Records operational expenses in the shared ledger.
- **Required Scope**: `write:finance`
- **Request Example**:
```bash
curl -X POST "https://platform.kazibox.com/api/v1/finance/expenses" \
  -H "Authorization: Bearer kz_live_demo_sec_9999999999" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "demo",
    "amount": 8500,
    "currency": "XOF",
    "category": "Achat shampoing et matériel",
    "occurredAt": "2026-10-06T11:00:00Z",
    "reference": "REF-EXP-2026-0044"
  }'
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "isDuplicate": false,
  "record": {
    "id": "fin-exp-1728220...",
    "amount": 8500,
    "currency": "XOF",
    "reference": "REF-EXP-2026-0044"
  }
}
```

---

### D. POST `/api/v1/events`
Ingests operational business events for activity auditing and real-time alerts.
- **Required Scope**: `write:events`
- **Request Example**:
```bash
curl -X POST "https://platform.kazibox.com/api/v1/events" \
  -H "Authorization: Bearer kz_live_demo_sec_9999999999" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "demo",
    "action": "appointment.confirmed",
    "entity": "appointment",
    "entityId": "apt-882",
    "details": { "client": "Awa Traoré", "stylist": "Moussa" }
  }'
```

---

### E. GET `/api/v1/subscription`
Checks whether the calling workspace has an active subscription to your module.
- **Required Scope**: `read:subscription`
- **Request Example**:
```bash
curl -X GET "https://platform.kazibox.com/api/v1/subscription" \
  -H "Authorization: Bearer kz_live_demo_sec_9999999999" \
  -H "X-Workspace-Id: ws-palmeraie-01"
```
- **Response (200 OK)**:
```json
{
  "workspaceId": "ws-palmeraie-01",
  "moduleId": "demo",
  "hasAccess": true,
  "planId": "single",
  "status": "active",
  "billingCycle": "monthly",
  "validUntil": "2026-11-01T00:00:00Z"
}
```

---

## 6. Webhooks & Signature Verification

KaziBox dispatches real-time webhooks for platform lifecycle events:
- `subscription.activated`
- `subscription.expired`
- `module.activated`
- `module.deactivated`
- `user.role_changed`

All webhook POST requests include the `x-kazibox-signature` header (`sha256=<hex_digest>`).

### Webhook Verification Code Example:
```typescript
import { createHmac } from 'crypto';

export function verifyWebhookSignature(rawBody: string, headerSignature: string, webhookSecret: string): boolean {
  const hash = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const expected = `sha256=${hash}`;
  return headerSignature === expected;
}
```

---

---

## 7. Module Summary Endpoint Contract (`summaryUrl`)

To display live operational widgets on the consolidated dashboard without granting KaziBox direct database access, your module must expose an HTTP endpoint (or `@kazibox/sdk` function) matching `summaryUrl`:

- **HTTP Method**: `GET`
- **Request Headers**: `Authorization: Bearer <kazibox_api_key>`, `X-Workspace-Id: <company_id>`
- **Response Format (JSON 200 OK)**:
```json
{
  "moduleId": "my-salon",
  "companyId": "ws-palmeraie-01",
  "revenue": 345000,
  "expenses": 65000,
  "activityCount": 18,
  "currency": "XOF",
  "lastUpdated": "2026-10-06T12:00:00Z",
  "metrics": [
    {
      "id": "apt-today",
      "moduleId": "my-salon",
      "label": {
        "fr": "Rendez-vous du jour",
        "en": "Today's Appointments"
      },
      "value": "12 / 16",
      "trend": "up"
    },
    {
      "id": "chairs-active",
      "moduleId": "my-salon",
      "label": {
        "fr": "Fauteuils occupés",
        "en": "Occupied Chairs"
      },
      "value": "4 / 5",
      "trend": "neutral"
    }
  ]
}
```

---

## 8. PWA Compliance Standards (Mandatory Checklist)

Before any module can transition from `draft` to `published` in the Platform Registry, it must pass all 6 compliance gates:

1. **Web App Manifest (`manifest.json`)**:
   Must define `name`, `short_name`, `start_url`, `display: "standalone"`, `theme_color`, and `background_color`.
2. **App Icons Set**:
   Must include at least `192x192` PNG icon, `512x512` PNG icon, and an adaptive `maskable` icon.
3. **Service Worker Registration**:
   Must register a service worker implementing an offline cache fallback strategy.
4. **Strict HTTPS & Transport Security**:
   All endpoints (`entryUrl`, `summaryUrl`, `webhookUrl`) must be served exclusively over TLS (HTTPS).
5. **Ergonomic Touch Targets (>= 44px)**:
   All buttons, inputs, and interactive controls must adhere to WCAG mobile ergonomics (minimum 44x44px touch bounding box).
6. **Bilingual FR/EN Day-One Support**:
   All UI strings, labels, and error messages must support French (default) and English.

---

## 9. Step-by-Step Tutorial: Connect Your First Module

1. **Step 1: Create Manifest**: Define your `ModuleManifest` object with unique ID, routes, scopes, and PWA icons.
2. **Step 2: Submit to Registry**: Provide the manifest at `/admin/registry`. Ensure all 6 PWA checks pass.
3. **Step 3: Retrieve API Key**: Store the secret in your server environment (`KAZIBOX_API_KEY`).
4. **Step 4: Implement SSO Route**: Accept `?token=...` on your entry URL, verify the 5-minute TTL, and establish the user session.
5. **Step 5: Emit Shared Finance**: On every invoice, call `POST /api/v1/finance/revenue` with your unique reference.
6. **Step 6: Listen for Webhooks**: Implement a webhook route validating `x-kazibox-signature` to respond to activations or deactivations.
7. **Step 7: Implement Summary**: Expose your `summaryUrl` endpoint to provide telemetry to the workspace consolidated dashboard.
