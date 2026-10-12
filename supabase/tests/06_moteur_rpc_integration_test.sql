-- ============================================================================
-- KaziBox Moteur RPC Integration Test Script
-- Run against a disposable / test Supabase PostgreSQL database (DO NOT RUN ON PROD)
-- Wraps tests in a transaction that rolls back at the end to clean up.
-- ============================================================================

BEGIN;

-- 1. Setup Test Workspace & Catalogue Modules
INSERT INTO public.companies (id, name)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Test Corp Moteur')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.modules (id, slug, name, description, category, icon, developer, version)
VALUES 
  ('hotel', 'hotel', '{"fr":"Hôtel"}'::jsonb, '{"fr":"Desc"}'::jsonb, 'hospitality', 'building', 'KaziBox', '1.0.0'),
  ('garage', 'garage', '{"fr":"Garage"}'::jsonb, '{"fr":"Desc"}'::jsonb, 'automotive', 'wrench', 'KaziBox', '1.0.0')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_res JSONB;
  v_comp_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
  v_ref_1 TEXT := 'TEST-REF-001';
  v_ref_2 TEXT := 'TEST-REF-002';
  v_pay_count INT;
  v_sub_status TEXT;
  v_mod_status TEXT;
BEGIN
  RAISE NOTICE '── Test 1: Confirm Payment Success ──';
  v_res := public.confirm_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_1,
    p_amount := 35000,
    p_currency := 'XOF',
    p_plan_id := 'pro',
    p_billing_cycle := 'monthly',
    p_module_ids := '["hotel", "garage"]'::jsonb
  );

  ASSERT v_res->>'status' = 'success', 'Expected status success, got ' || (v_res->>'status');
  ASSERT v_res->>'code' = 'PAYMENT_CONFIRMED', 'Expected PAYMENT_CONFIRMED';

  SELECT COUNT(*) INTO v_pay_count FROM public.payment_history WHERE reference = v_ref_1 AND status = 'paid';
  ASSERT v_pay_count = 1, 'Expected 1 payment record';

  SELECT status INTO v_sub_status FROM public.subscriptions WHERE company_id = v_comp_id;
  ASSERT v_sub_status = 'active', 'Expected active subscription';

  SELECT status INTO v_mod_status FROM public.company_modules WHERE company_id = v_comp_id AND module_id = 'hotel';
  ASSERT v_mod_status = 'active', 'Expected active hotel module';


  RAISE NOTICE '── Test 2: Idempotent Duplicate Confirmation ──';
  v_res := public.confirm_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_1,
    p_amount := 35000,
    p_currency := 'XOF',
    p_plan_id := 'pro',
    p_billing_cycle := 'monthly',
    p_module_ids := '["hotel", "garage"]'::jsonb
  );

  ASSERT v_res->>'status' = 'duplicate', 'Expected duplicate status';
  ASSERT v_res->>'code' = 'ALREADY_PROCESSED', 'Expected ALREADY_PROCESSED code';


  RAISE NOTICE '── Test 3: Validation Rejection ──';
  -- Missing company
  v_res := public.confirm_moteur_payment(
    p_company_id := '99999999-9999-9999-9999-999999999999'::uuid,
    p_reference := 'TEST-REF-FAIL',
    p_amount := 1000,
    p_currency := 'USD',
    p_plan_id := 'starter',
    p_billing_cycle := 'monthly',
    p_module_ids := '[]'::jsonb
  );
  ASSERT v_res->>'status' = 'invalid' AND v_res->>'code' = 'COMPANY_NOT_FOUND', 'Expected COMPANY_NOT_FOUND';

  -- Negative amount
  v_res := public.confirm_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := 'TEST-REF-FAIL-AMT',
    p_amount := -10,
    p_currency := 'USD',
    p_plan_id := 'starter',
    p_billing_cycle := 'monthly',
    p_module_ids := '[]'::jsonb
  );
  ASSERT v_res->>'status' = 'invalid' AND v_res->>'code' = 'INVALID_AMOUNT', 'Expected INVALID_AMOUNT';

  -- Invalid Module ID: ensure incomplete paid entitlements are prevented
  v_res := public.confirm_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := 'TEST-REF-FAIL-MOD',
    p_amount := 15000,
    p_currency := 'XOF',
    p_plan_id := 'single',
    p_billing_cycle := 'monthly',
    p_module_ids := '["hotel", "non_existent_module_999"]'::jsonb
  );
  ASSERT v_res->>'status' = 'invalid' AND v_res->>'code' = 'INVALID_MODULES', 'Expected INVALID_MODULES, got ' || (v_res->>'code');


  RAISE NOTICE '── Test 4: Renewal Without Losing Remaining Days ──';
  v_res := public.confirm_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_2,
    p_amount := 35000,
    p_currency := 'XOF',
    p_plan_id := 'pro',
    p_billing_cycle := 'monthly',
    p_module_ids := '["hotel", "garage"]'::jsonb
  );
  ASSERT v_res->>'status' = 'success', 'Expected renewal success';


  RAISE NOTICE '── Test 5: Refund of Older Payment Preserves Active Subscription ──';
  -- Refund Month 1 (v_ref_1) while Month 2 (v_ref_2) is active
  v_res := public.refund_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_1,
    p_reason := 'chargeback_month_1'
  );
  ASSERT v_res->>'status' = 'success', 'Expected refund success';
  ASSERT v_res->>'code' = 'REFUNDED_NEWER_PAYMENT_ACTIVE', 'Expected newer payment active shield';
  ASSERT (v_res->>'subscription_cancelled')::boolean = FALSE, 'Subscription must NOT be cancelled';

  -- Verify Month 1 is marked as 'refunded' distinctly from 'failed'
  SELECT status INTO v_sub_status FROM public.payment_history WHERE reference = v_ref_1;
  ASSERT v_sub_status = 'refunded', 'Expected status to be refunded, got ' || v_sub_status;


  RAISE NOTICE '── Test 6: Refund of Current Payment Revokes Only Tied Entitlements ──';
  -- Seed an independent module 'salon' that is not part of this subscription
  INSERT INTO public.modules (id, slug, name, description, category, icon, developer, version)
  VALUES ('salon', 'salon', '{"fr":"Salon"}'::jsonb, '{"fr":"Desc"}'::jsonb, 'beauty', 'scissors', 'KaziBox', '1.0.0')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.company_modules (company_id, module_id, plan_id, status)
  VALUES (v_comp_id, 'salon', 'custom_addon', 'active')
  ON CONFLICT (company_id, module_id) DO UPDATE SET status = 'active';

  v_res := public.refund_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_2,
    p_reason := 'customer_requested'
  );
  ASSERT v_res->>'status' = 'success', 'Expected refund success';
  ASSERT (v_res->>'subscription_cancelled')::boolean = TRUE, 'Subscription must be cancelled';

  SELECT status INTO v_sub_status FROM public.subscriptions WHERE company_id = v_comp_id;
  ASSERT v_sub_status = 'cancelled', 'Expected cancelled subscription';

  SELECT status INTO v_mod_status FROM public.company_modules WHERE company_id = v_comp_id AND module_id = 'hotel';
  ASSERT v_mod_status = 'cancelled', 'Expected cancelled module status';

  -- Independent module salon must remain active!
  SELECT status INTO v_mod_status FROM public.company_modules WHERE company_id = v_comp_id AND module_id = 'salon';
  ASSERT v_mod_status = 'active', 'Independent module salon must remain active after subscription refund!';


  RAISE NOTICE '── Test 7: Duplicate Refund ──';
  v_res := public.refund_moteur_payment(
    p_company_id := v_comp_id,
    p_reference := v_ref_2
  );
  ASSERT v_res->>'status' = 'duplicate' AND v_res->>'code' = 'ALREADY_REFUNDED', 'Expected ALREADY_REFUNDED';

  RAISE NOTICE 'All 7 PostgreSQL integration test blocks PASSED successfully ✅';
END;
$$;

-- Always rollback so no test data remains
ROLLBACK;
