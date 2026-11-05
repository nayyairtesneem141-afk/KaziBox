import { KaziBoxClient } from '@kazibox/sdk';

export function getPharmaStockClient(workspaceId?: string): KaziBoxClient {
  const env: Record<string, string | undefined> = typeof process !== 'undefined' ? (process.env as any) || {} : {};
  const isStrictEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';

  const apiKey = env.KAZIBOX_API_KEY;
  const baseUrl = env.KAZIBOX_API_URL;
  const ssoSecret = env.KAZIBOX_SSO_SECRET;
  const webhookSecret = env.KAZIBOX_WEBHOOK_SECRET;

  if (isStrictEnv) {
    const missing: string[] = [];
    if (!apiKey) missing.push('KAZIBOX_API_KEY');
    if (!baseUrl) missing.push('KAZIBOX_API_URL');
    if (!ssoSecret) missing.push('KAZIBOX_SSO_SECRET');
    if (!webhookSecret) missing.push('KAZIBOX_WEBHOOK_SECRET');

    if (missing.length > 0) {
      throw new Error(
        `[SECURITY ABORT] Missing required environment variables in ${env.NODE_ENV}: ${missing.join(', ')}. ` +
        `Refusing execution with insecure fallbacks.`
      );
    }

    if (env.NODE_ENV === 'staging' && baseUrl?.includes('platform.kazibox.com')) {
      throw new Error(
        `[SECURITY ABORT] Staging environment misconfiguration: KAZIBOX_API_URL points to production (${baseUrl}). ` +
        `Must point to staging platform (e.g. https://staging.kazibox.pro).`
      );
    }
  }

  return new KaziBoxClient({
    apiKey: apiKey || 'kz_test_pharmastock_sec_default_mock_key',
    baseUrl: baseUrl || 'http://localhost:3000',
    workspaceId,
    moduleId: 'pharmastock',
    ssoSecret: ssoSecret || 'kazibox_mock_sso_secret_key_prod_env_replace',
    webhookSecret: webhookSecret || 'kazibox_mock_webhook_secret_pharma',
  });
}
