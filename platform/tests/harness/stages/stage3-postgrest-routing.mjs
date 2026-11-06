/**
 * KaziBox Flex Validation Harness — Stage 3: PostgREST RPC Routing & Overload Disambiguation
 *
 * SCOPE:
 * Tests HTTP POST dispatch to "/rest/v1/rpc/refund_moteur_payment" across 2-, 3-, 4-, and 6-parameter payloads.
 * Verifies that PostgREST unambiguously resolves overloads without triggering PGRST203 errors.
 *
 * Preconditions:
 * - Migrations 01, 06, 10, 11, and 12 applied.
 * - PostgREST schema cache reloaded (NOTIFY pgrst, 'reload schema').
 * - Synthetic test company seeded.
 *
 * Possible Mutations:
 * - Inserts synthetic company row into public.companies (prerequisite fixture).
 * - Inserts unmapped event rows into public.unmapped_payment_events for unconfirmed references.
 */

export const stageMetadata = {
  id: 'stage3',
  name: 'PostgREST RPC Routing & Overload Disambiguation',
  mode: 'LIVE_OR_DRY_RUN',
  targetSurface: 'POST /rest/v1/rpc/refund_moteur_payment',
  possibleMutations: 'Seeds company in public.companies; records unmapped refund events in unmapped_payment_events',
  requiredPreconditions: [
    'Migration 12 applied',
    'PostgREST schema cache reloaded',
    'Target disposable database active',
  ],
};

/**
 * Runs Stage 3 test cases.
 * @param {import('../http-client.mjs').PostgrestHarnessClient} client
 * @param {import('../fixtures.mjs').SyntheticFixtureManager} fixtures
 */
export async function runStage3(client, fixtures) {
  // Ensure prerequisite company and module fixtures exist to satisfy foreign key constraints
  await fixtures.ensurePrerequisiteFixtures(client);

  const tests = [
    {
      id: 'PGRST-2ARG',
      name: 'Two-parameter call (p_company_id, p_reference)',
      description: 'Resolves to 3-parameter wrapper; unconfirmed ref returns unmatched without PGRST203',
      payload: {
        p_company_id: fixtures.companyId,
        p_reference: fixtures.ref1,
      },
      expectedHttpStatus: 200,
      expectedTarget: '3-arg wrapper',
      // Migration 12 line 383: Returns 'unmatched' when reference not found in payment_history
      expectedJsonStatus: ['unmatched', 'success', 'duplicate', 'invalid'],
    },
    {
      id: 'PGRST-3ARG',
      name: 'Three-parameter call (p_company_id, p_reference, p_reason)',
      description: 'Resolves to 3-parameter wrapper with custom reason string',
      payload: {
        p_company_id: fixtures.companyId,
        p_reference: fixtures.ref1,
        p_reason: 'customer_cancellation_test',
      },
      expectedHttpStatus: 200,
      expectedTarget: '3-arg wrapper',
      expectedJsonStatus: ['unmatched', 'success', 'duplicate', 'invalid'],
    },
    {
      id: 'PGRST-4ARG',
      name: 'Four-parameter call (p_company_id, p_reference, p_reason, p_refund_amount)',
      description: 'Resolves to 6-parameter authoritative RPC (p_refund_amount eliminates 3-arg wrapper)',
      payload: {
        p_company_id: fixtures.companyId,
        p_reference: fixtures.ref2,
        p_reason: 'partial_refund_test',
        p_refund_amount: 10000,
      },
      expectedHttpStatus: 200,
      expectedTarget: '6-arg authoritative RPC',
      expectedJsonStatus: ['unmatched', 'success', 'duplicate', 'invalid'],
    },
    {
      id: 'PGRST-6ARG',
      name: 'Six-parameter call (all explicit parameters)',
      description: 'Resolves to 6-parameter authoritative RPC with explicit event and provider references',
      payload: {
        p_company_id: fixtures.companyId,
        p_reference: fixtures.ref2,
        p_reason: 'full_authoritative_test',
        p_refund_amount: 5000,
        p_refund_event_id: fixtures.eventRefund1,
        p_provider_reference: 'prov_synth_999',
      },
      expectedHttpStatus: 200,
      expectedTarget: '6-arg authoritative RPC',
      expectedJsonStatus: ['unmatched', 'success', 'duplicate', 'invalid'],
    },
    {
      id: 'PGRST-UNPREFIXED',
      name: 'Unprefixed parameter keys (company_id, reference)',
      description: 'Rejected by PostgREST due to parameter key mismatch (prevents unintended execution)',
      payload: {
        company_id: fixtures.companyId,
        reference: fixtures.ref1,
      },
      // Documented PostgREST behavior: Returns 404 (PGRST202 function not found) or 400
      expectedHttpStatus: [400, 404],
      expectedTarget: 'none (rejected by PostgREST)',
      expectedJsonStatus: null,
    },
  ];

  const results = {
    stage: stageMetadata.id,
    name: stageMetadata.name,
    dryRun: client.dryRun,
    testCases: [],
    passedCount: 0,
    failedCount: 0,
  };

  for (const t of tests) {
    const res = await client.rpc('refund_moteur_payment', t.payload);
    
    // Independent Assertions:
    // 1. HTTP Status Check
    const httpPassed = Array.isArray(t.expectedHttpStatus)
      ? t.expectedHttpStatus.includes(res.httpStatus)
      : res.httpStatus === t.expectedHttpStatus;

    // 2. JSON Result Check
    let jsonPassed = true;
    if (t.expectedJsonStatus && res.data) {
      jsonPassed = t.expectedJsonStatus.includes(res.data.status);
    }

    const testPassed = httpPassed && jsonPassed;
    if (testPassed) {
      results.passedCount++;
    } else {
      results.failedCount++;
    }

    results.testCases.push({
      id: t.id,
      name: t.name,
      passed: testPassed,
      assertions: {
        httpStatus: {
          expected: t.expectedHttpStatus,
          actual: res.httpStatus,
          passed: httpPassed,
        },
        jsonResult: {
          expectedStatus: t.expectedJsonStatus,
          actualStatus: res.data?.status || null,
          actualCode: res.data?.code || null,
          passed: jsonPassed,
        },
      },
      durationMs: res.durationMs,
    });
  }

  return results;
}
