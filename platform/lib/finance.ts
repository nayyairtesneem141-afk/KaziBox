import { getStore, setStoreItem } from './storage';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

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
export const STORAGE_FINANCE_KEY = 'kazibox_db_finance_records';

export const INITIAL_FINANCE_RECORDS: FinanceRecord[] = [
  // Hotel revenue
  {
    id: 'fin-rev-1',
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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
    workspaceId: '11111111-1111-4111-8111-111111111111',
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

// Global in-memory cache for server-side (API routes)
const globalForFinance = globalThis as unknown as {
  financeRecords: FinanceRecord[] | undefined;
};

function getFinanceRecordsStore(): FinanceRecord[] {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_FINANCE_KEY);
      if (raw) {
        const parsed: FinanceRecord[] = JSON.parse(raw);
        const existingIds = new Set(parsed.map((r) => r.id));
        let changed = false;
        for (const r of INITIAL_FINANCE_RECORDS) {
          if (!existingIds.has(r.id)) {
            parsed.push(r);
            changed = true;
          }
        }
        if (changed) localStorage.setItem(STORAGE_FINANCE_KEY, JSON.stringify(parsed));
        return parsed;
      }
      localStorage.setItem(STORAGE_FINANCE_KEY, JSON.stringify(INITIAL_FINANCE_RECORDS));
      return [...INITIAL_FINANCE_RECORDS];
    } catch {
      return [...INITIAL_FINANCE_RECORDS];
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
    return;
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
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined'
      ? createBrowserClient()
      : (createAdminClient() || createServerClient());

    if (supabase) {
      // 1. Idempotency check in Supabase by (company_id, reference, type)
      const { data: existing } = await supabase
        .from('finance_records')
        .select('*')
        .eq('company_id', input.workspaceId)
        .eq('reference', input.reference)
        .eq('type', 'revenue')
        .maybeSingle();

      if (existing) {
        return {
          record: {
            id: existing.id,
            workspaceId: existing.company_id,
            moduleId: existing.module_id,
            type: existing.type as 'revenue' | 'expense',
            amount: Number(existing.amount),
            currency: existing.currency,
            categoryOrSource: existing.category_or_source,
            occurredAt: existing.occurred_at,
            reference: existing.reference,
            createdAt: existing.created_at,
          },
          isDuplicate: true,
        };
      }

      // 2. Insert into Supabase
      const { data: inserted, error } = await supabase
        .from('finance_records')
        .insert({
          company_id: input.workspaceId,
          module_id: input.moduleId,
          type: 'revenue',
          amount: input.amount,
          currency: input.currency || 'XOF',
          category_or_source: input.source,
          reference: input.reference,
          occurred_at: input.occurredAt || new Date().toISOString(),
        })
        .select()
        .single();

      if (inserted && !error) {
        const record: FinanceRecord = {
          id: inserted.id,
          workspaceId: inserted.company_id,
          moduleId: inserted.module_id,
          type: 'revenue',
          amount: Number(inserted.amount),
          currency: inserted.currency,
          categoryOrSource: inserted.category_or_source,
          occurredAt: inserted.occurred_at,
          reference: inserted.reference,
          createdAt: inserted.created_at,
        };
        return { record, isDuplicate: false };
      }
    }
  }

  // Fallback in-memory / local storage logic
  const records = getFinanceRecordsStore();
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
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined'
      ? createBrowserClient()
      : (createAdminClient() || createServerClient());

    if (supabase) {
      // 1. Idempotency check in Supabase by (company_id, reference, type)
      const { data: existing } = await supabase
        .from('finance_records')
        .select('*')
        .eq('company_id', input.workspaceId)
        .eq('reference', input.reference)
        .eq('type', 'expense')
        .maybeSingle();

      if (existing) {
        return {
          record: {
            id: existing.id,
            workspaceId: existing.company_id,
            moduleId: existing.module_id,
            type: existing.type as 'revenue' | 'expense',
            amount: Number(existing.amount),
            currency: existing.currency,
            categoryOrSource: existing.category_or_source,
            occurredAt: existing.occurred_at,
            reference: existing.reference,
            createdAt: existing.created_at,
          },
          isDuplicate: true,
        };
      }

      // 2. Insert into Supabase
      const { data: inserted, error } = await supabase
        .from('finance_records')
        .insert({
          company_id: input.workspaceId,
          module_id: input.moduleId,
          type: 'expense',
          amount: input.amount,
          currency: input.currency || 'XOF',
          category_or_source: input.category,
          reference: input.reference,
          occurred_at: input.occurredAt || new Date().toISOString(),
        })
        .select()
        .single();

      if (inserted && !error) {
        const record: FinanceRecord = {
          id: inserted.id,
          workspaceId: inserted.company_id,
          moduleId: inserted.module_id,
          type: 'expense',
          amount: Number(inserted.amount),
          currency: inserted.currency,
          categoryOrSource: inserted.category_or_source,
          occurredAt: inserted.occurred_at,
          reference: inserted.reference,
          createdAt: inserted.created_at,
        };
        return { record, isDuplicate: false };
      }
    }
  }

  // Fallback in-memory logic
  const records = getFinanceRecordsStore();
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
  const allRecords = await getFinanceTimeline(workspaceId, 'all');
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
  const allRecords = await getFinanceTimeline(workspaceId, 'all');
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
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined'
      ? createBrowserClient()
      : (createAdminClient() || createServerClient());

    if (supabase) {
      const { data } = await supabase
        .from('finance_records')
        .select('*')
        .eq('company_id', workspaceId)
        .order('occurred_at', { ascending: false });

      if (data && data.length > 0) {
        const records: FinanceRecord[] = data.map((item: any) => ({
          id: item.id,
          workspaceId: item.company_id,
          moduleId: item.module_id,
          type: item.type as 'revenue' | 'expense',
          amount: Number(item.amount),
          currency: item.currency,
          categoryOrSource: item.category_or_source,
          occurredAt: item.occurred_at,
          reference: item.reference,
          createdAt: item.created_at,
        }));
        return filterByRange(records, range, customDates);
      }
    }
  }

  const allRecords = getFinanceRecordsStore().filter((r) => r.workspaceId === workspaceId || r.workspaceId === 'ws-palmeraie-01');
  return filterByRange(allRecords, range, customDates);
}

