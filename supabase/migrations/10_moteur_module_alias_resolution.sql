-- ============================================================================
-- KaziBox Additive Migration (10_moteur_module_alias_resolution.sql)
-- FOR REVIEW ONLY — DO NOT EXECUTE DIRECTLY AGAINST PRODUCTION OR LIVE DATABASE
--
-- Objectives:
-- 1. Safely ensure canonical module 'salon' exists in public.modules without unhandled
--    uniqueness crashes on (id) or (slug). Handles existing id='salon', existing
--    slug='hair-salon', split conflicts, and clean insertions idempotently.
-- 2. Add structured checkout term columns to public.payment_history:
--    plan_id, billing_cycle, module_ids.
-- 3. Enhance public.confirm_moteur_payment with:
--    a) Strict payment integrity verification:
--       - Confirmed amount must not be less than expected checkout amount.
--       - Confirmed currency must match expected checkout currency.
--    b) Strict company mismatch validation against existing payment references.
--    c) Term-binding to original checkout record:
--       - Verifies that confirmation plan and billing cycle match the original checkout.
--       - Rejects tampering attempts with PLAN_MISMATCH and BILLING_CYCLE_MISMATCH.
--    d) In-database module alias normalization to canonical IDs:
--       'garage-auto' -> 'garage', 'hotel' -> 'hotel-property',
--       'hair-salon'/'salon-beauty' -> 'salon', 'demo-module' -> 'demo'.
--    e) Foreign-key safe insertion: validates canonical module exists in public.modules
--       and grants entitlements on the canonical key.
--    f) Strict calendar semantics for billing period duration:
--       INTERVAL '1 month' and INTERVAL '1 year' (rejects unsupported cycles).
--    g) Replay and terminal state protection:
--       - Already paid references return status: 'duplicate' immediately.
--       - Failed, refunded, cancelled, expired payments are rejected with HTTP 409 semantics.
-- ============================================================================

-- 1. STRUCTURED COLUMNS FOR PAYMENT HISTORY
ALTER TABLE public.payment_history 
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS module_ids JSONB;

-- 2. SAFE CANONICAL CATALOGUE SEED FOR SALON
DO $$
DECLARE
  v_by_id RECORD;
  v_by_slug RECORD;
BEGIN
  SELECT * INTO v_by_id FROM public.modules WHERE id = 'salon';
  SELECT * INTO v_by_slug FROM public.modules WHERE slug = 'hair-salon';

  IF v_by_id.id IS NOT NULL AND v_by_slug.id IS NOT NULL AND v_by_id.id != v_by_slug.id THEN
    -- Split conflict: id='salon' has one slug, slug='hair-salon' has another id.
    -- Log notice and preserve existing records without silent overwrite.
    RAISE NOTICE 'Modules catalogue conflict detected: row id=salon has slug=%, while slug=hair-salon has id=%. Preserving existing data.', v_by_id.slug, v_by_slug.id;

  ELSIF v_by_id.id IS NOT NULL THEN
    -- Row with id='salon' exists. Update metadata safely.
    UPDATE public.modules
    SET slug = CASE WHEN v_by_slug.id IS NULL OR v_by_slug.id = 'salon' THEN 'hair-salon' ELSE slug END,
        name = '{"fr": "Salon de Coiffure & Esthétique", "en": "Hair Salon & Beauty Spa"}'::jsonb,
        description = '{"fr": "Gestion de salon de coiffure, plannings, rendez-vous et caisse tactile.", "en": "Hair salon and beauty spa management."}'::jsonb,
        tagline = '{"fr": "Pilotez vos fauteuils et prestations en toute sérénité", "en": "Manage appointments and stylists smoothly"}'::jsonb,
        category = 'Beauty',
        icon = 'Scissors',
        kind = 'internal',
        status = 'active',
        developer = 'KaziBox Core',
        version = '1.0.2',
        min_platform_version = '1.0.0',
        features = '["Planning coiffeurs", "Caisse tactile", "Fichier clients", "SMS rappels"]'::jsonb,
        pricing = '{"monthly": 10000, "annual": 100000, "currency": "XOF"}'::jsonb,
        manifest = '{"id": "salon", "canonical_id": "salon", "slug": "hair-salon", "name": "Salon de Coiffure", "version": "1.0.2", "entryUrl": "/modules/hair-salon"}'::jsonb
    WHERE id = 'salon';

  ELSIF v_by_slug.id IS NOT NULL THEN
    -- Row with slug='hair-salon' exists under another ID (e.g. 'hair-salon').
    -- Preserve primary key to avoid violating foreign keys in public.company_modules.
    UPDATE public.modules
    SET name = '{"fr": "Salon de Coiffure & Esthétique", "en": "Hair Salon & Beauty Spa"}'::jsonb,
        description = '{"fr": "Gestion de salon de coiffure, plannings, rendez-vous et caisse tactile.", "en": "Hair salon and beauty spa management."}'::jsonb,
        tagline = '{"fr": "Pilotez vos fauteuils et prestations en toute sérénité", "en": "Manage appointments and stylists smoothly"}'::jsonb,
        category = 'Beauty',
        icon = 'Scissors',
        kind = 'internal',
        status = 'active',
        developer = 'KaziBox Core',
        version = '1.0.2',
        min_platform_version = '1.0.0',
        features = '["Planning coiffeurs", "Caisse tactile", "Fichier clients", "SMS rappels"]'::jsonb,
        pricing = '{"monthly": 10000, "annual": 100000, "currency": "XOF"}'::jsonb,
        manifest = jsonb_build_object(
          'id', v_by_slug.id,
          'canonical_id', 'salon',
          'slug', 'hair-salon',
          'name', 'Salon de Coiffure',
          'version', '1.0.2',
          'entryUrl', '/modules/hair-salon'
        )
    WHERE id = v_by_slug.id;

  ELSE
    -- Neither exists: safe insert
    INSERT INTO public.modules (
      id, slug, name, description, tagline, category, icon, kind, status, developer, version, min_platform_version, features, pricing, manifest
    ) VALUES (
      'salon',
      'hair-salon',
      '{"fr": "Salon de Coiffure & Esthétique", "en": "Hair Salon & Beauty Spa"}'::jsonb,
      '{"fr": "Gestion de salon de coiffure, plannings, rendez-vous et caisse tactile.", "en": "Hair salon and beauty spa management."}'::jsonb,
      '{"fr": "Pilotez vos fauteuils et prestations en toute sérénité", "en": "Manage appointments and stylists smoothly"}'::jsonb,
      'Beauty',
      'Scissors',
      'internal',
      'active',
      'KaziBox Core',
      '1.0.2',
      '1.0.0',
      '["Planning coiffeurs", "Caisse tactile", "Fichier clients", "SMS rappels"]'::jsonb,
      '{"monthly": 10000, "annual": 100000, "currency": "XOF"}'::jsonb,
      '{"id": "salon", "canonical_id": "salon", "slug": "hair-salon", "name": "Salon de Coiffure", "version": "1.0.2", "entryUrl": "/modules/hair-salon"}'::jsonb
    );
  END IF;
END $$;

-- 3. SECURE, TERM-BOUND & ALIAS-AWARE CONFIRM_MOTEUR_PAYMENT RPC
CREATE OR REPLACE FUNCTION public.confirm_moteur_payment(
  p_company_id UUID,
  p_reference TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_plan_id TEXT,
  p_billing_cycle TEXT,
  p_module_ids JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub_id UUID;
  v_payment_id UUID;
  v_existing_payment RECORD;
  v_existing_end TIMESTAMPTZ;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_interval INTERVAL;
  v_mod TEXT;
  v_canonical_mod TEXT;
  v_normalized_module_ids JSONB := '[]'::jsonb;
  v_effective_plan_id TEXT;
  v_effective_billing_cycle TEXT;
  v_effective_module_ids JSONB;
BEGIN
  -- 1. Transaction-level advisory lock serializes concurrent executions for this reference
  PERFORM pg_advisory_xact_lock(hashtext('moteur_billing:' || p_reference));

  -- 2. Trusted parameter validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'COMPANY_NOT_FOUND', 'message', 'Target company/workspace not found');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_AMOUNT', 'message', 'Payment amount must be greater than zero');
  END IF;

  IF p_currency IS NULL OR length(trim(p_currency)) != 3 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_CURRENCY', 'message', 'Payment currency must be a valid 3-character ISO code');
  END IF;

  IF p_plan_id IS NULL OR trim(p_plan_id) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_PLAN', 'message', 'plan_id is required');
  END IF;

  -- Strictly accept only 'monthly' or 'yearly' billing cycles; reject any invalid values
  IF p_billing_cycle IS NULL OR LOWER(trim(p_billing_cycle)) NOT IN ('monthly', 'yearly') THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'INVALID_BILLING_CYCLE',
      'message', 'Billing cycle must be either "monthly" or "yearly"',
      'reference', p_reference
    );
  END IF;

  -- 3. In-database module alias normalization to canonical IDs
  IF p_module_ids IS NOT NULL AND jsonb_array_length(p_module_ids) > 0 THEN
    FOR v_mod IN SELECT jsonb_array_elements_text(p_module_ids) LOOP
      v_canonical_mod := CASE v_mod
        WHEN 'garage-auto' THEN 'garage'
        WHEN 'hair-salon' THEN 'salon'
        WHEN 'salon-beauty' THEN 'salon'
        WHEN 'hotel' THEN 'hotel-property'
        WHEN 'demo-module' THEN 'demo'
        ELSE v_mod
      END;

      -- Check if canonical ID exists in public.modules catalogue
      IF EXISTS (SELECT 1 FROM public.modules WHERE id = v_canonical_mod) THEN
        IF NOT (v_normalized_module_ids ? v_canonical_mod) THEN
          v_normalized_module_ids := v_normalized_module_ids || jsonb_build_array(v_canonical_mod);
        END IF;
      ELSIF EXISTS (SELECT 1 FROM public.modules WHERE id = v_mod) THEN
        IF NOT (v_normalized_module_ids ? v_mod) THEN
          v_normalized_module_ids := v_normalized_module_ids || jsonb_build_array(v_mod);
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'status', 'invalid',
          'code', 'INVALID_MODULES',
          'message', 'Requested module ' || v_mod || ' does not exist in the catalogue'
        );
      END IF;
    END LOOP;
  END IF;

  -- 4. Database-level Idempotency, Company Mismatch & Payment Integrity Check
  -- Prioritize exact reference match, falling back to legacy description only if reference IS NULL
  SELECT id, company_id, status, amount, currency, plan_id, billing_cycle, module_ids INTO v_existing_payment
  FROM public.payment_history
  WHERE reference = p_reference
     OR (reference IS NULL AND company_id = p_company_id AND description = 'Moteur Payment: ' || p_reference)
  ORDER BY (CASE WHEN reference = p_reference THEN 0 ELSE 1 END), created_at DESC
  LIMIT 1;

  -- Company mismatch protection: reference cannot be hijacked across companies
  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.company_id IS NOT NULL AND v_existing_payment.company_id != p_company_id THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'COMPANY_MISMATCH',
      'message', 'Payment reference belongs to another company',
      'reference', p_reference
    );
  END IF;

  -- Payment integrity check: amount underpayment rejection
  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.amount IS NOT NULL AND p_amount < v_existing_payment.amount THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'UNDERPAID_AMOUNT',
      'message', 'Confirmed payment amount (' || p_amount || ') is less than expected checkout amount (' || v_existing_payment.amount || ')',
      'reference', p_reference
    );
  END IF;

  -- Payment integrity check: currency mismatch rejection
  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.currency IS NOT NULL AND upper(trim(p_currency)) != upper(trim(v_existing_payment.currency)) THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'CURRENCY_MISMATCH',
      'message', 'Confirmed payment currency (' || p_currency || ') does not match expected checkout currency (' || v_existing_payment.currency || ')',
      'reference', p_reference
    );
  END IF;

  -- Idempotency check: already paid references cannot reactivate or extend subscriptions
  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'code', 'ALREADY_PROCESSED',
      'message', 'Payment has already been processed and confirmed',
      'reference', p_reference,
      'payment_id', v_existing_payment.id
    );
  END IF;

  -- Terminal state check: failed/refunded/cancelled cannot be confirmed
  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.status IN ('failed', 'refunded', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'PAYMENT_ALREADY_TERMINATED',
      'message', 'Payment has already been marked as ' || v_existing_payment.status || ' and cannot be confirmed',
      'reference', p_reference,
      'payment_id', v_existing_payment.id
    );
  END IF;

  -- Terms binding to original checkout: Reject tampering with plan or billing cycle
  IF v_existing_payment.id IS NOT NULL THEN
    IF v_existing_payment.plan_id IS NOT NULL AND p_plan_id != v_existing_payment.plan_id THEN
      RETURN jsonb_build_object(
        'status', 'invalid',
        'code', 'PLAN_MISMATCH',
        'message', 'Confirmation plan (' || p_plan_id || ') does not match checkout plan (' || v_existing_payment.plan_id || ')',
        'reference', p_reference
      );
    END IF;

    IF v_existing_payment.billing_cycle IS NOT NULL AND LOWER(trim(p_billing_cycle)) != LOWER(trim(v_existing_payment.billing_cycle)) THEN
      RETURN jsonb_build_object(
        'status', 'invalid',
        'code', 'BILLING_CYCLE_MISMATCH',
        'message', 'Confirmation billing cycle (' || p_billing_cycle || ') does not match checkout billing cycle (' || v_existing_payment.billing_cycle || ')',
        'reference', p_reference
      );
    END IF;
  END IF;

  -- Resolve effective terms from stored checkout record
  v_effective_plan_id := COALESCE(v_existing_payment.plan_id, p_plan_id);
  v_effective_billing_cycle := LOWER(trim(COALESCE(v_existing_payment.billing_cycle, p_billing_cycle)));
  v_effective_module_ids := COALESCE(v_existing_payment.module_ids, v_normalized_module_ids);

  -- 5. Calculate Calendar Billing Period Duration
  IF v_effective_billing_cycle = 'yearly' THEN
    v_interval := INTERVAL '1 year';
  ELSE
    v_interval := INTERVAL '1 month';
  END IF;

  -- 6. Renewal Extension: Check if workspace currently has an active term ending in the future
  SELECT id, current_period_end INTO v_sub_id, v_existing_end
  FROM public.subscriptions
  WHERE company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_end IS NOT NULL AND v_existing_end > NOW() THEN
    v_period_start := NOW();
    v_period_end := v_existing_end + v_interval;
  ELSE
    v_period_start := NOW();
    v_period_end := NOW() + v_interval;
  END IF;

  -- 7. Atomically Upsert/Update Subscription with Trusted Effective Terms
  IF v_sub_id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET plan_id = v_effective_plan_id,
        status = 'active',
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        cancel_at_period_end = FALSE,
        included_module_ids = COALESCE(v_effective_module_ids, '[]'::jsonb)
    WHERE id = v_sub_id;
  ELSE
    INSERT INTO public.subscriptions (
      company_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, included_module_ids
    ) VALUES (
      p_company_id, v_effective_plan_id, 'active', v_period_start, v_period_end, FALSE, COALESCE(v_effective_module_ids, '[]'::jsonb)
    ) RETURNING id INTO v_sub_id;
  END IF;

  -- 8. Atomically Update Module Entitlements with Trusted Effective Terms
  IF v_effective_module_ids IS NOT NULL AND jsonb_array_length(v_effective_module_ids) > 0 THEN
    FOR v_mod IN SELECT jsonb_array_elements_text(v_effective_module_ids) LOOP
      IF EXISTS (SELECT 1 FROM public.modules WHERE id = v_mod) THEN
        INSERT INTO public.company_modules (
          company_id, module_id, plan_id, status, activated_at, expires_at, auto_renew
        ) VALUES (
          p_company_id, v_mod, v_effective_plan_id, 'active', NOW(), v_period_end, TRUE
        )
        ON CONFLICT (company_id, module_id)
        DO UPDATE SET
          plan_id = v_effective_plan_id,
          status = 'active',
          expires_at = v_period_end,
          auto_renew = TRUE;
      END IF;
    END LOOP;
  END IF;

  -- 9. Record Payment History (Atomically committed in this transaction)
  -- If a pending record was pre-created during checkout creation, update it; otherwise insert
  IF v_existing_payment.id IS NOT NULL THEN
    UPDATE public.payment_history
    SET amount = p_amount,
        currency = p_currency,
        status = 'paid',
        description = 'Moteur Payment: ' || p_reference,
        reference = COALESCE(payment_history.reference, p_reference),
        plan_id = v_effective_plan_id,
        billing_cycle = v_effective_billing_cycle,
        module_ids = v_effective_module_ids,
        invoice_url = '#'
    WHERE id = v_existing_payment.id
    RETURNING id INTO v_payment_id;
  ELSE
    INSERT INTO public.payment_history (
      company_id,
      amount,
      currency,
      status,
      description,
      invoice_url,
      reference,
      plan_id,
      billing_cycle,
      module_ids
    ) VALUES (
      p_company_id,
      p_amount,
      p_currency,
      'paid',
      'Moteur Payment: ' || p_reference,
      '#',
      p_reference,
      v_effective_plan_id,
      v_effective_billing_cycle,
      v_effective_module_ids
    ) RETURNING id INTO v_payment_id;
  END IF;

  -- 10. Return Structured Result
  RETURN jsonb_build_object(
    'status', 'success',
    'code', 'PAYMENT_CONFIRMED',
    'message', 'Payment confirmed and entitlements updated atomically',
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id,
    'reference', p_reference,
    'period_end', v_period_end
  );

EXCEPTION WHEN OTHERS THEN
  -- Transaction automatically rolls back all sub-operations on exception
  RETURN jsonb_build_object(
    'status', 'error',
    'code', SQLSTATE,
    'message', SQLERRM,
    'reference', p_reference
  );
END;
$$;

-- Secure execution permissions
-- Revoke execution from PUBLIC (pseudo-role that always exists in PostgreSQL)
REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;

-- Conditionally revoke from anon/authenticated and grant exclusively to service_role
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
  ELSE
    RAISE WARNING 'Role "service_role" does not exist in this database. In Supabase environments, execute privilege on confirm_moteur_payment must be granted to service_role.';
  END IF;
END $$;
