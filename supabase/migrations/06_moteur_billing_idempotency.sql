-- KaziBox Supabase Migration (06_moteur_billing_idempotency.sql)
-- Enforces database-level idempotency, indexing, and atomic RPC functions for Moteur payment processing

-- ============================================================================
-- 1. SCHEMA EXTENSION & IDEMPOTENCY INDEXES
-- ============================================================================

-- Add optional reference and refund audit columns on payment_history
ALTER TABLE public.payment_history 
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- Update status check constraint to support 'refunded' distinctly from 'failed'
ALTER TABLE public.payment_history 
  DROP CONSTRAINT IF EXISTS payment_history_status_check;

ALTER TABLE public.payment_history 
  ADD CONSTRAINT payment_history_status_check 
  CHECK (status IN ('paid', 'pending', 'failed', 'refunded'));

-- Unique partial index: Enforces idempotency per company + reference across all server instances
-- Using WHERE reference IS NOT NULL ensures legacy rows with NULL reference are not blocked
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_history_company_reference 
  ON public.payment_history (company_id, reference) 
  WHERE reference IS NOT NULL;

-- Fast index for subscription lookups by company and status
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_status 
  ON public.subscriptions (company_id, status);

-- Index for payment lookup by company and reference
CREATE INDEX IF NOT EXISTS idx_payment_history_reference 
  ON public.payment_history (company_id, reference);


-- ============================================================================
-- 2. ATOMIC PAYMENT CONFIRMATION RPC FUNCTION
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
  v_sub_id UUID;
  v_payment_id UUID;
  v_existing_payment RECORD;
  v_existing_end TIMESTAMPTZ;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_interval_days INT;
  v_mod TEXT;
BEGIN
  -- 1. Transaction-level advisory lock serializes concurrent executions for this company & reference
  PERFORM pg_advisory_xact_lock(hashtext('moteur_billing:' || p_company_id::text || ':' || p_reference));

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

  -- Validate that all requested module IDs exist in the catalogue to prevent incomplete paid entitlements
  IF p_module_ids IS NOT NULL AND jsonb_array_length(p_module_ids) > 0 THEN
    IF EXISTS (
      SELECT 1 
      FROM jsonb_array_elements_text(p_module_ids) AS req_mod(id)
      WHERE NOT EXISTS (SELECT 1 FROM public.modules WHERE public.modules.id = req_mod.id)
    ) THEN
      RETURN jsonb_build_object(
        'status', 'invalid',
        'code', 'INVALID_MODULES',
        'message', 'One or more requested module IDs do not exist in the catalogue'
      );
    END IF;
  END IF;

  -- 3. Database-level Idempotency Check
  SELECT id, status INTO v_existing_payment
  FROM public.payment_history
  WHERE company_id = p_company_id 
    AND (reference = p_reference OR description = 'Moteur Payment: ' || p_reference)
  LIMIT 1;

  IF v_existing_payment.id IS NOT NULL AND v_existing_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'code', 'ALREADY_PROCESSED',
      'message', 'Payment has already been processed and confirmed',
      'reference', p_reference,
      'payment_id', v_existing_payment.id
    );
  END IF;

  -- 4. Calculate Billing Period Duration
  v_interval_days := CASE LOWER(COALESCE(p_billing_cycle, 'monthly'))
    WHEN 'annual' THEN 365
    WHEN 'yearly' THEN 365
    WHEN 'semi_annual' THEN 180
    WHEN 'quarterly' THEN 90
    ELSE 30
  END;

  -- 5. Renewal Extension: Check if workspace currently has an active term ending in the future
  SELECT id, current_period_end INTO v_sub_id, v_existing_end
  FROM public.subscriptions
  WHERE company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_end IS NOT NULL AND v_existing_end > NOW() THEN
    v_period_start := NOW();
    v_period_end := v_existing_end + (v_interval_days || ' days')::INTERVAL;
  ELSE
    v_period_start := NOW();
    v_period_end := NOW() + (v_interval_days || ' days')::INTERVAL;
  END IF;

  -- 6. Atomically Upsert/Update Subscription
  IF v_sub_id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET plan_id = p_plan_id,
        status = 'active',
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        cancel_at_period_end = FALSE,
        included_module_ids = COALESCE(p_module_ids, '[]'::jsonb)
    WHERE id = v_sub_id;
  ELSE
    INSERT INTO public.subscriptions (
      company_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, included_module_ids
    ) VALUES (
      p_company_id, p_plan_id, 'active', v_period_start, v_period_end, FALSE, COALESCE(p_module_ids, '[]'::jsonb)
    ) RETURNING id INTO v_sub_id;
  END IF;

  -- 7. Atomically Update Module Entitlements (only for registered catalogue modules)
  IF p_module_ids IS NOT NULL AND jsonb_array_length(p_module_ids) > 0 THEN
    FOR v_mod IN SELECT jsonb_array_elements_text(p_module_ids) LOOP
      IF EXISTS (SELECT 1 FROM public.modules WHERE id = v_mod) THEN
        INSERT INTO public.company_modules (
          company_id, module_id, plan_id, status, activated_at, expires_at, auto_renew
        ) VALUES (
          p_company_id, v_mod, p_plan_id, 'active', NOW(), v_period_end, TRUE
        )
        ON CONFLICT (company_id, module_id)
        DO UPDATE SET
          plan_id = p_plan_id,
          status = 'active',
          expires_at = v_period_end,
          auto_renew = TRUE;
      END IF;
    END LOOP;
  END IF;

  -- 8. Record Payment History (Atomically committed in this transaction)
  INSERT INTO public.payment_history (
    company_id,
    amount,
    currency,
    status,
    description,
    invoice_url,
    reference
  ) VALUES (
    p_company_id,
    p_amount,
    p_currency,
    'paid',
    'Moteur Payment: ' || p_reference,
    '#',
    p_reference
  ) RETURNING id INTO v_payment_id;

  -- 9. Return Structured Result
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


-- ============================================================================
-- 3. ATOMIC REFUND PROCESSING RPC FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refund_moteur_payment(
  p_company_id UUID,
  p_reference TEXT,
  p_reason TEXT DEFAULT 'customer_requested'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment RECORD;
  v_has_newer_payment BOOLEAN;
  v_sub_id UUID;
  v_module_ids JSONB;
BEGIN
  -- 1. Advisory lock to serialize concurrent operations for this company & reference
  PERFORM pg_advisory_xact_lock(hashtext('moteur_billing:' || p_company_id::text || ':' || p_reference));

  -- 2. Parameter validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  -- 3. Lookup Payment Record
  SELECT id, status, created_at, description, amount, currency
  INTO v_payment
  FROM public.payment_history
  WHERE company_id = p_company_id
    AND (reference = p_reference OR description = 'Moteur Payment: ' || p_reference)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_payment.id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'code', 'PAYMENT_NOT_FOUND',
      'message', 'Payment record not found for this reference and company',
      'reference', p_reference
    );
  END IF;

  IF v_payment.status IN ('failed', 'refunded') THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'code', 'ALREADY_REFUNDED',
      'message', 'Payment was already refunded or marked failed',
      'reference', p_reference,
      'payment_id', v_payment.id
    );
  END IF;

  -- 4. Mark Payment Record as refunded with timestamp and reason
  UPDATE public.payment_history
  SET status = 'refunded',
      refunded_at = NOW(),
      refund_reason = COALESCE(p_reason, 'customer_requested')
  WHERE id = v_payment.id;

  -- 5. Check if workspace has a subsequent valid paid payment
  SELECT EXISTS (
    SELECT 1 FROM public.payment_history
    WHERE company_id = p_company_id
      AND status = 'paid'
      AND (created_at > v_payment.created_at OR (created_at = v_payment.created_at AND id != v_payment.id))
  ) INTO v_has_newer_payment;

  -- 6. If a newer payment exists, preserve the active subscription and entitlements
  IF v_has_newer_payment THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'code', 'REFUNDED_NEWER_PAYMENT_ACTIVE',
      'message', 'Payment marked refunded; active subscription preserved due to subsequent valid payment',
      'reference', p_reference,
      'subscription_cancelled', FALSE
    );
  END IF;

  -- 7. Otherwise, revoke the active subscription and specifically associated module entitlements
  SELECT id, included_module_ids INTO v_sub_id, v_module_ids
  FROM public.subscriptions
  WHERE company_id = p_company_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET status = 'cancelled',
        cancel_at_period_end = TRUE
    WHERE id = v_sub_id;

    -- Deactivate ONLY modules funded by this subscription/payment
    IF v_module_ids IS NOT NULL AND jsonb_array_length(v_module_ids) > 0 THEN
      UPDATE public.company_modules
      SET status = 'cancelled'
      WHERE company_id = p_company_id
        AND module_id IN (SELECT jsonb_array_elements_text(v_module_ids));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'code', 'REFUND_PROCESSED',
    'message', 'Payment refunded and associated subscription entitlements revoked',
    'reference', p_reference,
    'subscription_cancelled', (v_sub_id IS NOT NULL)
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


-- ============================================================================
-- 4. SECURITY & PRIVILEGE ASSIGNMENTS
-- ============================================================================

-- Functions are SECURITY DEFINER with search_path restricted to public, pg_temp
-- Revoke execution from public
REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) FROM PUBLIC;

-- Revoke from anon/authenticated and grant exclusively to service_role when present
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM anon;
    REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM authenticated;
    REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) TO service_role;
  END IF;
END $$;
