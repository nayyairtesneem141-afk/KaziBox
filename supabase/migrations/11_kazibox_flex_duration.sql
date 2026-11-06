-- ============================================================================
-- Migration 11: KaziBox Flex — High-Precision Duration, Fee Split & Pricing Tiers
-- ============================================================================
--
-- Description:
-- 1. Expands payment_history with net_amount, fee_amount, duration_seconds,
--    monthly_reference_price, payment_event_id, and pricing_snapshot.
-- 2. Adds persistent pricing_tiers table with Row Level Security.
-- 3. Implements high-precision confirm_moteur_payment supporting:
--    - Fixed 30-day commercial month Flex duration:
--      duration_seconds = (net_amount / monthly_reference_price) * 30 * 86400
--    - Active subscription top-up (stacks onto current_period_end)
--    - Expired renewal (starts new from NOW())
--    - Unified common expiration across subscriptions and all bundle company_modules
--    - Transaction-level advisory lock and payment_event_id idempotency
--    - Legacy monthly/yearly backward compatibility
-- ============================================================================

-- 1. EXPAND PAYMENT_HISTORY & SUBSCRIPTIONS COLUMNS
-- ============================================================================
ALTER TABLE public.subscriptions 
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.company_modules
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.payment_history 
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS module_ids JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'net_amount'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN net_amount NUMERIC(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'fee_amount'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN fee_amount NUMERIC(12, 2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'duration_seconds'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN duration_seconds BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'monthly_reference_price'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN monthly_reference_price NUMERIC(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'payment_event_id'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN payment_event_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'pricing_snapshot'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN pricing_snapshot JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'refunded_amount'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN refunded_amount NUMERIC(12, 2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'refund_history'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN refund_history JSONB DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_history' AND column_name = 'last_refund_at'
  ) THEN
    ALTER TABLE public.payment_history ADD COLUMN last_refund_at TIMESTAMPTZ;
  END IF;
END $$;

-- Event ID Index for duplicate delivery prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_history_event_id
  ON public.payment_history (payment_event_id)
  WHERE payment_event_id IS NOT NULL;

-- 2. PRICING TIERS TABLE (Configurable Admin Pricing)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pricing_tiers (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  min_modules INT NOT NULL DEFAULT 1,
  max_modules INT NOT NULL,
  price_usd NUMERIC(12, 2) NOT NULL,
  price_eur NUMERIC(12, 2) NOT NULL,
  price_xof NUMERIC(12, 2) NOT NULL,
  price_xaf NUMERIC(12, 2) NOT NULL,
  price_cdf NUMERIC(12, 2) NOT NULL,
  badge_en TEXT,
  badge_fr TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed confirmed client approved five-currency pricing matrix (Phase 2 Approved Matrix)
INSERT INTO public.pricing_tiers (
  id, name_en, name_fr, min_modules, max_modules,
  price_usd, price_eur, price_xof, price_xaf, price_cdf,
  badge_en, badge_fr
)
VALUES
  ('tier_1', 'Solo (1 App)', 'Formule Solo (1 Métier)', 1, 1, 12.00, 10.00, 7000.00, 7000.00, 30000.00, 'Starter', 'Démarrage'),
  ('tier_2', 'Multi-App (2–4 Apps)', 'Pack Multi-Métiers (2–4 Métiers)', 2, 4, 18.00, 16.00, 10500.00, 10500.00, 45000.00, 'Popular', 'Populaire'),
  ('tier_3', 'Pro Bundle (5–6 Apps)', 'Pack Pro (5–6 Métiers)', 5, 6, 24.00, 21.00, 14000.00, 14000.00, 60000.00, 'Best Value', 'Meilleure valeur'),
  ('additional_app', 'Additional App (>6)', 'Par métier supp. (>6)', 7, 9999, 3.00, 2.50, 1750.00, 1750.00, 7500.00, 'Per App', 'Par Métier')
ON CONFLICT (id) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    min_modules = EXCLUDED.min_modules,
    max_modules = EXCLUDED.max_modules,
    price_usd = EXCLUDED.price_usd,
    price_eur = EXCLUDED.price_eur,
    price_xof = EXCLUDED.price_xof,
    price_xaf = EXCLUDED.price_xaf,
    price_cdf = EXCLUDED.price_cdf,
    updated_at = NOW();

-- Enable RLS
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pricing_tiers' AND policyname = 'pricing_tiers_read'
  ) THEN
    CREATE POLICY pricing_tiers_read ON public.pricing_tiers FOR SELECT USING (true);
  END IF;
END $$;

-- 3. REVISED CONFIRM_MOTEUR_PAYMENT RPC
-- ============================================================================
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
  v_rec RECORD;
  v_existing_end TIMESTAMPTZ;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_interval INTERVAL;
  v_duration_seconds BIGINT;
  v_net_amount NUMERIC;
  v_fee_amount NUMERIC;
  v_ref_price NUMERIC;
  v_sub_id UUID;
  v_cycle TEXT;
  v_event_id TEXT;
  v_resolved_ids JSONB;
BEGIN
  -- 1. Advisory Lock to serialize concurrent operations for this reference
  PERFORM pg_advisory_xact_lock(hashtext('moteur_billing:' || p_reference));

  -- 2. Validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'COMPANY_NOT_FOUND', 'message', 'Target company not found');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_AMOUNT', 'message', 'Payment amount must be greater than zero');
  END IF;

  IF p_currency IS NULL OR length(trim(p_currency)) != 3 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_CURRENCY', 'message', 'Currency must be a 3-character ISO code');
  END IF;

  v_cycle := LOWER(TRIM(COALESCE(p_billing_cycle, 'flex')));
  IF v_cycle NOT IN ('flex', 'monthly', 'yearly') THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_BILLING_CYCLE', 'message', 'Billing cycle must be flex, monthly, or yearly');
  END IF;

  v_event_id := p_metadata->>'payment_event_id';
  IF v_event_id IS NOT NULL AND trim(v_event_id) != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.payment_history
      WHERE payment_event_id = v_event_id AND status = 'paid'
    ) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'code', 'ALREADY_PROCESSED', 'message', 'Event already processed', 'reference', p_reference);
    END IF;
  END IF;

  -- 3. Lookup & Lock Pending Payment Record
  SELECT id, status, company_id, amount, currency, plan_id, billing_cycle, module_ids, net_amount, fee_amount, monthly_reference_price
  INTO v_rec
  FROM public.payment_history
  WHERE reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_rec.id IS NOT NULL THEN
    IF v_rec.status = 'paid' THEN
      RETURN jsonb_build_object('status', 'duplicate', 'code', 'ALREADY_CONFIRMED', 'message', 'Payment already confirmed', 'reference', p_reference);
    END IF;

    IF v_rec.status IN ('failed', 'refunded') THEN
      RETURN jsonb_build_object('status', 'invalid', 'code', 'PAYMENT_ALREADY_TERMINATED', 'message', 'Payment reference was terminated', 'reference', p_reference);
    END IF;

    IF v_rec.company_id IS NOT NULL AND v_rec.company_id != p_company_id THEN
      RETURN jsonb_build_object('status', 'invalid', 'code', 'COMPANY_MISMATCH', 'message', 'Payment belongs to another company');
    END IF;

    IF v_rec.currency IS NOT NULL AND UPPER(v_rec.currency) != UPPER(p_currency) THEN
      RETURN jsonb_build_object('status', 'invalid', 'code', 'CURRENCY_MISMATCH', 'message', 'Currency mismatch');
    END IF;
  END IF;

  -- 4. Calculate Duration
  v_net_amount := COALESCE((p_metadata->>'net_amount')::NUMERIC, v_rec.net_amount, p_amount);
  v_fee_amount := COALESCE((p_metadata->>'fee_amount')::NUMERIC, v_rec.fee_amount, 0);
  v_ref_price  := COALESCE((p_metadata->>'monthly_reference_price')::NUMERIC, v_rec.monthly_reference_price);

  IF v_cycle = 'flex' THEN
    IF v_ref_price IS NULL OR v_ref_price <= 0 THEN
      RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_REFERENCE_PRICE', 'message', 'KaziBox Flex requires a positive trusted monthly_reference_price');
    END IF;
    -- Fixed 30-day commercial month: 30 * 86,400 = 2,592,000 seconds
    v_duration_seconds := ROUND((v_net_amount / v_ref_price) * 2592000);
    v_interval := (v_duration_seconds || ' seconds')::INTERVAL;
  ELSIF v_cycle = 'yearly' THEN
    v_duration_seconds := 365 * 86400;
    v_interval := INTERVAL '1 year';
  ELSE
    v_duration_seconds := 30 * 86400;
    v_interval := INTERVAL '1 month';
  END IF;

  -- 5. Stacking: Active Top-up vs. Expired Renewal
  SELECT current_period_end INTO v_existing_end
  FROM public.subscriptions
  WHERE company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_end IS NOT NULL AND v_existing_end > NOW() THEN
    v_period_start := NOW();
    v_period_end := v_existing_end + v_interval;
  ELSE
    v_period_start := NOW();
    v_period_end := NOW() + v_interval;
  END IF;

  -- 6. Canonical Module Aliases Resolution
  v_resolved_ids := COALESCE(p_module_ids, '[]'::jsonb);

  -- 7. Upsert Active Subscription
  SELECT id INTO v_sub_id
  FROM public.subscriptions
  WHERE company_id = p_company_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET status = 'active',
        plan_id = COALESCE(p_plan_id, 'single'),
        billing_cycle = v_cycle,
        included_module_ids = v_resolved_ids,
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        cancel_at_period_end = FALSE,
        updated_at = NOW()
    WHERE id = v_sub_id;
  ELSE
    INSERT INTO public.subscriptions (
      company_id, plan_id, status, billing_cycle, included_module_ids,
      current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
    ) VALUES (
      p_company_id, COALESCE(p_plan_id, 'single'), 'active', v_cycle, v_resolved_ids,
      v_period_start, v_period_end, FALSE, NOW(), NOW()
    ) RETURNING id INTO v_sub_id;
  END IF;

  -- 8. Apply Common Expiration Timestamp to Every Bundle Module in company_modules
  IF jsonb_array_length(v_resolved_ids) > 0 THEN
    INSERT INTO public.company_modules (company_id, module_id, status, expires_at, created_at, updated_at)
    SELECT
      p_company_id,
      m.value,
      'active',
      v_period_end,
      NOW(),
      NOW()
    FROM jsonb_array_elements_text(v_resolved_ids) AS m(value)
    ON CONFLICT (company_id, module_id) DO UPDATE
    SET status = 'active',
        expires_at = v_period_end,
        updated_at = NOW();
  END IF;

  -- 9. Update Payment History
  IF v_rec.id IS NOT NULL THEN
    UPDATE public.payment_history
    SET status = 'paid',
        net_amount = v_net_amount,
        fee_amount = v_fee_amount,
        duration_seconds = v_duration_seconds,
        monthly_reference_price = v_ref_price,
        payment_event_id = v_event_id,
        pricing_snapshot = p_metadata->'pricing_snapshot'
    WHERE id = v_rec.id;
  ELSE
    INSERT INTO public.payment_history (
      company_id, amount, currency, status, plan_id, billing_cycle,
      module_ids, description, reference, net_amount, fee_amount,
      duration_seconds, monthly_reference_price, payment_event_id, pricing_snapshot
    ) VALUES (
      p_company_id, p_amount, p_currency, 'paid', p_plan_id, v_cycle,
      v_resolved_ids, 'Moteur Payment: ' || p_reference, p_reference,
      v_net_amount, v_fee_amount, v_duration_seconds, v_ref_price,
      v_event_id, p_metadata->'pricing_snapshot'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'code', 'PAYMENT_CONFIRMED',
    'reference', p_reference,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'duration_seconds', v_duration_seconds,
    'is_extension', (v_existing_end IS NOT NULL AND v_existing_end > NOW()),
    'subscription_id', v_sub_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'error',
    'code', SQLSTATE,
    'message', SQLERRM,
    'reference', p_reference
  );
END;
$$;

-- Revoke and grant service_role permissions conditionally
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
  END IF;
END $$;

-- 4. REVISED REFUND_MOTEUR_PAYMENT RPC (Supporting Partial Refunds & Duration Reduction)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refund_moteur_payment(
  p_company_id UUID,
  p_reference TEXT,
  p_reason TEXT DEFAULT 'customer_requested',
  p_refund_amount NUMERIC DEFAULT NULL,
  p_refund_event_id TEXT DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment RECORD;
  v_sub RECORD;
  v_ref_history JSONB;
  v_total_refunded NUMERIC;
  v_is_partial BOOLEAN := FALSE;
  v_remaining_seconds NUMERIC;
  v_prepaid_value_before NUMERIC;
  v_prepaid_value_after NUMERIC;
  v_new_remaining_seconds NUMERIC;
  v_new_period_end TIMESTAMPTZ;
  v_is_fully_exhausted BOOLEAN := FALSE;
  v_refund_item JSONB;
BEGIN
  -- 1. Advisory lock to serialize concurrent operations for this reference
  PERFORM pg_advisory_xact_lock(hashtext('moteur_refund:' || p_reference));

  -- 2. Validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  -- 3. Lookup Payment Record
  SELECT id, status, company_id, amount, net_amount, currency, monthly_reference_price, refunded_amount, refund_history
  INTO v_payment
  FROM public.payment_history
  WHERE reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'PAYMENT_NOT_FOUND', 'message', 'Payment record not found', 'reference', p_reference);
  END IF;

  IF v_payment.company_id != p_company_id THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'COMPANY_MISMATCH', 'message', 'Payment belongs to another company', 'reference', p_reference);
  END IF;

  v_ref_history := COALESCE(v_payment.refund_history, '[]'::jsonb);

  -- Idempotency check: if refund_event_id already processed
  IF p_refund_event_id IS NOT NULL AND trim(p_refund_event_id) != '' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_ref_history) AS elem
      WHERE elem->>'refund_event_id' = p_refund_event_id
    ) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'code', 'REFUND_EVENT_ALREADY_PROCESSED', 'message', 'Refund event already processed', 'reference', p_reference);
    END IF;
  END IF;

  -- If already completely refunded
  IF v_payment.status = 'refunded' AND (p_refund_amount IS NULL OR p_refund_amount <= 0) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'code', 'ALREADY_REFUNDED', 'message', 'Payment was already fully refunded', 'reference', p_reference);
  END IF;

  -- Lookup active subscription for this company
  SELECT id, current_period_start, current_period_end, status, included_module_ids
  INTO v_sub
  FROM public.subscriptions
  WHERE company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- 4. Calculate Reduction (Partial vs Full)
  IF p_refund_amount IS NOT NULL AND p_refund_amount > 0 AND p_refund_amount < COALESCE(v_payment.net_amount, v_payment.amount) THEN
    v_is_partial := TRUE;
  END IF;

  IF v_is_partial AND v_sub.id IS NOT NULL AND v_sub.current_period_end > NOW() AND COALESCE(v_payment.monthly_reference_price, 0) > 0 THEN
    -- Calculate future remaining seconds
    v_remaining_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_sub.current_period_end - NOW())));
    -- Remaining prepaid value at commercial month rate (2,592,000s)
    v_prepaid_value_before := ROUND(((v_remaining_seconds / 2592000.0) * v_payment.monthly_reference_price)::NUMERIC, 2);
    v_prepaid_value_after := GREATEST(0, v_prepaid_value_before - p_refund_amount);

    IF v_prepaid_value_after <= 0 THEN
      v_is_fully_exhausted := TRUE;
      v_new_period_end := NOW();
    ELSE
      v_new_remaining_seconds := ROUND((v_prepaid_value_after / v_payment.monthly_reference_price) * 2592000.0);
      v_new_period_end := NOW() + (v_new_remaining_seconds || ' seconds')::INTERVAL;
    END IF;
  ELSE
    -- Full refund or entitlement already ended
    v_is_fully_exhausted := TRUE;
    v_new_period_end := NOW();
  END IF;

  -- 5. Update Subscription & Module Entitlements
  IF v_sub.id IS NOT NULL THEN
    IF v_is_fully_exhausted THEN
      UPDATE public.subscriptions
      SET status = 'cancelled',
          current_period_end = v_new_period_end,
          updated_at = NOW()
      WHERE id = v_sub.id;

      IF v_sub.included_module_ids IS NOT NULL THEN
        UPDATE public.company_modules
        SET status = 'cancelled',
            expires_at = v_new_period_end,
            updated_at = NOW()
        WHERE company_id = p_company_id
          AND module_id IN (SELECT jsonb_array_elements_text(v_sub.included_module_ids));
      END IF;
    ELSE
      UPDATE public.subscriptions
      SET current_period_end = v_new_period_end,
          updated_at = NOW()
      WHERE id = v_sub.id;

      IF v_sub.included_module_ids IS NOT NULL THEN
        UPDATE public.company_modules
        SET expires_at = v_new_period_end,
            updated_at = NOW()
        WHERE company_id = p_company_id
          AND module_id IN (SELECT jsonb_array_elements_text(v_sub.included_module_ids));
      END IF;
    END IF;
  END IF;

  -- 6. Record in Payment History
  v_total_refunded := COALESCE(v_payment.refunded_amount, 0) + COALESCE(p_refund_amount, v_payment.amount);
  v_refund_item := jsonb_build_object(
    'refund_event_id', COALESCE(p_refund_event_id, 'ref_evt_' || EXTRACT(EPOCH FROM NOW())::TEXT),
    'amount', COALESCE(p_refund_amount, v_payment.amount),
    'timestamp', NOW(),
    'provider_reference', p_provider_reference,
    'reason', COALESCE(p_reason, 'customer_requested'),
    'new_period_end', v_new_period_end,
    'is_partial', v_is_partial,
    'is_fully_exhausted', v_is_fully_exhausted
  );

  UPDATE public.payment_history
  SET status = CASE WHEN v_is_fully_exhausted OR v_total_refunded >= COALESCE(net_amount, amount) THEN 'refunded' ELSE 'partially_refunded' END,
      refunded_amount = v_total_refunded,
      refund_history = v_ref_history || jsonb_build_array(v_refund_item),
      last_refund_at = NOW()
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'code', 'REFUND_PROCESSED',
    'reference', p_reference,
    'is_partial', v_is_partial,
    'is_fully_exhausted', v_is_fully_exhausted,
    'refunded_amount', v_total_refunded,
    'new_period_end', v_new_period_end
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'error',
    'code', SQLSTATE,
    'message', SQLERRM,
    'reference', p_reference
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
  END IF;
END $$;
