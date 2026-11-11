import { ModuleSummary, PlatformContext } from './contracts.js';
import { verifySsoToken, issueSsoToken, IssueSsoTokenParams, SsoVerificationResult, DEFAULT_SSO_SECRET } from './sso.js';
import { verifyWebhookSignature, signWebhookPayload } from './webhooks.js';
import {
  HeadlessAuthExchangeRequest,
  HeadlessAuthResponse,
  HeadlessCheckoutRequest,
  HeadlessCheckoutResponse,
} from './types.js';

export interface KaziBoxClientConfig {
  apiKey: string;
  baseUrl?: string;
  workspaceId?: string;
  moduleId?: string;
  ssoSecret?: string;
  webhookSecret?: string;
  timeoutMs?: number;
}

export interface KaziBoxApiResponse<T = any> {
  status: number;
  ok: boolean;
  data: T | null;
  error?: string;
}

export interface RecordRevenueParams {
  amount: number;
  currency?: string;
  source: string;
  reference: string;
  occurredAt?: string;
  moduleId?: string;
  metadata?: Record<string, any>;
}

export interface RecordExpenseParams {
  amount: number;
  currency?: string;
  category: string;
  reference: string;
  occurredAt?: string;
  moduleId?: string;
  metadata?: Record<string, any>;
}

export interface EmitEventParams {
  action: string;
  entity: string;
  entityId: string;
  moduleId?: string;
  details?: Record<string, any>;
}

/**
 * Standard KaziBox Integration Kit client library.
 * Designed for external SaaS modules (e.g. PharmaStock, Hotel, Garage)
 * to communicate seamlessly, securely, and multi-tenant-isolated with KaziBox.
 */
export class KaziBoxClient {
  private apiKey: string;
  private baseUrl: string;
  private workspaceId?: string;
  private moduleId?: string;
  private ssoSecret: string;
  private webhookSecret?: string;
  private timeoutMs: number;

  constructor(config: KaziBoxClientConfig) {
    if (!config.apiKey) {
      throw new Error('KaziBoxClient requires an apiKey');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    this.workspaceId = config.workspaceId;
    this.moduleId = config.moduleId;
    this.ssoSecret = config.ssoSecret || DEFAULT_SSO_SECRET;
    this.webhookSecret = config.webhookSecret;
    this.timeoutMs = config.timeoutMs || 10000;
  }

  /**
   * Sets or switches active workspace/tenant context.
   */
  public setWorkspace(workspaceId: string): this {
    this.workspaceId = workspaceId;
    return this;
  }

  /**
   * Returns current active workspace/tenant ID.
   */
  public getWorkspaceId(): string | undefined {
    return this.workspaceId;
  }

  /**
   * Low-level HTTP dispatch with automatic header decoration and timeout.
   */
  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<KaziBoxApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.workspaceId && !headers['X-Workspace-Id']) {
      headers['X-Workspace-Id'] = this.workspaceId;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller?.signal,
      });

      const data = await res.json().catch(() => null);
      return {
        status: res.status,
        ok: res.ok,
        data,
        error: res.ok ? undefined : (data?.message || data?.error || `HTTP ${res.status}`),
      };
    } catch (err: any) {
      return {
        status: 0,
        ok: false,
        data: null,
        error: err?.message || 'Network request failed',
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * GET /api/v1/context
   * Resolves workspace, user, active role, language, and accessible modules.
   */
  public async getContext(options?: { userId?: string; workspaceId?: string }): Promise<KaziBoxApiResponse<PlatformContext & any>> {
    const headers: Record<string, string> = {};
    if (options?.userId) {
      headers['X-User-Id'] = options.userId;
    }
    if (options?.workspaceId) {
      headers['X-Workspace-Id'] = options.workspaceId;
    }
    return this.request('/api/v1/context', { method: 'GET', headers });
  }

  /**
   * GET /api/v1/subscription
   * Verifies workspace subscription status and entitlement for the calling module.
   */
  public async getSubscription(workspaceId?: string): Promise<KaziBoxApiResponse<any>> {
    const headers: Record<string, string> = {};
    if (workspaceId) {
      headers['X-Workspace-Id'] = workspaceId;
    }
    return this.request('/api/v1/subscription', { method: 'GET', headers });
  }

  /**
   * POST /api/v1/finance/revenue
   * Emits operational revenue to the KaziBox consolidated ledger (idempotent by reference).
   */
  public async recordRevenue(params: RecordRevenueParams): Promise<KaziBoxApiResponse<any>> {
    const payload = {
      moduleId: params.moduleId || this.moduleId || 'module',
      amount: params.amount,
      currency: params.currency || 'XOF',
      source: params.source,
      reference: params.reference,
      occurredAt: params.occurredAt || new Date().toISOString(),
      metadata: params.metadata,
    };
    return this.request('/api/v1/finance/revenue', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * POST /api/v1/finance/expenses
   * Emits operational expenses to the KaziBox consolidated ledger (idempotent by reference).
   */
  public async recordExpense(params: RecordExpenseParams): Promise<KaziBoxApiResponse<any>> {
    const payload = {
      moduleId: params.moduleId || this.moduleId || 'module',
      amount: params.amount,
      currency: params.currency || 'XOF',
      category: params.category,
      reference: params.reference,
      occurredAt: params.occurredAt || new Date().toISOString(),
      metadata: params.metadata,
    };
    return this.request('/api/v1/finance/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * POST /api/v1/events
   * Ingests operational business events for activity auditing.
   */
  public async emitEvent(params: EmitEventParams): Promise<KaziBoxApiResponse<any>> {
    const payload = {
      moduleId: params.moduleId || this.moduleId || 'module',
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      details: params.details || {},
    };
    return this.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Cryptographic SSO Handshake Verifier.
   * Validates incoming handoff token against SSO secret and 5-minute TTL.
   */
  public verifySso(token: string): SsoVerificationResult {
    return verifySsoToken(token, this.ssoSecret);
  }

  /**
   * Cryptographic SSO Token Issuer (for testing and platform emulation).
   */
  public issueSso(params: IssueSsoTokenParams): string {
    return issueSsoToken(params, this.ssoSecret);
  }

  /**
   * Webhook Signature Verifier.
   */
  public verifyWebhook(rawBody: string, signature: string | null | undefined): boolean {
    if (!this.webhookSecret) {
      throw new Error('KaziBoxClient webhookSecret must be set to verify webhooks');
    }
    return verifyWebhookSignature(rawBody, signature, this.webhookSecret);
  }

  /**
   * Webhook Payload Signer.
   */
  public signWebhook(rawBody: string): string {
    if (!this.webhookSecret) {
      throw new Error('KaziBoxClient webhookSecret must be set to sign webhooks');
    }
    return signWebhookPayload(rawBody, this.webhookSecret);
  }

  /**
   * Generates the browser authorize URL for initiating OAuth PKCE authorization.
   */
  public getAuthorizeUrl(params: {
    redirectUri: string;
    codeChallenge: string;
    state: string;
    testUserId?: string;
    testCompanyId?: string;
  }): string {
    const url = new URL(`${this.baseUrl}/api/v1/auth/authorize`);
    url.searchParams.set('module_id', this.moduleId || '');
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', params.state);
    if (params.testUserId) url.searchParams.set('test_user_id', params.testUserId);
    if (params.testCompanyId) url.searchParams.set('test_company_id', params.testCompanyId);
    return url.toString();
  }

  /**
   * Exchanges an authorization code and PKCE code_verifier for an asymmetric RS256 User Token.
   */
  public async exchangeAuthCode(
    params: HeadlessAuthExchangeRequest
  ): Promise<KaziBoxApiResponse<HeadlessAuthResponse>> {
    return this.request('/api/v1/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: params.redirectUri,
      }),
    });
  }

  /**
   * Initiates a headless checkout session via Module API Key (write:billing scope).
   */
  public async initiateCheckout(
    params: HeadlessCheckoutRequest
  ): Promise<KaziBoxApiResponse<HeadlessCheckoutResponse>> {
    const payload = {
      companyId: params.companyId || this.workspaceId,
      planId: params.planId,
      billingCycle: params.billingCycle,
      moduleIds: params.moduleIds || (this.moduleId ? [this.moduleId] : []),
      country: params.country || 'CI',
      amount: params.amount,
      referralCode: params.referralCode,
      customer: params.customer,
      returnUrl: params.returnUrl,
    };
    return this.request('/api/v1/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
