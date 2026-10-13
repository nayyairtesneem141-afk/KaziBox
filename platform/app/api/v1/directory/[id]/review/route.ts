import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { reviewDirectoryEntry, getDirectoryEntryByIdOrSlug } from '@/lib/directory';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/directory/[id]/review
 *
 * Dedicated Admin Moderation & Publishing Workflow Endpoint.
 *
 * Security:
 * - Strictly restricted to 'platform_admin'.
 * - Non-admins receive HTTP 403 INSUFFICIENT_ROLE.
 *
 * Actions:
 * - 'approve': Validates the listing and advances status to 'approved'
 * - 'reject': Rejects the listing with required rejectionReason
 * - 'publish': Publishes the listing and activates public visibility
 * - 'suspend': Suspends the listing
 * - 'activate': Sets isActive to true
 * - 'hide': Sets isActive to false
 * - 'verify': Toggles official KaziBox verified badge
 * - 'feature': Toggles featured placement in catalogue
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const session = await getServerSession(req);

  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  if (session.role !== 'platform_admin') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Seuls les administrateurs de la plateforme KaziBox peuvent modérer et publier des fiches.',
      },
      { status: 403 }
    );
  }

  const existing = await getDirectoryEntryByIdOrSlug(id);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'NOT_FOUND', message: 'Fiche entreprise introuvable' },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload' },
      { status: 400 }
    );
  }

  const { action, rejectionReason, adminNotes } = body;

  const validActions = [
    'approve',
    'reject',
    'publish',
    'suspend',
    'activate',
    'hide',
    'verify',
    'feature',
  ];

  if (!action || !validActions.includes(action)) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_ACTION',
        message: `Action invalide. Actions autorisées: ${validActions.join(', ')}`,
      },
      { status: 422 }
    );
  }

  if (action === 'reject' && (!rejectionReason || !rejectionReason.trim())) {
    return NextResponse.json(
      {
        success: false,
        error: 'REJECTION_REASON_REQUIRED',
        message: 'Un motif de rejet explicite est obligatoire.',
      },
      { status: 422 }
    );
  }

  try {
    const result = await reviewDirectoryEntry(
      existing.id,
      action,
      session.userId,
      { rejectionReason, adminNotes }
    );

    if (!result.success || !result.entry) {
      return NextResponse.json(
        { success: false, error: 'ACTION_FAILED', message: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      message: `Action '${action}' effectuée avec succès pour l'entreprise '${result.entry.name}'.`,
      entry: result.entry,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message: err.message },
      { status: 500 }
    );
  }
}
