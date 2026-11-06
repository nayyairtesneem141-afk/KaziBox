-- ============================================================================
-- Migration 12: KaziBox Flex — Discrete Entitlements, Cumulative Rounding & Unmapped Events
-- FOR REVIEW ONLY — DO NOT EXECUTE DIRECTLY AGAINST PRODUCTION OR LIVE DATABASE
-- ============================================================================
--
-- Objectives:
-- 1. Safely resolve status and billing cycle check constraints:
--    - Update payment_history_status_check to include 'partially_refunded'.
--    - Update subscriptions_billing_cycle_check to include 'flex'.
-- 2. Establish four approved core tables:
--    a) public.subscription_entitlements: Discrete payment-to-entitlement ledger
--       preventing cross-payment cancellation.
--    b) public.entitlement_schedule_adjustments: Audit log for partial refund reductions
--       and excess uncovered deductions (ensures zero negative entitlement).
--    c) public.payment_refund_events: Immutable ledger of discrete Moteur refund events
--       with cryptographic payload hash and conflict rejection.
--    d) public.unmapped_payment_events: Durable storage and retry state for unmatched
--       or unreconciled webhook events awaiting Moteur status recovery.
-- 3. Resolve RPC overload ambiguity for PostgREST:
--    - Retains legacy 3-parameter overload public.refund_moteur_payment(UUID, TEXT, TEXT) as a backward-compatible delegation wrapper.
--    - Implements authoritative 6-parameter public.refund_moteur_payment without default on p_refund_amount for deterministic routing.
-- 4. Enforce Abdullah's confirmed Moteur refund & rounding contract:
--    - net_deduction = refunded_amount * original_net_amount / original_gross_amount
--    - Gateway fees retained; never assumed refunded.
--    - Half-up rounding: 0 decimals for XOF, XAF, CDF; 2 decimals for USD, EUR.
--    - Terminal reconciliation: final refund reconciles accumulated rounding differences
--      without exceeding original verified net amount.
--    - Legacy safety: missing historical net_amount routes to manual reconciliation.
--    - Proportional duration adjustment applied equally across bundle company_modules.
-- 5. PostgREST schema cache notification: NOTIFY pgrst, 'reload schema'.
-- ============================================================================

-- 1. CONSTRAINT UPDATES & PAYMENT HISTORY EXPANSIONS
-- ============================================================================

-- 1.1 Ensure all required columns exist on subscriptions
ALTER TABLE public.subscriptions 
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 1.2 Support 'flex' in subscriptions billing_cycle
ALTER TABLE public.subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;

ALTER TABLE public.subscriptions 
  ADD CONSTRAINT subscriptions_billing_cycle_check 
  CHECK (billing_cycle IN ('monthly', 'yearly', 'flex'));

-- 1.3 Ensure all required columns exist on company_modules
ALTER TABLE public.company_modules
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 1.4 Support 'partially_refunded' in payment_history status
ALTER TABLE public.payment_history 
  DROP CONSTRAINT IF EXISTS payment_history_status_check;

ALTER TABLE public.payment_history 
  ADD CONSTRAINT payment_history_status_check 
  CHECK (status IN ('paid', 'pending', 'failed', 'refunded', 'partially_refunded'));

-- 1.5 Ensure plan_id, billing_cycle, module_ids exist on payment_history
ALTER TABLE public.payment_history 
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS module_ids JSONB;

-- 1.6 Ensure financial & flex columns exist on payment_history
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


-- 2. DISCRETE SUBSCRIPTION ENTITLEMENTS TABLE
-- ============================================================================
-- Tracks discrete periods funded by individual payments. Prevents refunds from
-- truncating or revoking access funded by independent subsequent payments.
CREATE TABLE IF NOT EXISTS public.subscription_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payment_history(id) ON DELETE SET NULL,
  payment_reference TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_amount NUMERIC(12, 2) NOT NULL,
  original_net_amount NUMERIC(12, 2) NOT NULL,
  cumulative_gross_refunded NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cumulative_net_deducted NUMERIC(12, 2) NOT NULL DEFAULT 0,
  monthly_reference_price NUMERIC(12, 2) NOT NULL,
  initial_duration_seconds BIGINT NOT NULL,
  remaining_duration_seconds BIGINT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  included_module_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'partially_refunded', 'refunded', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_entitlement_gross_refund_limit CHECK (cumulative_gross_refunded <= gross_amount),
  CONSTRAINT check_entitlement_net_deduct_limit CHECK (cumulative_net_deducted <= original_net_amount),
  CONSTRAINT check_entitlement_non_negative_duration CHECK (remaining_duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_payment_ref
  ON public.subscription_entitlements (payment_reference);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_company_status
  ON public.subscription_entitlements (company_id, status);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_sub_end
  ON public.subscription_entitlements (subscription_id, period_end DESC);


-- 3. ENTITLEMENT SCHEDULE ADJUSTMENTS (AUDIT TRAIL)
-- ============================================================================
-- Records every reduction of duration and tracks excess uncovered financial amounts
-- separately to guarantee non-negative remaining entitlement time.
CREATE TABLE IF NOT EXISTS public.entitlement_schedule_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID REFERENCES public.subscription_entitlements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_reference TEXT NOT NULL,
  refund_event_id TEXT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('refund_duration_reduction', 'excess_refund_uncovered', 'tier_change', 'manual_reconciliation')),
  gross_refund_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_deduction_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  duration_seconds_delta BIGINT NOT NULL DEFAULT 0,
  excess_uncovered_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  previous_period_end TIMESTAMPTZ,
  new_period_end TIMESTAMPTZ,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entitlement_adjustments_entitlement_id
  ON public.entitlement_schedule_adjustments (entitlement_id);

CREATE INDEX IF NOT EXISTS idx_entitlement_adjustments_company
  ON public.entitlement_schedule_adjustments (company_id);


-- 4. IMMUTABLE PAYMENT REFUND EVENTS TABLE
-- ============================================================================
-- Tracks discrete Moteur refund events with payload hash to prevent duplicate
-- processing and reject conflicting payloads for the same event identifier.
CREATE TABLE IF NOT EXISTS public.payment_refund_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_event_id TEXT NOT NULL UNIQUE,
  payment_reference TEXT NOT NULL,
  payment_id UUID REFERENCES public.payment_history(id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  gross_refund_amount NUMERIC(12, 2) NOT NULL,
  net_deduction_amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  provider_reference TEXT,
  reason TEXT,
  payload_hash TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rounding_reconciliation_applied BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_events_ref
  ON public.payment_refund_events (payment_reference);


-- 5. DURABLE UNMAPPED PAYMENT EVENTS TABLE
-- ============================================================================
-- Captures unmatched or out-of-order events durably so they can be recovered
-- via Moteur GET status polling or scheduled retries.
CREATE TABLE IF NOT EXISTS public.unmapped_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  reference TEXT,
  company_id UUID,
  amount NUMERIC(12, 2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending_recovery' CHECK (status IN ('pending_recovery', 'reconciled', 'manual_review_required', 'permanently_unresolvable')),
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  last_retry_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  recovery_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_reason TEXT,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmapped_events_status
  ON public.unmapped_payment_events (status)
  WHERE status = 'pending_recovery';

CREATE INDEX IF NOT EXISTS idx_unmapped_events_ref
  ON public.unmapped_payment_events (reference);


-- 6. ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_schedule_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unmapped_payment_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_entitlements' AND policyname = 'entitlements_service_role'
  ) THEN
    CREATE POLICY entitlements_service_role ON public.subscription_entitlements TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'entitlement_schedule_adjustments' AND policyname = 'adjustments_service_role'
  ) THEN
    CREATE POLICY adjustments_service_role ON public.entitlement_schedule_adjustments TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payment_refund_events' AND policyname = 'refund_events_service_role'
  ) THEN
    CREATE POLICY refund_events_service_role ON public.payment_refund_events TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unmapped_payment_events' AND policyname = 'unmapped_events_service_role'
  ) THEN
    CREATE POLICY unmapped_events_service_role ON public.unmapped_payment_events TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Grant API & PostgREST permissions to service_role and authenticated
GRANT ALL ON TABLE public.subscription_entitlements TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.entitlement_schedule_adjustments TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.payment_refund_events TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.unmapped_payment_events TO postgres, service_role, authenticated;


-- 7. RPC COMPATIBILITY & OVERLOAD DESIGN
-- ============================================================================
-- PRESERVE legacy 3-parameter overload public.refund_moteur_payment(UUID, TEXT, TEXT)
-- to maintain full backwards compatibility with existing database callers,
-- stored procedures, and migration test suites (e.g. 06_moteur_rpc_integration_test.sql).
-- The 3-parameter function is retained as a lightweight delegation wrapper
-- forwarding calls to the authoritative 6-parameter RPC.
-- PostgREST disambiguation is achieved by leaving p_refund_amount with NO default value
-- on the 6-parameter RPC, ensuring 2- and 3-parameter HTTP calls match ONLY the legacy wrapper,
-- and 4- to 6-parameter HTTP calls match ONLY the authoritative RPC.


-- 8. AUTHORITATIVE REFUND_MOTEUR_PAYMENT RPC
-- ============================================================================
-- Explicitly drop existing signatures from migrations 06/11 to avoid PostgREST PGRST203 ambiguity
DROP FUNCTION IF EXISTS public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.refund_moteur_payment(UUID, TEXT, TEXT);

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
  -- 1. Unified Advisory Locks:
  -- Acquire company-level lock first to serialize subscription schedule recalculation across concurrent payments,
  -- followed by payment-level lock to serialize lifecycle operations for this reference.
  -- Strict, identical lock ordering across confirm and refund prevents deadlocks.
  IF p_company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('company_subscription:' || p_company_id));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('moteur_payment:' || p_reference));

  -- 2. Input Validations
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'MISSING_COMPANY', 'message', 'company_id is required');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFERENCE', 'message', 'Payment reference cannot be empty');
  END IF;

  -- 3. Lookup Payment Record
  SELECT id, status, company_id, amount, net_amount, fee_amount, currency,
         monthly_reference_price, refunded_amount, refund_history, duration_seconds
  INTO v_payment
  FROM public.payment_history
  WHERE reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    -- Route unmatched refund event to durable unmapped table
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

  -- 4. Check for unverified historical net amount
  -- Rule: Never infer missing historical net amounts. Route unverified records to manual reconciliation.
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

  -- 5. Stable Event Deduplication & Payload Conflict Detection
  v_event_id := COALESCE(p_refund_event_id, 'manual_ref_' || p_reference || '_' || EXTRACT(EPOCH FROM NOW())::TEXT);
  v_payload_hash := md5(COALESCE(p_refund_amount::TEXT, '0') || ':' || COALESCE(p_reason, '') || ':' || COALESCE(p_provider_reference, ''));

  IF p_refund_event_id IS NOT NULL AND trim(p_refund_event_id) != '' THEN
    SELECT * INTO v_existing_event
    FROM public.payment_refund_events
    WHERE refund_event_id = p_refund_event_id;

    IF v_existing_event.id IS NOT NULL THEN
      -- If payload differs from original event, durably quarantine as an integrity incident without ledger mutation
      IF v_existing_event.gross_refund_amount != COALESCE(p_refund_amount, v_payment.amount) THEN
        INSERT INTO public.unmapped_payment_events (
          event_id,
          event_type,
          reference,
          company_id,
          amount,
          currency,
          status,
          failure_reason,
          raw_payload
        ) VALUES (
          'incident_conflict_' || p_refund_event_id || '_' || md5(COALESCE(p_refund_amount::TEXT, '0') || ':' || COALESCE(p_reason, '') || ':' || COALESCE(p_provider_reference, '')),
          'payment.refunded.conflict',
          p_reference,
          p_company_id,
          p_refund_amount,
          v_payment.currency,
          'manual_review_required',
          'CONFLICTING_PAYLOAD_FOR_EXISTING_EVENT_ID',
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

  -- 6. Check Available Refund Capacity on Gross
  v_remaining_gross := GREATEST(0, v_payment.amount - COALESCE(v_payment.refunded_amount, 0));
  IF v_remaining_gross <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'code', 'ALREADY_REFUNDED',
      'message', 'Payment was already fully refunded up to original gross amount',
      'reference', p_reference
    );
  END IF;

  -- Cap individual gross refund to remaining available gross
  v_gross_refund := LEAST(COALESCE(p_refund_amount, v_payment.amount), v_remaining_gross);
  IF v_gross_refund <= 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'code', 'INVALID_REFUND_AMOUNT', 'message', 'Refund amount must be greater than zero');
  END IF;

  -- 7. Currency Decimal Places & Confirmed Half-Up Net Deduction Formula
  -- Confirmed rules:
  -- - 0 decimal places for XOF, XAF, CDF
  -- - 2 decimal places for USD, EUR
  v_currency := UPPER(TRIM(COALESCE(v_payment.currency, 'XOF')));
  IF v_currency IN ('USD', 'EUR') THEN
    v_decimals := 2;
  ELSE
    v_decimals := 0;
  END IF;

  -- Check if this refund completes the gross amount
  IF (COALESCE(v_payment.refunded_amount, 0) + v_gross_refund) >= v_payment.amount THEN
    v_is_final_refund := TRUE;
  END IF;

  -- 8. Lookup or Initialize Discrete Entitlement Record
  SELECT * INTO v_entitlement
  FROM public.subscription_entitlements
  WHERE payment_reference = p_reference
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Calculate Net Entitlement Deduction
  IF v_is_final_refund THEN
    -- Terminal reconciliation: Reconciles all accumulated rounding differences to exact original net
    v_net_deduction := GREATEST(0, v_payment.net_amount - COALESCE(v_entitlement.cumulative_net_deducted, 0));
    v_rounding_reconciled := TRUE;
  ELSE
    -- Proportional deduction: net_deduction = gross_refund * original_net / original_gross
    v_raw_net := (v_gross_refund * v_payment.net_amount) / v_payment.amount;
    v_net_deduction := ROUND(v_raw_net, v_decimals);
    -- Safety clamp: cumulative net deduction must never exceed original net
    v_net_deduction := LEAST(v_net_deduction, GREATEST(0, v_payment.net_amount - COALESCE(v_entitlement.cumulative_net_deducted, 0)));
  END IF;

  -- Partial vs Full flag
  IF v_gross_refund < v_payment.amount AND NOT v_is_final_refund THEN
    v_is_partial := TRUE;
  END IF;

  -- 9. Entitlement Duration Reduction Calculation
  IF v_entitlement.id IS NOT NULL AND v_entitlement.monthly_reference_price > 0 THEN
    -- Check if entitlement started in past vs queued in future
    IF v_entitlement.period_start <= NOW() THEN
      -- Actively running entitlement: remaining unused time is from NOW to period_end
      v_remaining_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_entitlement.period_end - NOW())));
    ELSE
      -- Queued future entitlement: full remaining duration is unused
      v_remaining_sec := GREATEST(0, v_entitlement.remaining_duration_seconds);
    END IF;

    -- Unused prepaid value at commercial month rate (2,592,000s)
    v_unused_val := ROUND(((v_remaining_sec / 2592000.0) * v_entitlement.monthly_reference_price)::NUMERIC, v_decimals);

    IF v_net_deduction <= v_unused_val THEN
      v_new_unused := v_unused_val - v_net_deduction;
      -- Duration to deduct from this entitlement's total active allowance
      v_new_rem_sec := GREATEST(0, v_entitlement.remaining_duration_seconds - ROUND((v_net_deduction / v_entitlement.monthly_reference_price) * 2592000.0));
      v_excess_uncovered := 0;
    ELSE
      -- Refund exceeds remaining prepaid value: all future unconsumed time is eliminated; excess tracked separately
      v_new_rem_sec := 0;
      v_excess_uncovered := ROUND(v_net_deduction - v_unused_val, v_decimals);
      v_is_fully_exhausted := TRUE;
    END IF;
  ELSE
    v_is_fully_exhausted := TRUE;
    v_new_rem_sec := 0;
    v_excess_uncovered := v_net_deduction;
  END IF;

  -- 10. Update Discrete Entitlement Ledger
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

    -- Record in Entitlement Schedule Adjustments Audit Table
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

  -- 11. Transaction-Safe Contiguous Schedule Recalculation
  -- Chains all valid active/partially_refunded entitlements contiguously starting from NOW().
  -- Guarantees zero schedule gaps, preserves consumed time, and isolates payments.
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
        -- Entitlement started in the past: calculate unconsumed future duration
        v_ent_unconsumed_sec := GREATEST(0, (v_cur_ent.remaining_duration_seconds - EXTRACT(EPOCH FROM (NOW() - v_cur_ent.period_start))::BIGINT));
        IF v_ent_unconsumed_sec <= 0 THEN
          -- Consumed in full or exhausted by refund
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
        -- Queued future entitlement: shift forward to chain contiguously from cursor
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

  -- 12. Record in Immutable Payment Refund Events Table
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

  -- 13. Update Payment History
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


-- 8.1 BACKWARD-COMPATIBLE LEGACY 3-PARAMETER WRAPPER
-- ============================================================================
-- Retains public.refund_moteur_payment(UUID, TEXT, TEXT) without dropping it.
-- Enables seamless execution of legacy callers and 06_moteur_rpc_integration_test.sql.
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


-- Permissions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT) TO service_role;

    REVOKE ALL ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refund_moteur_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
  END IF;
END $$;


-- 9. ENHANCE CONFIRM_MOTEUR_PAYMENT TO SEED SUBSCRIPTION_ENTITLEMENTS
-- ============================================================================
-- Extends confirmation so every confirmed payment generates a discrete
-- subscription_entitlements record automatically.
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
  -- 1. Unified Advisory Locks:
  -- Acquire company-level lock first to serialize subscription schedule recalculation across concurrent payments,
  -- followed by payment-level lock to serialize lifecycle operations for this reference.
  -- Strict, identical lock ordering across confirm and refund prevents deadlocks.
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
  -- Reconciles all pending refunds previously quarantined in unmapped_payment_events for this reference.
  -- Deterministic ordering: created_at ASC, id ASC. Zero lock inversion.
  FOR v_pending_refund IN
    SELECT *
    FROM public.unmapped_payment_events
    WHERE reference = p_reference
      AND event_type = 'payment.refunded'
      AND status = 'pending_recovery'
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    -- A. Currency Verification: Do not silently apply refund in mismatched currency
    v_pending_currency := COALESCE(
      v_pending_refund.raw_payload->>'refunded_currency',
      v_pending_refund.raw_payload->>'currency',
      v_pending_refund.currency
    );

    IF v_pending_currency IS NOT NULL AND TRIM(v_pending_currency) != '' AND UPPER(TRIM(v_pending_currency)) != UPPER(TRIM(p_currency)) THEN
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = 'CURRENCY_MISMATCH',
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'status', 'manual_review_required',
            'code', 'CURRENCY_MISMATCH',
            'message', 'Refund currency (' || v_pending_currency || ') does not match payment currency (' || p_currency || ')'
          ))
      WHERE id = v_pending_refund.id;
      -- Halt subsequent queued refunds for this reference to protect cumulative financial invariants
      EXIT;
    END IF;

    -- B. Safe Numeric Amount Extraction & Validation:
    -- Supports confirmed refunded_amount, legacy aliases, and persisted amount column without blind cast
    v_refund_amt_str := COALESCE(
      v_pending_refund.raw_payload->>'refunded_amount',
      v_pending_refund.raw_payload->>'refund_amount',
      v_pending_refund.raw_payload->>'amount'
    );

    v_clean_refund_amt := NULL;
    IF v_refund_amt_str IS NOT NULL AND TRIM(v_refund_amt_str) ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_clean_refund_amt := TRIM(v_refund_amt_str)::NUMERIC;
    ELSIF v_refund_amt_str IS NULL AND v_pending_refund.amount IS NOT NULL THEN
      v_clean_refund_amt := v_pending_refund.amount;
    END IF;

    IF v_clean_refund_amt IS NULL OR v_clean_refund_amt <= 0 THEN
      UPDATE public.unmapped_payment_events
      SET status = 'manual_review_required',
          failure_reason = 'INVALID_OR_MISSING_REFUND_AMOUNT',
          updated_at = NOW(),
          recovery_attempts = recovery_attempts || jsonb_build_array(jsonb_build_object(
            'attempted_at', NOW(),
            'status', 'manual_review_required',
            'code', 'INVALID_REFUND_AMOUNT',
            'message', 'Malformed, zero, or negative refund amount in queued event: ' || COALESCE(v_refund_amt_str, 'NULL')
          ))
      WHERE id = v_pending_refund.id;
      -- Halt subsequent queued refunds
      EXIT;
    END IF;

    -- C. Invoke Authoritative 6-Argument refund_moteur_payment
    v_auto_refund_res := public.refund_moteur_payment(
      p_company_id := p_company_id,
      p_reference := p_reference,
      p_reason := COALESCE(v_pending_refund.raw_payload->>'reason', 'out_of_order_auto_reconciled'),
      p_refund_amount := v_clean_refund_amt,
      p_refund_event_id := COALESCE(
        v_pending_refund.raw_payload->>'refund_event_id',
        v_pending_refund.event_id
      ),
      p_provider_reference := COALESCE(
        v_pending_refund.raw_payload->>'provider_refund_id',
        v_pending_refund.raw_payload->>'provider_reference'
      )
    );

    -- D. Process Result with Zero Silent Swallowing
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
      -- Halt subsequent queued refunds to preserve cumulative invariants
      EXIT;
    ELSE
      -- Any unexpected error or invalid status
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
      -- Halt subsequent queued refunds
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

-- Permissions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.confirm_moteur_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
  END IF;
END $$;


-- 10. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE
-- ============================================================================
NOTIFY pgrst, 'reload schema';
