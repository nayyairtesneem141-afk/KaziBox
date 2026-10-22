import crypto from 'crypto';
import {
  MoteurConfig,
  MoteurInitiatePaymentRequest,
  MoteurInitiatePaymentResponse,
  MoteurVerifyPaymentRequest,
  MoteurVerifyPaymentResponse,
  MoteurRefundRequest,
  MoteurRefundResponse,
  MoteurWebhookEvent,
} from './types';
import { getMoteurConfig, getMoteurConfigStatus, maskSecret } from './config';
import { MOTEUR_PAYMENT_DESCRIPTION } from './countries';

/**
 * Custom error class for Moteur integration boundary
 */
export class MoteurIntegrationError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'MOTEUR_ERROR', statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'MoteurIntegrationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Transport fetch function signature (allows dependency injection for testing)
 */
export type MoteurHttpFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Server-Side Moteur Payment Infrastructure Adapter
 *
 * Implements the isolated boundary between KaziBox Core and Moteur centralized payment infrastructure.
 */
export class MoteurAdapter {
  private config: MoteurConfig | null;
  private httpFetch: MoteurHttpFetch;

  constructor(customConfig?: MoteurConfig | null, customFetch?: MoteurHttpFetch) {
    this.config = customConfig !== undefined ? customConfig : getMoteurConfig();
    this.httpFetch = customFetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : (fetch as any));
  }

  /**
   * Returns current configuration readiness
   */
  public isReady(): boolean {
    return Boolean(this.config && this.config.baseUrl && this.config.apiKey);
  }

  /**
   * Returns configuration status without leaking secrets
   */
  public getStatus() {
    return getMoteurConfigStatus();
  }

  /**
   * Initiates a payment session through Moteur
   */
  public async initiatePaymentSession(
    request: MoteurInitiatePaymentRequest
  ): Promise<MoteurInitiatePaymentResponse> {
    if (!this.config || !this.isReady()) {
      return {
        success: false,
        sessionId: '',
        reference: request.idempotencyKey,
        status: 'pending',
        errorCode: 'MOTEUR_NOT_CONFIGURED',
        errorMessage:
          'Moteur centralized payment backend is pending client credentials and migration. Live payment requests are withheld.',
      };
    }

    // Build payload preserving referral attribution and fixed description
    const saasId = this.config.saasId || '167a0c84-ce3c-488c-8367-d2e649933f34';
    const appCode = this.config.appCode || 'demosaas';
    const subscriberExtId =
      request.subscriberExtId ||
      request.companyId ||
      (request.customer as any)?.id ||
      'unknown';
    const subscriberEmail = request.customer?.email || undefined;
    const subscriberName = request.customer?.name || undefined;
    const subscriberPhone = request.customer?.phone || undefined;
    const rawPlanKey = request.planKey || request.planId || 'starter';
    const planKey =
      rawPlanKey === 'single'
        ? 'starter'
        : rawPlanKey === 'bundle'
        ? 'pro'
        : rawPlanKey;
    const returnUrl = request.returnUrl || 'https://kazibox.com/billing';
    const callbackUrl = request.callbackUrl || undefined;

    const payload = {
      action: 'payments.collect',
      app_code: appCode,
      application_code: appCode,
      saas_id: saasId,
      subscriber_ext_id: subscriberExtId,
      subscriber_id: subscriberExtId,
      subscriber_email: subscriberEmail,
      subscriber_name: subscriberName,
      subscriber_phone: subscriberPhone,
      customer_email: subscriberEmail,
      customer_name: subscriberName,
      customer_phone: subscriberPhone,
      company_id: request.companyId,
      plan_key: planKey,
      plan_id: request.planId,
      planKey: planKey,
      plan_code: planKey,
      module_key: request.moduleIds?.[0] || planKey,
      module_keys: request.moduleIds,
      module_ids: request.moduleIds,
      billing_cycle: request.billingCycle,
      cycle: request.billingCycle,
      period: request.billingCycle,
      description: MOTEUR_PAYMENT_DESCRIPTION,
      amount: request.amount,
      currency: request.currency,
      country: request.country,
      idempotency_key: request.idempotencyKey,
      reference: request.idempotencyKey,
      return_url: returnUrl,
      redirect_url: returnUrl,
      callback_url: callbackUrl,
      metadata: {
        app_code: appCode,
        saas_id: saasId,
        company_id: request.companyId,
        subscriber_ext_id: subscriberExtId,
        subscriber_id: subscriberExtId,
        plan_key: planKey,
        plan_id: request.planId,
        module_ids: request.moduleIds,
        module_keys: request.moduleIds,
        billing_cycle: request.billingCycle,
        cycle: request.billingCycle,
        // Preserve referral attribution for Moteur ambassador commission calculations
        referral_code: request.referralCode || null,
        description: MOTEUR_PAYMENT_DESCRIPTION,
        ...(request.metadata || {}),
      },
      customer: {
        id: request.customer?.id || subscriberExtId,
        ext_id: subscriberExtId,
        subscriber_ext_id: subscriberExtId,
        name: subscriberName,
        email: subscriberEmail,
        phone: subscriberPhone,
        ...(request.customer || {}),
      },
    };

    const endpoint = this.config.baseUrl.endsWith('/api/v1/payments/collect')
      ? this.config.baseUrl
      : `${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/payments/collect`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['x-engine-api-key'] = this.config.apiKey;
    }
    const bearer = this.config.gatewayBearerToken || this.config.apiKey;
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
      headers['apikey'] = bearer;
    }
    headers['X-Idempotency-Key'] = request.idempotencyKey;

    try {
      const response = await this.executeHttpRequest(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }
      );

      const json = await response.json();

      if (!response.ok) {
        const detailStr =
          typeof json === 'object' && json !== null
            ? json.details ||
              json.detail ||
              json.hint ||
              json.reason ||
              json.error_description ||
              (typeof json.error === 'object' ? json.error?.message || json.error?.details : null)
            : null;

        const codeStr = json.code || (typeof json.error === 'object' ? json.error?.code : null);
        const reqId = json.request_id || json.requestId;

        const baseMsg =
          json.message ||
          (typeof json.error === 'string' ? json.error : json.error?.message) ||
          'Moteur payment session initialization failed';

        const extraParts: string[] = [];
        if (codeStr && codeStr !== `HTTP_${response.status}`) extraParts.push(`code: ${codeStr}`);
        if (detailStr && detailStr !== baseMsg) extraParts.push(`détails: ${typeof detailStr === 'object' ? JSON.stringify(detailStr) : detailStr}`);
        if (reqId) extraParts.push(`req_id: ${reqId}`);

        const errorMsg = extraParts.length > 0 ? `${baseMsg} (${extraParts.join(' | ')})` : baseMsg;

        return {
          success: false,
          sessionId: '',
          reference: request.idempotencyKey,
          status: 'failed',
          errorCode: json.code || (typeof json.error === 'object' ? json.error?.code : null) || `HTTP_${response.status}`,
          errorMessage: errorMsg,
          raw: json,
        };
      }

      return {
        success: true,
        sessionId:
          json.session_id ||
          json.id ||
          json.data?.session_id ||
          json.data?.id ||
          '',
        reference:
          json.reference ||
          json.idempotency_key ||
          json.data?.reference ||
          request.idempotencyKey,
        status: (json.status as any) || (json.data?.status as any) || 'pending',
        checkoutUrl:
          json.checkout_url ||
          json.url ||
          json.data?.checkout_url ||
          json.data?.url ||
          json.payment_url ||
          json.data?.payment_url,
        qrCodeUrl: json.qr_code_url || json.data?.qr_code_url,
        expiresAt: json.expires_at || json.data?.expires_at,
        instructions: json.instructions || json.data?.instructions,
        raw: json,
      };
    } catch (err: any) {
      return {
        success: false,
        sessionId: '',
        reference: request.idempotencyKey,
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err.message || 'Failed to connect to Moteur backend',
      };
    }
  }

  /**
   * Verifies payment status with Moteur backend
   */
  public async verifyPayment(
    query: MoteurVerifyPaymentRequest
  ): Promise<MoteurVerifyPaymentResponse> {
    if (!this.config || !this.isReady()) {
      return {
        success: false,
        reference: query.reference,
        sessionId: query.sessionId,
        status: 'pending',
        amount: 0,
        currency: 'XOF',
        companyId: '',
        planId: '',
        moduleIds: [],
        billingCycle: 'monthly',
        raw: { error: 'MOTEUR_NOT_CONFIGURED' },
      };
    }

    try {
      const identifier = encodeURIComponent(query.sessionId || query.reference);
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/payments/${identifier}`;

      const headers: Record<string, string> = {};
      if (this.config.apiKey) headers['x-engine-api-key'] = this.config.apiKey;
      const bearer = this.config.gatewayBearerToken || this.config.apiKey;
      if (bearer) {
        headers['Authorization'] = `Bearer ${bearer}`;
        headers['apikey'] = bearer;
      }

      const response = await this.executeHttpRequest(
        endpoint,
        {
          method: 'GET',
          headers,
        }
      );

      const json = await response.json();

      if (!response.ok) {
        throw new MoteurIntegrationError(
          json.error?.message || 'Payment status verification failed',
          json.error?.code || 'VERIFICATION_FAILED',
          response.status,
          json
        );
      }

      const meta = json.metadata || {};

      return {
        success: response.ok,
        reference: json.reference || query.reference,
        sessionId: json.session_id || query.sessionId,
        status: json.status,
        amount: Number(json.amount) || 0,
        currency: json.currency || 'XOF',
        companyId: meta.company_id || '',
        planId: meta.plan_id || '',
        moduleIds: Array.isArray(meta.module_ids) ? meta.module_ids : [],
        billingCycle: meta.billing_cycle || 'monthly',
        paidAt: json.paid_at || json.completed_at,
        referralCode: meta.referral_code,
        providerReference: json.provider_reference,
        providerName: json.provider_name,
        raw: json,
      };
    } catch (err: any) {
      if (err instanceof MoteurIntegrationError) throw err;
      throw new MoteurIntegrationError(
        err.message || 'Failed to verify payment with Moteur',
        'NETWORK_ERROR',
        500
      );
    }
  }

  /**
   * Requests a refund via Moteur
   */
  public async refundPayment(
    request: MoteurRefundRequest
  ): Promise<MoteurRefundResponse> {
    if (!this.config || !this.isReady()) {
      throw new MoteurIntegrationError(
        'Moteur credentials not configured',
        'MOTEUR_NOT_CONFIGURED',
        503
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) headers['x-engine-api-key'] = this.config.apiKey;
    const bearer = this.config.gatewayBearerToken || this.config.apiKey;
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
      headers['apikey'] = bearer;
    }

    const response = await this.executeHttpRequest(
      `${this.config.baseUrl}/v1/payments/${encodeURIComponent(request.reference)}/refund`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: request.amount,
          reason: request.reason,
        }),
      }
    );

    const json = await response.json();

    if (!response.ok) {
      throw new MoteurIntegrationError(
        json.error?.message || 'Refund request failed',
        json.error?.code || 'REFUND_FAILED',
        response.status,
        json
      );
    }

    return {
      success: true,
      reference: request.reference,
      refundId: json.refund_id || json.id || `ref-${Date.now()}`,
      status: json.status || 'refunded',
      amount: Number(json.amount) || 0,
      currency: json.currency || 'XOF',
      refundedAt: json.refunded_at || new Date().toISOString(),
    };
  }

  /**
   * Verifies inbound Moteur webhook signature using constant-time comparison
   *
   * Note on Moteur signing scheme:
   * Uses HMAC-SHA256 standard with timing-safe comparison.
   * If secret is missing or signature header is absent, verification safely returns false.
   * Never invents signatures or grants unverified access.
   */
  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader?: string | null
  ): boolean {
    const secret = this.config?.webhookSecret || process.env.MOTEUR_WEBHOOK_SECRET;

    if (!secret || !signatureHeader) {
      return false;
    }

    try {
      const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const cleanHeader = signatureHeader.trim();

      // Support common format variants (e.g. 'sha256=abcdef...' or 'abcdef...')
      const rawHex = cleanHeader.startsWith('sha256=') ? cleanHeader.slice(7) : cleanHeader;

      // Validate that rawHex is a valid 64-char hexadecimal string
      if (!/^[0-9a-fA-F]{64}$/.test(rawHex)) {
        return false;
      }

      const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(bodyString)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedHex, 'hex');
      const actualBuf = Buffer.from(rawHex, 'hex');

      if (expectedBuf.length === 0 || actualBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parses and validates inbound webhook payload
   */
  public parseWebhookPayload(
    rawBody: string | Buffer,
    signatureHeader?: string | null
  ): { valid: boolean; event: MoteurWebhookEvent | null; error?: string } {
    const isValid = this.verifyWebhookSignature(rawBody, signatureHeader);

    if (!isValid) {
      return {
        valid: false,
        event: null,
        error: 'INVALID_SIGNATURE',
      };
    }

    try {
      const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const parsed = JSON.parse(bodyString);

      if (!parsed.event || (!parsed.data && parsed.event !== 'test.ping')) {
        return {
          valid: false,
          event: null,
          error: 'MALFORMED_PAYLOAD',
        };
      }

      return {
        valid: true,
        event: parsed as MoteurWebhookEvent,
      };
    } catch {
      return {
        valid: false,
        event: null,
        error: 'INVALID_JSON',
      };
    }
  }

  /**
   * Protected HTTP execution with timeout and error wrapping
   */
  private async executeHttpRequest(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.config?.timeoutMs || 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.httpFetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new MoteurIntegrationError(
          `Request to Moteur timed out after ${timeoutMs}ms`,
          'TIMEOUT',
          504
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
