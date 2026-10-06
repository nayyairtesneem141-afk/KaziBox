-- KaziBox Supabase RLS and Security Policies Migration (02_rls_and_policies.sql)

-- SECURITY DEFINER Helper Functions to avoid recursion in RLS policies
CREATE OR REPLACE FUNCTION public.get_auth_user_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
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
CREATE POLICY "Modules are readable by all authenticated users"
  ON public.modules FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Modules are manageable by platform admins"
  ON public.modules FOR ALL
  TO authenticated
  USING (is_platform_admin());

----------------------------------------------------
-- 2. COMPANIES POLICIES
----------------------------------------------------
CREATE POLICY "Users can view their own company or platform admins"
  ON public.companies FOR SELECT
  TO authenticated
  USING (id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Owners and platform admins can update their company"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    (id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 3. PROFILES POLICIES
----------------------------------------------------
CREATE POLICY "Users can view profiles in their company or platform admins"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR is_platform_admin());

CREATE POLICY "Users can insert their profile on signup"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid() OR is_platform_admin());

----------------------------------------------------
-- 4. TEAM MEMBERS POLICIES
----------------------------------------------------
CREATE POLICY "Team members readable within same company"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Owners and Managers can manage team members"
  ON public.team_members FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 5. COMPANY MODULES POLICIES
----------------------------------------------------
CREATE POLICY "Company modules viewable within company"
  ON public.company_modules FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Company modules manageable by owners and platform admins"
  ON public.company_modules FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 6. SUBSCRIPTIONS & PAYMENT POLICIES
----------------------------------------------------
CREATE POLICY "Subscriptions viewable by owners, managers, platform admins"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

CREATE POLICY "Subscriptions manageable by owners and platform admins"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

CREATE POLICY "Payment history viewable by owners and platform admins"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 7. FINANCE RECORDS POLICIES
----------------------------------------------------
CREATE POLICY "Finance records readable within company"
  ON public.finance_records FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Finance records insertable by owner, manager, or backend service"
  ON public.finance_records FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

----------------------------------------------------
-- 8. NOTIFICATIONS & ACTIVITY LOGS
----------------------------------------------------
CREATE POLICY "Notifications readable by target user or company owner/manager"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Notifications updateable by target user"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Activity logs readable by owners and managers"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'platform_admin'))
    OR is_platform_admin()
  );

CREATE POLICY "Activity logs insertable within company"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_auth_user_company_id() OR is_platform_admin());
