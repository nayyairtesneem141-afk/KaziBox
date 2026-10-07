import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';
import { recordRevenue } from './finance';
import { ModuleSummary } from '@kazibox/sdk';

export interface HotelRoom {
  id: string;
  company_id: string;
  room_number: string;
  category: 'Standard' | 'Deluxe' | 'Suite' | 'Executive' | 'Family';
  capacity: number;
  price_per_night: number;
  currency: string;
  status: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface HotelGuest {
  id: string;
  company_id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  id_number?: string | null;
  nationality?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface HotelReservation {
  id: string;
  company_id: string;
  room_id: string;
  guest_id: string;
  check_in_date: string;
  check_out_date: string;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  total_amount: number;
  paid_amount: number;
  currency: string;
  notes?: string | null;
  created_at?: string;
  room?: HotelRoom;
  guest?: HotelGuest;
}

export interface HotelDashboardMetrics {
  totalRooms: number;
  availableRooms: number;
  occupiedRooms: number;
  reservedRooms: number;
  cleaningRooms: number;
  maintenanceRooms: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  occupancyRate: number;
  totalRevenue: number;
  pendingBalance: number;
}

// Initial default seed rooms when table is newly created
const DEFAULT_INITIAL_ROOMS: Omit<HotelRoom, 'company_id'>[] = [
  { id: 'room-101', room_number: '101', category: 'Standard', capacity: 2, price_per_night: 45000, currency: 'XOF', status: 'available', notes: 'Vue jardin' },
  { id: 'room-102', room_number: '102', category: 'Standard', capacity: 2, price_per_night: 45000, currency: 'XOF', status: 'occupied', notes: 'Arrivé hier' },
  { id: 'room-201', room_number: '201', category: 'Deluxe', capacity: 2, price_per_night: 75000, currency: 'XOF', status: 'reserved', notes: 'Client VIP' },
  { id: 'room-202', room_number: '202', category: 'Deluxe', capacity: 3, price_per_night: 85000, currency: 'XOF', status: 'available', notes: 'Lit supplémentaire possible' },
  { id: 'room-301', room_number: '301', category: 'Suite', capacity: 4, price_per_night: 150000, currency: 'XOF', status: 'occupied', notes: 'Suite Présidentielle' },
  { id: 'room-302', room_number: '302', category: 'Executive', capacity: 2, price_per_night: 110000, currency: 'XOF', status: 'cleaning', notes: 'Ménage en cours' },
  { id: 'room-303', room_number: '303', category: 'Family', capacity: 5, price_per_night: 130000, currency: 'XOF', status: 'maintenance', notes: 'Remplacement climatiseur' },
];

const DEFAULT_INITIAL_GUESTS: Omit<HotelGuest, 'company_id'>[] = [
  { id: 'gst-1', full_name: 'Kouassi Jean-Marc', phone: '+225 0707123456', email: 'jm.kouassi@example.ci', id_number: 'CI-889124', nationality: 'Ivoirienne' },
  { id: 'gst-2', full_name: 'Awa Diallo', phone: '+221 771234567', email: 'awa.diallo@example.sn', id_number: 'SN-441290', nationality: 'Sénégalaise' },
  { id: 'gst-3', full_name: 'Emmanuel Mensah', phone: '+233 241234567', email: 'e.mensah@example.gh', id_number: 'GH-991204', nationality: 'Ghanéenne' },
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureUuidCompanyId(id: string): string {
  if (id && UUID_REGEX.test(id)) {
    return id;
  }
  return '11111111-1111-4111-8111-111111111111';
}

/**
 * Get Supabase Client safely
 */
function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  const client: any = typeof window !== 'undefined'
    ? createBrowserClient()
    : (createAdminClient() || createServerClient());
  return client;
}

/**
 * Fetch all Rooms for Company
 */
export async function getRooms(companyIdInput: string): Promise<HotelRoom[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/v1/hotel/rooms?companyId=${encodeURIComponent(companyId)}`);
      const json = await res.json();
      if (res.ok && json.success && json.rooms && json.rooms.length > 0) {
        return json.rooms.map((r: any) => ({
          id: r.id,
          company_id: r.company_id,
          room_number: r.room_number,
          category: r.category,
          capacity: Number(r.capacity),
          price_per_night: Number(r.price_per_night),
          currency: r.currency || 'XOF',
          status: r.status,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
      }
    } catch {
      // Fall through to direct or fallback
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_rooms')
      .select('*')
      .eq('company_id', companyId)
      .order('room_number', { ascending: true });

    if (!error && data) {
      return data.map((r: any) => ({
        id: r.id,
        company_id: r.company_id,
        room_number: r.room_number,
        category: r.category,
        capacity: Number(r.capacity),
        price_per_night: Number(r.price_per_night),
        currency: r.currency || 'XOF',
        status: r.status,
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    }
  }

  if (!isSupabaseConfigured()) {
    // Initial fallback data mapped to companyId only in offline mode
    return DEFAULT_INITIAL_ROOMS.map((r) => ({
      ...r,
      company_id: companyId,
    }));
  }

  return [];
}

/**
 * Create a new Room
 */
export async function createRoom(
  companyIdInput: string,
  room: Omit<HotelRoom, 'id' | 'company_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; room?: HotelRoom; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  // In the browser, invoke the secure server API route to bypass anon RLS constraints
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...room }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        return { success: true, room: json.room };
      }
      return { success: false, error: json.error || 'Erreur lors de la création de la chambre' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_rooms')
      .insert({
        company_id: companyId,
        room_number: room.room_number,
        category: room.category,
        capacity: room.capacity,
        price_per_night: room.price_per_night,
        currency: room.currency || 'XOF',
        status: room.status || 'available',
        notes: room.notes || '',
      })
      .select()
      .single();

    if (!error && data) {
      return {
        success: true,
        room: {
          id: data.id,
          company_id: data.company_id,
          room_number: data.room_number,
          category: data.category,
          capacity: Number(data.capacity),
          price_per_night: Number(data.price_per_night),
          currency: data.currency,
          status: data.status,
          notes: data.notes,
          created_at: data.created_at,
        },
      };
    }
    return { success: false, error: error?.message || 'Database error creating room' };
  }

  const newRoom: HotelRoom = {
    id: `room-${Date.now()}`,
    company_id: companyId,
    ...room,
    currency: room.currency || 'XOF',
    status: room.status || 'available',
  };
  return { success: true, room: newRoom };
}

/**
 * Update Room Status
 */
export async function updateRoomStatus(
  companyIdInput: string,
  roomId: string,
  status: HotelRoom['status']
): Promise<{ success: boolean; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/rooms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, roomId, status }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true };
      return { success: false, error: json.error || 'Erreur mise à jour chambre' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from('hotel_rooms')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', roomId)
      .eq('company_id', companyId);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  return { success: true };
}

/**
 * Fetch all Guests for Company
 */
export async function getGuests(companyIdInput: string): Promise<HotelGuest[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/v1/hotel/guests?companyId=${encodeURIComponent(companyId)}`);
      const json = await res.json();
      if (res.ok && json.success && json.guests && json.guests.length > 0) {
        return json.guests.map((g: any) => ({
          id: g.id,
          company_id: g.company_id,
          full_name: g.full_name,
          phone: g.phone,
          email: g.email,
          id_number: g.id_number,
          nationality: g.nationality,
          notes: g.notes,
          created_at: g.created_at,
        }));
      }
    } catch {
      // Fall through to direct or fallback
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_guests')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data.map((g: any) => ({
        id: g.id,
        company_id: g.company_id,
        full_name: g.full_name,
        phone: g.phone,
        email: g.email,
        id_number: g.id_number,
        nationality: g.nationality,
        notes: g.notes,
        created_at: g.created_at,
      }));
    }
  }

  if (!isSupabaseConfigured()) {
    return DEFAULT_INITIAL_GUESTS.map((g) => ({
      ...g,
      company_id: companyId,
    }));
  }

  return [];
}

/**
 * Create a new Guest
 */
export async function createGuest(
  companyIdInput: string,
  guest: Omit<HotelGuest, 'id' | 'company_id' | 'created_at'>
): Promise<{ success: boolean; guest?: HotelGuest; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...guest }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, guest: json.guest };
      return { success: false, error: json.error || 'Erreur création client' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_guests')
      .insert({
        company_id: companyId,
        full_name: guest.full_name,
        phone: guest.phone || null,
        email: guest.email || null,
        id_number: guest.id_number || null,
        nationality: guest.nationality || null,
        notes: guest.notes || null,
      })
      .select()
      .single();

    if (!error && data) {
      return {
        success: true,
        guest: {
          id: data.id,
          company_id: data.company_id,
          full_name: data.full_name,
          phone: data.phone,
          email: data.email,
          id_number: data.id_number,
          nationality: data.nationality,
          notes: data.notes,
          created_at: data.created_at,
        },
      };
    }
    return { success: false, error: error?.message || 'Database error creating guest' };
  }

  const newGuest: HotelGuest = {
    id: `gst-${Date.now()}`,
    company_id: companyId,
    ...guest,
  };
  return { success: true, guest: newGuest };
}

/**
 * Fetch all Reservations for Company
 */
export async function getReservations(companyIdInput: string): Promise<HotelReservation[]> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/v1/hotel/reservations?companyId=${encodeURIComponent(companyId)}`);
      const json = await res.json();
      if (res.ok && json.success && json.reservations && json.reservations.length > 0) {
        return json.reservations.map((r: any) => ({
          id: r.id,
          company_id: r.company_id,
          room_id: r.room_id,
          guest_id: r.guest_id,
          check_in_date: r.check_in_date,
          check_out_date: r.check_out_date,
          status: r.status,
          total_amount: Number(r.total_amount),
          paid_amount: Number(r.paid_amount),
          currency: r.currency || 'XOF',
          notes: r.notes,
          created_at: r.created_at,
          room: r.room ? {
            id: r.room.id,
            company_id: r.room.company_id,
            room_number: r.room.room_number,
            category: r.room.category,
            capacity: Number(r.room.capacity),
            price_per_night: Number(r.room.price_per_night),
            currency: r.room.currency || 'XOF',
            status: r.room.status,
          } : undefined,
          guest: r.guest ? {
            id: r.guest.id,
            company_id: r.guest.company_id,
            full_name: r.guest.full_name,
            phone: r.guest.phone,
            email: r.guest.email,
          } : undefined,
        }));
      }
    } catch {
      // Fall through
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const [resResult, roomsList, guestsList] = await Promise.all([
      supabase.from('hotel_reservations').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      getRooms(companyId),
      getGuests(companyId),
    ]);

    if (!resResult.error && resResult.data) {
      const roomMap = new Map(roomsList.map((r) => [r.id, r]));
      const guestMap = new Map(guestsList.map((g) => [g.id, g]));

      return resResult.data.map((r: any) => ({
        id: r.id,
        company_id: r.company_id,
        room_id: r.room_id,
        guest_id: r.guest_id,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        status: r.status,
        total_amount: Number(r.total_amount),
        paid_amount: Number(r.paid_amount),
        currency: r.currency || 'XOF',
        notes: r.notes,
        created_at: r.created_at,
        room: roomMap.get(r.room_id),
        guest: guestMap.get(r.guest_id),
      }));
    }
  }

  if (!isSupabaseConfigured()) {
    // Fallback demo reservation if offline mode
    const rooms = await getRooms(companyId);
    const guests = await getGuests(companyId);

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

    if (rooms.length > 0 && guests.length > 0) {
      return [
        {
          id: 'res-101',
          company_id: companyId,
          room_id: rooms[1]?.id || 'room-102',
          guest_id: guests[0]?.id || 'gst-1',
          check_in_date: today,
          check_out_date: tomorrow,
          status: 'checked_in',
          total_amount: 90000,
          paid_amount: 90000,
          currency: 'XOF',
          notes: 'Payé par Carte Bancaire',
          room: rooms[1],
          guest: guests[0],
        },
        {
          id: 'res-201',
          company_id: companyId,
          room_id: rooms[2]?.id || 'room-201',
          guest_id: guests[1]?.id || 'gst-2',
          check_in_date: today,
          check_out_date: tomorrow,
          status: 'confirmed',
          total_amount: 150000,
          paid_amount: 50000,
          currency: 'XOF',
          notes: 'Acompte 50,000 XOF versé',
          room: rooms[2],
          guest: guests[1],
        },
      ];
    }
  }

  return [];
}

/**
 * Check room availability for date range (helper)
 */
export async function checkRoomAvailability(
  companyIdInput: string,
  roomId: string,
  checkInDate: string,
  checkOutDate: string,
  excludeReservationId?: string
): Promise<{ available: boolean; conflictReason?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    return { available: false, conflictReason: 'Dates de réservation invalides.' };
  }
  if (checkOut <= checkIn) {
    return { available: false, conflictReason: 'La date de départ doit être strictement postérieure à la date d’arrivée.' };
  }

  const [rooms, reservations] = await Promise.all([
    getRooms(companyId),
    getReservations(companyId),
  ]);

  const room = rooms.find((r) => r.id === roomId);
  if (room && room.status === 'maintenance') {
    return { available: false, conflictReason: 'Cette chambre est actuellement en maintenance et ne peut être réservée.' };
  }

  const overlap = reservations.some((r) => {
    if (r.room_id !== roomId) return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    if (r.status !== 'confirmed' && r.status !== 'checked_in') return false;
    return r.check_in_date < checkOutDate && r.check_out_date > checkInDate;
  });

  if (overlap) {
    return {
      available: false,
      conflictReason: 'Cette chambre fait déjà l’objet d’une réservation active pour la période sélectionnée.',
    };
  }

  return { available: true };
}

/**
 * Create a new Reservation with date and overlap validation
 */
export async function createReservation(
  companyIdInput: string,
  reservation: Omit<HotelReservation, 'id' | 'company_id' | 'created_at' | 'room' | 'guest'>
): Promise<{ success: boolean; reservation?: HotelReservation; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  // 1. Validate dates and overlaps
  const availability = await checkRoomAvailability(
    companyId,
    reservation.room_id,
    reservation.check_in_date,
    reservation.check_out_date
  );

  if (!availability.available) {
    return { success: false, error: availability.conflictReason };
  }

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...reservation }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, reservation: json.reservation };
      return { success: false, error: json.error || 'Erreur création réservation' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_reservations')
      .insert({
        company_id: companyId,
        room_id: reservation.room_id,
        guest_id: reservation.guest_id,
        check_in_date: reservation.check_in_date,
        check_out_date: reservation.check_out_date,
        status: reservation.status || 'confirmed',
        total_amount: reservation.total_amount,
        paid_amount: reservation.paid_amount || 0,
        currency: reservation.currency || 'XOF',
        notes: reservation.notes || null,
      })
      .select()
      .single();

    if (!error && data) {
      // 1. Record revenue in shared finance ledger if paid_amount > 0 (idempotent deterministic reference)
      if (reservation.paid_amount > 0) {
        await recordRevenue({
          workspaceId: companyId,
          moduleId: 'hotel-property',
          amount: reservation.paid_amount,
          currency: reservation.currency || 'XOF',
          source: `Acompte Réservation Chambre (${reservation.check_in_date})`,
          reference: `REF-HTL-RES-${data.id}`,
        });
      }

      // 2. Update room status to 'reserved' if confirmed
      if (reservation.status === 'confirmed') {
        await updateRoomStatus(companyId, reservation.room_id, 'reserved');
      }

      return {
        success: true,
        reservation: {
          id: data.id,
          company_id: data.company_id,
          room_id: data.room_id,
          guest_id: data.guest_id,
          check_in_date: data.check_in_date,
          check_out_date: data.check_out_date,
          status: data.status,
          total_amount: Number(data.total_amount),
          paid_amount: Number(data.paid_amount),
          currency: data.currency,
          notes: data.notes,
          created_at: data.created_at,
        },
      };
    }
    if (error) {
      return { success: false, error: error.message };
    }
  }

  // Fallback
  const newId = `res-${Date.now()}`;
  if (reservation.paid_amount > 0) {
    await recordRevenue({
      workspaceId: companyId,
      moduleId: 'hotel-property',
      amount: reservation.paid_amount,
      currency: reservation.currency || 'XOF',
      source: `Acompte Réservation Chambre (${reservation.check_in_date})`,
      reference: `REF-HTL-RES-${newId}`,
    });
  }
  if (reservation.status === 'confirmed') {
    await updateRoomStatus(companyId, reservation.room_id, 'reserved');
  }

  const createdRes: HotelReservation = {
    id: newId,
    company_id: companyId,
    ...reservation,
  };
  return { success: true, reservation: createdRes };
}

/**
 * Check-in Guest (updates reservation to checked_in, room to occupied, records payment in finance)
 */
export async function checkInGuest(
  companyIdInput: string,
  reservationId: string,
  roomId: string,
  paidAmountAdd: number = 0,
  currency: string = 'XOF'
): Promise<{ success: boolean; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/reservations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          reservationId,
          action: 'checkin',
          paymentAmount: paidAmountAdd,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true };
      return { success: false, error: json.error || 'Erreur check-in' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    // 1. Fetch reservation to verify state and get current paid_amount
    const { data: currentRes } = await supabase
      .from('hotel_reservations')
      .select('status, paid_amount')
      .eq('id', reservationId)
      .maybeSingle();

    if (currentRes?.status === 'checked_in') {
      return { success: false, error: 'Ce client est déjà enregistré (déjà checked-in).' };
    }
    if (currentRes?.status === 'checked_out' || currentRes?.status === 'cancelled') {
      return { success: false, error: `Impossible de procéder au check-in pour une réservation au statut "${currentRes.status}".` };
    }

    const newPaidAmount = (currentRes?.paid_amount || 0) + paidAmountAdd;

    // 2. Update reservation status and paid_amount
    const { error: resErr } = await supabase
      .from('hotel_reservations')
      .update({
        status: 'checked_in',
        paid_amount: newPaidAmount,
      })
      .eq('id', reservationId)
      .eq('company_id', companyId);

    if (resErr) return { success: false, error: resErr.message };

    // 3. Update room status to occupied
    await updateRoomStatus(companyId, roomId, 'occupied');

    // 4. Post revenue into shared finance ledger with deterministic idempotent reference
    if (paidAmountAdd > 0) {
      await recordRevenue({
        workspaceId: companyId,
        moduleId: 'hotel-property',
        amount: paidAmountAdd,
        currency,
        source: `Paiement Check-in Réservation #${reservationId.substring(0, 8)}`,
        reference: `REF-HTL-IN-${reservationId}`,
      });
    }

    return { success: true };
  }

  await updateRoomStatus(companyId, roomId, 'occupied');
  if (paidAmountAdd > 0) {
    await recordRevenue({
      workspaceId: companyId,
      moduleId: 'hotel-property',
      amount: paidAmountAdd,
      currency,
      source: `Paiement Check-in Réservation #${reservationId.substring(0, 8)}`,
      reference: `REF-HTL-IN-${reservationId}`,
    });
  }

  return { success: true };
}

/**
 * Check-out Guest (updates reservation to checked_out, room to cleaning/available, records final balance in finance)
 */
export async function checkOutGuest(
  companyIdInput: string,
  reservationId: string,
  roomId: string,
  finalPaymentAdd: number = 0,
  nextRoomStatus: 'cleaning' | 'available' = 'cleaning',
  currency: string = 'XOF'
): Promise<{ success: boolean; error?: string }> {
  const companyId = ensureUuidCompanyId(companyIdInput);

  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/hotel/reservations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          reservationId,
          action: 'checkout',
          paymentAmount: finalPaymentAdd,
          nextStatus: nextRoomStatus,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true };
      return { success: false, error: json.error || 'Erreur check-out' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur réseau' };
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    // 1. Fetch reservation to guard against duplicate checkout
    const { data: currentRes } = await supabase
      .from('hotel_reservations')
      .select('status, paid_amount')
      .eq('id', reservationId)
      .maybeSingle();

    if (currentRes?.status === 'checked_out') {
      return { success: false, error: 'Cette réservation a déjà été clôturée (déjà checked-out).' };
    }

    const newPaidAmount = (currentRes?.paid_amount || 0) + finalPaymentAdd;

    // 2. Update reservation
    const { error: resErr } = await supabase
      .from('hotel_reservations')
      .update({
        status: 'checked_out',
        paid_amount: newPaidAmount,
      })
      .eq('id', reservationId)
      .eq('company_id', companyId);

    if (resErr) return { success: false, error: resErr.message };

    // 3. Update room status to cleaning or available
    await updateRoomStatus(companyId, roomId, nextRoomStatus);

    // 4. Record final payment in shared finance ledger with deterministic idempotent reference
    if (finalPaymentAdd > 0) {
      await recordRevenue({
        workspaceId: companyId,
        moduleId: 'hotel-property',
        amount: finalPaymentAdd,
        currency,
        source: `Règlement Check-out Réservation #${reservationId.substring(0, 8)}`,
        reference: `REF-HTL-OUT-${reservationId}`,
      });
    }

    return { success: true };
  }

  await updateRoomStatus(companyId, roomId, nextRoomStatus);
  if (finalPaymentAdd > 0) {
    await recordRevenue({
      workspaceId: companyId,
      moduleId: 'hotel-property',
      amount: finalPaymentAdd,
      currency,
      source: `Règlement Check-out Réservation #${reservationId.substring(0, 8)}`,
      reference: `REF-HTL-OUT-${reservationId}`,
    });
  }

  return { success: true };
}

/**
 * Fetch Consolidated Hotel Dashboard Metrics
 */
export async function getHotelDashboardMetrics(companyIdInput: string): Promise<HotelDashboardMetrics> {
  const companyId = ensureUuidCompanyId(companyIdInput);
  const [rooms, reservations] = await Promise.all([
    getRooms(companyId),
    getReservations(companyId),
  ]);

  const totalRooms = rooms.length;
  const availableRooms = rooms.filter((r) => r.status === 'available').length;
  const occupiedRooms = rooms.filter((r) => r.status === 'occupied').length;
  const reservedRooms = rooms.filter((r) => r.status === 'reserved').length;
  const cleaningRooms = rooms.filter((r) => r.status === 'cleaning').length;
  const maintenanceRooms = rooms.filter((r) => r.status === 'maintenance').length;

  const todayStr = new Date().toISOString().split('T')[0];

  const todayCheckIns = reservations.filter(
    (r) => r.check_in_date === todayStr || (r.status === 'checked_in' && r.check_in_date <= todayStr)
  ).length;

  const todayCheckOuts = reservations.filter(
    (r) => r.check_out_date === todayStr
  ).length;

  const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

  let totalRevenue = 0;
  let pendingBalance = 0;

  for (const res of reservations) {
    totalRevenue += res.paid_amount;
    const balance = res.total_amount - res.paid_amount;
    if (balance > 0 && res.status !== 'cancelled') {
      pendingBalance += balance;
    }
  }

  return {
    totalRooms,
    availableRooms,
    occupiedRooms,
    reservedRooms,
    cleaningRooms,
    maintenanceRooms,
    todayCheckIns,
    todayCheckOuts,
    occupancyRate,
    totalRevenue,
    pendingBalance,
  };
}

/**
 * ModuleSummary Contract Exporter for Global Dashboard
 */
export async function getHotelSummary(companyIdInput: string): Promise<ModuleSummary> {
  const companyId = ensureUuidCompanyId(companyIdInput);
  const metrics = await getHotelDashboardMetrics(companyId);

  return {
    moduleId: 'hotel-property',
    companyId,
    revenue: metrics.totalRevenue,
    expenses: 0,
    activityCount: metrics.occupiedRooms + metrics.todayCheckIns,
    currency: 'XOF',
    lastUpdated: new Date().toISOString(),
    metrics: [
      {
        id: 'htl-occupancy',
        moduleId: 'hotel-property',
        label: { fr: 'Chambres occupées', en: 'Occupied Rooms' },
        value: `${metrics.occupiedRooms} / ${metrics.totalRooms} (${metrics.occupancyRate}%)`,
      },
      {
        id: 'htl-arrivals',
        moduleId: 'hotel-property',
        label: { fr: 'Arrivées du jour', en: "Today's Check-ins" },
        value: metrics.todayCheckIns,
      },
      {
        id: 'htl-departures',
        moduleId: 'hotel-property',
        label: { fr: 'Départs du jour', en: "Today's Check-outs" },
        value: metrics.todayCheckOuts,
      },
      {
        id: 'htl-pending-balance',
        moduleId: 'hotel-property',
        label: { fr: 'Soldes à encaisser', en: 'Pending Balances' },
        value: metrics.pendingBalance,
        currency: 'XOF',
      },
    ],
  };
}
