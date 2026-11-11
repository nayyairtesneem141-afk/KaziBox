import { ModuleSummary, PlatformContext } from './contracts.js';
import { verifySsoToken, issueSsoToken, IssueSsoTokenParams, SsoVerificationResult, DEFAULT_SSO_SECRET } from './sso.js';
import { verifyWebhookSignature, signWebhookPayload } from './webhooks.js';
import {
  HeadlessAuthExchangeRequest,
  HeadlessAuthResponse,
  HeadlessCheckoutRequest,
  HeadlessCheckoutResponse,
} from './types.js';
import * as nodeCrypto from 'crypto';

export const KAZIBOX_PLATFORM_ISSUER = 'https://platform.kazibox.com';

export interface VerifyUserTokenOptions {
  /**
   * Public key PEM string (SPKI format) obtained from GET /api/v1/auth/jwks?format=pem.
   * Required. Never pass a private key here.
   */
  publicKeyPem: string;
  /**
   * Expected audience. Must match the moduleId that issued the token.
   * Reject tokens whose 'aud' claim does not equal this value.
   */
  expectedAudience: string;
  /**
   * Expected issuer. Defaults to 'https://platform.kazibox.com'.
   * Reject tokens whose 'iss' claim does not match.
   */
  expectedIssuer?: string;
  /**
   * Expected token_use. Must be 'user_api' for headless user tokens.
   */
  expectedTokenUse?: string;
}

export interface VerifyUserTokenResult {
  valid: boolean;
  claims?: {
    sub: string;
    email: string;
    name: string;
    role: string;
    company_id: string;
    workspace_id: string;
    aud: string;
    iss: string;
    token_use: string;
    scopes: string[];
    iat: number;
    exp: number;
    jti: string;
  };
  error?: string;
  code?: 'INVALID_FORMAT' | 'SIGNATURE_MISMATCH' | 'EXPIRED' | 'AUDIENCE_MISMATCH' | 'ISSUER_MISMATCH' | 'TOKEN_USE_MISMATCH' | 'PARSE_ERROR';
}

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
   * RS256 User API Token Verifier.
   *
   * Verifies a headless user token issued by KaziBox's POST /api/v1/auth/exchange endpoint.
   * Uses PUBLIC-KEY-ONLY RS256 verification. Never requires or accepts a private key.
   *
   * Checks (all mandatory):
   *  - RS256 cryptographic signature using the provided publicKeyPem
   *  - Token expiry (exp claim)
   *  - Issuer (iss === 'https://platform.kazibox.com')
   *  - Audience (aud === options.expectedAudience)
   *  - token_use === 'user_api'
   *
   * @param token - The Bearer access_token string from /api/v1/auth/exchange response
   * @param options - Verification options including publicKeyPem and expectedAudience (both required)
   */
  public verifyUserToken(token: string, options: VerifyUserTokenOptions): VerifyUserTokenResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or not a string', code: 'INVALID_FORMAT' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token: expected 3 dot-separated parts', code: 'INVALID_FORMAT' };
    }

    const [encodedHeader, encodedPayload, encodedSig] = parts;

    // 1. Verify RS256 signature using the provided PUBLIC key only
    if (!options.publicKeyPem || typeof options.publicKeyPem !== 'string') {
      return { valid: false, error: 'publicKeyPem is required for RS256 verification', code: 'INVALID_FORMAT' };
    }

    // Guard: reject anything that looks like a private key
    if (options.publicKeyPem.includes('PRIVATE KEY')) {
      return { valid: false, error: 'publicKeyPem must be a public key (SPKI format). Private keys are not accepted.', code: 'INVALID_FORMAT' };
    }

    try {
      const dataToVerify = `${encodedHeader}.${encodedPayload}`;
      const b64Sig = encodedSig.replace(/-/g, '+').replace(/_/g, '/');
      const sigBuffer = Buffer.from(b64Sig, 'base64');

      const verifier = nodeCrypto.createVerify('RSA-SHA256');
      verifier.update(dataToVerify, 'utf-8');
      const sigValid = verifier.verify(options.publicKeyPem, sigBuffer);
      if (!sigValid) {
        return { valid: false, error: 'RS256 signature verification failed', code: 'SIGNATURE_MISMATCH' };
      }
    } catch (sigErr: any) {
      return { valid: false, error: `Signature check error: ${sigErr?.message}`, code: 'SIGNATURE_MISMATCH' };
    }

    // 2. Decode and validate claims
    let claims: any;
    try {
      let b64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
      while (b64Payload.length % 4) b64Payload += '=';
      claims = JSON.parse(Buffer.from(b64Payload, 'base64').toString('utf-8'));
    } catch (parseErr: any) {
      return { valid: false, error: 'Failed to decode token payload', code: 'PARSE_ERROR' };
    }

    // 3. Expiry
    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) {
      return {
        valid: false,
        error: `Token expired at ${new Date((claims.exp || 0) * 1000).toISOString()}`,
        code: 'EXPIRED',
      };
    }

    // 4. Issuer
    const expectedIssuer = options.expectedIssuer || KAZIBOX_PLATFORM_ISSUER;
    if (claims.iss !== expectedIssuer) {
      return {
        valid: false,
        error: `Issuer mismatch: expected '${expectedIssuer}', got '${claims.iss}'`,
        code: 'ISSUER_MISMATCH',
      };
    }

    // 5. Audience (mandatory — partner MUST specify their moduleId)
    if (!options.expectedAudience) {
      return { valid: false, error: 'expectedAudience is required', code: 'INVALID_FORMAT' };
    }
    if (claims.aud !== options.expectedAudience) {
      return {
        valid: false,
        error: `Audience mismatch: expected '${options.expectedAudience}', got '${claims.aud}'`,
        code: 'AUDIENCE_MISMATCH',
      };
    }

    // 6. token_use
    const expectedTokenUse = options.expectedTokenUse || 'user_api';
    if (claims.token_use !== expectedTokenUse) {
      return {
        valid: false,
        error: `token_use mismatch: expected '${expectedTokenUse}', got '${claims.token_use}'`,
        code: 'TOKEN_USE_MISMATCH',
      };
    }

    return { valid: true, claims };
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
