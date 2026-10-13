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

export const DEFAULT_MOTEUR_API_BASE_URL = 'https://moteur.kazibox.pro';

/**
 * Reads server environment variables for Moteur without leaking secret values
 */
export function getMoteurConfig(): MoteurConfig | null {
  if (typeof window !== 'undefined') {
    // Strictly prevent invocation from client-side code
    throw new Error('SECURITY VIOLATION: Moteur configuration cannot be accessed from client-side bundles');
  }

  const baseUrl = process.env.MOTEUR_API_BASE_URL || process.env.MOTEUR_BACKEND_URL || DEFAULT_MOTEUR_API_BASE_URL;
  const apiKey = process.env.MOTEUR_API_KEY || process.env.MOTEUR_SECRET_KEY || '';
  const webhookSecret = process.env.MOTEUR_WEBHOOK_SECRET || '';
  const environment = (process.env.MOTEUR_ENVIRONMENT === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production';
  const timeoutMs = Number(process.env.MOTEUR_TIMEOUT_MS) || 15000;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''), // Strip trailing slashes
    apiKey,
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
  const baseUrl = process.env.MOTEUR_API_BASE_URL || process.env.MOTEUR_BACKEND_URL || DEFAULT_MOTEUR_API_BASE_URL;
  const hasBaseUrl = Boolean(baseUrl);
  const hasApiKey = Boolean(process.env.MOTEUR_API_KEY || process.env.MOTEUR_SECRET_KEY);
  const hasWebhookSecret = Boolean(process.env.MOTEUR_WEBHOOK_SECRET);
  const environment = process.env.MOTEUR_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

  const missingVariables: string[] = [];
  if (!process.env.MOTEUR_API_BASE_URL && !process.env.MOTEUR_BACKEND_URL) {
    // Base URL defaults to confirmed custom domain: https://moteur.kazibox.pro
  }
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
