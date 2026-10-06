import { getStore } from './storage';

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
const MOCK_WEBHOOK_SECRET = 'kz_whsec_mock_african_saas_hmac_secret_2026';

export const INITIAL_WEBHOOK_QUEUE: WebhookQueueItem[] = [
  {
    id: 'wh-001',
    event: 'subscription.activated',
    moduleId: 'hotel-property',
    targetUrl: 'https://hotel.kazibox.internal/api/webhooks/platform',
    payload: {
      event: 'subscription.activated',
      workspaceId: 'ws-palmeraie-01',
      planId: 'single',
      billingCycle: 'monthly',
      activatedAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    },
    status: 'delivered',
    attempts: 1,
    maxAttempts: 3,
    signature: 'sha256_mock_a8f9c2d1e0',
    lastAttemptAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    createdAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    responseStatus: 200,
    responseBody: '{"received": true}',
  },
  {
    id: 'wh-002',
    event: 'module.activated',
    moduleId: 'hotel-property',
    targetUrl: 'https://hotel.kazibox.internal/api/webhooks/platform',
    payload: {
      event: 'module.activated',
      workspaceId: 'ws-palmeraie-01',
      moduleId: 'hotel-property',
      activatedBy: 'usr-owner-01',
      timestamp: new Date(Date.now() - 3600 * 1000 * 20).toISOString(),
    },
    status: 'delivered',
    attempts: 1,
    maxAttempts: 3,
    signature: 'sha256_mock_b7e6d5c4',
    lastAttemptAt: new Date(Date.now() - 3600 * 1000 * 20).toISOString(),
    createdAt: new Date(Date.now() - 3600 * 1000 * 20).toISOString(),
    responseStatus: 200,
    responseBody: '{"received": true}',
  },
  {
    id: 'wh-003',
    event: 'user.role_changed',
    moduleId: 'hotel-property',
    targetUrl: 'https://hotel.kazibox.internal/api/webhooks/platform',
    payload: {
      event: 'user.role_changed',
      workspaceId: 'ws-palmeraie-01',
      userId: 'usr-worker-03',
      previousRole: 'worker',
      newRole: 'manager',
      updatedBy: 'usr-owner-01',
      timestamp: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    },
    status: 'failed',
    attempts: 3,
    maxAttempts: 3,
    signature: 'sha256_mock_f1e2d3c4',
    lastAttemptAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    createdAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    responseStatus: 504,
    responseBody: 'Gateway Timeout: Module endpoint unresponsive',
  },
  {
    id: 'wh-004',
    event: 'module.activated',
    moduleId: 'demo',
    targetUrl: '/api/mock-demo-webhook',
    payload: {
      event: 'module.activated',
      workspaceId: 'ws-palmeraie-01',
      moduleId: 'demo',
      timestamp: new Date().toISOString(),
    },
    status: 'delivered',
    attempts: 1,
    maxAttempts: 3,
    signature: 'sha256_mock_c9a8b7',
    lastAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    responseStatus: 200,
    responseBody: '{"received": true, "demo": true}',
  },
];

const globalForWebhooks = globalThis as unknown as {
  webhooksQueue: WebhookQueueItem[] | undefined;
};

function getQueue(): WebhookQueueItem[] {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_WEBHOOKS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
  }
  if (!globalForWebhooks.webhooksQueue) {
    globalForWebhooks.webhooksQueue = [...INITIAL_WEBHOOK_QUEUE];
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
 * Sign payload using HMAC-SHA256 simulation safe for client and server
 */
export function signWebhookPayload(payload: Record<string, any>, secret: string = MOCK_WEBHOOK_SECRET): string {
  const payloadString = JSON.stringify(payload);
  const hash = computeSignatureHex(secret, payloadString);
  return `sha256=${hash}`;
}

/**
 * Dispatches an event to registered webhooks
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  payload: Record<string, any>,
  targetModuleId?: string
): Promise<WebhookQueueItem[]> {
  const store = getStore();
  const queue = getQueue();

  // Find target modules
  const candidateModules = store.modules.filter((m) => {
    if (targetModuleId) return m.id === targetModuleId || m.slug === targetModuleId;
    return m.status === 'published' && m.webhookUrl;
  });

  const createdItems: WebhookQueueItem[] = [];

  for (const mod of candidateModules) {
    const signature = signWebhookPayload({ event, ...payload });
    const item: WebhookQueueItem = {
      id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      event,
      moduleId: mod.id,
      targetUrl: mod.webhookUrl || `https://${mod.slug}.kazibox.internal/webhook`,
      payload: { event, moduleId: mod.id, ...payload },
      status: 'delivered', // simulated immediate delivery
      attempts: 1,
      maxAttempts: 3,
      signature,
      lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      responseStatus: 200,
      responseBody: '{"received": true}',
    };

    queue.unshift(item);
    createdItems.push(item);
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
 * Retries a failed or pending webhook item
 */
export async function retryWebhook(id: string): Promise<WebhookQueueItem | null> {
  const queue = getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const item = queue[index];
  item.attempts += 1;
  item.lastAttemptAt = new Date().toISOString();

  // Simulate success on retry
  item.status = 'delivered';
  item.responseStatus = 200;
  item.responseBody = '{"received": true, "retried": true}';

  queue[index] = item;
  saveQueue(queue);
  return item;
}
