import { NextRequest, NextResponse } from 'next/server';
import { authenticateModuleApiKey } from '@/lib/api-auth';
import { z } from '@/lib/validation';
import { getStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const eventSchema = z.object({
  moduleId: z.string({ min: 1 }),
  action: z.string({ min: 2 }), // e.g. 'booking.created', 'repair.completed'
  entity: z.string({ min: 2 }), // e.g. 'booking', 'repair_order'
  entityId: z.string({ min: 1 }),
  details: z.record(),
});

export interface TelemetryEvent {
  id: string;
  workspaceId: string;
  moduleId: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, any>;
  timestamp: string;
}

// In-memory telemetry log
const telemetryEvents: TelemetryEvent[] = [];

/**
 * POST /api/v1/events
 * Ingests operational business events from modules for auditing and consolidated telemetry.
 * Scope required: write:events
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateModuleApiKey(req, 'write:events');
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

  const validation = eventSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: 'Unprocessable Entity',
        code: 'VALIDATION_FAILED',
        message: 'Invalid event payload parameters.',
        details: validation.errors,
      },
      { status: 422 }
    );
  }

  const data = validation.data;

  // Cross-check: caller can only emit for its own moduleId unless granted wildcard
  if (data.moduleId !== auth!.moduleId && !auth!.module.scopes.includes('*')) {
    return NextResponse.json(
      {
        error: 'Forbidden',
        code: 'MODULE_MISMATCH',
        message: `API key for module '${auth!.moduleId}' cannot dispatch events for '${data.moduleId}'.`,
      },
      { status: 403 }
    );
  }

  const newEvent: TelemetryEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    workspaceId: auth!.workspaceId,
    moduleId: data.moduleId,
    action: data.action,
    entity: data.entity,
    entityId: data.entityId,
    details: data.details || {},
    timestamp: new Date().toISOString(),
  };

  telemetryEvents.unshift(newEvent);

  // Optional: create in-app notification if event is notable
  const store = getStore();
  const modDisplayName = typeof auth!.module.name === 'string' ? auth!.module.name : (auth!.module.name?.fr || auth!.module.name?.en || auth!.module.id);
  store.notifications.unshift({
    id: `notif-evt-${Date.now()}`,
    company_id: auth!.workspaceId,
    type: 'module_event' as any,
    title: `Événement ${modDisplayName}: ${data.action}`,
    message: `${data.entity} #${data.entityId} mis à jour.`,
    read: false,
    created_at: new Date().toISOString(),
    link: `/modules/${auth!.module.slug}`,
  });

  return NextResponse.json(
    {
      success: true,
      eventId: newEvent.id,
      timestamp: newEvent.timestamp,
      message: 'Event successfully ingested.',
    },
    { status: 201 }
  );
}
