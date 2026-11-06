-- ============================================================================
-- MANUAL SETUP HELPER: Ledger Tables & Schema Cache Sync
-- Matches canonical definition in: supabase/migrations/12_kazibox_flex_entitlements_and_refunds.sql (Sections 1-6)
-- Use only for manual dashboard provisioning if Migration 12 has not yet been applied.
-- ============================================================================

-- 1. Ensure required columns exist on subscriptions
ALTER TABLE public.subscriptions 
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Ensure billing_cycle check constraint includes 'flex'
ALTER TABLE public.subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;

ALTER TABLE public.subscriptions 
  ADD CONSTRAINT subscriptions_billing_cycle_check 
  CHECK (billing_cycle IN ('monthly', 'yearly', 'flex'));

-- 3. Ensure company_modules columns exist
ALTER TABLE public.company_modules
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Ensure payment_history has all flex & refund columns
ALTER TABLE public.payment_history 
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS module_ids JSONB,
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_seconds BIGINT,
  ADD COLUMN IF NOT EXISTS monthly_reference_price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS payment_event_id TEXT,
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_refund_at TIMESTAMPTZ;

-- 5. Support 'partially_refunded' in payment_history status
ALTER TABLE public.payment_history 
  DROP CONSTRAINT IF EXISTS payment_history_status_check;

ALTER TABLE public.payment_history 
  ADD CONSTRAINT payment_history_status_check 
  CHECK (status IN ('paid', 'pending', 'failed', 'refunded', 'partially_refunded'));

-- 6. CREATE THE 4 FLEX LEDGER TABLES
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

-- 7. Grant PostgREST & Supabase API permissions (Strict: postgres, service_role, authenticated)
GRANT ALL ON TABLE public.subscription_entitlements TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.entitlement_schedule_adjustments TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.payment_refund_events TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.unmapped_payment_events TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.subscriptions TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.company_modules TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.payment_history TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.pricing_tiers TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.companies TO postgres, service_role, authenticated;

-- 8. Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
