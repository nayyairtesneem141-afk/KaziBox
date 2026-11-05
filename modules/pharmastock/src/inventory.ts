/**
 * PharmaStock Multi-Tenant Inventory & Operational Domain Model.
 * Strict Tenant Isolation: all queries and mutations are partition-bound to `companyId`.
 */

export interface MedicationBatch {
  batchNumber: string;
  quantity: number;
  expiryDate: string; // ISO Date YYYY-MM-DD
  costPrice: number;
}

export interface MedicationItem {
  id: string;
  companyId: string;
  name: string;
  genericName: string;
  dosage: string;
  category: 'antibiotic' | 'analgesic' | 'antimalarial' | 'cardiovascular' | 'vitamin' | 'general';
  sellingPrice: number;
  stockCount: number;
  minThreshold: number;
  batches: MedicationBatch[];
  requiresPrescription: boolean;
  createdAt: string;
}

export interface PrescriptionSaleItem {
  medicationId: string;
  medicationName: string;
  quantity: number;
  unitPrice: number;
  batchNumber: string;
}

export interface PrescriptionSale {
  id: string;
  companyId: string;
  reference: string;
  patientName?: string;
  prescriberDoctor?: string;
  items: PrescriptionSaleItem[];
  totalAmount: number;
  currency: string;
  createdAt: string;
}

export interface RestockBatchParams {
  medicationId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  costPrice: number;
  reference: string;
}

import { getPharmaStorageAdapter, setPharmaStorageAdapter, PharmaStorageAdapter } from './storage.js';

// In-memory tenant partition cache
const tenantStore = new Map<
  string,
  {
    medications: Map<string, MedicationItem>;
    sales: PrescriptionSale[];
    expenses: Array<{ id: string; reference: string; amount: number; description: string; date: string }>;
  }
>();

// Per-tenant asynchronous transaction queue for single-process serialization
const tenantQueues = new Map<string, Promise<any>>();

/**
 * Executes a function within a per-tenant serialized transaction queue.
 * Guarantees that concurrent read-modify-persist operations on the same companyId
 * cannot interleave or cause lost updates.
 */
export function withTenantTransaction<T>(companyId: string, fn: () => Promise<T> | T): Promise<T> {
  if (!companyId) {
    throw new Error('Tenant isolation violation: companyId is required');
  }

  const currentQueue = tenantQueues.get(companyId) || Promise.resolve();

  const nextExecution = currentQueue
    .catch(() => {}) // Ensure previous transaction failure does not stall the queue
    .then(async () => {
      return await fn();
    });

  const queuedPromise = nextExecution.finally(() => {
    if (tenantQueues.get(companyId) === queuedPromise) {
      tenantQueues.delete(companyId);
    }
  });
  // Attach noop catch to internal queue reference so callers catch the rejection without Node crashing on queuedPromise
  queuedPromise.catch(() => {});

  tenantQueues.set(companyId, queuedPromise);

  return nextExecution;
}

function saveTenantBucket(
  companyId: string,
  bucket: { medications: Map<string, MedicationItem>; sales: PrescriptionSale[]; expenses: Array<any> }
) {
  const adapter = getPharmaStorageAdapter();
  adapter.saveTenant(companyId, {
    medications: Array.from(bucket.medications.values()),
    sales: bucket.sales,
    expenses: bucket.expenses,
  });
}

function getTenantBucket(companyId: string) {
  if (!companyId) {
    throw new Error('Tenant isolation violation: companyId is required');
  }
  let bucket = tenantStore.get(companyId);
  if (!bucket) {
    const adapter = getPharmaStorageAdapter();
    const persisted = adapter.getTenant(companyId);
    if (persisted) {
      bucket = {
        medications: new Map((persisted.medications || []).map((m) => [m.id, m])),
        sales: persisted.sales || [],
        expenses: persisted.expenses || [],
      };
      tenantStore.set(companyId, bucket);
    } else {
      bucket = {
        medications: new Map(),
        sales: [],
        expenses: [],
      };
      tenantStore.set(companyId, bucket);
      seedInitialTenantStock(companyId, bucket);
      saveTenantBucket(companyId, bucket);
    }
  }
  return bucket;
}

function seedInitialTenantStock(
  companyId: string,
  bucket: { medications: Map<string, MedicationItem>; sales: PrescriptionSale[]; expenses: Array<any> }
) {
  const seedItems: Omit<MedicationItem, 'id' | 'companyId'>[] = [
    {
      name: 'Paracétamol 500mg',
      genericName: 'Paracetamol',
      dosage: '500mg - Boîte de 16',
      category: 'analgesic',
      sellingPrice: 1200,
      stockCount: 140,
      minThreshold: 30,
      requiresPrescription: false,
      createdAt: new Date().toISOString(),
      batches: [
        { batchNumber: 'LOT-PARA-2401', quantity: 100, expiryDate: '2027-04-30', costPrice: 750 },
        { batchNumber: 'LOT-PARA-2309', quantity: 40, expiryDate: '2026-11-20', costPrice: 750 }, // Expiring soon
      ],
    },
    {
      name: 'Amoxicilline 500mg',
      genericName: 'Amoxicillin Trihydrate',
      dosage: '500mg - Boîte de 12 gélules',
      category: 'antibiotic',
      sellingPrice: 3800,
      stockCount: 65,
      minThreshold: 20,
      requiresPrescription: true,
      createdAt: new Date().toISOString(),
      batches: [
        { batchNumber: 'LOT-AMOX-2403', quantity: 65, expiryDate: '2027-08-15', costPrice: 2200 },
      ],
    },
    {
      name: 'Artéméther + Luméfantrine',
      genericName: 'Coartem / CTA',
      dosage: '20/120mg - Plaquette 24 comp',
      category: 'antimalarial',
      sellingPrice: 4500,
      stockCount: 85,
      minThreshold: 25,
      requiresPrescription: false,
      createdAt: new Date().toISOString(),
      batches: [
        { batchNumber: 'LOT-CTA-2405', quantity: 85, expiryDate: '2027-12-31', costPrice: 2900 },
      ],
    },
  ];

  seedItems.forEach((item, idx) => {
    const id = `med-${companyId}-${idx + 1}`;
    bucket.medications.set(id, { id, companyId, ...item });
  });
}

export class PharmaInventoryService {
  /**
   * Retrieves all medication records for the specified tenant company.
   */
  static listMedications(companyId: string): MedicationItem[] {
    const bucket = getTenantBucket(companyId);
    return Array.from(bucket.medications.values());
  }

  /**
   * Retrieves a specific medication item belonging strictly to companyId.
   */
  static getMedication(companyId: string, medicationId: string): MedicationItem | null {
    const bucket = getTenantBucket(companyId);
    return bucket.medications.get(medicationId) || null;
  }

  /**
   * Identifies batches expiring within a specified number of days (default 30 days).
   */
  static getExpiringBatches(
    companyId: string,
    daysAhead: number = 30
  ): Array<{ medicationId: string; medicationName: string; batch: MedicationBatch; daysRemaining: number }> {
    const bucket = getTenantBucket(companyId);
    const now = Date.now();
    const targetTimestamp = now + daysAhead * 24 * 60 * 60 * 1000;
    const expiring: Array<{ medicationId: string; medicationName: string; batch: MedicationBatch; daysRemaining: number }> = [];

    for (const med of bucket.medications.values()) {
      for (const b of med.batches) {
        const expTime = new Date(b.expiryDate).getTime();
        if (expTime <= targetTimestamp && b.quantity > 0) {
          const daysRemaining = Math.max(0, Math.ceil((expTime - now) / (1000 * 60 * 60 * 24)));
          expiring.push({
            medicationId: med.id,
            medicationName: med.name,
            batch: b,
            daysRemaining,
          });
        }
      }
    }

    return expiring.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  /**
   * Records a restock batch for a medication and tracks expense.
   */
  static recordRestock(
    companyId: string,
    params: RestockBatchParams
  ): { medication: MedicationItem; totalExpense: number } {
    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      throw new Error('Tenant isolation violation: companyId is required');
    }
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid request body: expected an object');
    }
    if (!params.medicationId || typeof params.medicationId !== 'string' || !params.medicationId.trim()) {
      throw new Error('Validation error: medicationId must be a non-empty string');
    }
    if (!params.batchNumber || typeof params.batchNumber !== 'string' || !params.batchNumber.trim()) {
      throw new Error('Validation error: batchNumber must be a non-empty string');
    }
    if (typeof params.quantity !== 'number' || !Number.isInteger(params.quantity) || params.quantity <= 0) {
      throw new Error('Validation error: quantity must be a positive integer greater than 0');
    }
    if (typeof params.costPrice !== 'number' || !Number.isFinite(params.costPrice) || params.costPrice < 0) {
      throw new Error('Validation error: costPrice must be a non-negative number');
    }
    if (!params.expiryDate || typeof params.expiryDate !== 'string' || isNaN(new Date(params.expiryDate).getTime())) {
      throw new Error('Validation error: expiryDate must be a valid date string (e.g. YYYY-MM-DD)');
    }
    if (!params.reference || typeof params.reference !== 'string' || !params.reference.trim()) {
      throw new Error('Validation error: reference must be a non-empty string');
    }

    const bucket = getTenantBucket(companyId);

    // Prevent duplicate restock by reference
    const existingExpense = bucket.expenses.find((e) => e.reference === params.reference);
    if (existingExpense) {
      const med = bucket.medications.get(params.medicationId);
      if (med) {
        return { medication: med, totalExpense: existingExpense.amount };
      }
    }

    const med = bucket.medications.get(params.medicationId);
    if (!med) {
      throw new Error(`Medication not found for company ${companyId}`);
    }

    // Deep clone state prior to mutation for safe rollback on persistence failure
    const prevMedications = new Map(
      Array.from(bucket.medications.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
    );
    const prevExpenses = [...bucket.expenses];

    // Add or increment batch
    const existingBatch = med.batches.find((b) => b.batchNumber === params.batchNumber);
    if (existingBatch) {
      existingBatch.quantity += params.quantity;
      existingBatch.costPrice = params.costPrice;
      existingBatch.expiryDate = params.expiryDate;
    } else {
      med.batches.push({
        batchNumber: params.batchNumber,
        quantity: params.quantity,
        expiryDate: params.expiryDate,
        costPrice: params.costPrice,
      });
    }

    med.stockCount += params.quantity;
    const totalExpense = params.quantity * params.costPrice;

    bucket.expenses.push({
      id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      reference: params.reference,
      amount: totalExpense,
      description: `Restock ${med.name} (${params.quantity} units, Lot ${params.batchNumber})`,
      date: new Date().toISOString(),
    });

    try {
      saveTenantBucket(companyId, bucket);
    } catch (err) {
      // Revert in-memory mutation so failed persistence cannot report success or corrupt state
      bucket.medications = prevMedications;
      bucket.expenses = prevExpenses;
      throw new Error(`[PharmaStock] Restock persistence failure for ${params.reference}: ${(err as Error).message}`);
    }

    return { medication: med, totalExpense };
  }

  /**
   * Records an OTC or prescription sale, deducting from the appropriate batch.
   */
  static recordSale(
    companyId: string,
    params: {
      reference: string;
      items: Array<{ medicationId: string; quantity: number }>;
      patientName?: string;
      prescriberDoctor?: string;
      currency?: string;
    }
  ): PrescriptionSale {
    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      throw new Error('Tenant isolation violation: companyId is required');
    }
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid request body: expected an object');
    }
    if (!params.reference || typeof params.reference !== 'string' || !params.reference.trim()) {
      throw new Error('Validation error: reference must be a non-empty string');
    }
    if (!Array.isArray(params.items) || params.items.length === 0) {
      throw new Error('Validation error: items must be a non-empty array of sale items');
    }
    for (const item of params.items) {
      if (!item || typeof item !== 'object') {
        throw new Error('Validation error: sale item must be an object');
      }
      if (!item.medicationId || typeof item.medicationId !== 'string' || !item.medicationId.trim()) {
        throw new Error('Validation error: medicationId in items must be a non-empty string');
      }
      if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error(`Validation error: quantity for medication '${item.medicationId}' must be a positive integer greater than 0`);
      }
    }
    if (params.currency !== undefined && (typeof params.currency !== 'string' || !/^[A-Z]{3,4}$/i.test(params.currency))) {
      throw new Error('Validation error: currency must be a 3 or 4-letter ISO code');
    }
    if (params.patientName !== undefined && typeof params.patientName !== 'string') {
      throw new Error('Validation error: patientName must be a string');
    }
    if (params.prescriberDoctor !== undefined && typeof params.prescriberDoctor !== 'string') {
      throw new Error('Validation error: prescriberDoctor must be a string');
    }

    const bucket = getTenantBucket(companyId);

    // Prevent duplicate sales by reference
    const duplicate = bucket.sales.find((s) => s.reference === params.reference);
    if (duplicate) {
      return duplicate;
    }

    // Deep clone state prior to mutation for safe rollback on persistence failure
    const prevMedications = new Map(
      Array.from(bucket.medications.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
    );
    const prevSales = [...bucket.sales];

    let totalAmount = 0;
    const fulfilledItems: PrescriptionSaleItem[] = [];

    for (const orderItem of params.items) {
      const med = bucket.medications.get(orderItem.medicationId);
      if (!med) {
        throw new Error(`Medication '${orderItem.medicationId}' not found`);
      }
      if (med.stockCount < orderItem.quantity) {
        throw new Error(`Insufficient stock for '${med.name}' (available: ${med.stockCount}, requested: ${orderItem.quantity})`);
      }

      // Deduct from batches (FIFO: earliest expiring batch first)
      med.batches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

      let remainingToDeduct = orderItem.quantity;
      let usedBatch = med.batches[0]?.batchNumber || 'DEFAULT';

      for (const batch of med.batches) {
        if (remainingToDeduct <= 0) break;
        if (batch.quantity <= 0) continue;

        const deduct = Math.min(batch.quantity, remainingToDeduct);
        batch.quantity -= deduct;
        remainingToDeduct -= deduct;
        usedBatch = batch.batchNumber;
      }

      med.stockCount -= orderItem.quantity;
      const lineTotal = med.sellingPrice * orderItem.quantity;
      totalAmount += lineTotal;

      fulfilledItems.push({
        medicationId: med.id,
        medicationName: med.name,
        quantity: orderItem.quantity,
        unitPrice: med.sellingPrice,
        batchNumber: usedBatch,
      });
    }

    const sale: PrescriptionSale = {
      id: `sale-${companyId}-${Date.now()}`,
      companyId,
      reference: params.reference,
      patientName: params.patientName,
      prescriberDoctor: params.prescriberDoctor,
      items: fulfilledItems,
      totalAmount,
      currency: params.currency || 'XOF',
      createdAt: new Date().toISOString(),
    };

    bucket.sales.push(sale);

    try {
      saveTenantBucket(companyId, bucket);
    } catch (err) {
      // Revert in-memory mutation so failed persistence cannot report success or corrupt state
      bucket.medications = prevMedications;
      bucket.sales = prevSales;
      throw new Error(`[PharmaStock] Sale persistence failure for ${params.reference}: ${(err as Error).message}`);
    }

    return sale;
  }

  /**
   * Executes an arbitrary operation within the tenant's transaction lock.
   */
  static async runInTransaction<T>(companyId: string, fn: () => Promise<T> | T): Promise<T> {
    return withTenantTransaction(companyId, fn);
  }

  /**
   * Asynchronously records a sale under tenant transaction serialization.
   */
  static async recordSaleAsync(
    companyId: string,
    params: {
      reference: string;
      items: Array<{ medicationId: string; quantity: number }>;
      patientName?: string;
      prescriberDoctor?: string;
      currency?: string;
    }
  ): Promise<PrescriptionSale> {
    return withTenantTransaction(companyId, () => this.recordSale(companyId, params));
  }

  /**
   * Asynchronously records a restock batch under tenant transaction serialization.
   */
  static async recordRestockAsync(
    companyId: string,
    params: RestockBatchParams
  ): Promise<{ medication: MedicationItem; totalExpense: number }> {
    return withTenantTransaction(companyId, () => this.recordRestock(companyId, params));
  }

  /**
   * Configures a custom persistence adapter (e.g. FilePharmaStorageAdapter or MemoryPharmaStorageAdapter).
   */
  static setStorageAdapter(adapter: PharmaStorageAdapter) {
    setPharmaStorageAdapter(adapter);
    // Clear in-memory cache to reload from new adapter
    tenantStore.clear();
  }

  /**
   * Retrieves the active persistence adapter.
   */
  static getStorageAdapter(): PharmaStorageAdapter {
    return getPharmaStorageAdapter();
  }

  /**
   * Explicitly clears in-memory partition cache (useful for testing persistence reload across restarts).
   */
  static clearMemoryCache(): void {
    tenantStore.clear();
  }

  /**
   * Computes operational telemetry metrics for the tenant.
   */
  static getTelemetry(companyId: string) {
    const bucket = getTenantBucket(companyId);

    const totalRevenue = bucket.sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalExpenses = bucket.expenses.reduce((sum, e) => sum + e.amount, 0);
    const activityCount = bucket.sales.length;

    let totalStockUnits = 0;
    for (const med of bucket.medications.values()) {
      totalStockUnits += med.stockCount;
    }

    const expiringBatches = this.getExpiringBatches(companyId, 30);

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      activityCount,
      totalStockUnits,
      expiringBatchesCount: expiringBatches.length,
      expiringBatches,
      recentSalesCount: bucket.sales.length,
    };
  }
}
