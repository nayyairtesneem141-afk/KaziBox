import { computeHmacSha256Hex } from './crypto.js';
import { WebhookEvent } from './contracts.js';

export type WebhookEventType =
  | 'module.activated'
  | 'module.deactivated'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'workspace.updated';

export interface WebhookEnvelope<T = Record<string, any>> {
  id: string;
  event: WebhookEventType;
  moduleId?: string;
  companyId: string;
  timestamp: string;
  data: T;
}

/**
 * Computes standard x-kazibox-signature header format: `sha256=<hex_digest>`.
 */
export function signWebhookPayload(rawBody: string, webhookSecret: string): string {
  const hash = computeHmacSha256Hex(webhookSecret, rawBody);
  return `sha256=${hash}`;
}

/**
 * Verifies standard x-kazibox-signature header format: `sha256=<hex_digest>`.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headerSignature: string | null | undefined,
  webhookSecret: string
): boolean {
  if (!headerSignature || !webhookSecret || typeof rawBody !== 'string') {
    return false;
  }

  const expectedSignature = signWebhookPayload(rawBody, webhookSecret);
  return headerSignature === expectedSignature;
}
