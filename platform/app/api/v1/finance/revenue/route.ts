import { NextRequest, NextResponse } from 'next/server';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { recordRevenue } from '@/lib/finance';
import { z } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const revenueSchema = z.object({
  moduleId: z.string({ min: 1 }),
  amount: z.number({ positive: true }),
  currency: z.string({ min: 3, max: 4 }),
  source: z.string({ min: 2 }),
  occurredAt: z.datetime(),
  reference: z.string({ min: 3 }),
});

/**
 * POST /api/v1/finance/revenue
 * Records operational merchant revenue from an activated module into the shared finance ledger.
 * Scope required: write:finance
 * Idempotency: same reference returns existing record without duplicating.
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateModuleApiKey(req, 'write:finance');
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  const { auth } = authResult;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: 'Unprocessable Entity',
        code: 'INVALID_JSON_BODY',
        message: 'Malformed JSON payload.',
      },
      { status: 422 }
    );
  }

  // Schema Validation
  const validation = revenueSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: 'Unprocessable Entity',
        code: 'VALIDATION_FAILED',
        message: 'Invalid request payload parameters.',
        details: validation.errors,
      },
      { status: 422 }
    );
  }

  const data = validation.data;

  // Cross-check: caller can only record for its own moduleId unless granted wildcard
  if (data.moduleId !== auth!.moduleId && !auth!.module.scopes.includes('*')) {
    return NextResponse.json(
      {
        error: 'Forbidden',
        code: 'MODULE_MISMATCH',
        message: `API key for module '${auth!.moduleId}' cannot record financial data for module '${data.moduleId}'.`,
      },
      { status: 403 }
    );
  }

  // Record with idempotency
  const result = await recordRevenue({
    workspaceId: auth!.workspaceId,
    moduleId: data.moduleId,
    amount: data.amount,
    currency: data.currency,
    source: data.source,
    occurredAt: data.occurredAt,
    reference: data.reference,
  });

  return NextResponse.json(
    {
      success: true,
      isDuplicate: result.isDuplicate,
      record: result.record,
      message: result.isDuplicate
        ? 'Duplicate reference detected. Returning existing record (Idempotent).'
        : 'Revenue record successfully created.',
    },
    { status: result.isDuplicate ? 200 : 201 }
  );
}
