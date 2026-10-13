-- KaziBox Migration: 07_registration_and_recovery.sql
-- Atomic Workspace & Owner Registration RPC
-- Ensures atomic, transactional creation of company, profile, owner team membership,
-- and default subscription without leaving orphaned records or bypassing RLS.

CREATE OR REPLACE FUNCTION public.create_workspace_and_owner(
  p_user_id UUID,
  p_email TEXT,
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT 'Mon Entreprise',
  p_country TEXT DEFAULT 'Côte d’Ivoire',
  p_currency TEXT DEFAULT 'XOF',
  p_language TEXT DEFAULT 'fr'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_company RECORD;
  v_profile RECORD;
BEGIN
  -- 1. Insert new company
  INSERT INTO public.companies (
    name,
    country,
    currency,
    language,
    plan,
    status
  ) VALUES (
    TRIM(p_company_name),
    COALESCE(NULLIF(TRIM(p_country), ''), 'Côte d’Ivoire'),
    COALESCE(NULLIF(TRIM(p_currency), ''), 'XOF'),
    COALESCE(NULLIF(TRIM(p_language), ''), 'fr'),
    'starter',
    'active'
  )
  RETURNING * INTO v_company;

  v_company_id := v_company.id;

  -- 2. Insert or update profile for the authenticated user as owner
  INSERT INTO public.profiles (
    id,
    email,
    name,
    phone,
    role,
    company_id
  ) VALUES (
    p_user_id,
    LOWER(TRIM(p_email)),
    TRIM(p_name),
    NULLIF(TRIM(p_phone), ''),
    'owner',
    v_company_id
  )
  ON CONFLICT (id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    role = 'owner',
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone
  RETURNING * INTO v_profile;

  -- 3. Insert team member record with owner role
  INSERT INTO public.team_members (
    company_id,
    user_id,
    name,
    email,
    role,
    status
  ) VALUES (
    v_company_id,
    p_user_id,
    TRIM(p_name),
    LOWER(TRIM(p_email)),
    'owner',
    'active'
  );

  -- 4. Insert starter subscription record
  INSERT INTO public.subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    included_module_ids
  ) VALUES (
    v_company_id,
    'starter',
    'active',
    NOW(),
    '[]'::jsonb
  );

  RETURN jsonb_build_object(
    'company', to_jsonb(v_company),
    'profile', to_jsonb(v_profile)
  );
END;
$$;

-- Restrict RPC execution strictly to service_role to prevent unauthorized PostgREST execution
REVOKE ALL ON FUNCTION public.create_workspace_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_workspace_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_workspace_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_workspace_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;


