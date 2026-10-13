import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, isPrivilegedRole } from '@/lib/server-auth';
import {
  getDirectoryEntries,
  createDirectoryEntry,
  DirectoryCategory,
  DirectoryStatus,
} from '@/lib/directory';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/directory
 *
 * Lists business directory entries with search and multi-facet filtering.
 * Public visibility:
 * - Unauthenticated or non-admin users only see status="published" & isActive=true,
 *   plus entries belonging to their own workspace.
 * - Platform admins can view all entries in any status.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);

  const search = searchParams.get('q') || searchParams.get('search') || undefined;
  const category = (searchParams.get('category') as DirectoryCategory) || 'all';
  const country = searchParams.get('country') || 'all';
  const city = searchParams.get('city') || undefined;
  const requestedStatus = (searchParams.get('status') as DirectoryStatus) || 'all';
  const isFeaturedParam = searchParams.get('featured');
  const isFeatured = isFeaturedParam !== null ? isFeaturedParam === 'true' : undefined;
  const companyOnly = searchParams.get('my_company') === 'true';

  const isPlatformAdmin = session?.role === 'platform_admin';

  let statusFilter: DirectoryStatus | 'all' = requestedStatus;
  let isActiveFilter: boolean | undefined = undefined;
  let companyIdFilter: string | undefined = undefined;

  if (companyOnly && session?.companyId) {
    companyIdFilter = session.companyId;
  } else if (!isPlatformAdmin) {
    // Non-admin public view strictly requires published and active
    if ((requestedStatus as string) === 'all') {
      statusFilter = 'published';
    }
    isActiveFilter = true;
  }

  try {
    const entries = await getDirectoryEntries({
      search,
      category,
      country,
      city,
      status: statusFilter,
      isActive: isActiveFilter,
      isFeatured,
      companyId: companyIdFilter,
    });

    return NextResponse.json({
      success: true,
      count: entries.length,
      entries,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'DIRECTORY_QUERY_FAILED', message: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/directory
 *
 * Registers a new business in the directory.
 * Security & Access Rules:
 * - Requires authenticated session.
 * - Caller must be 'owner', 'manager', or 'platform_admin'.
 * - Company ID is automatically bound to caller's workspace (unless platform_admin).
 * - Newly registered entries default to status="pending_review".
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  if (session.role === 'worker') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Les employés ne peuvent pas inscrire une entreprise à l’annuaire.',
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

  const {
    name,
    category,
    country,
    city,
    address,
    phone,
    email,
    website,
    tagline,
    description,
    logoUrl,
    coverImageUrl,
    openingHours,
    companyId,
  } = body;

  if (!name || !category || !country || !city || !phone || !email) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Nom, catégorie, pays, ville, téléphone et email sont obligatoires.',
      },
      { status: 422 }
    );
  }

  // Tenant bound safety: companyId must match caller session unless platform_admin
  const targetCompanyId =
    session.role === 'platform_admin' && companyId ? companyId : session.companyId;

  try {
    const result = await createDirectoryEntry(
      {
        companyId: targetCompanyId,
        name,
        category,
        country,
        city,
        address,
        phone,
        email,
        website,
        tagline,
        description,
        logoUrl,
        coverImageUrl,
        openingHours,
      },
      session.userId
    );

    if (!result.success || !result.entry) {
      return NextResponse.json(
        { success: false, error: 'CREATION_FAILED', message: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Entreprise inscrite avec succès. Fiche soumise pour examen par l’équipe KaziBox.',
        entry: result.entry,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message: err.message },
      { status: 500 }
    );
  }
}
