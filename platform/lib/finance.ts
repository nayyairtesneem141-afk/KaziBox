import { getStore, setStoreItem } from './storage';

export interface FinanceRecord {
  id: string;
  workspaceId: string;
  moduleId: string;
  type: 'revenue' | 'expense';
  amount: number;
  currency: string;
  categoryOrSource: string;
  occurredAt: string;
  reference: string;
  createdAt: string;
}

export interface FinanceSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  currency: string;
  recordsCount: number;
  range: string;
}

export interface ModuleFinanceBreakdown {
  moduleId: string;
  moduleName?: string;
  revenue: number;
  expenses: number;
  net: number;
  currency: string;
}

// In-memory / storage key for shared finance records
const STORAGE_FINANCE_KEY = 'kazibox_db_finance_records';

export const INITIAL_FINANCE_RECORDS: FinanceRecord[] = [
  // Hotel revenue
  {
    id: 'fin-rev-1',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'hotel-property',
    type: 'revenue',
    amount: 145000,
    currency: 'XOF',
    categoryOrSource: 'Chambre Deluxe #204 - 2 nuits',
    occurredAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
    reference: 'REF-HTL-2026-0891',
    createdAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
  },
  {
    id: 'fin-rev-2',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'hotel-property',
    type: 'revenue',
    amount: 85000,
    currency: 'XOF',
    categoryOrSource: 'Suite Junior #101 - 1 nuit',
    occurredAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    reference: 'REF-HTL-2026-0892',
    createdAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
  },
  {
    id: 'fin-rev-3',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'hotel-property',
    type: 'revenue',
    amount: 220000,
    currency: 'XOF',
    categoryOrSource: 'Bungalow Famille #05 - 3 nuits',
    occurredAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
    reference: 'REF-HTL-2026-0893',
    createdAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
  },
  // Hotel expenses
  {
    id: 'fin-exp-1',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'hotel-property',
    type: 'expense',
    amount: 35000,
    currency: 'XOF',
    categoryOrSource: 'Maintenance Climatisation R+1',
    occurredAt: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
    reference: 'REF-HTL-EXP-0041',
    createdAt: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
  },
  {
    id: 'fin-exp-2',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'hotel-property',
    type: 'expense',
    amount: 52000,
    currency: 'XOF',
    categoryOrSource: 'Approvisionnement Blanchisserie & Produits',
    occurredAt: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
    reference: 'REF-HTL-EXP-0042',
    createdAt: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
  },
  // Demo module test records
  {
    id: 'fin-rev-demo-1',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'demo',
    type: 'revenue',
    amount: 25000,
    currency: 'XOF',
    categoryOrSource: 'Vente test service API Demo',
    occurredAt: new Date().toISOString(),
    reference: 'REF-DEMO-001',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'fin-exp-demo-1',
    workspaceId: 'ws-palmeraie-01',
    moduleId: 'demo',
    type: 'expense',
    amount: 7500,
    currency: 'XOF',
    categoryOrSource: 'Frais test matériel Demo',
    occurredAt: new Date().toISOString(),
    reference: 'REF-DEMO-EXP-001',
    createdAt: new Date().toISOString(),
  },
];

// Global cache for server-side persistence in Node process
const globalForFinance = globalThis as unknown as {
  financeRecords: FinanceRecord[] | undefined;
};

// Helper to get records from storage
function getFinanceRecordsStore(): FinanceRecord[] {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_FINANCE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        // fallback
      }
    }
  }
  if (!globalForFinance.financeRecords) {
    globalForFinance.financeRecords = [...INITIAL_FINANCE_RECORDS];
  }
  return globalForFinance.financeRecords;
}

function saveFinanceRecordsStore(records: FinanceRecord[]) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_FINANCE_KEY, JSON.stringify(records));
    } catch {}
  }
  globalForFinance.financeRecords = records;
}

export interface RecordRevenueInput {
  workspaceId: string;
  moduleId: string;
  amount: number;
  currency: string;
  source: string;
  occurredAt?: string;
  reference: string;
}

/**
 * Records a revenue item with idempotency enforcement.
 */
export async function recordRevenue(input: RecordRevenueInput): Promise<{ record: FinanceRecord; isDuplicate: boolean }> {
  const records = getFinanceRecordsStore();

  // Check idempotency by reference and workspace
  const existing = records.find(
    (r) => r.reference === input.reference && r.workspaceId === input.workspaceId && r.type === 'revenue'
  );
  if (existing) {
    return { record: existing, isDuplicate: true };
  }

  const newRecord: FinanceRecord = {
    id: `fin-rev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    workspaceId: input.workspaceId,
    moduleId: input.moduleId,
    type: 'revenue',
    amount: input.amount,
    currency: input.currency || 'XOF',
    categoryOrSource: input.source,
    occurredAt: input.occurredAt || new Date().toISOString(),
    reference: input.reference,
    createdAt: new Date().toISOString(),
  };

  records.unshift(newRecord);
  saveFinanceRecordsStore(records);

  return { record: newRecord, isDuplicate: false };
}

export interface RecordExpenseInput {
  workspaceId: string;
  moduleId: string;
  amount: number;
  currency: string;
  category: string;
  occurredAt?: string;
  reference: string;
}

/**
 * Records an expense item with idempotency enforcement.
 */
export async function recordExpense(input: RecordExpenseInput): Promise<{ record: FinanceRecord; isDuplicate: boolean }> {
  const records = getFinanceRecordsStore();

  // Check idempotency by reference and workspace
  const existing = records.find(
    (r) => r.reference === input.reference && r.workspaceId === input.workspaceId && r.type === 'expense'
  );
  if (existing) {
    return { record: existing, isDuplicate: true };
  }

  const newRecord: FinanceRecord = {
    id: `fin-exp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    workspaceId: input.workspaceId,
    moduleId: input.moduleId,
    type: 'expense',
    amount: input.amount,
    currency: input.currency || 'XOF',
    categoryOrSource: input.category,
    occurredAt: input.occurredAt || new Date().toISOString(),
    reference: input.reference,
    createdAt: new Date().toISOString(),
  };

  records.unshift(newRecord);
  saveFinanceRecordsStore(records);

  return { record: newRecord, isDuplicate: false };
}

export type FinanceDateRange = 'today' | '7d' | '30d' | 'custom' | 'all';

export interface CustomDateRangeOptions {
  startDate?: string;
  endDate?: string;
}

/**
 * Filter records by date range helper
 */
function filterByRange(
  records: FinanceRecord[],
  range: FinanceDateRange = '30d',
  customDates?: CustomDateRangeOptions
): FinanceRecord[] {
  if (range === 'all') return records;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (range === 'custom') {
    let startCutoff = customDates?.startDate ? new Date(customDates.startDate).getTime() : 0;
    let endCutoff = customDates?.endDate
      ? new Date(customDates.endDate).getTime() + 24 * 3600 * 1000 - 1
      : Number.MAX_SAFE_INTEGER;

    if (isNaN(startCutoff)) startCutoff = 0;
    if (isNaN(endCutoff)) endCutoff = Number.MAX_SAFE_INTEGER;

    return records.filter((r) => {
      const t = new Date(r.occurredAt).getTime();
      return t >= startCutoff && t <= endCutoff;
    });
  }

  let cutoff = 0;
  if (range === 'today') {
    cutoff = startOfDay;
  } else if (range === '7d') {
    cutoff = now.getTime() - 7 * 24 * 3600 * 1000;
  } else if (range === '30d') {
    cutoff = now.getTime() - 30 * 24 * 3600 * 1000;
  }

  return records.filter((r) => {
    const t = new Date(r.occurredAt).getTime();
    return t >= cutoff;
  });
}

/**
 * Computes consolidated financial KPI summary for a workspace.
 */
export async function getFinanceSummary(
  workspaceId: string,
  range: FinanceDateRange = '30d',
  customDates?: CustomDateRangeOptions
): Promise<FinanceSummary> {
  const allRecords = getFinanceRecordsStore().filter((r) => r.workspaceId === workspaceId);
  const filtered = filterByRange(allRecords, range, customDates);

  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const item of filtered) {
    if (item.type === 'revenue') {
      totalRevenue += item.amount;
    } else {
      totalExpenses += item.amount;
    }
  }

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    currency: 'XOF',
    recordsCount: filtered.length,
    range,
  };
}

/**
 * Computes per-module financial breakdown for a workspace.
 */
export async function getFinanceByModule(
  workspaceId: string,
  range: FinanceDateRange = '30d',
  customDates?: CustomDateRangeOptions
): Promise<ModuleFinanceBreakdown[]> {
  const allRecords = getFinanceRecordsStore().filter((r) => r.workspaceId === workspaceId);
  const filtered = filterByRange(allRecords, range, customDates);

  const breakdownMap: Record<string, { revenue: number; expenses: number }> = {};

  for (const item of filtered) {
    if (!breakdownMap[item.moduleId]) {
      breakdownMap[item.moduleId] = { revenue: 0, expenses: 0 };
    }
    if (item.type === 'revenue') {
      breakdownMap[item.moduleId].revenue += item.amount;
    } else {
      breakdownMap[item.moduleId].expenses += item.amount;
    }
  }

  const results: ModuleFinanceBreakdown[] = Object.entries(breakdownMap).map(([modId, data]) => ({
    moduleId: modId,
    revenue: data.revenue,
    expenses: data.expenses,
    net: data.revenue - data.expenses,
    currency: 'XOF',
  }));

  return results;
}

/**
 * Returns raw finance timeline records for charting.
 */
export async function getFinanceTimeline(
  workspaceId: string,
  range: FinanceDateRange = '7d',
  customDates?: CustomDateRangeOptions
): Promise<FinanceRecord[]> {
  const allRecords = getFinanceRecordsStore().filter((r) => r.workspaceId === workspaceId);
  return filterByRange(allRecords, range, customDates);
}
