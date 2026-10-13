import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { recordRevenue } from '@/lib/finance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hotel/reservations
 * List reservations for the authorized company
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
        .from('hotel_reservations')
        .select(`
          *,
          room:hotel_rooms(*),
          guest:hotel_guests(*)
        `)
        .eq('company_id', companyId)
        .order('check_in_date', { ascending: false });

      if (error) {
        return NextResponse.json({ success: false, error: 'Erreur lors de la récupération des réservations.' }, { status: 500 });
      }

      return NextResponse.json({ success: true, reservations: data || [] });
    }
  }

  return NextResponse.json({ success: true, reservations: [] });
}

/**
 * POST /api/v1/hotel/reservations
 * Create reservation for the authorized company
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

  if (!body.room_id || !body.guest_id || !body.check_in_date || !body.check_out_date) {
    return NextResponse.json({ success: false, error: 'Champs de réservation manquants' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      // Cross-check: ensure room and guest belong to the same authorized company
      const [{ data: room }, { data: guest }] = await Promise.all([
        supabase.from('hotel_rooms').select('id, company_id').eq('id', body.room_id).eq('company_id', companyId).maybeSingle(),
        supabase.from('hotel_guests').select('id, company_id').eq('id', body.guest_id).eq('company_id', companyId).maybeSingle(),
      ]);

      if (!room) {
        return NextResponse.json({ success: false, error: 'Chambre introuvable dans cet établissement.' }, { status: 404 });
      }
      if (!guest) {
        return NextResponse.json({ success: false, error: 'Client introuvable dans cet établissement.' }, { status: 404 });
      }

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
        return NextResponse.json({ success: false, error: 'Erreur lors de la création de la réservation.' }, { status: 400 });
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

      return NextResponse.json({ success: true, reservation: data }, { status: 201 });
    }
  }

  return NextResponse.json({ success: true, reservation: { id: `res-${Date.now()}`, ...body } }, { status: 201 });
}

/**
 * PATCH /api/v1/hotel/reservations
 * Handles check-in, check-out, and payment collection
 */
export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Format JSON invalide' }, { status: 400 });
  }

  const { reservationId, action, paymentAmount, nextStatus } = body;
  if (!reservationId) {
    return NextResponse.json({ success: false, error: 'reservationId est obligatoire' }, { status: 422 });
  }

  const auth = await requireServerAuth(req, {
    targetCompanyId: body.company_id || body.companyId,
    requiredModuleId: 'hotel-property',
  });
  if (auth.errorResponse) return auth.errorResponse;

  const companyId = auth.session.companyId;

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      // 1. Fetch existing reservation strictly scoped to company_id
      const { data: res, error: fetchErr } = await supabase
        .from('hotel_reservations')
        .select(`*, room:hotel_rooms(*)`)
        .eq('id', reservationId)
        .eq('company_id', companyId)
        .maybeSingle();

      if (fetchErr || !res) {
        return NextResponse.json({ success: false, error: 'Réservation introuvable dans cet établissement.' }, { status: 404 });
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
          .eq('id', reservationId)
          .eq('company_id', companyId);

        if (res.room_id) {
          await supabase
            .from('hotel_rooms')
            .update({ status: 'occupied', updated_at: new Date().toISOString() })
            .eq('id', res.room_id)
            .eq('company_id', companyId);
        }

        if (pAmount > 0) {
          try {
            await recordRevenue({
              workspaceId: companyId,
              moduleId: 'hotel-property',
              amount: pAmount,
              currency: res.currency || 'XOF',
              source: `Paiement Check-in #${reservationId.substring(0, 8)}`,
              reference: `REF-HTL-CKIN-${reservationId}-${Date.now()}`,
              occurredAt: new Date().toISOString(),
            });
          } catch {
            // Non-blocking
          }
        }
      } else if (action === 'checkout') {
        await supabase
          .from('hotel_reservations')
          .update({
            status: 'checked_out',
            paid_amount: newPaid,
          })
          .eq('id', reservationId)
          .eq('company_id', companyId);

        if (res.room_id) {
          await supabase
            .from('hotel_rooms')
            .update({ status: nextStatus || 'cleaning', updated_at: new Date().toISOString() })
            .eq('id', res.room_id)
            .eq('company_id', companyId);
        }

        if (pAmount > 0) {
          try {
            await recordRevenue({
              workspaceId: companyId,
              moduleId: 'hotel-property',
              amount: pAmount,
              currency: res.currency || 'XOF',
              source: `Règlement Check-out #${reservationId.substring(0, 8)}`,
              reference: `REF-HTL-CKOUT-${reservationId}-${Date.now()}`,
              occurredAt: new Date().toISOString(),
            });
          } catch {
            // Non-blocking
          }
        }
      }

      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ success: true });
}
