import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { recordRevenue } from '@/lib/finance';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUuid(id: string): string {
  if (id && UUID_REGEX.test(id)) return id;
  return '11111111-1111-4111-8111-111111111111';
}

/**
 * GET /api/v1/hotel/reservations
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuid(searchParams.get('companyId') || session?.companyId || '');

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_reservations')
        .select(`
          *,
          room:hotel_rooms(*),
          guest:hotel_guests(*)
        `)
        .eq('company_id', companyId)
        .order('check_in_date', { ascending: false });

      if (!error && data) {
        return NextResponse.json({ success: true, reservations: data });
      }
    }
  }

  return NextResponse.json({ success: true, reservations: [] });
}

/**
 * POST /api/v1/hotel/reservations
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

  if (!body.room_id || !body.guest_id || !body.check_in_date || !body.check_out_date) {
    return NextResponse.json({ success: false, error: 'Champs de réservation manquants' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_reservations')
        .insert({
          company_id: companyId,
          room_id: body.room_id,
          guest_id: body.guest_id,
          check_in_date: body.check_in_date,
          check_out_date: body.check_out_date,
          status: body.status || 'confirmed',
          total_amount: parseFloat(body.total_amount) || 0,
          paid_amount: parseFloat(body.paid_amount) || 0,
          currency: body.currency || 'XOF',
          notes: body.notes || null,
        })
        .select(`
          *,
          room:hotel_rooms(*),
          guest:hotel_guests(*)
        `)
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }

      // Record shared finance revenue if initial deposit was paid
      if (data && Number(data.paid_amount) > 0) {
        try {
          await recordRevenue({
            workspaceId: companyId,
            moduleId: 'hotel-property',
            amount: Number(data.paid_amount),
            currency: data.currency || 'XOF',
            source: `Acompte Réservation #${data.id.substring(0, 8)}`,
            reference: `REF-HTL-DEP-${data.id}`,
            occurredAt: new Date().toISOString(),
          });
        } catch {
          // Non-blocking finance record
        }
      }

      return NextResponse.json({ success: true, reservation: data });
    }
  }

  return NextResponse.json({ success: true, reservation: { id: `res-${Date.now()}`, ...body } });
}

/**
 * PATCH /api/v1/hotel/reservations
 * Handles check-in, check-out, and payment collection
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const { reservationId, action, paymentAmount, nextStatus, companyId: inputCompanyId } = body;
  const companyId = ensureUuid(inputCompanyId || session?.companyId || '');

  if (!reservationId) {
    return NextResponse.json({ success: false, error: 'reservationId is required' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      // 1. Fetch existing reservation
      const { data: res, error: fetchErr } = await supabase
        .from('hotel_reservations')
        .select(`*, room:hotel_rooms(*)`)
        .eq('id', reservationId)
        .eq('company_id', companyId)
        .single();

      if (fetchErr || !res) {
        return NextResponse.json({ success: false, error: 'Réservation introuvable' }, { status: 404 });
      }

      const pAmount = parseFloat(paymentAmount) || 0;
      const newPaid = Number(res.paid_amount) + pAmount;

      if (action === 'checkin') {
        await supabase
          .from('hotel_reservations')
          .update({
            status: 'checked_in',
            paid_amount: newPaid,
          })
          .eq('id', reservationId);

        if (res.room_id) {
          await supabase
            .from('hotel_rooms')
            .update({ status: 'occupied', updated_at: new Date().toISOString() })
            .eq('id', res.room_id);
        }

        if (pAmount > 0) {
          await recordRevenue({
            workspaceId: companyId,
            moduleId: 'hotel-property',
            amount: pAmount,
            currency: res.currency || 'XOF',
            source: `Paiement Check-in #${reservationId.substring(0, 8)}`,
            reference: `REF-HTL-CKIN-${reservationId}-${Date.now()}`,
          });
        }
      } else if (action === 'checkout') {
        await supabase
          .from('hotel_reservations')
          .update({
            status: 'checked_out',
            paid_amount: newPaid,
          })
          .eq('id', reservationId);

        if (res.room_id) {
          await supabase
            .from('hotel_rooms')
            .update({ status: nextStatus || 'cleaning', updated_at: new Date().toISOString() })
            .eq('id', res.room_id);
        }

        if (pAmount > 0) {
          await recordRevenue({
            workspaceId: companyId,
            moduleId: 'hotel-property',
            amount: pAmount,
            currency: res.currency || 'XOF',
            source: `Règlement Check-out #${reservationId.substring(0, 8)}`,
            reference: `REF-HTL-CKOUT-${reservationId}-${Date.now()}`,
          });
        }
      }

      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ success: true });
}
