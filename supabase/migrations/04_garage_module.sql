-- KaziBox Garage & Auto Repair Module Migration (04_garage_module.sql)
-- Defines native KaziBox tables for Garage & Automotive Repair Workshop Management

-- 1. GARAGE CUSTOMERS
CREATE TABLE IF NOT EXISTS public.garage_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. GARAGE VEHICLES
CREATE TABLE IF NOT EXISTS public.garage_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.garage_customers(id) ON DELETE CASCADE,
  registration_number TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INT,
  color TEXT,
  mileage INT,
  vin TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. GARAGE JOBS (Repair Orders)
CREATE TABLE IF NOT EXISTS public.garage_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.garage_customers(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.garage_vehicles(id) ON DELETE CASCADE,
  job_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  diagnosis TEXT,
  mechanic_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'diagnosing', 'in_progress', 'waiting_parts', 'completed', 'delivered', 'cancelled')),
  estimated_amount NUMERIC(12,2),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_completion_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_company_job_number UNIQUE (company_id, job_number)
);

-- 4. GARAGE JOB ITEMS (Services & Parts)
CREATE TABLE IF NOT EXISTS public.garage_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.garage_jobs(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'service' CHECK (item_type IN ('service', 'part')),
  name TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. GARAGE PAYMENTS
CREATE TABLE IF NOT EXISTS public.garage_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.garage_jobs(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer', 'other')),
  reference TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for optimal multi-tenant query performance
CREATE INDEX IF NOT EXISTS idx_garage_customers_company_id ON public.garage_customers(company_id);
CREATE INDEX IF NOT EXISTS idx_garage_vehicles_company_id ON public.garage_vehicles(company_id);
CREATE INDEX IF NOT EXISTS idx_garage_vehicles_customer_id ON public.garage_vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_garage_vehicles_registration ON public.garage_vehicles(registration_number);
CREATE INDEX IF NOT EXISTS idx_garage_jobs_company_id ON public.garage_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_garage_jobs_customer_id ON public.garage_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_garage_jobs_vehicle_id ON public.garage_jobs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_garage_jobs_status ON public.garage_jobs(status);
CREATE INDEX IF NOT EXISTS idx_garage_jobs_job_number ON public.garage_jobs(job_number);
CREATE INDEX IF NOT EXISTS idx_garage_job_items_job_id ON public.garage_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_garage_payments_job_id ON public.garage_payments(job_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.garage_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_payments ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES FOR GARAGE CUSTOMERS
DROP POLICY IF EXISTS "Garage customers viewable within company" ON public.garage_customers;
CREATE POLICY "Garage customers viewable within company"
  ON public.garage_customers FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Garage customers manageable by company staff" ON public.garage_customers;
CREATE POLICY "Garage customers manageable by company staff"
  ON public.garage_customers FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 7. RLS POLICIES FOR GARAGE VEHICLES
DROP POLICY IF EXISTS "Garage vehicles viewable within company" ON public.garage_vehicles;
CREATE POLICY "Garage vehicles viewable within company"
  ON public.garage_vehicles FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Garage vehicles manageable by company staff" ON public.garage_vehicles;
CREATE POLICY "Garage vehicles manageable by company staff"
  ON public.garage_vehicles FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 8. RLS POLICIES FOR GARAGE JOBS
DROP POLICY IF EXISTS "Garage jobs viewable within company" ON public.garage_jobs;
CREATE POLICY "Garage jobs viewable within company"
  ON public.garage_jobs FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Garage jobs manageable by company staff" ON public.garage_jobs;
CREATE POLICY "Garage jobs manageable by company staff"
  ON public.garage_jobs FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 9. RLS POLICIES FOR GARAGE JOB ITEMS
DROP POLICY IF EXISTS "Garage job items viewable within company" ON public.garage_job_items;
CREATE POLICY "Garage job items viewable within company"
  ON public.garage_job_items FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Garage job items manageable by company staff" ON public.garage_job_items;
CREATE POLICY "Garage job items manageable by company staff"
  ON public.garage_job_items FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 10. RLS POLICIES FOR GARAGE PAYMENTS
DROP POLICY IF EXISTS "Garage payments viewable within company" ON public.garage_payments;
CREATE POLICY "Garage payments viewable within company"
  ON public.garage_payments FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Garage payments manageable by company staff" ON public.garage_payments;
CREATE POLICY "Garage payments manageable by company staff"
  ON public.garage_payments FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );
