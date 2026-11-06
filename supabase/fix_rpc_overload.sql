-- ============================================================================
-- STANDALONE HOTFIX SCRIPT: PostgREST RPC Disambiguation (PGRST203)
-- Matches canonical definition in: supabase/migrations/12_kazibox_flex_entitlements_and_refunds.sql (Section 8)
-- Use only for manual database recovery if Migration 12 has not yet been applied.
-- ============================================================================

-- 1. Drop existing overloaded functions from migrations 06 and 11
DROP FUNCTION IF EXISTS public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.refund_moteur_payment(UUID, TEXT, TEXT);

-- 2. Authoritative 6-parameter RPC (p_refund_amount has NO default value)
CREATE OR REPLACE FUNCTION public.refund_moteur_payment(
  p_company_id UUID,
  p_reference TEXT,
  p_reason TEXT,
  p_refund_amount NUMERIC,
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
  v_entitlement RECORD;
  v_existing_event RECORD;
  v_sub RECORD;
  v_currency TEXT;
  v_decimals INT := 0;
  v_gross_refund NUMERIC(12, 2);
  v_remaining_gross NUMERIC(12, 2);
  v_net_deduction NUMERIC(12, 2);
  v_raw_net NUMERIC(16, 6);
  v_is_final_refund BOOLEAN := FALSE;
  v_rounding_reconciled BOOLEAN := FALSE;
  v_remaining_sec NUMERIC;
  v_unused_val NUMERIC(12, 2);
  v_new_unused NUMERIC(12, 2);
  v_new_rem_sec BIGINT := 0;
  v_excess_uncovered NUMERIC(12, 2) := 0;
  v_new_period_end TIMESTAMPTZ;
  v_is_partial BOOLEAN := FALSE;
  v_is_fully_exhausted BOOLEAN := FALSE;
  v_final_sub_end TIMESTAMPTZ;
  v_payload_hash TEXT;
  v_event_id TEXT;
  v_refund_item JSONB;
BEGIN
  -- Unified Advisory Locks
  IF p_company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('company_subscription:' || p_company_id));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('moteur_payment:' || p_reference));

  -- Input Validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  -- Lookup Payment Record
  SELECT id, status, company_id, amount, net_amount, fee_amount, currency,
         monthly_reference_price, refunded_amount, refund_history, duration_seconds
  INTO v_payment
  FROM public.payment_history
  WHERE reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    v_event_id := COALESCE(p_refund_event_id, 'unmatched_' || p_reference || '_' || EXTRACT(EPOCH FROM NOW())::TEXT);
    INSERT INTO public.unmapped_payment_events (
      event_id, event_type, reference, company_id, amount, status, failure_reason, raw_payload
    ) VALUES (
      v_event_id, 'payment.refunded', p_reference, p_company_id, p_refund_amount,
      'pending_recovery', 'PAYMENT_RECORD_NOT_FOUND',
      jsonb_build_object(
        'company_id', p_company_id,
        'reference', p_reference,
        'refunded_amount', p_refund_amount,
        'refund_amount', p_refund_amount,
        'refund_event_id', p_refund_event_id,
        'provider_refund_id', p_provider_reference,
        'provider_reference', p_provider_reference,
        'reason', p_reason
      )
    )
    ON CONFLICT (event_id) DO UPDATE
    SET retry_count = unmapped_payment_events.retry_count + 1,
        last_retry_at = NOW();

    RETURN jsonb_build_object(
      'status', 'unmatched',
      'code', 'PAYMENT_NOT_FOUND',
      'message', 'Payment record not found; recorded to unmapped events for recovery',
      'reference', p_reference,
      'event_id', v_event_id
    );
  END IF;

  IF v_payment.company_id != p_company_id THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'COMPANY_MISMATCH', 'message', 'Payment belongs to another company', 'reference', p_reference);
  END IF;

  -- Check for unverified historical net amount
  IF v_payment.net_amount IS NULL THEN
    v_event_id := COALESCE(p_refund_event_id, 'unverified_net_' || p_reference || '_' || EXTRACT(EPOCH FROM NOW())::TEXT);
    INSERT INTO public.unmapped_payment_events (
      event_id, event_type, reference, company_id, amount, currency, status, failure_reason, raw_payload
    ) VALUES (
      v_event_id, 'payment.refunded', p_reference, p_company_id, p_refund_amount, v_payment.currency,
      'manual_review_required', 'MISSING_VERIFIED_NET_AMOUNT',
      jsonb_build_object(
        'payment_id', v_payment.id,
        'reference', p_reference,
        'refund_amount', p_refund_amount,
        'original_gross', v_payment.amount,
        'reason', p_reason
      )
    )
    ON CONFLICT (event_id) DO NOTHING;

    RETURN jsonb_build_object(
      'status', 'manual_review_required',
      'code', 'UNVERIFIED_NET_AMOUNT',
      'message', 'Payment record lacks verified net amount. Routed to unmapped table for manual finance reconciliation.',
      'reference', p_reference
    );
  END IF;

  -- Event Deduplication & Payload Conflict Detection
  v_event_id := COALESCE(p_refund_event_id, 'manual_ref_' || p_reference || '_' || EXTRACT(EPOCH FROM NOW())::TEXT);
  v_payload_hash := md5(COALESCE(p_refund_amount::TEXT, '0') || ':' || COALESCE(p_reason, '') || ':' || COALESCE(p_provider_reference, ''));

  IF p_refund_event_id IS NOT NULL AND trim(p_refund_event_id) != '' THEN
    SELECT * INTO v_existing_event
    FROM public.payment_refund_events
    WHERE refund_event_id = p_refund_event_id;

    IF v_existing_event.id IS NOT NULL THEN
      IF v_existing_event.gross_refund_amount != COALESCE(p_refund_amount, v_payment.amount) THEN
        INSERT INTO public.unmapped_payment_events (
          event_id, event_type, reference, company_id, amount, currency, status, failure_reason, raw_payload
        ) VALUES (
          'incident_conflict_' || p_refund_event_id || '_' || md5(COALESCE(p_refund_amount::TEXT, '0') || ':' || COALESCE(p_reason, '') || ':' || COALESCE(p_provider_reference, '')),
          'payment.refunded.conflict', p_reference, p_company_id, p_refund_amount, v_payment.currency,
          'manual_review_required', 'CONFLICTING_PAYLOAD_FOR_EXISTING_EVENT_ID',
          jsonb_build_object(
            'conflict_event_id', p_refund_event_id,
            'original_gross_refund', v_existing_event.gross_refund_amount,
            'conflicting_gross_refund', p_refund_amount,
            'reference', p_reference,
            'company_id', p_company_id,
            'provider_refund_id', p_provider_reference,
            'provider_reference', p_provider_reference,
            'reason', p_reason
          )
        )
        ON CONFLICT (event_id) DO UPDATE
        SET retry_count = unmapped_payment_events.retry_count + 1,
            last_retry_at = NOW(),
            updated_at = NOW();

        RETURN jsonb_build_object(
          'status', 'conflict_quarantined',
          'code', 'CONFLICTING_PAYLOAD_QUARANTINED',
          'message', 'Conflicting payload detected and safely quarantined as an integrity incident without financial ledger mutation',
          'refund_event_id', p_refund_event_id
        );
      END IF;

      RETURN jsonb_build_object(
        'status', 'duplicate',
        'code', 'REFUND_EVENT_ALREADY_PROCESSED',
        'message', 'Refund event already processed successfully',
        'reference', p_reference,
        'refund_event_id', p_refund_event_id
      );
    END IF;
  END IF;

  -- Check Available Refund Capacity on Gross
  v_remaining_gross := GREATEST(0, v_payment.amount - COALESCE(v_payment.refunded_amount, 0));
  IF v_remaining_gross <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'code', 'ALREADY_REFUNDED',
      'message', 'Payment was already fully refunded up to original gross amount',
      'reference', p_reference
    );
  END IF;

  v_gross_refund := LEAST(COALESCE(p_refund_amount, v_payment.amount), v_remaining_gross);
  IF v_gross_refund <= 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFUND_AMOUNT', 'message', 'Refund amount must be greater than zero');
  END IF;

  v_currency := UPPER(TRIM(COALESCE(v_payment.currency, 'XOF')));
  IF v_currency IN ('USD', 'EUR') THEN
    v_decimals := 2;
  ELSE
    v_decimals := 0;
  END IF;

  IF (COALESCE(v_payment.refunded_amount, 0) + v_gross_refund) >= v_payment.amount THEN
    v_is_final_refund := TRUE;
  END IF;

  -- Lookup or Initialize Discrete Entitlement Record
  SELECT * INTO v_entitlement
  FROM public.subscription_entitlements
  WHERE payment_reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_is_final_refund THEN
    v_net_deduction := GREATEST(0, v_payment.net_amount - COALESCE(v_entitlement.cumulative_net_deducted, 0));
    v_rounding_reconciled := TRUE;
  ELSE
    v_raw_net := (v_gross_refund * v_payment.net_amount) / v_payment.amount;
    v_net_deduction := ROUND(v_raw_net, v_decimals);
    v_net_deduction := LEAST(v_net_deduction, GREATEST(0, v_payment.net_amount - COALESCE(v_entitlement.cumulative_net_deducted, 0)));
  END IF;

  IF v_gross_refund < v_payment.amount AND NOT v_is_final_refund THEN
    v_is_partial := TRUE;
  END IF;

  IF v_entitlement.id IS NOT NULL AND v_entitlement.monthly_reference_price > 0 THEN
    IF v_entitlement.period_start <= NOW() THEN
      v_remaining_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_entitlement.period_end - NOW())));
    ELSE
      v_remaining_sec := GREATEST(0, v_entitlement.remaining_duration_seconds);
    END IF;

    v_unused_val := ROUND(((v_remaining_sec / 2592000.0) * v_entitlement.monthly_reference_price)::NUMERIC, v_decimals);

    IF v_net_deduction <= v_unused_val THEN
      v_new_unused := v_unused_val - v_net_deduction;
      v_new_rem_sec := GREATEST(0, v_entitlement.remaining_duration_seconds - ROUND((v_net_deduction / v_entitlement.monthly_reference_price) * 2592000.0));
      v_excess_uncovered := 0;
    ELSE
      v_new_rem_sec := 0;
      v_excess_uncovered := ROUND(v_net_deduction - v_unused_val, v_decimals);
      v_is_fully_exhausted := TRUE;
    END IF;
  ELSE
    v_is_fully_exhausted := TRUE;
    v_new_rem_sec := 0;
    v_excess_uncovered := v_net_deduction;
  END IF;

  IF v_entitlement.id IS NOT NULL THEN
    UPDATE public.subscription_entitlements
    SET cumulative_gross_refunded = cumulative_gross_refunded + v_gross_refund,
        cumulative_net_deducted = cumulative_net_deducted + v_net_deduction,
        remaining_duration_seconds = v_new_rem_sec,
        period_end = CASE 
          WHEN v_is_fully_exhausted OR (cumulative_gross_refunded + v_gross_refund) >= gross_amount THEN
            CASE 
              WHEN period_start <= NOW() THEN LEAST(period_end, NOW())
              ELSE period_start
            END
          ELSE period_end
        END,
        status = CASE 
          WHEN v_is_fully_exhausted OR (cumulative_gross_refunded + v_gross_refund) >= gross_amount THEN 'refunded'
          ELSE 'partially_refunded'
        END,
        updated_at = NOW()
    WHERE id = v_entitlement.id;

    INSERT INTO public.entitlement_schedule_adjustments (
      entitlement_id, company_id, payment_reference, refund_event_id,
      adjustment_type, gross_refund_amount, net_deduction_amount,
      duration_seconds_delta, excess_uncovered_amount, previous_period_end,
      new_period_end, reason, metadata
    ) VALUES (
      v_entitlement.id, p_company_id, p_reference, p_refund_event_id,
      CASE WHEN v_excess_uncovered > 0 THEN 'excess_refund_uncovered' ELSE 'refund_duration_reduction' END,
      v_gross_refund, v_net_deduction,
      -GREATEST(0, (COALESCE(v_entitlement.remaining_duration_seconds, 0) - v_new_rem_sec)::BIGINT),
      v_excess_uncovered, v_entitlement.period_end,
      CASE 
        WHEN v_entitlement.period_start <= NOW() THEN LEAST(v_entitlement.period_end, NOW() + (GREATEST(0, v_new_rem_sec - EXTRACT(EPOCH FROM (NOW() - v_entitlement.period_start))::BIGINT) || ' seconds')::INTERVAL)
        ELSE NOW()
      END,
      p_reason,
      jsonb_build_object(
        'rounding_reconciled', v_rounding_reconciled,
        'provider_reference', p_provider_reference
      )
    );
  END IF;

  DECLARE
    v_cursor TIMESTAMPTZ := NOW();
    v_cur_ent RECORD;
    v_target_start TIMESTAMPTZ;
    v_target_end TIMESTAMPTZ;
    v_ent_unconsumed_sec BIGINT;
  BEGIN
    FOR v_cur_ent IN
      SELECT id, period_start, period_end, remaining_duration_seconds, status
      FROM public.subscription_entitlements
      WHERE company_id = p_company_id
        AND status IN ('active', 'partially_refunded')
        AND remaining_duration_seconds > 0
      ORDER BY period_start ASC, created_at ASC
      FOR UPDATE
    LOOP
      IF v_cur_ent.period_start <= NOW() THEN
        v_ent_unconsumed_sec := GREATEST(0, (v_cur_ent.remaining_duration_seconds - EXTRACT(EPOCH FROM (NOW() - v_cur_ent.period_start))::BIGINT));
        IF v_ent_unconsumed_sec <= 0 THEN
          UPDATE public.subscription_entitlements
          SET status = CASE WHEN status = 'partially_refunded' THEN 'partially_refunded' ELSE 'expired' END,
              period_end = LEAST(period_end, NOW()),
              updated_at = NOW()
          WHERE id = v_cur_ent.id;
        ELSE
          v_target_start := v_cur_ent.period_start;
          v_target_end := NOW() + (v_ent_unconsumed_sec || ' seconds')::INTERVAL;
          v_cursor := v_target_end;

          UPDATE public.subscription_entitlements
          SET period_start = v_target_start,
              period_end = v_target_end,
              updated_at = NOW()
          WHERE id = v_cur_ent.id;
        END IF;
      ELSE
        v_target_start := v_cursor;
        v_target_end := v_cursor + (v_cur_ent.remaining_duration_seconds || ' seconds')::INTERVAL;
        v_cursor := v_target_end;

        UPDATE public.subscription_entitlements
        SET period_start = v_target_start,
            period_end = v_target_end,
            updated_at = NOW()
        WHERE id = v_cur_ent.id;
      END IF;
    END LOOP;

    v_final_sub_end := v_cursor;
  END;

  SELECT id, included_module_ids INTO v_sub
  FROM public.subscriptions
  WHERE company_id = p_company_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_sub.id IS NOT NULL THEN
    IF v_final_sub_end <= NOW() THEN
      UPDATE public.subscriptions
      SET status = 'cancelled',
          current_period_end = NOW(),
          updated_at = NOW()
      WHERE id = v_sub.id;

      IF v_sub.included_module_ids IS NOT NULL THEN
        UPDATE public.company_modules
        SET status = 'cancelled',
            expires_at = NOW(),
            updated_at = NOW()
        WHERE company_id = p_company_id
          AND module_id IN (SELECT jsonb_array_elements_text(v_sub.included_module_ids));
      END IF;
    ELSE
      UPDATE public.subscriptions
      SET status = 'active',
          current_period_end = v_final_sub_end,
          updated_at = NOW()
      WHERE id = v_sub.id;

      IF v_sub.included_module_ids IS NOT NULL THEN
        UPDATE public.company_modules
        SET status = 'active',
            expires_at = v_final_sub_end,
            updated_at = NOW()
        WHERE company_id = p_company_id
          AND module_id IN (SELECT jsonb_array_elements_text(v_sub.included_module_ids));
      END IF;
    END IF;
  END IF;

  INSERT INTO public.payment_refund_events (
    refund_event_id, payment_reference, payment_id, company_id,
    gross_refund_amount, net_deduction_amount, currency,
    provider_reference, reason, payload_hash, raw_payload,
    rounding_reconciliation_applied
  ) VALUES (
    v_event_id, p_reference, v_payment.id, p_company_id,
    v_gross_refund, v_net_deduction, v_currency,
    p_provider_reference, p_reason, v_payload_hash,
    jsonb_build_object(
      'refund_event_id', p_refund_event_id,
      'gross_refund', v_gross_refund,
      'net_deduction', v_net_deduction,
      'excess_uncovered', v_excess_uncovered,
      'is_final_refund', v_is_final_refund
    ),
    v_rounding_reconciled
  );

  v_refund_item := jsonb_build_object(
    'refund_event_id', v_event_id,
    'gross_amount', v_gross_refund,
    'net_deduction', v_net_deduction,
    'excess_uncovered', v_excess_uncovered,
    'timestamp', NOW(),
    'provider_reference', p_provider_reference,
    'reason', p_reason,
    'is_partial', v_is_partial,
    'is_final_refund', v_is_final_refund,
    'rounding_reconciled', v_rounding_reconciled
  );

  UPDATE public.payment_history
  SET status = CASE WHEN (COALESCE(refunded_amount, 0) + v_gross_refund) >= amount THEN 'refunded' ELSE 'partially_refunded' END,
      refunded_amount = COALESCE(refunded_amount, 0) + v_gross_refund,
      refund_history = COALESCE(refund_history, '[]'::jsonb) || jsonb_build_array(v_refund_item),
      last_refund_at = NOW()
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'code', CASE WHEN (v_final_sub_end > NOW()) AND NOT v_is_partial THEN 'REFUNDED_NEWER_PAYMENT_ACTIVE' ELSE 'REFUND_PROCESSED' END,
    'message', CASE WHEN (v_final_sub_end > NOW()) AND NOT v_is_partial THEN 'Payment marked refunded; active subscription preserved due to subsequent valid payment' ELSE 'Payment refunded' END,
    'reference', p_reference,
    'refund_event_id', v_event_id,
    'gross_refund_amount', v_gross_refund,
    'net_deduction_amount', v_net_deduction,
    'excess_uncovered_amount', v_excess_uncovered,
    'is_partial', v_is_partial,
    'is_final_refund', v_is_final_refund,
    'rounding_reconciled', v_rounding_reconciled,
    'subscription_cancelled', (v_final_sub_end <= NOW()),
    'new_subscription_period_end', v_final_sub_end
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


-- 3. Backward-compatible legacy 3-parameter wrapper
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
BEGIN
  RETURN public.refund_moteur_payment(
    p_company_id := p_company_id,
    p_reference := p_reference,
    p_reason := COALESCE(p_reason, 'customer_requested'),
    p_refund_amount := NULL,
    p_refund_event_id := NULL,
    p_provider_reference := NULL
  );
END;
$$;

-- 4. Permissions (Strictly restricted to service_role; financial RPCs must not be executable by anon/authenticated)
REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
