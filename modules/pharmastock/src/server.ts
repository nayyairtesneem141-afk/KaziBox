import http from 'node:http';
import { pharmastockManifest } from './manifest.js';
import { PharmaInventoryService } from './inventory.js';
import { PharmaFinanceSync } from './finance.js';
import { buildPharmaStockSummary } from './summary.js';
import { createPharmaSsoHandoff } from './sso.js';
import { getPharmaStockWebhookHandler, getTenantProvisioningStatus } from './webhooks.js';
import { IdempotencyStore } from '@kazibox/sdk';

const PORT = parseInt(process.env.PORT || '3000', 10);
const SSO_SECRET = process.env.KAZIBOX_SSO_SECRET || 'kazibox_mock_sso_secret_key_prod_env_replace';
const WEBHOOK_SECRET = process.env.KAZIBOX_WEBHOOK_SECRET || 'kazibox_mock_webhook_secret_pharma';
const KAZIBOX_API_KEY = process.env.KAZIBOX_API_KEY;

function isServerAuthorized(req: http.IncomingMessage): boolean {
  const isStrictEnv = (process.env.NODE_ENV as string) === 'production' || (process.env.NODE_ENV as string) === 'staging';
  if (!KAZIBOX_API_KEY) {
    if (isStrictEnv) {
      // In staging or production, lack of KAZIBOX_API_KEY must FAIL CLOSED
      return false;
    }
    return true; // dev fallback only when in test or local dev
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token === KAZIBOX_API_KEY;
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        const parsed = JSON.parse(body);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new Error('Invalid JSON body: expected an object'));
        }
        resolve(parsed);
      } catch (err: any) {
        if (err.message === 'Invalid JSON body: expected an object') {
          return reject(err);
        }
        reject(new Error('Malformed JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Workspace-Id, x-kazibox-signature',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

export interface PharmaServerOptions {
  ssoSecret?: string;
  webhookSecret?: string;
  ssoStore?: IdempotencyStore;
  webhookStore?: IdempotencyStore;
}

/**
 * Creates the PharmaStock HTTP microservice.
 *
 * ARCHITECTURAL CONCURRENCY & DEPLOYMENT CONSTRAINT:
 * Single-instance deployment constraint: Single Node process owning persistent volume (/data).
 * Replay protection and webhook idempotency are persisted to the filesystem and survive restarts.
 * Multi-instance deployments require a shared transactional database adapter.
 */
export function createPharmaServer(options: PharmaServerOptions = {}): http.Server {
  const ssoSecret = options.ssoSecret || SSO_SECRET;
  const webhookSecret = options.webhookSecret || WEBHOOK_SECRET;
  const ssoHandoff = createPharmaSsoHandoff(ssoSecret, options.ssoStore);
  const webhookHandler = getPharmaStockWebhookHandler(webhookSecret, options.webhookStore);

  return http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Workspace-Id, x-kazibox-signature',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = (urlObj.pathname || '/').replace(/\/+$/, '') || '/';
    const method = req.method?.toUpperCase();

    // ── 1. Health check for DigitalOcean App Platform & Orchestrators ──
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'healthy',
        service: 'kazibox-pharmastock',
        version: pharmastockManifest.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    }

    // ── 2. Manifest discovery endpoint ──
    if (pathname === '/api/manifest' && method === 'GET') {
      return sendJson(res, 200, pharmastockManifest);
    }

    // ── 3. Operational telemetry summary for KaziBox consolidated dashboard ──
    if ((pathname === '/api/summary' || pathname === '/api/modules/pharmastock/summary') && method === 'GET') {
      if (!isServerAuthorized(req)) {
        return sendJson(res, 401, {
          error: 'Unauthorized',
          message: 'Invalid or missing API key authorization',
        });
      }
      const companyId = (req.headers['x-workspace-id'] as string) || urlObj.searchParams.get('companyId');
      if (!companyId) {
        return sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Missing X-Workspace-Id header or companyId query param',
        });
      }
      const summary = buildPharmaStockSummary(companyId);
      return sendJson(res, 200, summary);
    }

    // ── 4. Webhook listener for KaziBox platform lifecycle events ──
    if (pathname === '/api/webhooks/kazibox' && method === 'POST') {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', async () => {
        const signature = (req.headers['x-kazibox-signature'] as string) || '';
        const adapterReq = {
          method: 'POST',
          headers: req.headers as Record<string, string>,
          body: rawBody,
        };
        const result = await webhookHandler(adapterReq);
        return sendJson(res, result.status, result.body);
      });
      return;
    }

    // ── 5. SSO 5-minute login handoff entry point ──
    if ((pathname === '/modules/pharmastock' || pathname === '/sso') && method === 'GET') {
      const token = urlObj.searchParams.get('token') || '';
      if (!token) {
        return sendJson(res, 401, {
          authenticated: false,
          error: 'Missing SSO handoff token',
          hint: 'Open this module from the KaziBox workspace sidebar',
        });
      }

      const authResult = await ssoHandoff(token);
      if (!authResult.authenticated || !authResult.session) {
        return sendJson(res, 401, {
          authenticated: false,
          error: authResult.error || 'Invalid or expired SSO token',
        });
      }

      const session = authResult.session;
      // Return authenticated session metadata and status
      return sendJson(res, 200, {
        authenticated: true,
        session,
        tenantStatus: getTenantProvisioningStatus(session.companyId),
        message: `Welcome to PharmaStock, ${session.userName}! Authenticated in tenant ${session.companyName}`,
      });
    }

    // ── 6. Tenant-Isolated Inventory API ──
    if (pathname === '/api/inventory' && method === 'GET') {
      if (!isServerAuthorized(req)) {
        return sendJson(res, 401, { error: 'Unauthorized', message: 'API key authorization required' });
      }
      const companyId = (req.headers['x-workspace-id'] as string) || urlObj.searchParams.get('companyId');
      if (!companyId) {
        return sendJson(res, 400, { error: 'X-Workspace-Id header required' });
      }
      const medications = PharmaInventoryService.listMedications(companyId);
      return sendJson(res, 200, { medications });
    }

    // ── 7. Tenant-Isolated Expiry Alerts API ──
    if (pathname === '/api/alerts' && method === 'GET') {
      if (!isServerAuthorized(req)) {
        return sendJson(res, 401, { error: 'Unauthorized', message: 'API key authorization required' });
      }
      const companyId = (req.headers['x-workspace-id'] as string) || urlObj.searchParams.get('companyId');
      if (!companyId) {
        return sendJson(res, 400, { error: 'X-Workspace-Id header required' });
      }
      const days = parseInt(urlObj.searchParams.get('days') || '30', 10);
      const expiring = PharmaInventoryService.getExpiringBatches(companyId, days);
      return sendJson(res, 200, { expiringBatches: expiring });
    }

    // ── 8. Tenant-Isolated POS Sale with FIFO Deduction and KaziBox Finance Sync ──
    if (pathname === '/api/sales' && method === 'POST') {
      if (!isServerAuthorized(req)) {
        return sendJson(res, 401, { error: 'Unauthorized', message: 'API key authorization required' });
      }
      const companyId = (req.headers['x-workspace-id'] as string);
      if (!companyId) {
        return sendJson(res, 400, { error: 'X-Workspace-Id header required' });
      }
      try {
        const body = await parseJsonBody(req);
        if (body.reference !== undefined && (typeof body.reference !== 'string' || !body.reference.trim())) {
          return sendJson(res, 400, { success: false, error: 'Validation error: reference must be a non-empty string' });
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
          return sendJson(res, 400, { success: false, error: 'Validation error: items must be a non-empty array of sale items' });
        }
        for (const item of body.items) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return sendJson(res, 400, { success: false, error: 'Validation error: sale item must be an object' });
          }
          if (!item.medicationId || typeof item.medicationId !== 'string' || !item.medicationId.trim()) {
            return sendJson(res, 400, { success: false, error: 'Validation error: medicationId in items must be a non-empty string' });
          }
          if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
            return sendJson(res, 400, { success: false, error: `Validation error: quantity for medication '${item.medicationId}' must be a positive integer greater than 0` });
          }
        }
        if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3,4}$/i.test(body.currency))) {
          return sendJson(res, 400, { success: false, error: 'Validation error: currency must be a 3 or 4-letter ISO code' });
        }
        if (body.patientName !== undefined && typeof body.patientName !== 'string') {
          return sendJson(res, 400, { success: false, error: 'Validation error: patientName must be a string' });
        }
        if (body.prescriberDoctor !== undefined && typeof body.prescriberDoctor !== 'string') {
          return sendJson(res, 400, { success: false, error: 'Validation error: prescriberDoctor must be a string' });
        }

        const result = await PharmaFinanceSync.executeSaleAndSync(companyId, {
          reference: body.reference || `SALE-${Date.now()}`,
          items: body.items,
          patientName: body.patientName,
          prescriberDoctor: body.prescriberDoctor,
          currency: body.currency || 'XOF',
        });
        return sendJson(res, 201, { success: true, ...result });
      } catch (err: any) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ── 9. Tenant-Isolated Restock with KaziBox Expense Sync ──
    if (pathname === '/api/restock' && method === 'POST') {
      if (!isServerAuthorized(req)) {
        return sendJson(res, 401, { error: 'Unauthorized', message: 'API key authorization required' });
      }
      const companyId = (req.headers['x-workspace-id'] as string);
      if (!companyId) {
        return sendJson(res, 400, { error: 'X-Workspace-Id header required' });
      }
      try {
        const body = await parseJsonBody(req);
        if (!body.medicationId || typeof body.medicationId !== 'string' || !body.medicationId.trim()) {
          return sendJson(res, 400, { success: false, error: 'Validation error: medicationId must be a non-empty string' });
        }
        if (!body.batchNumber || typeof body.batchNumber !== 'string' || !body.batchNumber.trim()) {
          return sendJson(res, 400, { success: false, error: 'Validation error: batchNumber must be a non-empty string' });
        }
        if (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity <= 0) {
          return sendJson(res, 400, { success: false, error: 'Validation error: quantity must be a positive integer greater than 0' });
        }
        if (typeof body.costPrice !== 'number' || !Number.isFinite(body.costPrice) || body.costPrice < 0) {
          return sendJson(res, 400, { success: false, error: 'Validation error: costPrice must be a non-negative number' });
        }
        if (!body.expiryDate || typeof body.expiryDate !== 'string' || isNaN(new Date(body.expiryDate).getTime())) {
          return sendJson(res, 400, { success: false, error: 'Validation error: expiryDate must be a valid date string (e.g. YYYY-MM-DD)' });
        }
        if (body.reference !== undefined && (typeof body.reference !== 'string' || !body.reference.trim())) {
          return sendJson(res, 400, { success: false, error: 'Validation error: reference must be a non-empty string' });
        }

        const result = await PharmaFinanceSync.executeRestockAndSync(companyId, {
          medicationId: body.medicationId,
          batchNumber: body.batchNumber,
          quantity: body.quantity,
          expiryDate: body.expiryDate,
          costPrice: body.costPrice,
          reference: body.reference || `RESTOCK-${Date.now()}`,
        });
        return sendJson(res, 201, { success: true, ...result });
      } catch (err: any) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ── 404 Route Not Found ──
    sendJson(res, 404, { error: 'Not Found', path: pathname });
  });
}

// Start server directly when invoked as main module in ESM or standalone mode
const isMainModule = typeof process !== 'undefined' && (
  process.env.RUN_STANDALONE === 'true' ||
  (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js')))
);

if (isMainModule) {
  const server = createPharmaServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[PharmaStock] SaaS Microservice listening on http://0.0.0.0:${PORT}`);
    console.log(`[PharmaStock] Health check available at http://0.0.0.0:${PORT}/api/health`);
  });
}
