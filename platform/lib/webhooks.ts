import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getStore } from './storage';
import { getModule, getModules } from './modules';
import { getModuleRuntimeSecrets, assertSafeOutboundUrl } from './registry';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

export type WebhookEventType =
  | 'subscription.activated'
  | 'subscription.expired'
  | 'module.activated'
  | 'module.deactivated'
  | 'user.role_changed';

export interface WebhookQueueItem {
  id: string;
  event: WebhookEventType;
  moduleId: string;
  targetUrl: string;
  payload: Record<string, any>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  maxAttempts: number;
  signature: string;
  lastAttemptAt?: string;
  createdAt: string;
  responseStatus?: number;
  responseBody?: string;
}

const STORAGE_WEBHOOKS_KEY = 'kazibox_db_webhooks_queue';

function getDefaultWebhookSecret(): string {
  const env =
    typeof process !== 'undefined' &&
    ((process.env.NEXT_PUBLIC_APP_ENV as string) === 'staging' || (process.env.NODE_ENV as string) === 'staging')
      ? 'staging'
      : (typeof process !== 'undefined' && process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const secret = typeof process !== 'undefined' ? process.env?.KAZIBOX_WEBHOOK_SECRET : undefined;
  if (!secret) {
    if (env === 'production' || env === 'staging') {
      throw new Error(`[SECURITY ERROR] KAZIBOX_WEBHOOK_SECRET is required in ${env} environment.`);
    }
    return 'kz_whsec_mock_african_saas_hmac_secret_2026';
  }
  return secret;
}

export const INITIAL_WEBHOOK_QUEUE: WebhookQueueItem[] = [
  {
    id: 'wh-001',
    event: 'subscription.activated',
    moduleId: 'hotel-property',
    targetUrl: 'https://hotel.kazibox.internal/api/webhooks/platform',
    payload: {
      id: 'wh-001',
      event: 'subscription.activated',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      companyId: '11111111-1111-4111-8111-111111111111',
      planId: 'single',
      billingCycle: 'monthly',
      activatedAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    },
    status: 'delivered',
    attempts: 1,
    maxAttempts: 3,
    signature: 'sha256=a8f9c2d1e0',
    lastAttemptAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    createdAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    responseStatus: 200,
    responseBody: '{"received": true}',
  },
];

const globalForWebhooks = globalThis as unknown as {
  webhooksQueue: WebhookQueueItem[] | undefined;
  webhooksQueuePath: string | undefined;
};

function getWebhookQueueFilePath(): string | null {
  if (typeof window !== 'undefined') return null;
  if (typeof process !== 'undefined' && process.env?.KAZIBOX_DISABLE_DISK_STORE === '1') {
    return null;
  }
  try {
    if (typeof process !== 'undefined' && process.env?.KAZIBOX_WEBHOOK_QUEUE_PATH) {
      return path.resolve(process.env.KAZIBOX_WEBHOOK_QUEUE_PATH);
    }
    if (typeof process !== 'undefined' && process.env?.KAZIBOX_STORE_PATH) {
      return path.resolve(path.dirname(process.env.KAZIBOX_STORE_PATH), 'kazibox-webhooks-queue.json');
    }
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      return path.resolve(process.cwd(), '.cache', 'kazibox-webhooks-queue.json');
    }
  } catch {}
  return null;
}

function getQueue(): WebhookQueueItem[] {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_WEBHOOKS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
  }

  const filePath = getWebhookQueueFilePath() || 'memory';
  if (!globalForWebhooks.webhooksQueue || globalForWebhooks.webhooksQueuePath !== filePath) {
    let loaded: WebhookQueueItem[] | null = null;
    if (filePath !== 'memory' && fs && typeof fs.existsSync === 'function') {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            loaded = parsed;
          }
        }
      } catch {}
    }
    globalForWebhooks.webhooksQueue = loaded || [...INITIAL_WEBHOOK_QUEUE];
    globalForWebhooks.webhooksQueuePath = filePath;
  }
  return globalForWebhooks.webhooksQueue;
}

function saveQueue(queue: WebhookQueueItem[]) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_WEBHOOKS_KEY, JSON.stringify(queue));
    } catch {}
  }
  globalForWebhooks.webhooksQueue = queue;

  const filePath = getWebhookQueueFilePath();
  if (filePath && fs && typeof fs.writeFileSync === 'function') {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(queue, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch {}
  }
}

/**
 * Deterministic signature calculation safe for browser client bundles without Node 'crypto'
 */
function computeSignatureHex(secret: string, data: string): string {
  let h1 = 0xdeadbeef ^ secret.length;
  let h2 = 0x41c64e6d ^ data.length;
  const combined = `${secret}:${data}:${secret}`;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let fullSig = '';
  for (let i = 0; i < 4; i++) {
    fullSig += ((h1 ^ (i * 0x9e3779b9)) >>> 0).toString(16).padStart(8, '0');
    fullSig += ((h2 ^ (i * 0x517cc1b7)) >>> 0).toString(16).padStart(8, '0');
  }
  return fullSig;
}

/**
 * Sign payload using HMAC-SHA256 (standard Node crypto on server, deterministic fallback in browser)
 */
export function signWebhookPayload(
  payload: Record<string, any> | string,
  secret?: string
): string {
  const effectiveSecret = secret || getDefaultWebhookSecret();
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (crypto && typeof crypto.createHmac === 'function') {
    const hash = crypto.createHmac('sha256', effectiveSecret).update(payloadString, 'utf8').digest('hex');
    return `sha256=${hash}`;
  }
  const hash = computeSignatureHex(effectiveSecret, payloadString);
  return `sha256=${hash}`;
}

/**
 * Verifies an incoming webhook signature against the raw request body and secret.
 * Performs constant-time comparison to protect against timing attacks.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Record<string, any>,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const bodyString =
    typeof rawBody === 'string'
      ? rawBody
      : typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : JSON.stringify(rawBody);

  const rawSig = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;

  if (crypto && typeof crypto.createHmac === 'function' && typeof crypto.timingSafeEqual === 'function') {
    try {
      const expectedHex = crypto.createHmac('sha256', secret).update(bodyString, 'utf8').digest('hex');
      const rawSigBuf = Buffer.from(rawSig, 'hex');
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      if (rawSigBuf.length !== expectedBuf.length || rawSigBuf.length === 0) return false;
      return crypto.timingSafeEqual(rawSigBuf, expectedBuf);
    } catch {}
  }

  const expectedSig = computeSignatureHex(secret, bodyString);
  if (rawSig.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < rawSig.length; i++) {
    mismatch |= rawSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Executes an outbound HTTP POST delivery to the module's webhookUrl with retry support.
 */
async function executeWebhookHttpDelivery(params: {
  targetUrl: string;
  rawBody: string;
  signature: string;
  event: string;
  deliveryId: string;
  maxAttempts: number;
  initialAttempts?: number;
}): Promise<{
  status: 'delivered' | 'failed';
  attempts: number;
  responseStatus: number;
  responseBody: string;
  lastAttemptAt: string;
}> {
  const { targetUrl, rawBody, signature, event, deliveryId, maxAttempts } = params;
  let attempts = params.initialAttempts || 0;
  let lastStatus = 0;
  let lastBody = '';
  let lastAttemptAt = new Date().toISOString();

  const safetyCheck = await assertSafeOutboundUrl(targetUrl);
  if (!safetyCheck.safe) {
    return {
      status: 'failed',
      attempts: attempts + 1,
      responseStatus: 400,
      responseBody: safetyCheck.reason || `Invalid or unsafe webhook target URL: ${targetUrl || '(empty)'}`,
      lastAttemptAt,
    };
  }

  const maxTries = Math.max(1, maxAttempts - attempts);

  for (let i = 0; i < maxTries; i++) {
    attempts += 1;
    lastAttemptAt = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(targetUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'x-kazibox-signature': signature,
          'x-kazibox-event': event,
          'x-kazibox-delivery': deliveryId,
          'User-Agent': 'KaziBox-Webhook-Dispatcher/1.0',
        },
        body: rawBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;

      // Never follow or retry HTTP 3xx redirects (SSRF protection)
      if (lastStatus >= 300 && lastStatus < 400) {
        lastBody = `Blocked unsafe HTTP redirect (${lastStatus}) from webhook endpoint`;
        break;
      }
      try {
        lastBody = (await response.text()).slice(0, 2000);
      } catch {
        lastBody = '';
      }

      if (response.ok) {
        return {
          status: 'delivered',
          attempts,
          responseStatus: lastStatus,
          responseBody: lastBody || '{"received":true}',
          lastAttemptAt,
        };
      }

      // Do not auto-retry 4xx client errors (except 408/429)
      if (lastStatus >= 400 && lastStatus < 500 && lastStatus !== 408 && lastStatus !== 429) {
        break;
      }
    } catch (err: any) {
      lastStatus = 502;
      lastBody = `Network / transport error: ${err?.message || String(err)}`;
    }

    if (i < maxTries - 1) {
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }

  return {
    status: 'failed',
    attempts,
    responseStatus: lastStatus || 502,
    responseBody: lastBody || 'Webhook delivery failed',
    lastAttemptAt,
  };
}

/**
 * Dispatches an event to registered webhooks over real HTTP with HMAC-SHA256 signing,
 * idempotency event IDs, automatic retries, and persistent delivery logging.
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  payload: Record<string, any>,
  targetModuleId?: string
): Promise<WebhookQueueItem[]> {
  const queue = getQueue();
  const createdItems: WebhookQueueItem[] = [];

  // Resolve target modules dynamically from the persistent registry / database
  let candidateModules = [];
  if (targetModuleId) {
    const singleMod = await getModule(targetModuleId);
    if (singleMod) {
      candidateModules.push(singleMod);
    } else {
      const store = getStore();
      const fallback = store.modules.find((m) => m.id === targetModuleId || m.slug === targetModuleId);
      if (fallback) candidateModules.push(fallback);
    }
  } else {
    const allModules = await getModules();
    candidateModules = allModules.filter((m) => {
      if (m.status !== 'published' || !m.webhookUrl) return false;
      if (Array.isArray(m.events) && m.events.length > 0) {
        return m.events.includes(event);
      }
      return true;
    });
  }

  for (const mod of candidateModules) {
    const targetUrl = (mod.webhookUrl || '').trim();
    if (!targetUrl) continue;

    // Deduplicate if an identical delivery ID for the same module is already delivered
    const explicitEventId = payload.id || payload.eventId;
    if (explicitEventId) {
      const existingDelivered = queue.find(
        (q) => q.id === explicitEventId && q.moduleId === mod.id && q.status === 'delivered'
      );
      if (existingDelivered) {
        createdItems.push(existingDelivered);
        continue;
      }
    }

    const deliveryId =
      explicitEventId || `wh-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const companyId = payload.companyId || payload.workspaceId || '11111111-1111-4111-8111-111111111111';
    const timestamp = payload.timestamp || new Date().toISOString();

    const envelope: Record<string, any> = {
      ...payload,
      id: deliveryId,
      event,
      moduleId: mod.id,
      companyId,
      workspaceId: payload.workspaceId || companyId,
      timestamp,
      data: payload.data || {
        ...payload,
        moduleId: mod.id,
        workspaceId: payload.workspaceId || companyId,
      },
    };

    const rawBody = JSON.stringify(envelope);
    let webhookSecret: string;
    try {
      const secrets = await getModuleRuntimeSecrets(mod.id);
      webhookSecret = secrets.webhookSecret;
    } catch (err: any) {
      const failedItem: WebhookQueueItem = {
        id: deliveryId,
        event,
        moduleId: mod.id,
        targetUrl,
        payload: envelope,
        status: 'failed',
        attempts: 1,
        maxAttempts: 3,
        signature: '',
        lastAttemptAt: timestamp,
        createdAt: timestamp,
        responseStatus: 0,
        responseBody: `Webhook delivery aborted: ${err?.message || 'Missing webhook signing secret'}`,
      };
      const existingIdx = queue.findIndex((q) => q.id === deliveryId && q.moduleId === mod.id);
      if (existingIdx >= 0) {
        queue[existingIdx] = failedItem;
      } else {
        queue.unshift(failedItem);
      }
      createdItems.push(failedItem);
      continue;
    }

    const signature = signWebhookPayload(rawBody, webhookSecret);
    const maxAttempts = 3;

    const deliveryResult = await executeWebhookHttpDelivery({
      targetUrl,
      rawBody,
      signature,
      event,
      deliveryId,
      maxAttempts,
    });

    const item: WebhookQueueItem = {
      id: deliveryId,
      event,
      moduleId: mod.id,
      targetUrl,
      payload: envelope,
      status: deliveryResult.status,
      attempts: deliveryResult.attempts,
      maxAttempts,
      signature,
      lastAttemptAt: deliveryResult.lastAttemptAt,
      createdAt: timestamp,
      responseStatus: deliveryResult.responseStatus,
      responseBody: deliveryResult.responseBody,
    };

    const existingIdx = queue.findIndex((q) => q.id === deliveryId && q.moduleId === mod.id);
    if (existingIdx >= 0) {
      queue[existingIdx] = item;
    } else {
      queue.unshift(item);
    }
    createdItems.push(item);

    if (isSupabaseConfigured()) {
      const supabase: any =
        typeof window !== 'undefined'
          ? createBrowserClient()
          : createAdminClient() || createServerClient();
      if (supabase) {
        await supabase.from('webhook_events').insert({
          company_id: companyId,
          event_type: event,
          payload: {
            ...envelope,
            _delivery: {
              id: deliveryId,
              moduleId: mod.id,
              targetUrl,
              attempts: item.attempts,
              responseStatus: item.responseStatus,
              responseBody: item.responseBody,
              lastAttemptAt: item.lastAttemptAt,
            },
          },
          status: item.status,
        });
      }
    }
  }

  saveQueue(queue);
  return createdItems;
}

/**
 * Fetch all items in webhook queue
 */
export async function getWebhookQueue(): Promise<WebhookQueueItem[]> {
  return getQueue();
}

/**
 * Retries a failed or pending webhook item over real HTTP.
 */
export async function retryWebhook(id: string): Promise<WebhookQueueItem | null> {
  const queue = getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const item = queue[index];
  if (item.status === 'delivered') {
    return item;
  }

  // Refresh targetUrl if the module's webhookUrl was updated in the registry
  const mod = await getModule(item.moduleId);
  if (mod?.webhookUrl) {
    item.targetUrl = mod.webhookUrl;
  }

  const rawBody = JSON.stringify(item.payload);
  const { webhookSecret } = await getModuleRuntimeSecrets(item.moduleId);
  const signature = signWebhookPayload(rawBody, webhookSecret);
  item.signature = signature;

  const deliveryResult = await executeWebhookHttpDelivery({
    targetUrl: item.targetUrl,
    rawBody,
    signature,
    event: item.event,
    deliveryId: item.id,
    maxAttempts: item.attempts + 1,
    initialAttempts: item.attempts,
  });

  item.attempts = deliveryResult.attempts;
  item.lastAttemptAt = deliveryResult.lastAttemptAt;
  item.status = deliveryResult.status;
  item.responseStatus = deliveryResult.responseStatus;
  item.responseBody = deliveryResult.responseBody;

  queue[index] = item;
  saveQueue(queue);

  if (isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const companyId = item.payload?.companyId || item.payload?.workspaceId || null;
      await supabase.from('webhook_events').insert({
        company_id: companyId,
        event_type: item.event,
        payload: {
          ...item.payload,
          _delivery: {
            id: item.id,
            moduleId: item.moduleId,
            targetUrl: item.targetUrl,
            attempts: item.attempts,
            responseStatus: item.responseStatus,
            responseBody: item.responseBody,
            retriedAt: item.lastAttemptAt,
          },
        },
        status: item.status,
      });
    }
  }

  return item;
}
