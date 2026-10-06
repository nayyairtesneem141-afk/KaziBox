/**
 * Public client library illustrating how external and decoupled modules
 * consume the KaziBox Integration API contracts.
 */

export interface DemoApiClientConfig {
  baseUrl?: string;
  apiKey: string;
  workspaceId: string;
}

export class DemoApiClient {
  private baseUrl: string;
  private apiKey: string;
  private workspaceId: string;

  constructor(config: DemoApiClientConfig) {
    this.baseUrl = config.baseUrl || '';
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'X-Workspace-Id': this.workspaceId,
      ...(options.headers || {}),
    };

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  /**
   * GET /api/v1/context
   */
  async getContext() {
    return this.request('/api/v1/context');
  }

  /**
   * GET /api/v1/subscription
   */
  async getSubscription() {
    return this.request('/api/v1/subscription');
  }

  /**
   * POST /api/v1/finance/revenue
   */
  async recordRevenue(params: {
    amount: number;
    currency?: string;
    source: string;
    reference: string;
    occurredAt?: string;
  }) {
    return this.request('/api/v1/finance/revenue', {
      method: 'POST',
      body: JSON.stringify({
        moduleId: 'demo',
        amount: params.amount,
        currency: params.currency || 'XOF',
        source: params.source,
        reference: params.reference,
        occurredAt: params.occurredAt || new Date().toISOString(),
      }),
    });
  }

  /**
   * POST /api/v1/finance/expenses
   */
  async recordExpense(params: {
    amount: number;
    currency?: string;
    category: string;
    reference: string;
    occurredAt?: string;
  }) {
    return this.request('/api/v1/finance/expenses', {
      method: 'POST',
      body: JSON.stringify({
        moduleId: 'demo',
        amount: params.amount,
        currency: params.currency || 'XOF',
        category: params.category,
        reference: params.reference,
        occurredAt: params.occurredAt || new Date().toISOString(),
      }),
    });
  }

  /**
   * POST /api/v1/events
   */
  async emitEvent(params: {
    action: string;
    entity: string;
    entityId: string;
    details?: Record<string, any>;
  }) {
    return this.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        moduleId: 'demo',
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: params.details || {},
      }),
    });
  }
}
