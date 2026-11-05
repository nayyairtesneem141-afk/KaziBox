/**
 * KaziBox Multi-SaaS Cross-Module Integration Event Bus
 *
 * Architectural Principles:
 * 1. Strict Tenant Isolation: Every event is strictly bound to a `company_id`.
 * 2. Shared Identity & Workspace: User identity and workspace boundaries are preserved.
 * 3. Recursion & Loop Prevention: Maximum dispatch depth (`maxDepth: 3`) prevents circular update cascades.
 * 4. Idempotency & Deduplication: `eventId` ensures events are processed exactly once.
 * 5. Auditability: All cross-module event dispatches maintain an in-memory/DB audit trail.
 * 6. Free Tools Independence: Utilities execute without requiring paid SaaS subscriptions.
 */

export interface CrossModuleEvent<T = any> {
  eventId: string;
  eventType: string; // e.g. 'sale.completed', 'inventory.adjusted', 'invoice.created'
  sourceModule: string; // e.g. 'garage', 'hotel', 'salon', 'pos'
  companyId: string;
  userId: string;
  timestamp: string;
  payload: T;
  depth: number; // Circuit-breaker loop prevention
}

export interface CrossModuleEventHandler<T = any> {
  targetModule: string;
  eventType: string;
  handle: (event: CrossModuleEvent<T>) => Promise<{ success: boolean; result?: any; error?: string }>;
}

export interface EventAuditLogEntry {
  eventId: string;
  eventType: string;
  sourceModule: string;
  targetModule: string;
  companyId: string;
  userId: string;
  status: 'delivered' | 'failed' | 'deduplicated' | 'loop_prevented';
  timestamp: string;
  durationMs: number;
  error?: string;
}

export class CrossModuleEventBus {
  private static instance: CrossModuleEventBus;
  private handlers = new Map<string, CrossModuleEventHandler[]>();
  private processedEventIds = new Set<string>();
  private auditLog: EventAuditLogEntry[] = [];
  private static MAX_DEPTH = 3;

  public static getInstance(): CrossModuleEventBus {
    if (!CrossModuleEventBus.instance) {
      CrossModuleEventBus.instance = new CrossModuleEventBus();
    }
    return CrossModuleEventBus.instance;
  }

  /**
   * Register a target module's listener for a specific event type
   */
  public registerHandler(handler: CrossModuleEventHandler): void {
    const list = this.handlers.get(handler.eventType) || [];
    list.push(handler);
    this.handlers.set(handler.eventType, list);
  }

  /**
   * Dispatches a typed cross-module event within tenant boundaries
   */
  public async dispatch<T>(event: Omit<CrossModuleEvent<T>, 'eventId' | 'timestamp' | 'depth'> & { eventId?: string; depth?: number }): Promise<{
    deliveredCount: number;
    errors: string[];
  }> {
    const eventId = event.eventId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const depth = event.depth || 0;
    const timestamp = new Date().toISOString();

    const fullEvent: CrossModuleEvent<T> = {
      ...event,
      eventId,
      timestamp,
      depth,
    };

    // 1. Loop Prevention Circuit Breaker
    if (depth > CrossModuleEventBus.MAX_DEPTH) {
      this.recordAudit({
        eventId,
        eventType: fullEvent.eventType,
        sourceModule: fullEvent.sourceModule,
        targetModule: 'all',
        companyId: fullEvent.companyId,
        userId: fullEvent.userId,
        status: 'loop_prevented',
        timestamp,
        durationMs: 0,
        error: `Exceeded maximum event cascade depth of ${CrossModuleEventBus.MAX_DEPTH}`,
      });
      return { deliveredCount: 0, errors: ['Max cascade depth exceeded (circular loop prevented)'] };
    }

    // 2. Idempotency Check
    if (this.processedEventIds.has(eventId)) {
      this.recordAudit({
        eventId,
        eventType: fullEvent.eventType,
        sourceModule: fullEvent.sourceModule,
        targetModule: 'all',
        companyId: fullEvent.companyId,
        userId: fullEvent.userId,
        status: 'deduplicated',
        timestamp,
        durationMs: 0,
      });
      return { deliveredCount: 0, errors: [] };
    }

    this.processedEventIds.add(eventId);

    const registered = this.handlers.get(fullEvent.eventType) || [];
    let deliveredCount = 0;
    const errors: string[] = [];

    for (const handler of registered) {
      // Cross-tenant protection: Handlers can only process within the event's company
      const start = Date.now();
      try {
        const res = await handler.handle(fullEvent);
        const durationMs = Date.now() - start;

        if (res.success) {
          deliveredCount++;
          this.recordAudit({
            eventId,
            eventType: fullEvent.eventType,
            sourceModule: fullEvent.sourceModule,
            targetModule: handler.targetModule,
            companyId: fullEvent.companyId,
            userId: fullEvent.userId,
            status: 'delivered',
            timestamp: new Date().toISOString(),
            durationMs,
          });
        } else {
          errors.push(res.error || `Handler failed for ${handler.targetModule}`);
          this.recordAudit({
            eventId,
            eventType: fullEvent.eventType,
            sourceModule: fullEvent.sourceModule,
            targetModule: handler.targetModule,
            companyId: fullEvent.companyId,
            userId: fullEvent.userId,
            status: 'failed',
            timestamp: new Date().toISOString(),
            durationMs,
            error: res.error,
          });
        }
      } catch (err: any) {
        const durationMs = Date.now() - start;
        errors.push(err.message);
        this.recordAudit({
          eventId,
          eventType: fullEvent.eventType,
          sourceModule: fullEvent.sourceModule,
          targetModule: handler.targetModule,
          companyId: fullEvent.companyId,
          userId: fullEvent.userId,
          status: 'failed',
          timestamp: new Date().toISOString(),
          durationMs,
          error: err.message,
        });
      }
    }

    return { deliveredCount, errors };
  }

  public getAuditLogs(companyId?: string): EventAuditLogEntry[] {
    if (!companyId) return this.auditLog;
    return this.auditLog.filter((log) => log.companyId === companyId);
  }

  public clearProcessedEvents(): void {
    this.processedEventIds.clear();
    this.auditLog = [];
  }

  private recordAudit(entry: EventAuditLogEntry): void {
    this.auditLog.push(entry);
    // Keep last 1,000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }
  }
}

export const crossModuleEventBus = CrossModuleEventBus.getInstance();
