import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';
import { recordRevenue } from './finance';
import { ModuleSummary } from '@kazibox/sdk';

export interface SalonCustomer {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  appointments_count?: number;
  last_visit?: string | null;
}

export interface SalonStaff {
  id: string;
  company_id: string;
  name: string;
  phone?: string | null;
  role: 'stylist' | 'beautician' | 'receptionist' | 'manager';
  status: 'active' | 'inactive';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  today_appointments_count?: number;
}

export interface SalonService {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  price: number;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface SalonPayment {
  id: string;
  company_id: string;
  appointment_id: string;
  amount: number;
  payment_method: 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other';
  reference?: string | null;
  paid_at: string;
  notes?: string | null;
  created_at?: string;
}

export interface SalonAppointment {
  id: string;
  company_id: string;
  customer_id: string;
  staff_id: string;
  service_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  price: number;
  notes?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  customer?: SalonCustomer;
  staff?: SalonStaff;
  service?: SalonService;
  payments?: SalonPayment[];
  paid_amount?: number;
  payment_status?: 'unpaid' | 'paid';
}

export interface SalonMetrics {
  todayAppointments: number;
  upcomingAppointments: number;
  inProgressAppointments: number;
  completedToday: number;
  cancelledToday: number;
  activeStaff: number;
  totalCustomers: number;
  revenueToday: number;
  revenueThisMonth: number;
  outstandingAmount: number;
}

export interface SalonReports {
  revenueToday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  appointmentsByStatus: {
    scheduled: number;
    confirmed: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    no_show: number;
  };
  mostBookedServices: Array<{ name: string; count: number; totalRevenue: number }>;
  topServices?: Array<{ name: string; count: number; totalRevenue: number }>;
  staffPerformance: Array<{ name: string; role: string; count: number; totalRevenue: number }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ensureUuidCompanyId(id: string): string {
  if (id && UUID_REGEX.test(id)) return id;
  return '11111111-1111-4111-8111-111111111111';
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getSupabase(): any {
  if (!isSupabaseConfigured()) return null;
  if (typeof window !== 'undefined') {
    return createBrowserClient();
  }
  return createAdminClient() || createServerClient();
}

/**
 * Calculates end_time (HH:MM) given start_time (HH:MM) and duration in minutes
 */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hoursStr, minutesStr] = startTime.split(':');
  const hours = parseInt(hoursStr || '0', 10);
  const minutes = parseInt(minutesStr || '0', 10);
  const totalMinutes = hours * 60 + minutes + durationMinutes;

  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Converts HH:MM string into minutes from start of day for conflict comparison
 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}

/**
 * Checks if two time windows [s1, e1) and [s2, e2) overlap
 */
export function checkTimeOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  return s1 < e2 && e1 > s2;
}

// -----------------------------------------------------------------------------
// DEFAULT IN-MEMORY SEED FOR RUNTIME RESILIENCE & TESTS
// -----------------------------------------------------------------------------

const DEFAULT_CUSTOMERS: SalonCustomer[] = [
  {
    id: 'cust-sal-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Fatou Diallo',
    phone: '+221 77 123 45 67',
    email: 'fatou.diallo@example.sn',
    notes: 'Habituée coloration caramel et soins kératine',
    created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    last_visit: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'cust-sal-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Aïssatou Ba',
    phone: '+221 78 456 78 90',
    email: 'aissatou.ba@example.sn',
    notes: 'Tresses régulières toutes les 3 semaines',
    created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 15).toISOString(),
    last_visit: new Date().toISOString(),
  },
  {
    id: 'cust-sal-3',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Mariama Sène',
    phone: '+221 76 987 65 43',
    email: 'mariama.sene@example.sn',
    notes: 'Manucure & pédicure spa',
    created_at: new Date(Date.now() - 86400000 * 40).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 40).toISOString(),
  },
];

const DEFAULT_STAFF: SalonStaff[] = [
  {
    id: 'staff-sal-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Awa Cissé',
    phone: '+221 77 555 11 22',
    role: 'stylist',
    status: 'active',
    notes: 'Spécialiste coiffure dames, tissages et coupes modernes',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'staff-sal-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Aminata Touré',
    phone: '+221 78 333 44 55',
    role: 'stylist',
    status: 'active',
    notes: 'Experte tresses africaines, vanilles et nattes collées',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'staff-sal-3',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Khadija Faye',
    phone: '+221 76 222 88 99',
    role: 'beautician',
    status: 'active',
    notes: 'Esthéticienne soins visage, manucure russe et massage bien-être',
    created_at: new Date(Date.now() - 86400000 * 45).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 45).toISOString(),
  },
];

const DEFAULT_SERVICES: SalonService[] = [
  {
    id: 'srv-sal-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Coupe & Brushing Dame',
    description: 'Shampoing traitant, coupe sur-mesure et brushing lissant',
    duration_minutes: 45,
    price: 15000,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'srv-sal-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Coloration Complète & Soin Kératine',
    description: 'Application couleur sans ammoniaque et masque nourrissant',
    duration_minutes: 90,
    price: 35000,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'srv-sal-3',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Tresses & Nattes Collées',
    description: 'Tressage traditionnel soigné avec mèches fournies ou client',
    duration_minutes: 120,
    price: 25000,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'srv-sal-4',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Manucure Spa & Vernis Semi-Permanent',
    description: 'Gommage mains, soin cuticules et pose vernis gel UV',
    duration_minutes: 60,
    price: 18000,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: 'srv-sal-5',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Soin Visage Éclat & Massage Relaxant',
    description: 'Nettoyage profond, vapeur d’ozone et modelage bien-être',
    duration_minutes: 75,
    price: 30000,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
];

const todayStr = new Date().toISOString().split('T')[0];

const DEFAULT_APPOINTMENTS: SalonAppointment[] = [
  {
    id: 'apt-sal-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    customer_id: 'cust-sal-1',
    staff_id: 'staff-sal-1',
    service_id: 'srv-sal-1',
    appointment_date: todayStr,
    start_time: '10:00',
    end_time: '10:45',
    status: 'completed',
    price: 15000,
    notes: 'Brushing souple avec pointes ondulées',
    completed_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'apt-sal-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    customer_id: 'cust-sal-2',
    staff_id: 'staff-sal-2',
    service_id: 'srv-sal-3',
    appointment_date: todayStr,
    start_time: '11:00',
    end_time: '13:00',
    status: 'in_progress',
    price: 25000,
    notes: 'Mèches couleur bordeaux #99',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'apt-sal-3',
    company_id: '11111111-1111-4111-8111-111111111111',
    customer_id: 'cust-sal-3',
    staff_id: 'staff-sal-3',
    service_id: 'srv-sal-4',
    appointment_date: todayStr,
    start_time: '14:30',
    end_time: '15:30',
    status: 'scheduled',
    price: 18000,
    notes: 'Pose french manucure',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEFAULT_PAYMENTS: SalonPayment[] = [
  {
    id: 'pay-sal-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    appointment_id: 'apt-sal-1',
    amount: 15000,
    payment_method: 'cash',
    reference: 'SAL-PAY-001',
    paid_at: new Date().toISOString(),
    notes: 'Règlement espèces en caisse',
    created_at: new Date().toISOString(),
  },
];

const runtimeCache = {
  customers: [...DEFAULT_CUSTOMERS],
  staff: [...DEFAULT_STAFF],
  services: [...DEFAULT_SERVICES],
  appointments: [...DEFAULT_APPOINTMENTS],
  payments: [...DEFAULT_PAYMENTS],
};

// =============================================================================
// 1. CUSTOMERS MANAGEMENT
// =============================================================================

export async function getSalonCustomers(companyIdInput: string, search?: string): Promise<SalonCustomer[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const q = search ? `&search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/v1/salon/customers?companyId=${encodeURIComponent(companyId)}${q}`);
      const json = await res.json();
      if (res.ok && json.success) return json.customers;
    } catch {
      // Fall through
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    let query = supabase
      .from('salon_customers')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term}`);
    }

    const { data, error } = await query;
    if (!error && data) return data;
  }

  let filtered = runtimeCache.customers.filter((c) => c.company_id === companyId);
  if (search && search.trim()) {
    const s = search.toLowerCase();
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(s) || c.phone.toLowerCase().includes(s));
  }
  return filtered;
}

export async function getSalonCustomerById(companyIdInput: string, customerId: string): Promise<SalonCustomer | null> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('salon_customers')
      .select('*')
      .eq('id', customerId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (data) return data;
  }

  const found = runtimeCache.customers.find((c) => c.id === customerId && c.company_id === companyId);
  return found || null;
}

export async function createSalonCustomer(
  companyIdInput: string,
  data: { name: string; phone: string; email?: string | null; notes?: string | null }
): Promise<{ success: boolean; customer?: SalonCustomer; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (!data.name || !data.name.trim()) {
    return { success: false, error: 'Le nom du client est obligatoire.' };
  }
  if (!data.phone || !data.phone.trim()) {
    return { success: false, error: 'Le numéro de téléphone est obligatoire.' };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...data }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, customer: json.customer };
      return { success: false, error: json.error || 'Erreur lors de l’enregistrement du client.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data: created, error } = await supabase
      .from('salon_customers')
      .insert({
        company_id: companyId,
        name: data.name.trim(),
        phone: data.phone.trim(),
        email: data.email || null,
        notes: data.notes || null,
      })
      .select()
      .single();

    if (!error && created) {
      runtimeCache.customers.unshift(created);
      return { success: true, customer: created };
    }
  }

  const fallbackCust: SalonCustomer = {
    id: generateId('cust-sal'),
    company_id: companyId,
    name: data.name.trim(),
    phone: data.phone.trim(),
    email: data.email || null,
    notes: data.notes || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  runtimeCache.customers.unshift(fallbackCust);
  return { success: true, customer: fallbackCust };
}

// =============================================================================
// 2. STAFF MANAGEMENT
// =============================================================================

export async function getSalonStaff(
  companyIdInput: string,
  role?: string,
  status?: 'active' | 'inactive'
): Promise<SalonStaff[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      let url = `/api/v1/salon/staff?companyId=${encodeURIComponent(companyId)}`;
      if (role && role !== 'all') url += `&role=${encodeURIComponent(role)}`;
      if (status) url += `&status=${encodeURIComponent(status)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.success) return json.staff;
    } catch {
      // Fall through
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    let query = supabase
      .from('salon_staff')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (role && role !== 'all') query = query.eq('role', role);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (!error && data) return data;
  }

  let filtered = runtimeCache.staff.filter((s) => s.company_id === companyId);
  if (role && role !== 'all') filtered = filtered.filter((s) => s.role === role);
  if (status) filtered = filtered.filter((s) => s.status === status);
  return filtered;
}

export async function getSalonStaffById(companyIdInput: string, staffId: string): Promise<SalonStaff | null> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('salon_staff')
      .select('*')
      .eq('id', staffId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (data) return data;
  }

  const found = runtimeCache.staff.find((s) => s.id === staffId && s.company_id === companyId);
  return found || null;
}

export async function createSalonStaff(
  companyIdInput: string,
  data: {
    name: string;
    phone?: string | null;
    role: 'stylist' | 'beautician' | 'receptionist' | 'manager';
    status?: 'active' | 'inactive';
    notes?: string | null;
  }
): Promise<{ success: boolean; staff?: SalonStaff; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (!data.name || !data.name.trim()) {
    return { success: false, error: 'Le nom du membre d’équipe est obligatoire.' };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...data }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, staff: json.staff };
      return { success: false, error: json.error || 'Erreur lors de la création du membre d’équipe.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data: created, error } = await supabase
      .from('salon_staff')
      .insert({
        company_id: companyId,
        name: data.name.trim(),
        phone: data.phone || null,
        role: data.role || 'stylist',
        status: data.status || 'active',
        notes: data.notes || null,
      })
      .select()
      .single();

    if (!error && created) {
      runtimeCache.staff.push(created);
      return { success: true, staff: created };
    }
  }

  const fallbackStaff: SalonStaff = {
    id: generateId('staff-sal'),
    company_id: companyId,
    name: data.name.trim(),
    phone: data.phone || null,
    role: data.role || 'stylist',
    status: data.status || 'active',
    notes: data.notes || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  runtimeCache.staff.push(fallbackStaff);
  return { success: true, staff: fallbackStaff };
}

// =============================================================================
// 3. SERVICES CATALOGUE
// =============================================================================

export async function getSalonServices(
  companyIdInput: string,
  status?: 'active' | 'inactive'
): Promise<SalonService[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const q = status ? `&status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`/api/v1/salon/services?companyId=${encodeURIComponent(companyId)}${q}`);
      const json = await res.json();
      if (res.ok && json.success) return json.services;
    } catch {
      // Fall through
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    let query = supabase
      .from('salon_services')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (!error && data) return data;
  }

  let filtered = runtimeCache.services.filter((s) => s.company_id === companyId);
  if (status) filtered = filtered.filter((s) => s.status === status);
  return filtered;
}

export async function getSalonServiceById(companyIdInput: string, serviceId: string): Promise<SalonService | null> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('salon_services')
      .select('*')
      .eq('id', serviceId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (data) return data;
  }

  const found = runtimeCache.services.find((s) => s.id === serviceId && s.company_id === companyId);
  return found || null;
}

export async function createSalonService(
  companyIdInput: string,
  data: {
    name: string;
    description?: string | null;
    duration_minutes: number;
    price: number;
    status?: 'active' | 'inactive';
  }
): Promise<{ success: boolean; service?: SalonService; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (!data.name || !data.name.trim()) {
    return { success: false, error: 'Le nom de la prestation est obligatoire.' };
  }
  if (!data.duration_minutes || Number(data.duration_minutes) <= 0) {
    return { success: false, error: 'La durée de la prestation doit être strictement supérieure à 0.' };
  }
  if (data.price === undefined || Number(data.price) < 0) {
    return { success: false, error: 'Le prix de la prestation ne peut être négatif.' };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...data }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, service: json.service };
      return { success: false, error: json.error || 'Erreur lors de la création de la prestation.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data: created, error } = await supabase
      .from('salon_services')
      .insert({
        company_id: companyId,
        name: data.name.trim(),
        description: data.description || null,
        duration_minutes: Number(data.duration_minutes),
        price: Number(data.price),
        status: data.status || 'active',
      })
      .select()
      .single();

    if (!error && created) {
      runtimeCache.services.push(created);
      return { success: true, service: created };
    }
  }

  const fallbackSrv: SalonService = {
    id: generateId('srv-sal'),
    company_id: companyId,
    name: data.name.trim(),
    description: data.description || null,
    duration_minutes: Number(data.duration_minutes),
    price: Number(data.price),
    status: data.status || 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  runtimeCache.services.push(fallbackSrv);
  return { success: true, service: fallbackSrv };
}

export async function updateSalonServiceStatus(
  companyIdInput: string,
  serviceId: string,
  status: 'active' | 'inactive'
): Promise<{ success: boolean; service?: SalonService; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, service_id: serviceId, status }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, service: json.service };
      return { success: false, error: json.error || 'Erreur lors de la mise à jour de la prestation.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data: updated, error } = await supabase
      .from('salon_services')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', serviceId)
      .eq('company_id', companyId)
      .select()
      .maybeSingle();

    if (!error && updated) {
      const idx = runtimeCache.services.findIndex((s) => s.id === serviceId && s.company_id === companyId);
      if (idx !== -1) runtimeCache.services[idx] = updated;
      return { success: true, service: updated };
    }
  }

  const found = runtimeCache.services.find((s) => s.id === serviceId && s.company_id === companyId);
  if (!found) {
    return { success: false, error: 'Prestation introuvable.' };
  }
  found.status = status;
  found.updated_at = new Date().toISOString();
  return { success: true, service: found };
}

// =============================================================================
// 4. APPOINTMENTS SCHEDULING & CONFLICT DETECTION
// =============================================================================

export async function getSalonAppointments(
  companyIdInput: string,
  filterDate?: string,
  staffId?: string,
  status?: string,
  search?: string
): Promise<SalonAppointment[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      let url = `/api/v1/salon/appointments?companyId=${encodeURIComponent(companyId)}`;
      if (filterDate) url += `&date=${encodeURIComponent(filterDate)}`;
      if (staffId && staffId !== 'all') url += `&staffId=${encodeURIComponent(staffId)}`;
      if (status && status !== 'all') url += `&status=${encodeURIComponent(status)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.success) return json.appointments;
    } catch {
      // Fall through
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    let query = supabase
      .from('salon_appointments')
      .select(`
        *,
        customer:salon_customers(*),
        staff:salon_staff(*),
        service:salon_services(*)
      `)
      .eq('company_id', companyId)
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: true });

    if (filterDate) query = query.eq('appointment_date', filterDate);
    if (staffId && staffId !== 'all') query = query.eq('staff_id', staffId);
    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (!error && data) return data;
  }

  let filtered = runtimeCache.appointments.filter((a) => a.company_id === companyId);
  if (filterDate) filtered = filtered.filter((a) => a.appointment_date === filterDate);
  if (staffId && staffId !== 'all') filtered = filtered.filter((a) => a.staff_id === staffId);
  if (status && status !== 'all') filtered = filtered.filter((a) => a.status === status);

  const populated = filtered.map((a) => {
    const cust = runtimeCache.customers.find((c) => c.id === a.customer_id);
    const stf = runtimeCache.staff.find((s) => s.id === a.staff_id);
    const srv = runtimeCache.services.find((s) => s.id === a.service_id);
    const pmt = runtimeCache.payments.filter((p) => p.appointment_id === a.id);
    const paid = pmt.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      ...a,
      customer: cust,
      staff: stf,
      service: srv,
      payments: pmt,
      paid_amount: paid,
      payment_status: (paid >= a.price ? 'paid' : 'unpaid') as 'paid' | 'unpaid',
    };
  });

  if (search && search.trim()) {
    const s = search.toLowerCase();
    return populated.filter(
      (a) =>
        a.customer?.name.toLowerCase().includes(s) ||
        a.staff?.name.toLowerCase().includes(s) ||
        a.service?.name.toLowerCase().includes(s)
    );
  }

  return populated;
}

export async function getSalonAppointmentById(
  companyIdInput: string,
  appointmentId: string
): Promise<SalonAppointment | null> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('salon_appointments')
      .select(`
        *,
        customer:salon_customers(*),
        staff:salon_staff(*),
        service:salon_services(*)
      `)
      .eq('id', appointmentId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (data) {
      const { data: payments } = await supabase
        .from('salon_payments')
        .select('*')
        .eq('appointment_id', appointmentId);
      const paid = (payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      return {
        ...data,
        payments: payments || [],
        paid_amount: paid,
        payment_status: paid >= data.price ? 'paid' : 'unpaid',
      };
    }
  }

  const found = runtimeCache.appointments.find((a) => a.id === appointmentId && a.company_id === companyId);
  if (!found) return null;
  const payments = runtimeCache.payments.filter((p) => p.appointment_id === appointmentId);
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return {
    ...found,
    customer: runtimeCache.customers.find((c) => c.id === found.customer_id),
    staff: runtimeCache.staff.find((s) => s.id === found.staff_id),
    service: runtimeCache.services.find((s) => s.id === found.service_id),
    payments,
    paid_amount: paid,
    payment_status: paid >= found.price ? 'paid' : 'unpaid',
  };
}

export async function createSalonAppointment(
  companyIdInput: string,
  data: {
    customer_id: string;
    staff_id: string;
    service_id: string;
    appointment_date: string;
    start_time: string;
    price?: number;
    notes?: string | null;
  }
): Promise<{ success: boolean; appointment?: SalonAppointment; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (!data.customer_id) return { success: false, error: 'Le client est obligatoire.' };
  if (!data.staff_id) return { success: false, error: 'Le membre d’équipe (coiffeur/esthéticien) est obligatoire.' };
  if (!data.service_id) return { success: false, error: 'La prestation est obligatoire.' };
  if (!data.appointment_date) return { success: false, error: 'La date du rendez-vous est obligatoire.' };
  if (!data.start_time) return { success: false, error: 'L’heure de début est obligatoire.' };

  // 1. Multi-tenant entity verification
  const customer = await getSalonCustomerById(companyId, data.customer_id);
  if (!customer) {
    return { success: false, error: 'Le client sélectionné n’appartient pas à cette entreprise.' };
  }

  const staff = await getSalonStaffById(companyId, data.staff_id);
  if (!staff) {
    return { success: false, error: 'Le membre d’équipe sélectionné n’appartient pas à cette entreprise.' };
  }

  const service = await getSalonServiceById(companyId, data.service_id);
  if (!service) {
    return { success: false, error: 'La prestation sélectionnée n’appartient pas à cette entreprise.' };
  }

  // 2. Compute end_time
  const endTime = calculateEndTime(data.start_time, service.duration_minutes);
  const finalPrice = data.price !== undefined ? Number(data.price) : Number(service.price);

  // 3. Server-side conflict detection for the SAME staff member on the SAME date
  const existingAppointments = await getSalonAppointments(companyId, data.appointment_date, data.staff_id);
  const activeExisting = existingAppointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');

  const hasConflict = activeExisting.some((ea) =>
    checkTimeOverlap(data.start_time, endTime, ea.start_time, ea.end_time)
  );

  if (hasConflict) {
    return {
      success: false,
      error: `Créneau indisponible : ${staff.name} a déjà un rendez-vous planifié sur cet horaire (${data.start_time} - ${endTime}).`,
    };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          end_time: endTime,
          price: finalPrice,
          ...data,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, appointment: json.appointment };
      return { success: false, error: json.error || 'Erreur lors de la prise de rendez-vous.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data: created, error } = await supabase
      .from('salon_appointments')
      .insert({
        company_id: companyId,
        customer_id: data.customer_id,
        staff_id: data.staff_id,
        service_id: data.service_id,
        appointment_date: data.appointment_date,
        start_time: data.start_time,
        end_time: endTime,
        status: 'scheduled',
        price: finalPrice,
        notes: data.notes || null,
      })
      .select(`
        *,
        customer:salon_customers(*),
        staff:salon_staff(*),
        service:salon_services(*)
      `)
      .single();

    if (!error && created) {
      runtimeCache.appointments.unshift(created);
      return { success: true, appointment: created };
    }
  }

  const fallbackApt: SalonAppointment = {
    id: generateId('apt-sal'),
    company_id: companyId,
    customer_id: data.customer_id,
    staff_id: data.staff_id,
    service_id: data.service_id,
    appointment_date: data.appointment_date,
    start_time: data.start_time,
    end_time: endTime,
    status: 'scheduled',
    price: finalPrice,
    notes: data.notes || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    customer,
    staff,
    service,
    payments: [],
    paid_amount: 0,
    payment_status: 'unpaid',
  };
  runtimeCache.appointments.unshift(fallbackApt);
  return { success: true, appointment: fallbackApt };
}

export async function updateSalonAppointmentStatus(
  companyIdInput: string,
  appointmentId: string,
  newStatus: SalonAppointment['status']
): Promise<{ success: boolean; appointment?: SalonAppointment; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, appointmentId, status: newStatus }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, appointment: json.appointment };
      return { success: false, error: json.error || 'Erreur mise à jour statut.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const payload: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (completedAt) payload.completed_at = completedAt;

    const { data: updated, error } = await supabase
      .from('salon_appointments')
      .update(payload)
      .eq('id', appointmentId)
      .eq('company_id', companyId)
      .select(`
        *,
        customer:salon_customers(*),
        staff:salon_staff(*),
        service:salon_services(*)
      `)
      .maybeSingle();

    if (!error && updated) {
      const idx = runtimeCache.appointments.findIndex((a) => a.id === appointmentId && a.company_id === companyId);
      if (idx !== -1) runtimeCache.appointments[idx] = updated;
      return { success: true, appointment: updated };
    }
  }

  const apt = runtimeCache.appointments.find((a) => a.id === appointmentId && a.company_id === companyId);
  if (apt) {
    apt.status = newStatus;
    if (completedAt) apt.completed_at = completedAt;
    apt.updated_at = new Date().toISOString();
    return { success: true, appointment: apt };
  }

  return { success: false, error: 'Rendez-vous introuvable.' };
}

// =============================================================================
// 5. PAYMENTS & SHARED FINANCE INTEGRATION
// =============================================================================

export async function recordSalonPayment(
  companyIdInput: string,
  appointmentId: string,
  paymentData: {
    amount: number;
    payment_method: 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other';
    reference?: string | null;
    notes?: string | null;
  }
): Promise<{ success: boolean; payment?: SalonPayment; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (paymentData.amount <= 0) {
    return { success: false, error: 'Le montant du paiement doit être supérieur à 0.' };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/salon/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, appointment_id: appointmentId, ...paymentData }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, payment: json.payment };
      return { success: false, error: json.error || 'Erreur enregistrement paiement.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau.' };
    }
  }

  const apt = await getSalonAppointmentById(companyId, appointmentId);
  if (!apt) {
    return { success: false, error: 'Rendez-vous introuvable dans cette entreprise.' };
  }

  const alreadyPaid = (apt.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = Math.max(0, apt.price - alreadyPaid);

  if (remaining <= 0) {
    return {
      success: false,
      error: 'Ce rendez-vous a déjà été intégralement réglé.',
    };
  }

  if (paymentData.amount > remaining) {
    return {
      success: false,
      error: `Le montant saisi (${paymentData.amount.toLocaleString()} XOF) dépasse le solde restant (${remaining.toLocaleString()} XOF).`,
    };
  }

  const pId = generateId('pay-sal');
  const nowIso = new Date().toISOString();
  const detReference = paymentData.reference || `salon-payment-${pId}`;

  const supabase = getSupabase();
  if (supabase) {
    const { data: pRecord, error: pErr } = await supabase
      .from('salon_payments')
      .insert({
        company_id: companyId,
        appointment_id: appointmentId,
        amount: paymentData.amount,
        payment_method: paymentData.payment_method || 'cash',
        reference: detReference,
        paid_at: nowIso,
        notes: paymentData.notes || null,
      })
      .select()
      .single();

    if (!pErr && pRecord) {
      // Shared finance revenue record with deterministic reference for idempotency
      try {
        await recordRevenue({
          workspaceId: companyId,
          moduleId: 'salon-beauty',
          amount: Number(paymentData.amount),
          currency: 'XOF',
          source: `Prestation Salon #${appointmentId.slice(0, 8)}`,
          reference: `salon-payment-${pRecord.id}`,
          occurredAt: nowIso,
        });
      } catch (fErr: any) {
        console.warn('Finance logging non-blocking error:', fErr?.message);
      }

      runtimeCache.payments.push(pRecord);
      return { success: true, payment: pRecord };
    }
  }

  const fallbackPay: SalonPayment = {
    id: pId,
    company_id: companyId,
    appointment_id: appointmentId,
    amount: paymentData.amount,
    payment_method: paymentData.payment_method || 'cash',
    reference: detReference,
    paid_at: nowIso,
    notes: paymentData.notes || null,
    created_at: nowIso,
  };

  try {
    await recordRevenue({
      workspaceId: companyId,
      moduleId: 'salon-beauty',
      amount: Number(paymentData.amount),
      currency: 'XOF',
      source: `Prestation Salon #${appointmentId.slice(0, 8)}`,
      reference: `salon-payment-${fallbackPay.id}`,
      occurredAt: nowIso,
    });
  } catch (fErr: any) {
    console.warn('Finance logging non-blocking fallback error:', fErr?.message);
  }

  runtimeCache.payments.push(fallbackPay);
  return { success: true, payment: fallbackPay };
}

// =============================================================================
// 6. METRICS & OPERATIONAL REPORTS
// =============================================================================

export async function getSalonMetrics(companyIdInput: string): Promise<SalonMetrics> {
  const companyId = ensureUuidCompanyId(companyIdInput);
  const today = new Date().toISOString().split('T')[0];

  const [appointments, staff, customers, payments] = await Promise.all([
    getSalonAppointments(companyId),
    getSalonStaff(companyId),
    getSalonCustomers(companyId),
    (async () => {
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.from('salon_payments').select('amount, paid_at').eq('company_id', companyId);
        if (data) return data;
      }
      return runtimeCache.payments.filter((p) => p.company_id === companyId);
    })(),
  ]);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let revenueToday = 0;
  let revenueThisMonth = 0;

  for (const p of payments) {
    const t = new Date(p.paid_at).getTime();
    const amt = Number(p.amount);
    if (t >= startOfDay) revenueToday += amt;
    if (t >= startOfMonth) revenueThisMonth += amt;
  }

  const todayApts = appointments.filter((a) => a.appointment_date === today);
  const todayAppointments = todayApts.length;
  const inProgressAppointments = todayApts.filter((a) => a.status === 'in_progress').length;
  const completedToday = todayApts.filter((a) => a.status === 'completed').length;
  const cancelledToday = todayApts.filter((a) => a.status === 'cancelled').length;
  const upcomingAppointments = appointments.filter(
    (a) => a.appointment_date >= today && (a.status === 'scheduled' || a.status === 'confirmed')
  ).length;

  const totalBilled = appointments.filter((a) => a.status !== 'cancelled').reduce((sum: number, a: SalonAppointment) => sum + Number(a.price), 0);
  const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const outstandingAmount = Math.max(0, totalBilled - totalPaid);

  return {
    todayAppointments,
    upcomingAppointments,
    inProgressAppointments,
    completedToday,
    cancelledToday,
    activeStaff: staff.filter((s) => s.status === 'active').length,
    totalCustomers: customers.length,
    revenueToday,
    revenueThisMonth,
    outstandingAmount,
  };
}

export async function getSalonReports(companyIdInput: string): Promise<SalonReports> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  const [appointments, staff, payments] = await Promise.all([
    getSalonAppointments(companyId),
    getSalonStaff(companyId),
    (async () => {
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.from('salon_payments').select('amount, paid_at').eq('company_id', companyId);
        if (data) return data;
      }
      return runtimeCache.payments.filter((p) => p.company_id === companyId);
    })(),
  ]);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = new Date(now.getTime() - 7 * 86400000).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let revenueToday = 0;
  let revenueThisWeek = 0;
  let revenueThisMonth = 0;

  for (const p of payments) {
    const t = new Date(p.paid_at).getTime();
    const amt = Number(p.amount);
    if (t >= startOfDay) revenueToday += amt;
    if (t >= startOfWeek) revenueThisWeek += amt;
    if (t >= startOfMonth) revenueThisMonth += amt;
  }

  const appointmentsByStatus = {
    scheduled: appointments.filter((a) => a.status === 'scheduled').length,
    confirmed: appointments.filter((a) => a.status === 'confirmed').length,
    in_progress: appointments.filter((a) => a.status === 'in_progress').length,
    completed: appointments.filter((a) => a.status === 'completed').length,
    cancelled: appointments.filter((a) => a.status === 'cancelled').length,
    no_show: appointments.filter((a) => a.status === 'no_show').length,
  };

  // Group by service
  const serviceCounts: Record<string, { count: number; revenue: number }> = {};
  for (const a of appointments) {
    const sName = a.service?.name || 'Prestation';
    if (!serviceCounts[sName]) serviceCounts[sName] = { count: 0, revenue: 0 };
    serviceCounts[sName].count += 1;
    if (a.status === 'completed') {
      serviceCounts[sName].revenue += Number(a.price);
    }
  }

  const mostBookedServices = Object.entries(serviceCounts)
    .map(([name, data]) => ({ name, count: data.count, totalRevenue: data.revenue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Group by staff member
  const staffPerformance = staff.map((st) => {
    const staffApts = appointments.filter((a) => a.staff_id === st.id);
    const rev = staffApts
      .filter((a) => a.status === 'completed')
      .reduce((sum, a) => sum + Number(a.price), 0);
    return {
      name: st.name,
      role: st.role,
      count: staffApts.length,
      totalRevenue: rev,
    };
  });

  return {
    revenueToday,
    revenueThisWeek,
    revenueThisMonth,
    appointmentsByStatus,
    mostBookedServices,
    topServices: mostBookedServices,
    staffPerformance,
  };
}

// =============================================================================
// 7. MODULE SUMMARY SDK CONTRACT (@kazibox/sdk)
// =============================================================================

export async function getSalonModuleSummary(companyIdInput: string): Promise<ModuleSummary> {
  const companyId = ensureUuidCompanyId(companyIdInput);
  const metrics = await getSalonMetrics(companyId);

  return {
    moduleId: 'hair-salon',
    companyId,
    revenue: metrics.revenueThisMonth,
    expenses: 0,
    activityCount: metrics.todayAppointments + metrics.completedToday,
    currency: 'XOF',
    lastUpdated: new Date().toISOString(),
    metrics: [
      {
        id: 'sal-today-apts',
        moduleId: 'hair-salon',
        label: { fr: 'Rendez-vous du jour', en: "Today's Appointments" },
        value: metrics.todayAppointments,
      },
      {
        id: 'sal-active-staff',
        moduleId: 'hair-salon',
        label: { fr: 'Équipe active', en: 'Active Stylists' },
        value: metrics.activeStaff,
      },
      {
        id: 'sal-month-revenue',
        moduleId: 'hair-salon',
        label: { fr: 'Recettes du mois', en: 'Monthly Revenue' },
        value: metrics.revenueThisMonth,
        currency: 'XOF',
      },
      {
        id: 'sal-pending-balance',
        moduleId: 'hair-salon',
        label: { fr: 'En attente d’encaissement', en: 'Pending Balances' },
        value: metrics.outstandingAmount,
        currency: 'XOF',
      },
      {
        id: 'sal-upcoming-apts',
        moduleId: 'hair-salon',
        label: { fr: 'Rendez-vous à venir', en: 'Upcoming Appointments' },
        value: metrics.upcomingAppointments,
      },
      {
        id: 'sal-active-customers',
        moduleId: 'hair-salon',
        label: { fr: 'Clients actifs', en: 'Active Customers' },
        value: metrics.totalCustomers,
      },
    ],
  };
}
