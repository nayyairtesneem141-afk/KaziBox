import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyWebhookSignature } from './webhooks.js';
import { verifySsoToken, ModuleTokenPayload } from './sso.js';
import { ModuleSummary } from './contracts.js';

export interface IdempotencyStore {
  /**
   * Atomically claims an idempotency key if absent or expired.
   * Guarantees atomic insert-if-absent semantics to prevent concurrency race conditions.
   * Returns true if key was successfully acquired (first execution).
   * Returns false if key is already claimed and active (duplicate / replay).
   */
  acquire(key: string, ttlSeconds: number): Promise<boolean> | boolean;
  has?(key: string): Promise<boolean> | boolean;
  set?(key: string, ttlSeconds: number): Promise<void> | void;
  clear?(): Promise<void> | void;
}

/**
 * In-memory atomic idempotency store for local development and test environments.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private map = new Map<string, number>();

  acquire(key: string, ttlSeconds: number): boolean {
    const now = Date.now();
    const exp = this.map.get(key);
    if (exp && exp >= now) {
      return false; // Active lock exists (duplicate)
    }
    this.map.set(key, now + ttlSeconds * 1000);
    return true;
  }

  has(key: string): boolean {
    const exp = this.map.get(key);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  set(key: string, ttlSeconds: number): void {
    const now = Date.now();
    this.map.set(key, now + ttlSeconds * 1000);
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Durable filesystem-based atomic idempotency store using OS-level exclusive file locks (O_CREAT | O_EXCL).
 * Safe across process restarts for single-instance deployments without requiring external database services.
 *
 * ARCHITECTURAL CONCURRENCY & DEPLOYMENT CONSTRAINT:
 * Single-instance deployment constraint: FileLockIdempotencyStore relies on local filesystem locks and
 * is safe for a single Node process owning the directory volume (e.g. single Docker container or Droplet).
 * It does NOT guarantee multi-instance / distributed safety across independent servers or distributed
 * networked filesystems (NFS/CIFS) where file locking semantics can be asynchronous or inconsistent.
 * Multi-instance horizontal scaling requires a shared transactional database store (e.g. PostgreSQL advisory locks or Redis).
 */
export class FileLockIdempotencyStore implements IdempotencyStore {
  private dirPath: string;

  constructor(dirPath?: string) {
    this.dirPath = dirPath || path.resolve('.cache', 'idempotency');
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
      }
    } catch {
      // Ignore if directory already exists
    }
  }

  private sanitizeKey(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safe.length > 100) {
      const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
      return `${safe.substring(0, 50)}_${hash}`;
    }
    return safe;
  }

  clear(): void {
    try {
      if (fs.existsSync(this.dirPath)) {
        const files = fs.readdirSync(this.dirPath);
        for (const file of files) {
          if (file.endsWith('.lock')) {
            try {
              fs.unlinkSync(path.join(this.dirPath, file));
            } catch {}
          }
        }
      }
    } catch {}
  }

  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
      }
    } catch {}
    const safeKey = this.sanitizeKey(key);
    const filePath = path.join(this.dirPath, `${safeKey}.lock`);
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    // Check existing lock file for expiration
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.expiresAt && parsed.expiresAt >= now) {
          return false; // Active lock exists
        }
        // Lock has expired; attempt to clean up
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Handled if concurrent process removed it
        }
      }
    } catch {
      // Corrupt or unreadable lock file; proceed to acquire
    }

    // Atomic exclusive creation (O_CREAT | O_EXCL)
    try {
      const fd = fs.openSync(filePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ key, expiresAt, createdAt: now }), 'utf8');
      fs.closeSync(fd);
      return true;
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        // File exists, verify if it expired at this instant
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(content);
          if (parsed.expiresAt && parsed.expiresAt < now) {
            fs.writeFileSync(filePath, JSON.stringify({ key, expiresAt, createdAt: now }), 'utf8');
            return true;
          }
        } catch {}
        return false;
      }
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    const safeKey = this.sanitizeKey(key);
    const filePath = path.join(this.dirPath, `${safeKey}.lock`);
    try {
      if (!fs.existsSync(filePath)) return false;
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      return Boolean(parsed.expiresAt && parsed.expiresAt >= Date.now());
    } catch {
      return false;
    }
  }

  async set(key: string, ttlSeconds: number): Promise<void> {
    await this.acquire(key, ttlSeconds);
  }
}

export interface WebhookHandlerOptions {
  webhookSecret: string;
  enableIdempotency?: boolean;
  store?: IdempotencyStore;
  onModuleActivated?: (event: any) => Promise<void> | void;
  onModuleDeactivated?: (event: any) => Promise<void> | void;
  onSubscriptionUpdated?: (event: any) => Promise<void> | void;
  onPaymentSucceeded?: (event: any) => Promise<void> | void;
  onPaymentFailed?: (event: any) => Promise<void> | void;
  onUnhandledEvent?: (event: any) => Promise<void> | void;
}

export interface GenericHttpRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined> | { get: (name: string) => string | null };
  body: string | Record<string, any>;
  query?: Record<string, string | undefined>;
}

export interface GenericHttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: any;
}

function getHeader(req: GenericHttpRequest, name: string): string | null {
  if (typeof (req.headers as any).get === 'function') {
    return (req.headers as any).get(name);
  }
  const headersObj = req.headers as Record<string, string | string[] | undefined>;
  const val = headersObj[name.toLowerCase()] || headersObj[name];
  if (Array.isArray(val)) return val[0] || null;
  return val || null;
}

/**
 * Creates a reusable webhook handler for Node / Next.js / Express servers
 * with HMAC-SHA256 signature verification and atomic event idempotency.
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const store = options.store || new MemoryIdempotencyStore();

  return async function handleWebhook(
    req: GenericHttpRequest
  ): Promise<GenericHttpResponse> {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = getHeader(req, 'x-kazibox-signature');

    const isValid = verifyWebhookSignature(rawBody, signature, options.webhookSecret);
    if (!isValid) {
      return {
        status: 401,
        body: { error: 'Unauthorized', message: 'Invalid or missing webhook signature' },
      };
    }

    let payload: any;
    try {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return {
        status: 400,
        body: { error: 'Bad Request', message: 'Malformed JSON payload' },
      };
    }

    const event = payload?.event;
    const eventId = payload?.id;

    // Atomic insert-if-absent idempotency check
    if (options.enableIdempotency !== false && eventId) {
      let isAcquired = false;
      try {
        if (typeof store.acquire === 'function') {
          isAcquired = await store.acquire(eventId, 24 * 60 * 60);
        } else {
          const exists = await store.has?.(eventId);
          if (!exists) {
            await store.set?.(eventId, 24 * 60 * 60);
            isAcquired = true;
          }
        }
      } catch (err: any) {
        // Fail-safe: if the store encounters an error or timeout, reject with 503 so side-effects are not executed twice
        return {
          status: 503,
          body: { error: 'Service Unavailable', message: 'Idempotency store error or timeout' },
        };
      }

      if (!isAcquired) {
        return {
          status: 200,
          body: { received: true, event, isDuplicate: true },
        };
      }
    }

    try {
      switch (event) {
        case 'module.activated':
          if (options.onModuleActivated) await options.onModuleActivated(payload);
          break;
        case 'module.deactivated':
          if (options.onModuleDeactivated) await options.onModuleDeactivated(payload);
          break;
        case 'subscription.updated':
        case 'subscription.created':
        case 'subscription.canceled':
          if (options.onSubscriptionUpdated) await options.onSubscriptionUpdated(payload);
          break;
        case 'payment.succeeded':
          if (options.onPaymentSucceeded) await options.onPaymentSucceeded(payload);
          break;
        case 'payment.failed':
          if (options.onPaymentFailed) await options.onPaymentFailed(payload);
          break;
        default:
          if (options.onUnhandledEvent) await options.onUnhandledEvent(payload);
          break;
      }

      return {
        status: 200,
        body: { received: true, event, isDuplicate: false },
      };
    } catch (err: any) {
      return {
        status: 500,
        body: { error: 'Internal Server Error', message: err?.message || 'Webhook processing failed' },
      };
    }
  };
}

export interface SummaryHandlerOptions {
  moduleId: string;
  apiKey?: string;
  getSummary: (companyId: string) => Promise<Omit<ModuleSummary, 'moduleId' | 'companyId'> & { revenue?: number; expenses?: number; activityCount?: number }> | (Omit<ModuleSummary, 'moduleId' | 'companyId'> & { revenue?: number; expenses?: number; activityCount?: number });
}

/**
 * Creates a reusable handler for serving summaryUrl metrics to KaziBox.
 * Supports optional API key authentication for server-to-server security.
 */
export function createSummaryHandler(options: SummaryHandlerOptions) {
  return async function handleSummary(req: GenericHttpRequest): Promise<GenericHttpResponse> {
    if (options.apiKey) {
      const authHeader = getHeader(req, 'authorization');
      const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
      if (!token || token !== options.apiKey) {
        return {
          status: 401,
          body: { error: 'Unauthorized', message: 'Invalid or missing API key authorization' },
        };
      }
    }

    const companyId = getHeader(req, 'x-workspace-id');
    if (!companyId) {
      return {
        status: 400,
        body: { error: 'Bad Request', message: 'Missing X-Workspace-Id header' },
      };
    }

    try {
      const result = await options.getSummary(companyId);
      const summary: ModuleSummary = {
        moduleId: options.moduleId,
        companyId,
        revenue: result.revenue ?? 0,
        expenses: result.expenses ?? 0,
        activityCount: result.activityCount ?? 0,
        currency: result.currency || 'XOF',
        lastUpdated: result.lastUpdated || new Date().toISOString(),
        metrics: result.metrics || [],
      };

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: summary,
      };
    } catch (err: any) {
      return {
        status: 500,
        body: { error: 'Internal Server Error', message: err?.message || 'Failed to generate module summary' },
      };
    }
  };
}

export interface SsoHandlerOptions {
  ssoSecret?: string;
  enableReplayProtection?: boolean;
  store?: IdempotencyStore;
  onAuthenticated?: (payload: ModuleTokenPayload) => Promise<any> | any;
}

/**
 * Creates a reusable SSO handoff verification handler with atomic single-use replay protection.
 */
export function createSsoHandler(options: SsoHandlerOptions = {}) {
  const store = options.store || new MemoryIdempotencyStore();

  return async function handleSso(token: string | null | undefined): Promise<{
    authenticated: boolean;
    session?: ModuleTokenPayload;
    error?: string;
    code?: string;
  }> {
    if (!token) {
      return { authenticated: false, error: 'No SSO token provided', code: 'MISSING_TOKEN' };
    }

    const verification = verifySsoToken(token, options.ssoSecret);
    if (!verification.valid || !verification.payload) {
      return { authenticated: false, error: verification.error || 'Invalid token', code: verification.code };
    }

    const payload = verification.payload;

    // Atomic single-use replay protection
    if (options.enableReplayProtection !== false) {
      const tokenId = payload.jti || token.slice(-32);
      const now = Math.floor(Date.now() / 1000);
      const remainingTtl = Math.max(1, (payload.exp || now + 300) - now);

      let isAcquired = false;
      try {
        if (typeof store.acquire === 'function') {
          isAcquired = await store.acquire(tokenId, remainingTtl);
        } else {
          const exists = await store.has?.(tokenId);
          if (!exists) {
            await store.set?.(tokenId, remainingTtl);
            isAcquired = true;
          }
        }
      } catch (err: any) {
        // Fail-safe: on store failure or timeout, deny authentication safely
        return {
          authenticated: false,
          error: 'SSO replay store error or timeout',
          code: 'STORE_UNAVAILABLE',
        };
      }

      if (!isAcquired) {
        return {
          authenticated: false,
          error: 'SSO token has already been consumed (replay rejected)',
          code: 'REPLAY_DETECTED',
        };
      }
    }

    if (options.onAuthenticated) {
      await options.onAuthenticated(payload);
    }

    return {
      authenticated: true,
      session: payload,
    };
  };
}
