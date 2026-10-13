import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hotel/rooms
 * List rooms for the authorized company
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
        .from('hotel_rooms')
        .select('*')
        .eq('company_id', companyId)
        .order('room_number', { ascending: true });

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la récupération des chambres.' }, { status: 500 });
      }

      return NextResponse.json({ success: true, rooms: data || [] });
    }
  }

  return NextResponse.json({ success: true, rooms: [] });
}

/**
 * POST /api/v1/hotel/rooms
 * Create room for the authorized company (restricted to owners, managers, platform_admin)
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
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (!body.room_number || !String(body.room_number).trim()) {
    return NextResponse.json({ success: false, error: 'Numéro de chambre obligatoire' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_rooms')
        .insert({
          company_id: companyId,
          room_number: String(body.room_number).trim(),
          category: body.category || 'Standard',
          capacity: parseInt(body.capacity) || 2,
          price_per_night: parseFloat(body.price_per_night) || 0,
          currency: body.currency || 'XOF',
          status: body.status || 'available',
          notes: body.notes || '',
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la création de la chambre.' }, { status: 400 });
      }

      return NextResponse.json({ success: true, room: data }, { status: 201 });
    }
  }

  const fallbackRoom = {
    id: `room-${Date.now()}`,
    company_id: companyId,
    room_number: String(body.room_number).trim(),
    category: body.category || 'Standard',
    capacity: parseInt(body.capacity) || 2,
    price_per_night: parseFloat(body.price_per_night) || 0,
    currency: body.currency || 'XOF',
    status: body.status || 'available',
    notes: body.notes || '',
    created_at: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, room: fallbackRoom }, { status: 201 });
}

/**
 * PATCH /api/v1/hotel/rooms
 * Update room status (restricted to owners, managers, platform_admin)
 */
export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { roomId, status } = body;
  if (!roomId || !status) {
    return NextResponse.json({ success: false, error: 'roomId et status sont obligatoires' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'hotel-property',
    allowedRoles: ['owner', 'manager', 'platform_admin'],
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_rooms')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', roomId)
        .eq('company_id', companyId)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la mise à jour de la chambre.' }, { status: 400 });
      }

      if (!data) {
        return NextResponse.json({ success: false, error: 'Chambre introuvable dans cet établissement.' }, { status: 404 });
      }

      return NextResponse.json({ success: true, room: data });
    }
  }

  return NextResponse.json({ success: true });
}
