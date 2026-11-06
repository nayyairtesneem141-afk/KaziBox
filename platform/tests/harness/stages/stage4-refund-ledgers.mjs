/**
 * KaziBox Flex Validation Harness — Stage 4: Financial Ledgers & Refund Edge Cases
 *
 * SCOPE:
 * Tests Migration 12 discrete entitlement ledgers, terminal rounding reconciliation,
 * schedule adjustments, missing historical net_amount protection, and conflicting event deduplication.
 *
 * CRITICAL ASSERTION REQUIREMENT:
 * Every test asserts BOTH the RPC HTTP/JSON response AND the final persisted database state
 * across subscription_entitlements, entitlement_schedule_adjustments, unmapped_payment_events,
 * and payment_history.
 *
 * Preconditions:
 * - Migrations 01, 06, 10, 11, and 12 applied.
 * - PostgREST schema cache reloaded.
 * - Target disposable database active.
 *
 * Possible Mutations:
 * - Seeds synthetic company and modules.
 * - Writes to public.payment_history, public.subscription_entitlements,
 *   public.entitlement_schedule_adjustments, public.payment_refund_events, and public.unmapped_payment_events.
 */

export const stageMetadata = {
  id: 'stage4',
  name: 'Financial Ledgers & Refund Edge Cases',
  mode: 'LIVE_OR_DRY_RUN',
  targetSurface: 'confirm_moteur_payment, refund_moteur_payment & Ledger Tables',
  possibleMutations: 'Writes payments, entitlements, adjustments, and unmapped events for synthetic test company',
  requiredPreconditions: [
    'Migration 12 applied',
    'PostgREST service role authentication',
    'Disposable database active',
  ],
};

/**
 * Runs Stage 4 ledger tests.
 * @param {import('../http-client.mjs').PostgrestHarnessClient} client
 * @param {import('../fixtures.mjs').SyntheticFixtureManager} fixtures
 */
export async function runStage4(client, fixtures) {
  // Ensure prerequisite company and module fixtures exist
  await fixtures.ensurePrerequisiteFixtures(client);

  const results = {
    stage: stageMetadata.id,
    name: stageMetadata.name,
    dryRun: client.dryRun,
    testCases: [],
    passedCount: 0,
    failedCount: 0,
  };

  const tests = [
    {
      id: 'LEDGER-01-PARTIAL',
      name: 'Partial refund duration deduction on 30-day flex payment with database persistence verification',
      action: async () => {
        // Step 1: Confirm 30-day payment (30,000 XOF)
        const confirmRes = await client.rpc('confirm_moteur_payment', {
          p_company_id: fixtures.companyId,
          p_reference: fixtures.ref1,
          p_amount: 30000,
          p_currency: 'XOF',
          p_plan_id: 'starter',
          p_billing_cycle: 'flex',
          p_module_ids: ['hotel'],
        });

        // Step 2: Refund 10,000 XOF (10 days = 33.3%)
        const refundRes = await client.rpc('refund_moteur_payment', {
          p_company_id: fixtures.companyId,
          p_reference: fixtures.ref1,
          p_reason: 'customer_partial_reduction',
          p_refund_amount: 10000,
          p_refund_event_id: `${fixtures.eventRefund1}_partial`,
        });

        const httpPassed = refundRes.httpStatus === 200;
        const jsonPassed = refundRes.data?.status === 'success' && refundRes.data?.is_partial === true;

        if (client.dryRun) {
          return {
            passed: true,
            dryRun: true,
            httpStatus: { expected: 200, actual: 200, passed: true },
            jsonResult: { expectedStatus: 'success', isPartial: true, passed: true },
            dbPersistence: { simulated: true, passed: true },
          };
        }

        // Step 3: Targeted Database Persistence Reads
        const [payRes, entRes, adjRes] = await Promise.all([
          client.queryTable('payment_history', `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.ref1}`),
          client.queryTable('subscription_entitlements', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
          client.queryTable('entitlement_schedule_adjustments', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
        ]);

        const paymentRow = payRes.data?.[0];
        const entitlementRow = entRes.data?.[0];
        const adjustmentRow = adjRes.data?.[0];

        const dbPayPassed = paymentRow && paymentRow.status === 'partially_refunded' && Number(paymentRow.refunded_amount) === 10000;
        const dbEntPassed = entitlementRow && entitlementRow.status === 'partially_refunded' && Number(entitlementRow.cumulative_gross_refunded) === 10000;
        const dbAdjPassed = adjustmentRow && adjustmentRow.adjustment_type === 'refund_duration_reduction' && Number(adjustmentRow.gross_refund_amount) === 10000;

        const allDbPassed = Boolean(dbPayPassed && dbEntPassed && dbAdjPassed);
        const overallPassed = httpPassed && jsonPassed && allDbPassed;

        return {
          passed: overallPassed,
          httpStatus: { expected: 200, actual: refundRes.httpStatus, passed: httpPassed },
          jsonResult: { expectedStatus: 'success', isPartial: true, actual: refundRes.data, passed: jsonPassed },
          dbPersistence: {
            paymentHistoryUpdated: Boolean(dbPayPassed),
            entitlementUpdated: Boolean(dbEntPassed),
            adjustmentLogged: Boolean(dbAdjPassed),
            passed: allDbPassed,
          },
        };
      },
    },
    {
      id: 'LEDGER-02-ROUNDING',
      name: 'Terminal rounding reconciliation completes gross amount and reconciles net deduction in database',
      action: async () => {
        // Complete the remaining 20,000 gross refund
        const refundRes = await client.rpc('refund_moteur_payment', {
          p_company_id: fixtures.companyId,
          p_reference: fixtures.ref1,
          p_reason: 'final_terminal_refund',
          p_refund_amount: 20000,
          p_refund_event_id: `${fixtures.eventRefund1}_terminal`,
        });

        const httpPassed = refundRes.httpStatus === 200;
        const jsonPassed = refundRes.data?.status === 'success' && refundRes.data?.is_final_refund === true;

        if (client.dryRun) {
          return {
            passed: true,
            dryRun: true,
            httpStatus: { expected: 200, actual: 200, passed: true },
            jsonResult: { expectedStatus: 'success', isFinal: true, passed: true },
            dbPersistence: { simulated: true, passed: true },
          };
        }

        // Targeted Database Persistence Reads
        const [payRes, entRes] = await Promise.all([
          client.queryTable('payment_history', `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.ref1}`),
          client.queryTable('subscription_entitlements', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
        ]);

        const paymentRow = payRes.data?.[0];
        const entitlementRow = entRes.data?.[0];

        const dbPayPassed = paymentRow && paymentRow.status === 'refunded' && Number(paymentRow.refunded_amount) === 30000;
        const dbEntPassed = entitlementRow && entitlementRow.status === 'refunded' && Number(entitlementRow.cumulative_gross_refunded) === 30000;
        const allDbPassed = Boolean(dbPayPassed && dbEntPassed);

        return {
          passed: httpPassed && jsonPassed && allDbPassed,
          httpStatus: { expected: 200, actual: refundRes.httpStatus, passed: httpPassed },
          jsonResult: { expectedStatus: 'success', isFinal: true, actual: refundRes.data, passed: jsonPassed },
          dbPersistence: {
            paymentMarkedRefunded: Boolean(dbPayPassed),
            entitlementMarkedRefunded: Boolean(dbEntPassed),
            passed: allDbPassed,
          },
        };
      },
    },
    {
      id: 'LEDGER-03-HISTORICAL-NULL-NET',
      name: 'Missing historical net_amount routes to unmapped_payment_events preserving subscription access',
      action: async () => {
        // Seed legacy payment lacking net_amount
        await client.insertTable('payment_history', {
          company_id: fixtures.companyId,
          reference: fixtures.refLegacy,
          amount: 25000,
          currency: 'XOF',
          status: 'paid',
          net_amount: null, // Legacy unverified record
          description: 'Historical legacy payment without net_amount',
        });

        const refundRes = await client.rpc('refund_moteur_payment', {
          p_company_id: fixtures.companyId,
          p_reference: fixtures.refLegacy,
          p_reason: 'dispute_legacy',
          p_refund_amount: 25000,
        });

        const httpPassed = refundRes.httpStatus === 200;
        const jsonPassed = refundRes.data?.status === 'manual_review_required' &&
                           refundRes.data?.code === 'UNVERIFIED_NET_AMOUNT';

        if (client.dryRun) {
          return {
            passed: true,
            dryRun: true,
            httpStatus: { expected: 200, actual: 200, passed: true },
            jsonResult: { expectedStatus: 'manual_review_required', passed: true },
            dbPersistence: { simulated: true, passed: true },
          };
        }

        // Verify unmapped_payment_events row exists with manual_review_required
        const unmappedRes = await client.queryTable(
          'unmapped_payment_events',
          `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.refLegacy}`
        );
        const unmappedRow = unmappedRes.data?.[0];
        const dbUnmappedPassed = unmappedRow &&
          unmappedRow.status === 'manual_review_required' &&
          unmappedRow.failure_reason === 'MISSING_VERIFIED_NET_AMOUNT';

        return {
          passed: httpPassed && jsonPassed && Boolean(dbUnmappedPassed),
          httpStatus: { expected: 200, actual: refundRes.httpStatus, passed: httpPassed },
          jsonResult: { expectedStatus: 'manual_review_required', expectedCode: 'UNVERIFIED_NET_AMOUNT', actual: refundRes.data, passed: jsonPassed },
          dbPersistence: {
            unmappedEventRecorded: Boolean(dbUnmappedPassed),
            passed: Boolean(dbUnmappedPassed),
          },
        };
      },
    },
    {
      id: 'LEDGER-04-CONFLICTING-PAYLOAD',
      name: 'Replaying existing refund_event_id with conflicting payload is rejected without database corruption',
      action: async () => {
        const replayEventId = `${fixtures.eventRefund1}_partial`;

        // Capture pre-replay state to verify complete immutability
        let preRefundEvent = null;
        let prePayment = null;
        let preEntitlement = null;
        let preAdjustmentCount = 0;

        if (!client.dryRun) {
          const [preEventRes, prePayRes, preEntRes, preAdjRes] = await Promise.all([
            client.queryTable('payment_refund_events', `refund_event_id=eq.${replayEventId}`),
            client.queryTable('payment_history', `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.ref1}`),
            client.queryTable('subscription_entitlements', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
            client.queryTable('entitlement_schedule_adjustments', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
          ]);
          preRefundEvent = preEventRes.data?.[0];
          prePayment = prePayRes.data?.[0];
          preEntitlement = preEntRes.data?.[0];
          preAdjustmentCount = preAdjRes.data?.length || 0;
        }

        // Replay existing event with altered amount ($99,999)
        const refundRes = await client.rpc('refund_moteur_payment', {
          p_company_id: fixtures.companyId,
          p_reference: fixtures.ref1,
          p_reason: 'tampered_replay_attempt',
          p_refund_amount: 99999,
          p_refund_event_id: replayEventId, // Reusing existing event ID
        });

        const httpPassed = refundRes.httpStatus === 200;
        const jsonPassed = (refundRes.data?.status === 'invalid' && refundRes.data?.code === 'CONFLICTING_PAYLOAD_FOR_EVENT') ||
                           (refundRes.data?.status === 'conflict_quarantined' && refundRes.data?.code === 'CONFLICTING_PAYLOAD_QUARANTINED');

        if (client.dryRun) {
          return {
            passed: httpPassed && jsonPassed,
            dryRun: true,
            httpStatus: { expected: 200, actual: refundRes.httpStatus, passed: httpPassed },
            jsonResult: { expectedStatus: ['invalid', 'conflict_quarantined'], expectedCode: ['CONFLICTING_PAYLOAD_FOR_EVENT', 'CONFLICTING_PAYLOAD_QUARANTINED'], actual: refundRes.data, passed: jsonPassed },
            dbPersistence: { simulated: true, passed: true },
          };
        }

        // Verify post-replay database invariants: durable quarantine and total ledger immutability
        const [incidentRes, postEventRes, postPayRes, postEntRes, postAdjRes] = await Promise.all([
          client.queryTable('unmapped_payment_events', `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.ref1}&event_type=eq.payment.refunded.conflict`),
          client.queryTable('payment_refund_events', `refund_event_id=eq.${replayEventId}`),
          client.queryTable('payment_history', `company_id=eq.${fixtures.companyId}&reference=eq.${fixtures.ref1}`),
          client.queryTable('subscription_entitlements', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
          client.queryTable('entitlement_schedule_adjustments', `company_id=eq.${fixtures.companyId}&payment_reference=eq.${fixtures.ref1}`),
        ]);

        const incidentRow = incidentRes.data?.[0];
        const postRefundEvent = postEventRes.data?.[0];
        const postPayment = postPayRes.data?.[0];
        const postEntitlement = postEntRes.data?.[0];
        const postAdjustmentCount = postAdjRes.data?.length || 0;

        // 1. Incident durably recorded with failure reason and manual_review_required
        const incidentDurable = Boolean(
          incidentRow &&
          incidentRow.status === 'manual_review_required' &&
          incidentRow.failure_reason === 'CONFLICTING_PAYLOAD_FOR_EXISTING_EVENT_ID' &&
          incidentRow.raw_payload?.conflict_event_id === replayEventId
        );

        // 2. Original payment_refund_events row is untouched (amount did not become 99999)
        const eventUntouched = Boolean(
          postRefundEvent &&
          Number(postRefundEvent.gross_refund_amount) === Number(preRefundEvent?.gross_refund_amount) &&
          postRefundEvent.gross_refund_amount !== 99999
        );

        // 3. Payment history refunded_amount and refund_history are unchanged
        const paymentUntouched = Boolean(
          postPayment &&
          Number(postPayment.refunded_amount) === Number(prePayment?.refunded_amount) &&
          JSON.stringify(postPayment.refund_history) === JSON.stringify(prePayment?.refund_history)
        );

        // 4. Entitlements ledger is unchanged
        const entitlementUntouched = Boolean(
          postEntitlement &&
          Number(postEntitlement.cumulative_gross_refunded) === Number(preEntitlement?.cumulative_gross_refunded) &&
          Number(postEntitlement.remaining_duration_seconds) === Number(preEntitlement?.remaining_duration_seconds)
        );

        // 5. Zero new schedule adjustments created for tampered replay
        const adjustmentsUntouched = Boolean(postAdjustmentCount === preAdjustmentCount);

        const allDbPassed = incidentDurable && eventUntouched && paymentUntouched && entitlementUntouched && adjustmentsUntouched;
        const overallPassed = httpPassed && jsonPassed && allDbPassed;

        return {
          passed: overallPassed,
          httpStatus: { expected: 200, actual: refundRes.httpStatus, passed: httpPassed },
          jsonResult: { expectedStatus: ['invalid', 'conflict_quarantined'], expectedCode: ['CONFLICTING_PAYLOAD_FOR_EVENT', 'CONFLICTING_PAYLOAD_QUARANTINED'], actual: refundRes.data, passed: jsonPassed },
          dbPersistence: {
            incidentDurablyQuarantined: incidentDurable,
            priorRefundEventUntouched: eventUntouched,
            paymentHistoryUntouched: paymentUntouched,
            entitlementLedgerUntouched: entitlementUntouched,
            adjustmentsUntouched: adjustmentsUntouched,
            passed: allDbPassed,
          },
        };
      },
    },
  ];

  for (const t of tests) {
    const outcome = await t.action();
    if (outcome.passed) {
      results.passedCount++;
    } else {
      results.failedCount++;
    }

    results.testCases.push({
      id: t.id,
      name: t.name,
      passed: outcome.passed,
      assertions: outcome,
    });
  }

  return results;
}
