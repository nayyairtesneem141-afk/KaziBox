# KaziBox — Security Architecture & Production Hardening Guide

This document details the security principles implemented in KaziBox and the mandatory checklist for transitioning from the typed mock data layer to production Supabase infrastructure.

---

## 1. Secrets & Key Isolation Principles

1. **Server-Side Environment Variables Only**:
   - Master signing keys (SSO asymmetric private keys, webhook HMAC secrets, database credentials, payment provider secrets) must live strictly in server environment variables (e.g. `process.env.KAZIBOX_SSO_PRIVATE_KEY`).
   - **Never** expose secrets to client-side bundles (e.g. `NEXT_PUBLIC_*` prefixes are prohibited for any confidential material).
   - Module developers only receive a public key / JWKS URL to verify tokens.

2. **One-Time API Key Generation & Hashing**:
   - Module API secrets (`kz_live_..._sec_...`) are shown **once** to the developer upon creation in the Module Registry.
   - The platform core never logs plaintext secrets and stores only a secure prefix and a cryptographic hash (SHA-256 / bcrypt).

3. **Rate Limiting**:
   - Integration API endpoints (`/api/v1/*`) enforce sliding window token-bucket rate limits per API key (default: 60 requests/minute).
   - In production, distribute this counter across Redis (e.g. Upstash Redis / Cloudflare KV).

4. **Input Schema Validation**:
   - All inbound payloads are validated against strict TypeScript schemas before processing.
   - Malformed data or unknown parameters trigger a 422 Unprocessable Entity with explicit field diagnostics.

---

## 2. Mandatory Supabase Migration Checklist

When connecting real Supabase PostgreSQL instances, the following measures must be strictly verified:

### A. Row-Level Security (RLS) on Every Table
Enable RLS on all tables without exception:
```sql
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_api_keys ENABLE ROW LEVEL SECURITY;
```

Tenant isolation policy example:
```sql
CREATE POLICY tenant_isolation_policy ON finance_records
  FOR ALL
  USING (workspace_id = auth.jwt() ->> 'company_id')
  WITH CHECK (workspace_id = auth.jwt() ->> 'company_id');
```

### B. SSO Cryptographic Upgrade
- Replace the mock HMAC SHA-256 signer in `platform/lib/sso.ts` with asymmetric RS256 or EdDSA (using `jose` / `jsonwebtoken`).
- Expose a standard OpenID Connect discovery document and JWKS endpoint (`/.well-known/jwks.json`) so external modules can verify tokens without shared symmetric secrets.

### C. Server-Side Payment Gateway Verification
- Verify pawaPay mobile money webhook signatures using the official cryptographic header:
  ```typescript
  const signature = req.headers.get('x-pawapay-signature');
  const isValid = verifyPawaPaySignature(rawBody, signature, process.env.PAWAPAY_WEBHOOK_SECRET);
  ```
- Reject unauthenticated deposit status updates.

### D. Multi-Tenant Penetration & Bleed Testing
- Run automated security test suites against at least two separate test tenants (`ws-tenant-alpha` and `ws-tenant-beta`).
- Verify that API keys and queries originating from `ws-tenant-alpha` are completely rejected when attempting to read or write financial, subscription, or membership records belonging to `ws-tenant-beta`.
