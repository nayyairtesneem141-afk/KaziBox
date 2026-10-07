-- KaziBox Supabase RLS and Security Policies Migration (02_rls_and_policies.sql)

-- SECURITY DEFINER Helper Functions supporting multi-company membership
CREATE OR REPLACE FUNCTION public.get_auth_user_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_company_ids()
RETURNS TABLE (company_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
  UNION
  SELECT company_id FROM public.team_members WHERE (user_id = auth.uid() OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())) AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'platform_admin' FROM public.profiles WHERE id = auth.uid() LIMIT 1), FALSE);
$$;

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

----------------------------------------------------
-- 1. MODULES CATALOGUE POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Modules are readable by all authenticated users" ON public.modules;
CREATE POLICY "Modules are readable by all authenticated users"
  ON public.modules FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Modules are manageable by platform admins" ON public.modules;
CREATE POLICY "Modules are manageable by platform admins"
  ON public.modules FOR ALL
  TO authenticated
  USING (is_platform_admin());

----------------------------------------------------
-- 2. COMPANIES POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own company or platform admins" ON public.companies;
CREATE POLICY "Users can view their own company or platform admins"
  ON public.companies FOR SELECT
  TO authenticated
  USING (id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Owners and platform admins can update their company" ON public.companies;
CREATE POLICY "Owners and platform admins can update their company"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    (id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 3. PROFILES POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Users can view profiles in their company or platform admins" ON public.profiles;
CREATE POLICY "Users can view profiles in their company or platform admins"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR is_platform_admin());

DROP POLICY IF EXISTS "Users can insert their profile on signup" ON public.profiles;
CREATE POLICY "Users can insert their profile on signup"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid() OR is_platform_admin());

----------------------------------------------------
-- 4. TEAM MEMBERS POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Team members readable within same company" ON public.team_members;
CREATE POLICY "Team members readable within same company"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

DROP POLICY IF EXISTS "Owners and Managers can manage team members" ON public.team_members;
CREATE POLICY "Owners and Managers can manage team members"
  ON public.team_members FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 5. COMPANY MODULES POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Company modules viewable within company" ON public.company_modules;
CREATE POLICY "Company modules viewable within company"
  ON public.company_modules FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Company modules manageable by owners and platform admins" ON public.company_modules;
CREATE POLICY "Company modules manageable by owners and platform admins"
  ON public.company_modules FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 6. SUBSCRIPTIONS & PAYMENT POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Subscriptions viewable by owners, managers, platform admins" ON public.subscriptions;
CREATE POLICY "Subscriptions viewable by owners, managers, platform admins"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

DROP POLICY IF EXISTS "Subscriptions manageable by owners and platform admins" ON public.subscriptions;
CREATE POLICY "Subscriptions manageable by owners and platform admins"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

DROP POLICY IF EXISTS "Payment history viewable by owners and platform admins" ON public.payment_history;
CREATE POLICY "Payment history viewable by owners and platform admins"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 7. FINANCE RECORDS POLICIES
----------------------------------------------------
DROP POLICY IF EXISTS "Finance records readable within company" ON public.finance_records;
CREATE POLICY "Finance records readable within company"
  ON public.finance_records FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Finance records insertable by owner, manager, or backend service" ON public.finance_records;
CREATE POLICY "Finance records insertable by owner, manager, or backend service"
  ON public.finance_records FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 8. NOTIFICATIONS & ACTIVITY LOGS
----------------------------------------------------
DROP POLICY IF EXISTS "Notifications readable by target user or company owner/manager" ON public.notifications;
CREATE POLICY "Notifications readable by target user or company owner/manager"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Notifications updateable by target user" ON public.notifications;
CREATE POLICY "Notifications updateable by target user"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

DROP POLICY IF EXISTS "Activity logs readable by owners and managers" ON public.activity_logs;
CREATE POLICY "Activity logs readable by owners and managers"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

DROP POLICY IF EXISTS "Activity logs insertable within company" ON public.activity_logs;
CREATE POLICY "Activity logs insertable within company"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT get_auth_user_company_ids()) OR is_platform_admin());

----------------------------------------------------
-- 9. MODULE API KEYS POLICIES (Owners & Admins Only)
----------------------------------------------------
DROP POLICY IF EXISTS "API keys readable by company owners and platform admins" ON public.module_api_keys;
CREATE POLICY "API keys readable by company owners and platform admins"
  ON public.module_api_keys FOR SELECT
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

DROP POLICY IF EXISTS "API keys manageable by company owners and platform admins" ON public.module_api_keys;
CREATE POLICY "API keys manageable by company owners and platform admins"
  ON public.module_api_keys FOR ALL
  TO authenticated
  USING (
    (company_id IN (SELECT get_auth_user_company_ids()) AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );
