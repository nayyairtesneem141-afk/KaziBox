import { KaziBoxClient, ModuleSummary, ConsolidatedMetric } from '@kazibox/sdk';

export interface TripRecord {
  id: string;
  companyId: string;
  driverName: string;
  amount: number;
  reference: string;
  occurredAt: string;
}

export interface FuelRecord {
  id: string;
  companyId: string;
  vehiclePlate: string;
  amount: number;
  reference: string;
  occurredAt: string;
}

export interface TenantRecord {
  companyId: string;
  status: 'active' | 'suspended';
  plan: string;
  updatedAt: string;
}

/**
 * Minimal domain business service demonstrating:
 * 1. Multi-tenant data isolation bound to companyId.
 * 2. Idempotent shared ledger synchronization using @kazibox/sdk.
 * 3. Lifecycle provisioning and operational telemetry generation.
 */
export class MinimalSaasService {
  private trips = new Map<string, TripRecord[]>();
  private fuelLogs = new Map<string, FuelRecord[]>();
  private tenants = new Map<string, TenantRecord>();

  /**
   * Provisions or updates tenant status following platform lifecycle events.
   */
  public provisionTenant(companyId: string, plan: string = 'starter'): TenantRecord {
    const record: TenantRecord = {
      companyId,
      status: 'active',
      plan,
      updatedAt: new Date().toISOString(),
    };
    this.tenants.set(companyId, record);
    if (!this.trips.has(companyId)) this.trips.set(companyId, []);
    if (!this.fuelLogs.has(companyId)) this.fuelLogs.set(companyId, []);
    return record;
  }

  /**
   * Suspends write access for a deactivated tenant.
   */
  public deactivateTenant(companyId: string): void {
    const existing = this.tenants.get(companyId);
    if (existing) {
      existing.status = 'suspended';
      existing.updatedAt = new Date().toISOString();
    }
  }

  public isTenantActive(companyId: string): boolean {
    const tenant = this.tenants.get(companyId);
    return tenant ? tenant.status === 'active' : true; // Default permissive in sandbox unless explicitly suspended
  }

  /**
   * Records a trip/dispatch and syncs revenue to KaziBox ledger idempotently.
   */
  public async recordTrip(
    companyId: string,
    params: { driverName: string; amount: number; reference: string; occurredAt?: string },
    client?: KaziBoxClient
  ): Promise<{ trip: TripRecord; isDuplicate: boolean }> {
    if (!companyId) throw new Error('companyId is required');
    if (!params.reference || params.reference.trim().length < 3) {
      throw new Error('Reference must be at least 3 characters');
    }
    if (typeof params.amount !== 'number' || params.amount <= 0 || !Number.isFinite(params.amount)) {
      throw new Error('Amount must be a positive finite number');
    }

    const tenantTrips = this.trips.get(companyId) || [];

    // Idempotency check on reference within tenant scope
    const existing = tenantTrips.find((t) => t.reference === params.reference);
    if (existing) {
      return { trip: existing, isDuplicate: true };
    }

    const occurredAt = params.occurredAt || new Date().toISOString();
    const trip: TripRecord = {
      id: `TRIP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      companyId,
      driverName: params.driverName || 'Chauffeur Express',
      amount: params.amount,
      reference: params.reference,
      occurredAt,
    };

    tenantTrips.push(trip);
    this.trips.set(companyId, tenantTrips);

    // Sync to KaziBox platform ledger if client provided
    if (client) {
      client.setWorkspace(companyId);
      await client.recordRevenue({
        moduleId: 'fleet-courier',
        amount: trip.amount,
        currency: 'XOF',
        source: `Course Express — ${trip.driverName}`,
        reference: trip.reference,
        occurredAt: trip.occurredAt,
      });

      await client.emitEvent({
        moduleId: 'fleet-courier',
        action: 'trip.completed',
        entity: 'trip',
        entityId: trip.id,
        details: { driverName: trip.driverName, amount: trip.amount },
      });
    }

    return { trip, isDuplicate: false };
  }

  /**
   * Records a fuel expense and syncs to KaziBox ledger idempotently.
   */
  public async recordFuel(
    companyId: string,
    params: { vehiclePlate: string; amount: number; reference: string; occurredAt?: string },
    client?: KaziBoxClient
  ): Promise<{ fuel: FuelRecord; isDuplicate: boolean }> {
    if (!companyId) throw new Error('companyId is required');
    if (!params.reference || params.reference.trim().length < 3) {
      throw new Error('Reference must be at least 3 characters');
    }
    if (typeof params.amount !== 'number' || params.amount <= 0 || !Number.isFinite(params.amount)) {
      throw new Error('Amount must be a positive finite number');
    }

    const tenantFuel = this.fuelLogs.get(companyId) || [];

    // Idempotency check on reference within tenant scope
    const existing = tenantFuel.find((f) => f.reference === params.reference);
    if (existing) {
      return { fuel: existing, isDuplicate: true };
    }

    const occurredAt = params.occurredAt || new Date().toISOString();
    const fuel: FuelRecord = {
      id: `FUEL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      companyId,
      vehiclePlate: params.vehiclePlate || 'VEH-01-ABJ',
      amount: params.amount,
      reference: params.reference,
      occurredAt,
    };

    tenantFuel.push(fuel);
    this.fuelLogs.set(companyId, tenantFuel);

    // Sync to KaziBox platform ledger if client provided
    if (client) {
      client.setWorkspace(companyId);
      await client.recordExpense({
        moduleId: 'fleet-courier',
        amount: fuel.amount,
        currency: 'XOF',
        category: 'Carburant',
        reference: fuel.reference,
        occurredAt: fuel.occurredAt,
      });
    }

    return { fuel, isDuplicate: false };
  }

  /**
   * Produces consolidated telemetry for the KaziBox platform dashboard.
   */
  public getSummary(companyId: string): Omit<ModuleSummary, 'moduleId' | 'companyId'> & { revenue: number; expenses: number; activityCount: number } {
    const tenantTrips = this.trips.get(companyId) || [];
    const tenantFuel = this.fuelLogs.get(companyId) || [];

    const revenue = tenantTrips.reduce((acc, t) => acc + t.amount, 0);
    const expenses = tenantFuel.reduce((acc, f) => acc + f.amount, 0);
    const activityCount = tenantTrips.length + tenantFuel.length;

    const metrics: ConsolidatedMetric[] = [
      {
        id: 'metric-trips-count',
        moduleId: 'fleet-courier',
        label: {
          en: 'Completed Trips',
          fr: 'Courses Terminées',
        },
        value: tenantTrips.length,
        trend: 'up',
      },
      {
        id: 'metric-fuel-expenses',
        moduleId: 'fleet-courier',
        label: {
          en: 'Fuel Expenses',
          fr: 'Dépenses Carburant',
        },
        value: expenses,
        currency: 'XOF',
        trend: 'neutral',
      },
    ];

    return {
      revenue,
      expenses,
      activityCount,
      currency: 'XOF',
      lastUpdated: new Date().toISOString(),
      metrics,
    };
  }

  /**
   * Returns isolated tenant data.
   */
  public getTenantData(companyId: string): { trips: TripRecord[]; fuelLogs: FuelRecord[]; status: TenantRecord | null } {
    return {
      trips: this.trips.get(companyId) || [],
      fuelLogs: this.fuelLogs.get(companyId) || [],
      status: this.tenants.get(companyId) || null,
    };
  }

  /**
   * Clears state (used in testing).
   */
  public clear(): void {
    this.trips.clear();
    this.fuelLogs.clear();
    this.tenants.clear();
  }
}
