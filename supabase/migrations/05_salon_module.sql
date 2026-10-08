-- KaziBox Hair Salon & Beauty Spa Module Migration (05_salon_module.sql)
-- Defines native KaziBox tables for Hair Salon & Beauty Spa Operations

-- 1. SALON CUSTOMERS
CREATE TABLE IF NOT EXISTS public.salon_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SALON STAFF / ROSTER
CREATE TABLE IF NOT EXISTS public.salon_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'stylist' CHECK (role IN ('stylist', 'beautician', 'receptionist', 'manager')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. SALON SERVICES CATALOGUE
CREATE TABLE IF NOT EXISTS public.salon_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  price NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SALON APPOINTMENTS
CREATE TABLE IF NOT EXISTS public.salon_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.salon_customers(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.salon_staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.salon_services(id) ON DELETE CASCADE,
  appointment_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  price NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. SALON PAYMENTS
CREATE TABLE IF NOT EXISTS public.salon_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES public.salon_appointments(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer', 'other')),
  reference TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance & Multi-Tenant Indexes
CREATE INDEX IF NOT EXISTS idx_salon_customers_company_id ON public.salon_customers(company_id);
CREATE INDEX IF NOT EXISTS idx_salon_customers_phone ON public.salon_customers(company_id, phone);
CREATE INDEX IF NOT EXISTS idx_salon_staff_company_id ON public.salon_staff(company_id);
CREATE INDEX IF NOT EXISTS idx_salon_services_company_id ON public.salon_services(company_id);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_company_id ON public.salon_appointments(company_id);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_customer ON public.salon_appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_staff_date ON public.salon_appointments(company_id, staff_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_salon_payments_company_id ON public.salon_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_salon_payments_appointment ON public.salon_payments(appointment_id);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.salon_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_payments ENABLE ROW LEVEL SECURITY;

-- 1. RLS FOR SALON CUSTOMERS
CREATE POLICY "Salon customers viewable within company"
  ON public.salon_customers FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Salon customers manageable by company staff"
  ON public.salon_customers FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 2. RLS FOR SALON STAFF
CREATE POLICY "Salon staff viewable within company"
  ON public.salon_staff FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Salon staff manageable by company staff"
  ON public.salon_staff FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 3. RLS FOR SALON SERVICES
CREATE POLICY "Salon services viewable within company"
  ON public.salon_services FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Salon services manageable by company staff"
  ON public.salon_services FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 4. RLS FOR SALON APPOINTMENTS
CREATE POLICY "Salon appointments viewable within company"
  ON public.salon_appointments FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Salon appointments manageable by company staff"
  ON public.salon_appointments FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 5. RLS FOR SALON PAYMENTS
CREATE POLICY "Salon payments viewable within company"
  ON public.salon_payments FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Salon payments manageable by company staff"
  ON public.salon_payments FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );
