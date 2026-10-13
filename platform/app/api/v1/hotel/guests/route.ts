import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hotel/guests
 * List guests for the authorized company
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetCompanyId = searchParams.get('companyId');

  const auth = await requireServerAuth(req, {
    targetCompanyId,
    requiredModuleId: 'hotel-property',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_guests')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la récupération des clients.' }, { status: 500 });
      }

      return NextResponse.json({ success: true, guests: data || [] });
    }
  }

  return NextResponse.json({ success: true, guests: [] });
}

/**
 * POST /api/v1/hotel/guests
 * Create a guest for the authorized company
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'hotel-property',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (!body.full_name || !String(body.full_name).trim()) {
    return NextResponse.json({ success: false, error: 'Nom du client obligatoire' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_guests')
        .insert({
          company_id: companyId,
          full_name: String(body.full_name).trim(),
          phone: body.phone ? String(body.phone).trim() : null,
          email: body.email ? String(body.email).trim() : null,
          id_number: body.id_number ? String(body.id_number).trim() : null,
          nationality: body.nationality ? String(body.nationality).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la création du client.' }, { status: 400 });
      }

      return NextResponse.json({ success: true, guest: data }, { status: 201 });
    }
  }

  const fallbackGuest = {
    id: `gst-${Date.now()}`,
    company_id: companyId,
    full_name: String(body.full_name).trim(),
    phone: body.phone ? String(body.phone).trim() : null,
    email: body.email ? String(body.email).trim() : null,
    id_number: body.id_number ? String(body.id_number).trim() : null,
    nationality: body.nationality ? String(body.nationality).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    created_at: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, guest: fallbackGuest }, { status: 201 });
}
