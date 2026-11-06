-- ============================================================================
-- STANDALONE HOTFIX SCRIPT: Update confirm_moteur_payment RPC
-- Matches canonical definition in: supabase/migrations/12_kazibox_flex_entitlements_and_refunds.sql (Section 9)
-- Defaults monthly_reference_price to p_amount if omitted (30-day commercial month)
-- Use only for manual database recovery if Migration 12 has not yet been applied.
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
  v_payment_id UUID;
  v_cycle TEXT;
  v_event_id TEXT;
  v_resolved_ids JSONB;
  v_pending_refund RECORD;
  v_auto_refund_res JSONB;
  v_reconciled_refunds_count INT := 0;
  v_refund_amt_str TEXT;
  v_clean_refund_amt NUMERIC;
  v_pending_currency TEXT;
BEGIN
  -- 1. Unified Advisory Locks
  IF p_company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('company_subscription:' || p_company_id));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('moteur_payment:' || p_reference));

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

    IF v_rec.status IN ('failed', 'refunded', 'partially_refunded') THEN
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
      -- Default monthly reference price to p_amount if not specified in metadata or payment record
      v_ref_price := p_amount;
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
    v_period_start := v_existing_end;
    v_period_end := v_existing_end + v_interval;
  ELSE
    v_period_start := NOW();
    v_period_end := NOW() + v_interval;
  END IF;

  v_resolved_ids := COALESCE(p_module_ids, '[]'::jsonb);

  -- 6. Upsert Active Subscription
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
        current_period_start = LEAST(COALESCE(current_period_start, NOW()), v_period_start),
        current_period_end = GREATEST(COALESCE(current_period_end, NOW()), v_period_end),
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

  -- 7. Apply Common Expiration Timestamp to Every Bundle Module in company_modules
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
        expires_at = GREATEST(company_modules.expires_at, v_period_end),
        updated_at = NOW();
  END IF;

  -- 8. Update Payment History
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
    v_payment_id := v_rec.id;
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
    ) RETURNING id INTO v_payment_id;
  END IF;

  -- 9. Seed Discrete Subscription Entitlement Ledger Row
  INSERT INTO public.subscription_entitlements (
    company_id, subscription_id, payment_id, payment_reference, currency,
    gross_amount, original_net_amount, cumulative_gross_refunded, cumulative_net_deducted,
    monthly_reference_price, initial_duration_seconds, remaining_duration_seconds,
    period_start, period_end, included_module_ids, status
  ) VALUES (
    p_company_id, v_sub_id, v_payment_id, p_reference, UPPER(p_currency),
    p_amount, v_net_amount, 0, 0,
    COALESCE(v_ref_price, v_net_amount), v_duration_seconds, v_duration_seconds,
    v_period_start, v_period_end, v_resolved_ids, 'active'
  )
  ON CONFLICT DO NOTHING;

  -- 10. Atomic Auto-Reconciliation of Pending Out-of-Order Refunds
  FOR v_pending_refund IN
    SELECT *
    FROM public.unmapped_payment_events
    WHERE reference = p_reference
      AND event_type = 'payment.refunded'
      AND status = 'pending_recovery'
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    v_refund_amt_str := COALESCE(v_pending_refund.raw_payload->>'refunded_amount', v_pending_refund.raw_payload->>'refund_amount');
    v_clean_refund_amt := NULL;
    IF v_refund_amt_str IS NOT NULL AND v_refund_amt_str ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_clean_refund_amt := v_refund_amt_str::NUMERIC;
    END IF;

    v_pending_currency := UPPER(TRIM(COALESCE(v_pending_refund.currency, v_pending_refund.raw_payload->>'currency', '')));

    IF v_pending_currency != '' AND v_pending_currency != UPPER(TRIM(p_currency)) THEN
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = 'CURRENCY_MISMATCH_ON_RECONCILIATION',
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'code', 'CURRENCY_MISMATCH',
            'message', 'Refund currency (' || v_pending_currency || ') does not match payment currency (' || p_currency || ')'
          ))
      WHERE id = v_pending_refund.id;
      EXIT;
    END IF;

    IF v_clean_refund_amt IS NULL OR v_clean_refund_amt <= 0 THEN
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = 'INVALID_OR_ZERO_REFUND_AMOUNT',
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'code', 'INVALID_AMOUNT',
            'message', 'Quarantined refund payload lacks valid positive amount: ' || COALESCE(v_refund_amt_str, 'NULL')
          ))
      WHERE id = v_pending_refund.id;
      CONTINUE;
    END IF;

    v_auto_refund_res := public.refund_moteur_payment(
      p_company_id := p_company_id,
      p_reference := p_reference,
      p_reason := COALESCE(v_pending_refund.raw_payload->>'reason', 'auto_reconciled_out_of_order_refund'),
      p_refund_amount := v_clean_refund_amt,
      p_refund_event_id := v_pending_refund.event_id,
      p_provider_reference := COALESCE(v_pending_refund.raw_payload->>'provider_refund_id', v_pending_refund.raw_payload->>'provider_reference')
    );

    IF v_auto_refund_res->>'status' IN ('success', 'duplicate') THEN
      UPDATE public.unmapped_payment_events
      SET status = 'reconciled',
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'reconciled_at', NOW(),
            'status', v_auto_refund_res->>'status',
            'code', v_auto_refund_res->>'code',
            'refund_event_id', v_pending_refund.event_id
          ))
      WHERE id = v_pending_refund.id;
      v_reconciled_refunds_count := v_reconciled_refunds_count + 1;
    ELSIF v_auto_refund_res->>'status' = 'manual_review_required' THEN
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = COALESCE(v_auto_refund_res->>'code', 'MANUAL_REVIEW_REQUIRED'),
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'status', v_auto_refund_res->>'status',
            'code', v_auto_refund_res->>'code',
            'message', v_auto_refund_res->>'message'
          ))
      WHERE id = v_pending_refund.id;
      EXIT;
    ELSE
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = COALESCE(v_auto_refund_res->>'code', 'AUTO_RECONCILIATION_FAILED'),
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'status', COALESCE(v_auto_refund_res->>'status', 'unknown'),
            'code', v_auto_refund_res->>'code',
            'message', v_auto_refund_res->>'message'
          ))
      WHERE id = v_pending_refund.id;
      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'success',
    'code', 'PAYMENT_CONFIRMED',
    'reference', p_reference,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'duration_seconds', v_duration_seconds,
    'is_extension', (v_existing_end IS NOT NULL AND v_existing_end > NOW()),
    'subscription_id', v_sub_id,
    'reconciled_refunds_count', v_reconciled_refunds_count
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

-- Permissions (Strictly restricted to service_role; financial confirmation must not be public)
REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;

-- Schema cache reload
NOTIFY pgrst, 'reload schema';
