import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import {
  getDirectoryEntryByIdOrSlug,
  updateDirectoryEntry,
  deleteDirectoryEntry,
} from '@/lib/directory';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/directory/[id]
 *
 * Fetches a single directory entry by ID or slug.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const session = await getServerSession(req);

  try {
    const entry = await getDirectoryEntryByIdOrSlug(id);
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'NOT_FOUND', message: 'Fiche entreprise introuvable' },
        { status: 404 }
      );
    }

    // If entry is not published/active, only platform admin or own company members can view it
    const isPlatformAdmin = session?.role === 'platform_admin';
    const isOwnCompany = session?.companyId && entry.companyId === session.companyId;

    if (entry.status !== 'published' || !entry.isActive) {
      if (!isPlatformAdmin && !isOwnCompany) {
        return NextResponse.json(
          { success: false, error: 'NOT_FOUND', message: 'Fiche entreprise non disponible' },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({ success: true, entry });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'QUERY_ERROR', message: err.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/v1/directory/[id]
 *
 * Updates business directory details.
 * Security & Access Rules:
 * - Requires authenticated session.
 * - Caller must be 'platform_admin' OR ('owner' / 'manager' belonging to the entry's company).
 * - Workers are strictly blocked.
 * - Cross-tenant edits are blocked.
 */
export async function PUT(
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

  if (session.role === 'worker') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'INSUFFICIENT_ROLE' },
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

  const isPlatformAdmin = session.role === 'platform_admin';
  const isOwnerOrManagerOfCompany =
    existing.companyId === session.companyId &&
    (session.role === 'owner' || session.role === 'manager');

  if (!isPlatformAdmin && !isOwnerOrManagerOfCompany) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'TENANT_MISMATCH',
        message: 'Vous ne pouvez modifier que les fiches associées à votre propre entreprise.',
      },
      { status: 403 }
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

  // Prevent tenants from self-promoting to verified, featured, or publishing without admin approval
  const sanitizedUpdates = { ...body };
  if (!isPlatformAdmin) {
    delete sanitizedUpdates.isVerified;
    delete sanitizedUpdates.isFeatured;
    delete sanitizedUpdates.status;
    delete sanitizedUpdates.rejectionReason;
    delete sanitizedUpdates.adminNotes;
  }

  try {
    const result = await updateDirectoryEntry(existing.id, sanitizedUpdates);
    if (!result.success || !result.entry) {
      return NextResponse.json(
        { success: false, error: 'UPDATE_FAILED', message: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Fiche entreprise mise à jour avec succès.',
      entry: result.entry,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message: err.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/directory/[id]
 *
 * Deletes directory entry.
 * Restricted to platform_admin or workspace owner.
 */
export async function DELETE(
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

  const existing = await getDirectoryEntryByIdOrSlug(id);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'NOT_FOUND', message: 'Fiche introuvable' },
      { status: 404 }
    );
  }

  const isPlatformAdmin = session.role === 'platform_admin';
  const isOwnerOfCompany =
    existing.companyId === session.companyId && session.role === 'owner';

  if (!isPlatformAdmin && !isOwnerOfCompany) {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'INSUFFICIENT_ROLE' },
      { status: 403 }
    );
  }

  try {
    await deleteDirectoryEntry(existing.id);
    return NextResponse.json({
      success: true,
      message: 'Fiche entreprise supprimée.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'DELETE_ERROR', message: err.message },
      { status: 500 }
    );
  }
}
