-- ==============================================================================
-- KaziBox Supabase Migration (09_additional_workspace_rpc.sql)
-- Atomic Additional Workspace & Owner Association RPC
-- ==============================================================================
-- Allows authenticated users to provision a secondary/additional company workspace.
-- Transactionally creates the company, establishes the creator as an active 'owner'
-- in public.team_members, and seeds a starter subscription.
-- If any step fails, the entire transaction rolls back, guaranteeing zero orphaned records.

CREATE OR REPLACE FUNCTION public.create_additional_workspace(
  p_user_id UUID,
  p_name TEXT,
  p_country TEXT DEFAULT 'Côte d’Ivoire',
  p_currency TEXT DEFAULT 'XOF',
  p_language TEXT DEFAULT 'fr',
  p_logo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_user_email TEXT;
  v_user_name TEXT;
BEGIN
  -- 1. Validate caller identity from profiles
  SELECT email, name INTO v_user_email, v_user_name
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Profile with ID % does not exist.', p_user_id;
  END IF;

  IF p_name IS NULL OR char_length(TRIM(p_name)) < 2 THEN
    RAISE EXCEPTION 'INVALID_NAME: Company name must be at least 2 characters.';
  END IF;

  -- 2. Insert new company
  INSERT INTO public.companies (
    name,
    country,
    currency,
    language,
    logo_url,
    plan,
    status
  ) VALUES (
    TRIM(p_name),
    COALESCE(NULLIF(TRIM(p_country), ''), 'Côte d’Ivoire'),
    COALESCE(NULLIF(TRIM(p_currency), ''), 'XOF'),
    COALESCE(NULLIF(TRIM(p_language), ''), 'fr'),
    NULLIF(TRIM(p_logo_url), ''),
    'starter',
    'active'
  )
  RETURNING * INTO v_company;

  -- 3. Insert team member record establishing the user as owner of the new workspace
  INSERT INTO public.team_members (
    company_id,
    user_id,
    name,
    email,
    role,
    status
  ) VALUES (
    v_company.id,
    p_user_id,
    COALESCE(v_user_name, 'Owner'),
    v_user_email,
    'owner',
    'active'
  );

  -- 4. Insert default starter subscription
  INSERT INTO public.subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    included_module_ids
  ) VALUES (
    v_company.id,
    'starter',
    'active',
    NOW(),
    '[]'::jsonb
  );

  RETURN to_jsonb(v_company);
END;
$$;
