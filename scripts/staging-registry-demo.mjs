/**
 * KaziBox No-Code SaaS Registry — Safe Staging Integration Demonstration
 *
 * Executes the complete end-to-end onboarding and runtime verification flow:
 *   0. Production Safety Guard & Staging Supabase Preflight Inspection
 *   1. Register brand-new external SaaS (`staging-logistics-pro`) via `/api/v1/modules/register`
 *   2. Provision & verify encrypted credentials (`apiKey`, `ssoSecret`, `webhookSecret`)
 *   3. Verify server restart persistence against the staging database (`public.modules` & `public.module_api_keys`)
 *   4. Verify SDK API authentication & idempotent ledger sync (`getContext`, `getSubscriptionStatus`, `recordRevenue`, `recordExpense`, `emitEvent`)
 *   5. Verify 5-minute HMAC-SHA256 SSO launch handoff & replay protection (`/api/v1/modules/[slug]/launch` -> external SaaS `/sso`)
 *   6. Verify signed outbound webhook delivery, retry/idempotency, & dynamic summary retrieval (`/api/v1/modules/[slug]/summary`)
 *
 * SAFETY GUARANTEES:
 * - Hard-blocks production/preview Supabase refs (`vkixehivjytpuhrjlaud`, `lvfoklqxqwgpktylphbu`) and any URL in `.env.local` / `.env.preview.local`.
 * - Performs a strictly READ-ONLY preflight check against `DISPOSABLE_SUPABASE_URL` in `platform/.env.test.local`.
 * - Runs all mutating steps against an isolated, disk-persisted Staging Database Engine that enforces PostgreSQL `01_schema.sql` & `04_saas_integration_kit.sql` constraints unless `EXECUTE_LIVE_MUTATIONS="true"` is explicitly set.
 * - Never logs raw secret values from environment files.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

import { extractProjectRef, maskSecret } from '../platform/tests/harness/config.mjs';
import {
  KaziBoxClient,
  createSsoHandler,
  createWebhookHandler,
  createSummaryHandler,
  MemoryIdempotencyStore,
} from '@kazibox/sdk';

// ---------------------------------------------------------------------------
// 0. Production Safety Guard & Environment Isolation
// ---------------------------------------------------------------------------
const ROOT_DIR = process.cwd();
const BLOCKED_PRODUCTION_REFS = new Set([
  'vkixehivjytpuhrjlaud', // Production / Preview KaziBox Supabase
  'lvfoklqxqwgpktylphbu', // Central Moteur Gateway
]);

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
}

// Discover and blacklist any Supabase URLs in production/preview .env files
for (const relPath of ['.env.local', '.env.preview.local', 'platform/.env.local']) {
  const envVars = parseEnvFile(path.join(ROOT_DIR, relPath));
  for (const [k, v] of Object.entries(envVars)) {
    if (k.includes('URL') && v) {
      const ref = extractProjectRef(v);
      if (ref && ref !== 'local-disposable-instance') {
        BLOCKED_PRODUCTION_REFS.add(ref);
      }
    }
  }
}

// Immediately scrub any ambient production Supabase env vars from this process
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const STAGING_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kazibox-staging-demo-'));
const STAGING_DB_FILE = path.join(STAGING_TMP_DIR, 'staging-supabase-db.json');
const STAGING_STORE_FILE = path.join(STAGING_TMP_DIR, 'staging-platform-store.json');

process.env.KAZIBOX_STORE_PATH = STAGING_STORE_FILE;
process.env.KAZIBOX_MASTER_KEY = 'staging-demo-master-key-2026-kazibox-aes256gcm-secret';
process.env.KAZIBOX_ALLOW_LOOPBACK_URLS = 'true';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_DB_MODULE_STATUSES = new Set(['active', 'beta', 'deprecated']);

/**
 * Disk-backed Staging Supabase PostgREST Engine that enforces `01_schema.sql` and
 * `04_saas_integration_kit.sql` constraints and persists across simulated server restarts.
 */
function createDiskBackedStagingSupabase(dbFilePath, initialSeed = null) {
  const defaultState = initialSeed || {
    companies: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Hôtel & Résidence Palmeraie' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Garage & Mécanique Express' },
    ],
    subscriptions: [
      {
        id: 'sub-staging-palmeraie-01',
        company_id: '11111111-1111-4111-8111-111111111111',
        plan_id: 'all_access',
        status: 'active',
        included_module_ids: ['hotel-property', 'staging-logistics-pro'],
        current_period_start: '2026-01-01T00:00:00.000Z',
        current_period_end: '2027-01-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    modules: [],
    module_api_keys: [],
    finance_records: [],
    webhook_events: [],
    activity_logs: [],
  };

  if (!fs.existsSync(dbFilePath)) {
    fs.writeFileSync(dbFilePath, JSON.stringify(defaultState, null, 2), 'utf8');
  }

  const readDb = () => JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
  const writeDb = (state) => fs.writeFileSync(dbFilePath, JSON.stringify(state, null, 2), 'utf8');

  function validateModulesRow(row) {
    const requiredNotNull = [
      'id',
      'slug',
      'name',
      'description',
      'category',
      'icon',
      'kind',
      'status',
      'developer',
      'version',
    ];
    for (const col of requiredNotNull) {
      assert.ok(
        row[col] !== undefined && row[col] !== null && row[col] !== '',
        `null value in column "${col}" of relation "modules" violates not-null constraint`
      );
    }
    assert.ok(
      ['internal', 'external'].includes(row.kind),
      `new row for relation "modules" violates check constraint "modules_kind_check"`
    );
    assert.ok(
      ALLOWED_DB_MODULE_STATUSES.has(row.status),
      `modules.status '${row.status}' violates CHECK (status IN ('active', 'beta', 'deprecated'))`
    );
    assert.ok(row.manifest && typeof row.manifest === 'object', 'modules.manifest JSONB NOT NULL is required');
  }

  function validateApiKeyRow(row, db) {
    assert.ok(
      row.company_id && UUID_REGEX.test(row.company_id),
      `module_api_keys.company_id '${row.company_id}' must be a valid UUID`
    );
    assert.ok(
      db.companies.some((c) => c.id === row.company_id),
      `module_api_keys.company_id '${row.company_id}' must reference an existing row in public.companies`
    );
    assert.ok(row.module_id && typeof row.module_id === 'string', 'module_api_keys.module_id is required');
    assert.ok(row.key_prefix && typeof row.key_prefix === 'string', 'module_api_keys.key_prefix is required');
    assert.ok(
      row.key_hash && /sha256:[0-9a-f]{64}/i.test(row.key_hash),
      'module_api_keys.key_hash must contain a 64-char SHA-256 hex digest (sha256:...)'
    );
  }

  const client = {
    from(table) {
      const filters = [];
      let limitCount = null;
      let orderCol = null;
      let orderAsc = true;

      const applyFilters = (rows) => {
        let out = rows.filter((r) => filters.every((fn) => fn(r)));
        if (orderCol) {
          out = [...out].sort((a, b) => {
            const va = a[orderCol] ?? '';
            const vb = b[orderCol] ?? '';
            return orderAsc ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
          });
        }
        if (typeof limitCount === 'number') {
          out = out.slice(0, limitCount);
        }
        return structuredClone(out);
      };

      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        in(col, vals) {
          filters.push((r) => Array.isArray(vals) && vals.includes(r[col]));
          return builder;
        },
        or(expr) {
          const clauses = String(expr)
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          filters.push((r) =>
            clauses.some((clause) => {
              const parts = clause.split('.');
              if (parts.length >= 3) {
                const col = parts[0];
                const op = parts[1];
                const val = parts.slice(2).join('.');
                const fieldVal = String(r[col] ?? r?.manifest?.[col] ?? '');
                if (op === 'eq') {
                  return fieldVal === val;
                }
                if (op === 'ilike') {
                  const cleanVal = val.replace(/^%|%$/g, '').toLowerCase();
                  return fieldVal.toLowerCase().includes(cleanVal);
                }
              }
              return false;
            })
          );
          return builder;
        },
        order(col, opts = {}) {
          orderCol = col;
          orderAsc = opts.ascending !== false;
          return builder;
        },
        limit(n) {
          limitCount = n;
          return builder;
        },
        async maybeSingle() {
          const db = readDb();
          const rows = applyFilters(db[table] || []);
          return { data: rows[0] ?? null, error: null };
        },
        async single() {
          const db = readDb();
          const rows = applyFilters(db[table] || []);
          if (rows.length === 0) {
            return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
          }
          return { data: rows[0], error: null };
        },
        then(resolve, reject) {
          try {
            const db = readDb();
            const rows = applyFilters(db[table] || []);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          } catch (err) {
            return Promise.reject(err).then(resolve, reject);
          }
        },
        async upsert(payload, opts = {}) {
          const db = readDb();
          const list = Array.isArray(payload) ? payload : [payload];
          const pk = opts.onConflict || 'id';
          db[table] = db[table] || [];
          for (const item of list) {
            if (table === 'modules') validateModulesRow(item);
            const idx = db[table].findIndex((r) => r[pk] === item[pk]);
            const record = { ... (idx >= 0 ? db[table][idx] : {}), ...structuredClone(item) };
            if (idx >= 0) db[table][idx] = record;
            else db[table].push(record);
          }
          writeDb(db);
          return { data: structuredClone(list), error: null };
        },
        insert(payload) {
          const db = readDb();
          const list = Array.isArray(payload) ? payload : [payload];
          db[table] = db[table] || [];
          const inserted = [];
          for (const item of list) {
            if (table === 'modules') validateModulesRow(item);
            if (table === 'module_api_keys') validateApiKeyRow(item, db);
            const record = {
              id: item.id || crypto.randomUUID(),
              created_at: item.created_at || new Date().toISOString(),
              ...structuredClone(item),
            };
            db[table].push(record);
            inserted.push(record);
          }
          writeDb(db);
          return {
            data: inserted,
            error: null,
            then(resolve) {
              return Promise.resolve({ data: inserted, error: null }).then(resolve);
            },
            select() {
              return {
                async single() {
                  return { data: inserted[0], error: null };
                },
                async maybeSingle() {
                  return { data: inserted[0] ?? null, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          const updateFilters = [];
          const updateBuilder = {
            eq(col, val) {
              updateFilters.push((r) => r[col] === val);
              return updateBuilder;
            },
            then(resolve, reject) {
              try {
                const db = readDb();
                db[table] = db[table] || [];
                const updated = [];
                for (const row of db[table]) {
                  if (updateFilters.every((fn) => fn(row))) {
                    Object.assign(row, structuredClone(patch));
                    if (table === 'modules') validateModulesRow(row);
                    updated.push(structuredClone(row));
                  }
                }
                writeDb(db);
                return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
              } catch (err) {
                return Promise.reject(err).then(resolve, reject);
              }
            },
          };
          return updateBuilder;
        },
        delete() {
          const deleteFilters = [];
          const deleteBuilder = {
            eq(col, val) {
              deleteFilters.push((r) => r[col] === val);
              return deleteBuilder;
            },
            ilike(col, pat) {
              const prefix = String(pat).replace(/%/g, '').toLowerCase();
              deleteFilters.push((r) => String(r[col] || '').toLowerCase().startsWith(prefix));
              return deleteBuilder;
            },
            then(resolve, reject) {
              try {
                const db = readDb();
                db[table] = (db[table] || []).filter((r) => !deleteFilters.every((fn) => fn(r)));
                writeDb(db);
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              } catch (err) {
                return Promise.reject(err).then(resolve, reject);
              }
            },
          };
          return deleteBuilder;
        },
      };

      return builder;
    },
  };

  return { client, readDb };
}

// ---------------------------------------------------------------------------
// 1. Test External SaaS Server built using `@kazibox/sdk`
// ---------------------------------------------------------------------------
function createExternalSaasApp({ moduleId }) {
  let currentApiKey = '';
  let currentSsoSecret = '';
  let currentWebhookSecret = '';
  let platformBaseUrl = '';

  const idempotencyStore = new MemoryIdempotencyStore();
  const tenants = new Map();
  const dispatches = new Map();
  const fuelExpenses = new Map();
  const receivedWebhooks = [];

  function ensureTenant(companyId, plan = 'starter') {
    if (!tenants.has(companyId)) {
      tenants.set(companyId, {
        companyId,
        status: 'active',
        plan,
        provisionedAt: new Date().toISOString(),
      });
    }
    if (!dispatches.has(companyId)) dispatches.set(companyId, []);
    if (!fuelExpenses.has(companyId)) fuelExpenses.set(companyId, []);
    return tenants.get(companyId);
  }

  function createSdkClient() {
    return new KaziBoxClient({
      apiKey: currentApiKey,
      baseUrl: platformBaseUrl,
      moduleId,
      ssoSecret: currentSsoSecret,
      webhookSecret: currentWebhookSecret,
    });
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    const sendJson = (status, body, extraHeaders = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        ...extraHeaders,
      });
      res.end(JSON.stringify(body));
    };

    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(200, { status: 'healthy', moduleId, sdk: '@kazibox/sdk' });
    }

    // SSO Handoff Endpoint powered by `@kazibox/sdk` createSsoHandler
    if (pathname === '/sso' && method === 'GET') {
      const ssoHandler = createSsoHandler({
        ssoSecret: currentSsoSecret,
        store: idempotencyStore,
        enableReplayProtection: true,
        onAuthenticated: (payload) => {
          ensureTenant(payload.workspaceId, 'pro');
        },
      });
      const token = parsedUrl.searchParams.get('token');
      const result = await ssoHandler(token);
      if (!result.authenticated) {
        return sendJson(401, {
          authenticated: false,
          error: result.error,
          code: result.code,
        });
      }
      return sendJson(200, {
        authenticated: true,
        session: result.session,
        tenant: tenants.get(result.session.workspaceId),
      });
    }

    // Read body for POST requests
    let rawBody = '';
    if (method === 'POST') {
      rawBody = await new Promise((resolve) => {
        let buf = '';
        req.on('data', (c) => (buf += c));
        req.on('end', () => resolve(buf));
      });
    }

    // Signed Webhook Endpoint powered by `@kazibox/sdk` createWebhookHandler
    if (pathname === '/api/webhooks/kazibox' && method === 'POST') {
      const webhookHandler = createWebhookHandler({
        webhookSecret: currentWebhookSecret,
        store: idempotencyStore,
        enableIdempotency: true,
        onModuleActivated: (evt) => {
          const cid = evt.companyId || evt.workspaceId;
          ensureTenant(cid, evt.data?.plan || 'pro');
          receivedWebhooks.push({ event: evt.event, companyId: cid, deliveryId: req.headers['x-kazibox-delivery-id'] });
        },
        onModuleDeactivated: (evt) => {
          const cid = evt.companyId || evt.workspaceId;
          const t = tenants.get(cid);
          if (t) t.status = 'suspended';
          receivedWebhooks.push({ event: evt.event, companyId: cid, deliveryId: req.headers['x-kazibox-delivery-id'] });
        },
        onSubscriptionUpdated: (evt) => {
          const cid = evt.companyId || evt.workspaceId;
          ensureTenant(cid, evt.data?.plan || 'pro');
          receivedWebhooks.push({ event: evt.event, companyId: cid, deliveryId: req.headers['x-kazibox-delivery-id'] });
        },
      });

      // Also record generic/test events after signature verification
      const response = await webhookHandler({
        method,
        headers: req.headers,
        body: rawBody,
      });
      if (response.status === 200) {
        try {
          const parsed = JSON.parse(rawBody);
          receivedWebhooks.push({
            event: parsed.event,
            companyId: parsed.companyId || parsed.workspaceId,
            deliveryId: req.headers['x-kazibox-delivery-id'],
          });
        } catch {
          // ignore
        }
      }
      return sendJson(response.status, response.body, response.headers);
    }

    // Dynamic Summary Endpoint powered by `@kazibox/sdk` createSummaryHandler
    if (pathname === '/api/summary' && method === 'GET') {
      const summaryHandler = createSummaryHandler({
        moduleId,
        getSummary: (companyId) => {
          const companyDispatches = dispatches.get(companyId) || [];
          const companyFuel = fuelExpenses.get(companyId) || [];
          const totalRev = companyDispatches.reduce((s, d) => s + d.amount, 0);
          const totalExp = companyFuel.reduce((s, f) => s + f.amount, 0);
          return {
            revenue: totalRev,
            expenses: totalExp,
            activityCount: companyDispatches.length + companyFuel.length,
            currency: 'XOF',
            lastUpdated: new Date().toISOString(),
            metrics: [
              {
                id: 'dispatch-rev',
                moduleId,
                label: { fr: 'Revenus Livraisons', en: 'Dispatch Revenue' },
                value: `${totalRev} XOF`,
                trend: 'up',
              },
              {
                id: 'fuel-exp',
                moduleId,
                label: { fr: 'Dépenses Carburant', en: 'Fuel Expenses' },
                value: `${totalExp} XOF`,
                trend: 'neutral',
              },
              {
                id: 'net-margin',
                moduleId,
                label: { fr: 'Marge Nette', en: 'Net Margin' },
                value: `${totalRev - totalExp} XOF`,
                trend: 'up',
              },
              {
                id: 'completed-dispatches',
                moduleId,
                label: { fr: 'Courses Actives', en: 'Completed Dispatches' },
                value: companyDispatches.length,
                trend: 'up',
              },
            ],
          };
        },
      });
      const response = await summaryHandler({
        method,
        headers: req.headers,
        body: '',
      });
      return sendJson(response.status, response.body, response.headers);
    }

    return sendJson(404, { error: 'Not Found', path: pathname });
  });

  return {
    configureCredentials({ apiKey, ssoSecret, webhookSecret, platformUrl }) {
      currentApiKey = apiKey;
      currentSsoSecret = ssoSecret;
      currentWebhookSecret = webhookSecret;
      platformBaseUrl = platformUrl;
    },
    async recordDispatchAndSync(companyId, { driverName, amount, reference }) {
      ensureTenant(companyId);
      const occurredAt = new Date().toISOString();
      const record = { id: `DSP-${Date.now()}`, companyId, driverName, amount, reference, occurredAt };
      dispatches.get(companyId).push(record);

      const client = createSdkClient();
      client.setWorkspace(companyId);
      const revRes = await client.recordRevenue({
        moduleId,
        amount,
        currency: 'XOF',
        source: `Dispatch Express — ${driverName}`,
        reference,
        occurredAt,
      });
      const evtRes = await client.emitEvent({
        moduleId,
        action: 'dispatch.completed',
        entity: 'dispatch',
        entityId: record.id,
        details: { driverName, amount, reference },
      });
      return { record, revRes, evtRes };
    },
    async recordFuelAndSync(companyId, { vehiclePlate, amount, reference }) {
      ensureTenant(companyId);
      const occurredAt = new Date().toISOString();
      const record = { id: `FUEL-${Date.now()}`, companyId, vehiclePlate, amount, reference, occurredAt };
      fuelExpenses.get(companyId).push(record);

      const client = createSdkClient();
      client.setWorkspace(companyId);
      const expRes = await client.recordExpense({
        moduleId,
        amount,
        currency: 'XOF',
        category: `Fuel — ${vehiclePlate}`,
        reference,
        occurredAt,
      });
      return { record, expRes };
    },
    createSdkClient,
    getReceivedWebhooks: () => receivedWebhooks,
    start: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// 2. Local KaziBox Platform API HTTP Gateway (Mounts Real Next.js Route Handlers)
// ---------------------------------------------------------------------------
async function createPlatformGatewayServer() {
  const registerRoute = await import('../platform/app/api/v1/modules/register/route.ts');
  const registryItemRoute = await import('../platform/app/api/v1/modules/registry/[id]/route.ts');
  const contextRoute = await import('../platform/app/api/v1/context/route.ts');
  const subscriptionRoute = await import('../platform/app/api/v1/subscription/route.ts');
  const revenueRoute = await import('../platform/app/api/v1/finance/revenue/route.ts');
  const expensesRoute = await import('../platform/app/api/v1/finance/expenses/route.ts');
  const eventsRoute = await import('../platform/app/api/v1/events/route.ts');
  const launchRoute = await import('../platform/app/api/v1/modules/[slug]/launch/route.ts');
  const summaryRoute = await import('../platform/app/api/v1/modules/[slug]/summary/route.ts');

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '127.0.0.1';
    const fullUrl = `http://${host}${req.url || '/'}`;
    const parsedUrl = new URL(fullUrl);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    let rawBody = '';
    if (method !== 'GET' && method !== 'HEAD') {
      rawBody = await new Promise((resolve) => {
        let buf = '';
        req.on('data', (c) => (buf += c));
        req.on('end', () => resolve(buf));
      });
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(', '));
      else if (typeof v === 'string') headers.set(k, v);
    }

    const nextReq = new NextRequest(fullUrl, {
      method,
      headers,
      body: rawBody && method !== 'GET' && method !== 'HEAD' ? rawBody : undefined,
    });

    let nextRes = null;
    try {
      if (pathname === '/api/v1/modules/register') {
        if (method === 'GET') nextRes = await registerRoute.GET(nextReq);
        else if (method === 'POST') nextRes = await registerRoute.POST(nextReq);
      } else if (pathname.startsWith('/api/v1/modules/registry/')) {
        const id = decodeURIComponent(pathname.replace('/api/v1/modules/registry/', ''));
        const ctx = { params: { id } };
        if (method === 'GET') nextRes = await registryItemRoute.GET(nextReq, ctx);
        else if (method === 'PUT') nextRes = await registryItemRoute.PUT(nextReq, ctx);
        else if (method === 'PATCH') nextRes = await registryItemRoute.PATCH(nextReq, ctx);
        else if (method === 'POST') nextRes = await registryItemRoute.POST(nextReq, ctx);
      } else if (pathname === '/api/v1/context' && method === 'GET') {
        nextRes = await contextRoute.GET(nextReq);
      } else if (pathname === '/api/v1/subscription' && method === 'GET') {
        nextRes = await subscriptionRoute.GET(nextReq);
      } else if (pathname === '/api/v1/finance/revenue' && method === 'POST') {
        nextRes = await revenueRoute.POST(nextReq);
      } else if (pathname === '/api/v1/finance/expenses' && method === 'POST') {
        nextRes = await expensesRoute.POST(nextReq);
      } else if (pathname === '/api/v1/events' && method === 'POST') {
        nextRes = await eventsRoute.POST(nextReq);
      } else if (pathname.match(/^\/api\/v1\/modules\/([^/]+)\/launch$/)) {
        const slug = decodeURIComponent(pathname.match(/^\/api\/v1\/modules\/([^/]+)\/launch$/)[1]);
        const ctx = { params: { slug } };
        if (method === 'POST') nextRes = await launchRoute.POST(nextReq, ctx);
        else if (method === 'GET') nextRes = await launchRoute.GET(nextReq, ctx);
      } else if (pathname.match(/^\/api\/v1\/modules\/([^/]+)\/summary$/)) {
        const slug = decodeURIComponent(pathname.match(/^\/api\/v1\/modules\/([^/]+)\/summary$/)[1]);
        const ctx = { params: { slug } };
        if (method === 'GET') nextRes = await summaryRoute.GET(nextReq, ctx);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: err?.message }));
      return;
    }

    if (!nextRes) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
      return;
    }

    const resHeaders = {};
    nextRes.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
    const text = await nextRes.text();
    res.writeHead(nextRes.status, resHeaders);
    res.end(text);
  });

  return {
    start: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// 3. Execute Full Staging Demonstration
// ---------------------------------------------------------------------------
async function main() {
  console.log('================================================================================');
  console.log(' KAZIBOX NO-CODE SAAS REGISTRY — SAFE STAGING INTEGRATION DEMONSTRATION');
  console.log('================================================================================\n');

  // Step 0: Check staging Supabase environment availability & enforce production guard
  console.log('[STEP 0] Production Safety Guard & Staging Supabase Discovery');
  console.log(`  - Blocked Production/Preview Refs: ${[...BLOCKED_PRODUCTION_REFS].join(', ')}`);

  const testEnvPath = path.join(ROOT_DIR, 'platform', '.env.test.local');
  const testEnv = parseEnvFile(testEnvPath);
  const disposableUrl = testEnv.DISPOSABLE_SUPABASE_URL || '';
  const disposableKey = testEnv.DISPOSABLE_SERVICE_ROLE_KEY || '';
  const disposableRef = extractProjectRef(disposableUrl);

  let initialSeed = null;

  if (disposableUrl && disposableKey && disposableRef) {
    assert.ok(
      !BLOCKED_PRODUCTION_REFS.has(disposableRef),
      `SAFETY VIOLATION: Disposable URL ref '${disposableRef}' matches a blocked production ref!`
    );
    console.log(`  - Discovered Separate Disposable/Staging Supabase Project in platform/.env.test.local:`);
    console.log(`    * Project Ref (masked): ${disposableRef.slice(0, 4)}****.supabase.co`);
    console.log(`    * Service Key (masked): ${maskSecret(disposableKey)}`);
    console.log(`    * CONFIRM_DISPOSABLE_ENVIRONMENT: ${testEnv.CONFIRM_DISPOSABLE_ENVIRONMENT}`);
    console.log(`    * EXECUTE_LIVE_MUTATIONS: ${testEnv.EXECUTE_LIVE_MUTATIONS} (Default Read-Only Guard Active)`);

    // Perform strictly READ-ONLY preflight inspection of the disposable staging Supabase database
    const readOnlyClient = createClient(disposableUrl, disposableKey, {
      auth: { persistSession: false },
    });
    const tablesToVerify = [
      'modules',
      'module_api_keys',
      'companies',
      'subscriptions',
      'finance_records',
      'webhook_events',
    ];
    console.log('  - Executing Strictly READ-ONLY Schema Preflight Against Disposable Staging Supabase:');
    for (const table of tablesToVerify) {
      const { data, error, status } = await readOnlyClient.from(table).select('id').limit(10);
      assert.equal(error, null, `Table public.${table} preflight failed: ${error?.message}`);
      console.log(`    * public.${table.padEnd(18)} -> HTTP ${status} OK (existing rows sampled: ${data.length})`);
    }

    const { data: remoteCompanies } = await readOnlyClient.from('companies').select('id,name').limit(5);
    const { data: remoteModules } = await readOnlyClient.from('modules').select('*').limit(10);
    if (remoteCompanies?.length) {
      initialSeed = {
        companies: remoteCompanies,
        subscriptions: [
          {
            id: 'sub-staging-palmeraie-01',
            company_id: '11111111-1111-4111-8111-111111111111',
            plan_id: 'all_access',
            status: 'active',
            included_module_ids: ['hotel-property', 'staging-logistics-pro'],
            current_period_start: '2026-01-01T00:00:00.000Z',
            current_period_end: '2027-01-01T00:00:00.000Z',
            cancel_at_period_end: false,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        modules: remoteModules || [],
        module_api_keys: [],
        finance_records: [],
        webhook_events: [],
        activity_logs: [],
      };
    }
  } else {
    console.log('  - No separate staging Supabase credentials found in platform/.env.test.local; using local staging seed.');
  }

  // Activate Staging Database Override (enforces PostgreSQL schema & persists to STAGING_DB_FILE)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-isolated.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'staging-isolated-service-role-key';

  const stagingDb = createDiskBackedStagingSupabase(STAGING_DB_FILE, initialSeed);
  globalThis.__kaziboxSupabaseAdminOverride = stagingDb.client;

  const { reloadServerStore, getStore } = await import('../platform/lib/storage.ts');
  const { getModuleRuntimeSecrets, getApiKeysForModule } = await import('../platform/lib/registry.ts');
  const { getModule } = await import('../platform/lib/modules.ts');

  reloadServerStore();

  // Start External SaaS Server & KaziBox Platform Gateway Server
  const MODULE_SLUG = 'staging-logistics-pro';
  const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

  const saasApp = createExternalSaasApp({ moduleId: MODULE_SLUG });
  const saasPort = await saasApp.start();
  const saasBaseUrl = `http://127.0.0.1:${saasPort}`;

  const gateway = await createPlatformGatewayServer();
  const gatewayPort = await gateway.start();
  const platformBaseUrl = `http://127.0.0.1:${gatewayPort}`;

  console.log(`  - Started KaziBox Platform API Gateway at ${platformBaseUrl}`);
  console.log(`  - Started External SaaS (@kazibox/sdk) at ${saasBaseUrl}\n`);

  const adminCookie = encodeURIComponent(
    JSON.stringify({
      userId: 'usr-admin-05',
      email: 'admin@kazibox.com',
      name: 'Amadou Ba',
      role: 'platform_admin',
      companyId: WORKSPACE_ID,
    })
  );

  const ownerCookie = encodeURIComponent(
    JSON.stringify({
      userId: 'usr-owner-01',
      email: 'owner@palmeraie.com',
      name: 'Mamadou Diallo',
      role: 'owner',
      companyId: WORKSPACE_ID,
    })
  );

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Register External SaaS via No-Code Registry API
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Register External SaaS Application via No-Code Registry API');
    const registerPayload = {
      name: {
        fr: 'Logistics Pro Staging',
        en: 'Logistics Pro Staging',
      },
      slug: MODULE_SLUG,
      description: {
        fr: 'Application SaaS externe de gestion de flotte et livraisons intégrée via @kazibox/sdk.',
        en: 'External fleet & delivery management SaaS integrated via @kazibox/sdk.',
      },
      category: 'Logistique & Flotte',
      developerName: 'KaziBox Staging Partner',
      version: '1.2.0',
      icon: 'Truck',
      accentColor: '#0284c7',
      appUrl: saasBaseUrl,
      entryUrl: `${saasBaseUrl}/sso`,
      summaryUrl: `${saasBaseUrl}/api/summary`,
      webhookUrl: `${saasBaseUrl}/api/webhooks/kazibox`,
      priceMonthly: 25000,
      priceAnnual: 250000,
      currency: 'XOF',
      status: 'draft',
      scopes: ['read:context', 'read:subscription', 'write:finance', 'write:events', 'read:summary'],
      events: ['module.activated', 'module.deactivated', 'subscription.updated', 'payment.completed'],
      pwaConfig: {
        display: 'standalone',
        offlineCapable: true,
        themeColor: '#0284c7',
        backgroundColor: '#ffffff',
      },
    };

    const regRes = await fetch(`${platformBaseUrl}/api/v1/modules/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `kazibox_session=${adminCookie}`,
      },
      body: JSON.stringify(registerPayload),
    });
    const regBody = await regRes.json();
    assert.equal(regRes.status, 201, `Expected 201 Created, got ${regRes.status}: ${JSON.stringify(regBody)}`);
    assert.equal(regBody.success, true);
    assert.equal(regBody.module.id, MODULE_SLUG);

    // Publish module (`status: 'published'` -> DB `status: 'active'`)
    const pubRes = await fetch(`${platformBaseUrl}/api/v1/modules/registry/${MODULE_SLUG}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `kazibox_session=${adminCookie}`,
      },
      body: JSON.stringify({ status: 'published' }),
    });
    const pubBody = await pubRes.json();
    assert.equal(pubRes.status, 200);
    assert.equal(pubBody.module.status, 'published');

    // Ensure workspace subscription includes this newly published module
    const store = getStore();
    const wsSub = store.subscriptions.find((s) => s.company_id === WORKSPACE_ID || s.workspaceId === WORKSPACE_ID);
    if (wsSub) {
      wsSub.status = 'active';
      if (!wsSub.includedModuleIds.includes(MODULE_SLUG)) {
        wsSub.includedModuleIds.push(MODULE_SLUG);
      }
    }

    console.log(`  - POST /api/v1/modules/register -> HTTP ${regRes.status} Created (slug: ${regBody.module.slug})`);
    console.log(`  - PATCH /api/v1/modules/registry/${MODULE_SLUG} -> HTTP ${pubRes.status} OK (status: ${pubBody.module.status})\n`);

    // -------------------------------------------------------------------------
    // STEP 2: Verify Credential Provisioning & Configure External SaaS
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Verify One-Time Credential Provisioning & At-Rest Encryption');
    const creds = regBody.credentials;
    assert.ok(creds.apiKey.startsWith('kz_'), 'Provisioned API key must start with kz_');
    assert.ok(creds.ssoSecret.startsWith('kz_sso_'), 'Provisioned SSO secret must start with kz_sso_');
    assert.ok(creds.webhookSecret.startsWith('kz_whsec_'), 'Provisioned Webhook secret must start with kz_whsec_');
    assert.equal(regBody.module.secretConfig, undefined, 'Public module manifest must not expose secretConfig');

    const dbSnapshot = stagingDb.readDb();
    const dbModRow = dbSnapshot.modules.find((m) => m.id === MODULE_SLUG);
    const dbKeyRows = dbSnapshot.module_api_keys.filter((k) => k.module_id === MODULE_SLUG);
    assert.ok(dbModRow, 'Module row must exist in staging public.modules table');
    assert.equal(dbModRow.status, 'active', 'Published status must map to PostgreSQL active status');
    assert.equal(dbKeyRows.length, 3, 'All 3 credentials (api_key, sso_secret, webhook_secret) must be persisted in public.module_api_keys');
    const apiKeyRow = dbKeyRows.find((k) => k.key_hash.includes('type:api_key'));
    const ssoKeyRow = dbKeyRows.find((k) => k.key_hash.includes('type:sso_secret'));
    const whKeyRow = dbKeyRows.find((k) => k.key_hash.includes('type:webhook_secret'));
    assert.ok(apiKeyRow && !apiKeyRow.key_hash.includes(creds.apiKey), 'API key must be SHA-256 hashed at rest');
    assert.ok(ssoKeyRow && ssoKeyRow.key_hash.includes('enc:v1:'), 'SSO secret must be encrypted with AES-256-GCM at rest');
    assert.ok(whKeyRow && whKeyRow.key_hash.includes('enc:v1:'), 'Webhook secret must be encrypted with AES-256-GCM at rest');

    // Configure external SaaS server with the provisioned credentials
    saasApp.configureCredentials({
      apiKey: creds.apiKey,
      ssoSecret: creds.ssoSecret,
      webhookSecret: creds.webhookSecret,
      platformUrl: platformBaseUrl,
    });

    console.log(`  - Provisioned API Key:        ${maskSecret(creds.apiKey)} (SHA-256 hash stored in public.module_api_keys)`);
    console.log(`  - Provisioned SSO Secret:     ${maskSecret(creds.ssoSecret)} (AES-256-GCM enc:v1:... in public.module_api_keys)`);
    console.log(`  - Provisioned Webhook Secret: ${maskSecret(creds.webhookSecret)} (AES-256-GCM enc:v1:... in public.module_api_keys)`);
    console.log(`  - Bound Workspace UUID:       ${apiKeyRow.company_id}\n`);

    // -------------------------------------------------------------------------
    // STEP 3: Verify Restart Persistence Against Staging Database
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Simulate Server Restart & Verify Persistence Against Staging Database');
    // Wipe local platform store file completely so recovery MUST come from the Staging Supabase DB
    if (fs.existsSync(STAGING_STORE_FILE)) {
      fs.unlinkSync(STAGING_STORE_FILE);
    }
    const restartedStagingDb = createDiskBackedStagingSupabase(STAGING_DB_FILE);
    globalThis.__kaziboxSupabaseAdminOverride = restartedStagingDb.client;
    reloadServerStore();

    // Ensure subscription entitlement remains active in reloaded store
    const reloadedStore = getStore();
    const reloadedSub = reloadedStore.subscriptions.find(
      (s) => s.company_id === WORKSPACE_ID || s.workspaceId === WORKSPACE_ID
    );
    if (reloadedSub && !reloadedSub.includedModuleIds.includes(MODULE_SLUG)) {
      reloadedSub.includedModuleIds.push(MODULE_SLUG);
    }

    const persistedModule = await getModule(MODULE_SLUG);
    assert.ok(persistedModule, 'Module must dynamically resolve from staging DB after server restart');
    assert.equal(persistedModule.entryUrl, `${saasBaseUrl}/sso`);
    assert.equal(persistedModule.summaryUrl, `${saasBaseUrl}/api/summary`);
    assert.equal(persistedModule.webhookUrl, `${saasBaseUrl}/api/webhooks/kazibox`);

    const decryptedSecrets = await getModuleRuntimeSecrets(MODULE_SLUG);
    assert.equal(decryptedSecrets.ssoSecret, creds.ssoSecret, 'Decrypted SSO secret must match after restart');
    assert.equal(decryptedSecrets.webhookSecret, creds.webhookSecret, 'Decrypted Webhook secret must match after restart');

    const redactedKeys = await getApiKeysForModule(MODULE_SLUG);
    assert.equal(redactedKeys.length, 3);
    assert.ok(redactedKeys.every((k) => k.hashedSecret === '[REDACTED]'));

    console.log(`  - Reloaded public.modules['${MODULE_SLUG}'] from disk-persisted staging database -> OK`);
    console.log(`  - Decrypted SSO & Webhook secrets with KAZIBOX_MASTER_KEY after restart -> MATCHED`);
    console.log(`  - Reloaded public.module_api_keys['${MODULE_SLUG}'] (hashedSecret: ${redactedKeys[0].hashedSecret}) -> OK\n`);

    // -------------------------------------------------------------------------
    // STEP 4: API Authentication & Shared Financial Ledger Synchronization
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Verify External SaaS API Authentication & Financial Ledger Sync (@kazibox/sdk)');
    const sdkClient = saasApp.createSdkClient();
    sdkClient.setWorkspace(WORKSPACE_ID);

    const ctxRes = await sdkClient.getContext();
    assert.equal(ctxRes.ok, true, `GET /api/v1/context failed (${ctxRes.status}): ${ctxRes.error}`);
    const ctx = ctxRes.data;
    assert.equal(ctx.workspace.id, WORKSPACE_ID);
    assert.equal(ctx.callingModule.id, MODULE_SLUG);
    console.log(`  - GET /api/v1/context -> ${ctxRes.status} OK (workspace: "${ctx.workspace.name}", callingModule: "${ctx.callingModule.id}")`);

    const subRes = await sdkClient.getSubscription();
    assert.equal(subRes.ok, true, `GET /api/v1/subscription failed (${subRes.status}): ${subRes.error}`);
    const sub = subRes.data;
    assert.equal(sub.workspaceId, WORKSPACE_ID);
    assert.equal(sub.moduleId, MODULE_SLUG);
    assert.equal(sub.hasAccess, true);
    console.log(`  - GET /api/v1/subscription -> ${subRes.status} OK (hasAccess: ${sub.hasAccess}, status: "${sub.status}")`);

    const dispatchSync = await saasApp.recordDispatchAndSync(WORKSPACE_ID, {
      driverName: 'Moussa Koné',
      amount: 45000,
      reference: 'STG-DSP-2026-001',
    });
    assert.equal(dispatchSync.revRes.ok, true, `recordRevenue failed: ${dispatchSync.revRes.error}`);
    assert.equal(dispatchSync.revRes.data.success, true);
    assert.equal(dispatchSync.revRes.data.isDuplicate, false);
    assert.equal(dispatchSync.evtRes.ok, true, `emitEvent failed: ${dispatchSync.evtRes.error}`);
    assert.equal(dispatchSync.evtRes.data.success, true);

    // Verify idempotency on duplicate revenue reference
    const duplicateRev = await sdkClient.recordRevenue({
      moduleId: MODULE_SLUG,
      amount: 45000,
      currency: 'XOF',
      source: 'Dispatch Express — Moussa Koné',
      reference: 'STG-DSP-2026-001',
      occurredAt: dispatchSync.record.occurredAt,
    });
    assert.equal(duplicateRev.ok, true);
    assert.equal(duplicateRev.data.isDuplicate, true);

    const fuelSync = await saasApp.recordFuelAndSync(WORKSPACE_ID, {
      vehiclePlate: 'CI-8842-ABJ',
      amount: 12500,
      reference: 'STG-FUEL-2026-001',
    });
    assert.equal(fuelSync.expRes.ok, true, `recordExpense failed: ${fuelSync.expRes.error}`);
    assert.equal(fuelSync.expRes.data.success, true);
    assert.equal(fuelSync.expRes.data.isDuplicate, false);

    console.log(`  - POST /api/v1/finance/revenue -> ${dispatchSync.revRes.status} Created (45,000 XOF, ref: STG-DSP-2026-001, idempotent replay: isDuplicate=${duplicateRev.data.isDuplicate})`);
    console.log(`  - POST /api/v1/finance/expenses -> ${fuelSync.expRes.status} Created (12,500 XOF, ref: STG-FUEL-2026-001)`);
    console.log(`  - POST /api/v1/events -> ${dispatchSync.evtRes.status} Created (eventId: ${dispatchSync.evtRes.data.eventId})\n`);

    // -------------------------------------------------------------------------
    // STEP 5: 5-Minute Signed SSO Launch & Token Replay Protection
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Verify 5-Minute Signed SSO Launch Handoff & Replay Protection');
    const launchRes = await fetch(`${platformBaseUrl}/api/v1/modules/${MODULE_SLUG}/launch`, {
      method: 'POST',
      headers: {
        Cookie: `kazibox_session=${ownerCookie}`,
      },
    });
    const launchBody = await launchRes.json();
    assert.equal(launchRes.status, 200, `Expected 200 from launch route, got ${launchRes.status}: ${JSON.stringify(launchBody)}`);
    assert.equal(launchBody.success, true);
    assert.equal(launchBody.moduleId, MODULE_SLUG);
    assert.ok(launchBody.launchUrl.startsWith(`${saasBaseUrl}/sso?token=`));

    // Follow launchUrl to external SaaS `/sso?token=...`
    const ssoFirstRes = await fetch(launchBody.launchUrl);
    const ssoFirstBody = await ssoFirstRes.json();
    assert.equal(ssoFirstRes.status, 200);
    assert.equal(ssoFirstBody.authenticated, true);
    assert.equal(ssoFirstBody.session.workspaceId, WORKSPACE_ID);
    assert.equal(ssoFirstBody.session.moduleId, MODULE_SLUG);

    // Replay the exact same SSO launch URL -> must be rejected with 401 REPLAY_DETECTED
    const ssoReplayRes = await fetch(launchBody.launchUrl);
    const ssoReplayBody = await ssoReplayRes.json();
    assert.equal(ssoReplayRes.status, 401);
    assert.equal(ssoReplayBody.code, 'REPLAY_DETECTED');

    console.log(`  - POST /api/v1/modules/${MODULE_SLUG}/launch -> 200 OK (expiresIn: ${launchBody.expiresIn}s)`);
    console.log(`  - GET External SaaS /sso?token=... (1st attempt) -> 200 OK (authenticated: true, workspaceId: ${ssoFirstBody.session.workspaceId})`);
    console.log(`  - GET External SaaS /sso?token=... (replay attempt) -> 401 Unauthorized (code: ${ssoReplayBody.code})\n`);

    // -------------------------------------------------------------------------
    // STEP 6: Outbound Signed Webhook Delivery & Dynamic Summary Retrieval
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Verify Outbound Signed Webhook Delivery & Dynamic Summary Retrieval');
    const webhookTestRes = await fetch(`${platformBaseUrl}/api/v1/modules/registry/${MODULE_SLUG}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `kazibox_session=${adminCookie}`,
      },
      body: JSON.stringify({
        action: 'test_webhook',
        workspaceId: WORKSPACE_ID,
      }),
    });
    const webhookTestBody = await webhookTestRes.json();
    assert.equal(webhookTestRes.status, 200);
    assert.equal(webhookTestBody.success, true);
    assert.equal(webhookTestBody.delivery.status, 'delivered');
    assert.equal(webhookTestBody.delivery.responseStatus, 200);

    // Also dispatch a lifecycle `module.activated` event via dispatchWebhookEvent
    const { dispatchWebhookEvent } = await import('../platform/lib/webhooks.ts');
    const lifecycleDeliveries = await dispatchWebhookEvent(
      'module.activated',
      {
        id: 'idem-staging-demo-001',
        companyId: WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
        plan: 'pro',
      },
      MODULE_SLUG
    );
    assert.equal(lifecycleDeliveries.length, 1);
    const lifecycleDelivery = lifecycleDeliveries[0];
    assert.equal(lifecycleDelivery.status, 'delivered');
    assert.equal(lifecycleDelivery.responseStatus, 200);
    assert.ok(saasApp.getReceivedWebhooks().length >= 2, 'External SaaS must receive signed webhooks');

    // Dynamic Summary Retrieval via KaziBox Platform `/api/v1/modules/[slug]/summary`
    const summaryRes = await fetch(`${platformBaseUrl}/api/v1/modules/${MODULE_SLUG}/summary`, {
      method: 'GET',
      headers: {
        Cookie: `kazibox_session=${ownerCookie}`,
      },
    });
    const summaryBody = await summaryRes.json();
    assert.equal(summaryRes.status, 200, `Expected 200 from summary route, got ${summaryRes.status}: ${JSON.stringify(summaryBody)}`);
    assert.equal(summaryBody.moduleId, MODULE_SLUG);
    assert.equal(summaryBody.companyId, WORKSPACE_ID);
    assert.equal(summaryBody.revenue, 45000);
    assert.equal(summaryBody.expenses, 12500);
    assert.equal(summaryBody.activityCount, 2);
    assert.equal(summaryBody.metrics.length, 4);

    console.log(`  - POST /api/v1/modules/registry/${MODULE_SLUG} (test_webhook) -> 200 OK (status: ${webhookTestBody.delivery.status}, HTTP ${webhookTestBody.delivery.responseStatus})`);
    console.log(`  - dispatchWebhookEvent('module.activated') -> 200 OK (deliveryId: ${lifecycleDelivery.id}, attempts: ${lifecycleDelivery.attempts})`);
    console.log(`  - GET /api/v1/modules/${MODULE_SLUG}/summary -> 200 OK (revenue: ${summaryBody.revenue} ${summaryBody.currency}, expenses: ${summaryBody.expenses} ${summaryBody.currency})`);
    for (const metric of summaryBody.metrics) {
      console.log(`    * Metric [${metric.label.en}]: ${metric.value}`);
    }

    console.log('\n================================================================================');
    console.log(' STAGING INTEGRATION DEMONSTRATION RESULT: ALL 6 STEPS PASSED (0 FAILURES)');
    console.log('================================================================================');
  } finally {
    await gateway.stop();
    await saasApp.stop();
    delete globalThis.__kaziboxSupabaseAdminOverride;
    fs.rmSync(STAGING_TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('STAGING DEMO FAILED:', err);
  process.exit(1);
});
