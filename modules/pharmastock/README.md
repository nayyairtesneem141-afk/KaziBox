# PharmaStock — Reference SaaS Integration & DigitalOcean Runbook

PharmaStock is the reference SaaS vertical module for pharmacy, dispensary, and medication inventory management built on the **KaziBox SaaS Integration Kit** (`@kazibox/sdk`).

---

## 1. Features

- **Batch & Expiry Control**: Multi-batch medication inventory tracking with automated FIFO dispensing and expiration threshold alerts (< 30, 60, 90 days).
- **Sales Counter & Prescriptions**: Rapid point-of-sale counter and doctor prescription fulfillment.
- **Unified Finance Sync**: Idempotent synchronization of daily sales revenue and restock purchase expenses to the KaziBox platform ledger.
- **KaziBox SSO Handshake**: Instant login via 5-minute cryptographically signed tokens from the KaziBox workspace shell.
- **Multi-Tenant Isolation**: Strict logical data isolation partitioned by `company_id`.
- **Installable PWA**: Responsive on tablets, smartphones, and desktop computers with offline caching.

---

## 2. Directory Structure

```
modules/pharmastock/
├── src/
│   ├── manifest.ts     # Standard ModuleManifest with 6-point PWA compliance
│   ├── inventory.ts    # Multi-tenant pharmacy domain model (batches, sales, restock)
│   ├── client.ts       # Configured KaziBoxClient instance
│   ├── summary.ts      # Live ModuleSummary & ConsolidatedMetric telemetry generator
│   ├── finance.ts      # Shared revenue and expense synchronization coordinator
│   ├── webhooks.ts     # HMAC-verified webhook handler for KaziBox lifecycle events
│   ├── sso.ts          # 5-minute SSO token handoff verifier and session builder
│   └── index.ts        # Module exports
├── Dockerfile          # Production multi-stage Docker build (Node 20 Alpine, non-root)
├── .dockerignore       # Clean container build ignore
├── digitalocean.app.yaml # DigitalOcean App Platform deployment spec
├── .env.example        # Environment variable documentation
└── package.json        # Workspace package definition
```

---

## 3. DigitalOcean Deployment Runbook

### Prerequisites
1. DigitalOcean account with access to App Platform or a Droplet.
2. Production credentials obtained from KaziBox Platform Registry (`/admin/registry`):
   - `KAZIBOX_API_KEY`
   - `KAZIBOX_API_URL`
   - `KAZIBOX_SSO_SECRET`
   - `KAZIBOX_WEBHOOK_SECRET`

### Option A: DigitalOcean App Platform (Recommended)
1. In DigitalOcean Control Panel, navigate to **Apps** > **Create App**.
2. Select your GitHub repository (`KaziBox`) and branch (`main`).
3. App Platform will detect `digitalocean.app.yaml` or you can import it directly.
4. Configure the environment variables in App Platform settings:
   - `NODE_ENV`: `production`
   - `PORT`: `3000`
   - `KAZIBOX_API_KEY`: `<Your production secret API key>`
   - `KAZIBOX_API_URL`: `https://platform.kazibox.com`
   - `KAZIBOX_SSO_SECRET`: `<Shared SSO HMAC secret>`
   - `KAZIBOX_WEBHOOK_SECRET`: `<Shared Webhook secret>`
5. Click **Deploy**. App Platform builds the container using `modules/pharmastock/Dockerfile` and provisions the service in the `fra` (Frankfurt) or `ams` (Amsterdam) datacenter.

### Option B: Docker Container Deployment (Droplet or VPS)

```bash
# Build the production container
docker build -t kazibox-pharmastock:latest -f modules/pharmastock/Dockerfile .

# Run the container
docker run -d \
  --name pharmastock \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  kazibox-pharmastock:latest
```

---

## 4. Health Check & Monitoring

- **Endpoint**: `GET /api/health`
- **Expected Status**: `200 OK`
- The container image includes a native Docker `HEALTHCHECK` running every 30 seconds.
