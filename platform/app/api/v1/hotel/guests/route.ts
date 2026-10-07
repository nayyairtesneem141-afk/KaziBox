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
 * GET /api/v1/hotel/guests
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(req);
  const { searchParams } = new URL(req.url);
  const companyId = ensureUuid(searchParams.get('companyId') || session?.companyId || '');

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_guests')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        return NextResponse.json({ success: true, guests: data });
      }
    }
  }

  return NextResponse.json({ success: true, guests: [] });
}

/**
 * POST /api/v1/hotel/guests
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

  if (!body.full_name || !body.full_name.trim()) {
    return NextResponse.json({ success: false, error: 'Nom du client obligatoire' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('hotel_guests')
        .insert({
          company_id: companyId,
          full_name: body.full_name.trim(),
          phone: body.phone || null,
          email: body.email || null,
          id_number: body.id_number || null,
          nationality: body.nationality || null,
          notes: body.notes || null,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, guest: data });
    }
  }

  // Fallback
  const fallbackGuest = {
    id: `gst-${Date.now()}`,
    company_id: companyId,
    full_name: body.full_name.trim(),
    phone: body.phone || null,
    email: body.email || null,
    id_number: body.id_number || null,
    nationality: body.nationality || null,
    notes: body.notes || null,
    created_at: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, guest: fallbackGuest });
}
