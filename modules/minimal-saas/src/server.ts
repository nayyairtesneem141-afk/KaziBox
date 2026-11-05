import http from 'node:http';
import { URL } from 'node:url';
import {
  createSsoHandler,
  createWebhookHandler,
  createSummaryHandler,
  IdempotencyStore,
  MemoryIdempotencyStore,
  KaziBoxClient,
} from '@kazibox/sdk';
import { minimalSaasManifest } from './manifest.js';
import { MinimalSaasService } from './service.js';

export interface MinimalServerOptions {
  port?: number;
  ssoSecret?: string;
  webhookSecret?: string;
  apiKey?: string;
  platformUrl?: string;
  idempotencyStore?: IdempotencyStore;
  service?: MinimalSaasService;
}

export function createMinimalServer(options: MinimalServerOptions = {}) {
  const service = options.service || new MinimalSaasService();
  const store = options.idempotencyStore || new MemoryIdempotencyStore();
  const ssoSecret = options.ssoSecret || process.env.KAZIBOX_SSO_SECRET || 'test_sso_secret';
  const webhookSecret = options.webhookSecret || process.env.KAZIBOX_WEBHOOK_SECRET || 'test_webhook_secret';
  const apiKey = options.apiKey || process.env.KAZIBOX_API_KEY || 'kz_test_key';
  const platformUrl = options.platformUrl || process.env.KAZIBOX_API_URL || 'http://127.0.0.1:3000';

  // Instantiate SDK KaziBox client for outbound shared ledger sync
  const client = new KaziBoxClient({
    apiKey,
    baseUrl: platformUrl,
    moduleId: 'fleet-courier',
    ssoSecret,
    webhookSecret,
  });

  // SDK Reusable SSO Handshake Handler
  const ssoHandler = createSsoHandler({
    ssoSecret,
    store,
    enableReplayProtection: true,
    onAuthenticated: (payload) => {
      // Provision or ensure tenant exists upon SSO entry
      service.provisionTenant(payload.workspaceId);
    },
  });

  // SDK Reusable Webhook Handler
  const webhookHandler = createWebhookHandler({
    webhookSecret,
    store,
    enableIdempotency: true,
    onModuleActivated: (event) => {
      service.provisionTenant(event.companyId || event.workspaceId, event.data?.plan || 'starter');
    },
    onModuleDeactivated: (event) => {
      service.deactivateTenant(event.companyId || event.workspaceId);
    },
    onSubscriptionUpdated: (event) => {
      service.provisionTenant(event.companyId || event.workspaceId, event.data?.plan);
    },
  });

  // SDK Reusable Summary Telemetry Handler
  const summaryHandler = createSummaryHandler({
    moduleId: 'fleet-courier',
    apiKey,
    getSummary: (companyId) => service.getSummary(companyId),
  });

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Helper to send JSON responses
    const sendJson = (status: number, data: any, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Workspace-Id, x-kazibox-signature',
        ...extraHeaders,
      });
      res.end(JSON.stringify(data));
    };

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Workspace-Id, x-kazibox-signature',
      });
      return res.end();
    }

    // 1. Health check
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(200, {
        status: 'healthy',
        module: 'fleet-courier',
        version: minimalSaasManifest.version,
        uptime: process.uptime(),
      });
    }

    // 2. Manifest discovery
    if (pathname === '/api/manifest' && method === 'GET') {
      return sendJson(200, minimalSaasManifest);
    }

    // 3. SSO 5-minute handoff entry point
    if ((pathname === '/sso' || pathname === '/modules/fleet-courier') && method === 'GET') {
      const token = parsedUrl.searchParams.get('token');
      const result = await ssoHandler(token);
      if (!result.authenticated) {
        return sendJson(401, { error: 'Unauthorized', message: result.error, code: result.code });
      }
      return sendJson(200, {
        authenticated: true,
        session: result.session,
        message: 'SSO handoff successfully validated',
      });
    }

    // Read request body for POST endpoints
    let rawBody = '';
    if (method === 'POST') {
      try {
        rawBody = await new Promise<string>((resolve, reject) => {
          let chunks = '';
          req.on('data', (c) => (chunks += c));
          req.on('end', () => resolve(chunks));
          req.on('error', reject);
        });
      } catch {
        return sendJson(400, { error: 'Bad Request', message: 'Failed to read request stream' });
      }
    }

    // 4. Webhook lifecycle endpoint
    if (pathname === '/api/webhooks/kazibox' && method === 'POST') {
      const genericReq = {
        method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: rawBody,
      };
      const response = await webhookHandler(genericReq);
      return sendJson(response.status, response.body, response.headers);
    }

    // 5. Telemetry summary endpoint
    if (pathname === '/api/summary' && method === 'GET') {
      const genericReq = {
        method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: '',
      };
      const response = await summaryHandler(genericReq);
      return sendJson(response.status, response.body, response.headers);
    }

    // Tenant context guard for operational endpoints
    const workspaceId = (req.headers['x-workspace-id'] as string) || parsedUrl.searchParams.get('companyId');
    if (pathname.startsWith('/api/trips') || pathname.startsWith('/api/fuel') || pathname.startsWith('/api/data')) {
      if (!workspaceId) {
        return sendJson(400, { error: 'Bad Request', message: 'Missing required X-Workspace-Id header' });
      }
    }

    // 6. Record trip (Operational Revenue)
    if (pathname === '/api/trips' && method === 'POST') {
      let body: any;
      try {
        body = JSON.parse(rawBody || '{}');
      } catch {
        return sendJson(400, { error: 'Bad Request', message: 'Invalid JSON body' });
      }
      try {
        const result = await service.recordTrip(
          workspaceId!,
          {
            driverName: body.driverName,
            amount: body.amount,
            reference: body.reference,
            occurredAt: body.occurredAt,
          },
          client
        );
        return sendJson(result.isDuplicate ? 200 : 201, result);
      } catch (err: any) {
        return sendJson(400, { error: 'Bad Request', message: err?.message || 'Failed to record trip' });
      }
    }

    // 7. Record fuel (Operational Expense)
    if (pathname === '/api/fuel' && method === 'POST') {
      let body: any;
      try {
        body = JSON.parse(rawBody || '{}');
      } catch {
        return sendJson(400, { error: 'Bad Request', message: 'Invalid JSON body' });
      }
      try {
        const result = await service.recordFuel(
          workspaceId!,
          {
            vehiclePlate: body.vehiclePlate,
            amount: body.amount,
            reference: body.reference,
            occurredAt: body.occurredAt,
          },
          client
        );
        return sendJson(result.isDuplicate ? 200 : 201, result);
      } catch (err: any) {
        return sendJson(400, { error: 'Bad Request', message: err?.message || 'Failed to record fuel' });
      }
    }

    // 8. Tenant data isolation audit
    if (pathname === '/api/data' && method === 'GET') {
      const data = service.getTenantData(workspaceId!);
      return sendJson(200, data);
    }

    // 404 fallback
    return sendJson(404, { error: 'Not Found', path: pathname });
  });

  return {
    server,
    service,
    client,
    store,
    start: (port: number = options.port || 3002) =>
      new Promise<number>((resolve) => {
        server.listen(port, () => {
          const addr = server.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(actualPort);
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
