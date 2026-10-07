import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUuid(id: string): string {
  if (id && UUID_REGEX.test(id)) return id;
  return '11111111-1111-4111-8111-111111111111';
}

/**
 * GET /api/v1/hotel/rooms
 * List rooms for company
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuid(searchParams.get('companyId') || session?.companyId || '');

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_rooms')
        .select('*')
        .eq('company_id', companyId)
        .order('room_number', { ascending: true });

      if (!error && data) {
        return NextResponse.json({ success: true, rooms: data });
      }
    }
  }

  return NextResponse.json({ success: true, rooms: [] });
}

/**
 * POST /api/v1/hotel/rooms
 * Create room for company
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const companyId = ensureUuid(body.company_id || session?.companyId || '');

  if (!body.room_number || !body.room_number.trim()) {
    return NextResponse.json({ success: false, error: 'Numéro de chambre obligatoire' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_rooms')
        .insert({
          company_id: companyId,
          room_number: body.room_number.trim(),
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
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, room: data });
    }
  }

  // Fallback
  const fallbackRoom = {
    id: `room-${Date.now()}`,
    company_id: companyId,
    room_number: body.room_number.trim(),
    category: body.category || 'Standard',
    capacity: parseInt(body.capacity) || 2,
    price_per_night: parseFloat(body.price_per_night) || 0,
    currency: body.currency || 'XOF',
    status: body.status || 'available',
    notes: body.notes || '',
    created_at: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, room: fallbackRoom });
}

/**
 * PATCH /api/v1/hotel/rooms
 * Update room status
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const { roomId, status, companyId: inputCompanyId } = body;
  const companyId = ensureUuid(inputCompanyId || session?.companyId || '');

  if (!roomId || !status) {
    return NextResponse.json({ success: false, error: 'roomId and status are required' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { error } = await supabase
        .from('hotel_rooms')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', roomId)
        .eq('company_id', companyId);

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ success: true });
}
