import { MoteurConfig } from './types';
import { MOTEUR_PAYMENT_DESCRIPTION } from './countries';

/**
 * Server-only configuration loader for Moteur
 *
 * Security requirements:
 * - Credentials must NEVER be loaded in browser client bundles.
 * - Credentials must NEVER be logged or leaked in error messages.
 * - Returns sanitized diagnostics when reporting configuration readiness.
 */

export interface MoteurConfigurationStatus {
  isConfigured: boolean;
  hasBaseUrl: boolean;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  environment: 'sandbox' | 'production';
  missingVariables: string[];
}

export const DEFAULT_MOTEUR_API_BASE_URL = 'https://lvfoklqxqwgpktylphbu.supabase.co/functions/v1/engine-api-gateway';
export const DEFAULT_MOTEUR_SAAS_ID = '167a0c84-ce3c-488c-8367-d2e649933f34';

/**
 * Reads server environment variables for Moteur without leaking secret values
 */
export function getMoteurConfig(): MoteurConfig | null {
  if (typeof window !== 'undefined') {
    // Strictly prevent invocation from client-side code
    throw new Error('SECURITY VIOLATION: Moteur configuration cannot be accessed from client-side bundles');
  }

  const configuredUrl = process.env.MOTEUR_API_BASE_URL || process.env.MOTEUR_BACKEND_URL;
  // If unconfigured or pointing to dead custom domain (moteur.kazibox.pro), fall back to live gateway
  const baseUrl = !configuredUrl || configuredUrl.includes('moteur.kazibox.pro')
    ? DEFAULT_MOTEUR_API_BASE_URL
    : configuredUrl;

  const apiKey = process.env.MOTEUR_API_KEY || process.env.MOTEUR_SECRET_KEY || '';
  const gatewayBearerToken = process.env.MOTEUR_GATEWAY_BEARER_TOKEN || '';
  const appCode = process.env.MOTEUR_APP_CODE || 'demosaas';
  const saasId = process.env.MOTEUR_SAAS_ID || DEFAULT_MOTEUR_SAAS_ID;
  const webhookSecret = process.env.MOTEUR_WEBHOOK_SECRET || '';
  const environment = (process.env.MOTEUR_ENVIRONMENT === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production';
  const timeoutMs = Number(process.env.MOTEUR_TIMEOUT_MS) || 15000;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''), // Strip trailing slashes
    apiKey,
    gatewayBearerToken: gatewayBearerToken || undefined,
    appCode,
    saasId,
    webhookSecret,
    environment,
    paymentDescription: MOTEUR_PAYMENT_DESCRIPTION,
    timeoutMs,
  };
}

/**
 * Inspects server environment to report integration readiness without exposing secrets
 */
export function getMoteurConfigStatus(): MoteurConfigurationStatus {
  const configuredUrl = process.env.MOTEUR_API_BASE_URL || process.env.MOTEUR_BACKEND_URL;
  const baseUrl = !configuredUrl || configuredUrl.includes('moteur.kazibox.pro')
    ? DEFAULT_MOTEUR_API_BASE_URL
    : configuredUrl;
  const hasBaseUrl = Boolean(baseUrl);
  const hasApiKey = Boolean(process.env.MOTEUR_API_KEY || process.env.MOTEUR_SECRET_KEY);
  const hasWebhookSecret = Boolean(process.env.MOTEUR_WEBHOOK_SECRET);
  const environment = process.env.MOTEUR_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

  const missingVariables: string[] = [];
  if (!hasApiKey) missingVariables.push('MOTEUR_API_KEY');
  if (!hasWebhookSecret) missingVariables.push('MOTEUR_WEBHOOK_SECRET');

  return {
    isConfigured: hasBaseUrl && hasApiKey,
    hasBaseUrl,
    hasApiKey,
    hasWebhookSecret,
    environment,
    missingVariables,
  };
}

/**
 * Helper to mask sensitive strings for safe diagnostic logging
 * e.g., 'kz_live_12345678' -> 'kz_l...5678'
 */
export function maskSecret(secret?: string | null): string {
  if (!secret) return '[NOT_SET]';
  if (secret.length <= 8) return '***';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
