import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { isSupabaseConfigured } from './supabase/config';
import { recordRevenue } from './finance';

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

/**
 * Get Supabase Client safely
 */
function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  const client: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
  return client;
}

/**
 * Fetch all Rooms for Company
 */
export async function getRooms(companyId: string): Promise<HotelRoom[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_rooms')
      .select('*')
      .eq('company_id', companyId)
      .order('room_number', { ascending: true });

    if (!error && data && data.length > 0) {
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

  // Initial fallback data mapped to companyId
  return DEFAULT_INITIAL_ROOMS.map((r) => ({
    ...r,
    company_id: companyId,
  }));
}

/**
 * Create a new Room
 */
export async function createRoom(
  companyId: string,
  room: Omit<HotelRoom, 'id' | 'company_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; room?: HotelRoom; error?: string }> {
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
    if (error) {
      return { success: false, error: error.message };
    }
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
  companyId: string,
  roomId: string,
  status: HotelRoom['status']
): Promise<{ success: boolean; error?: string }> {
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
export async function getGuests(companyId: string): Promise<HotelGuest[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from('hotel_guests')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
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

  return DEFAULT_INITIAL_GUESTS.map((g) => ({
    ...g,
    company_id: companyId,
  }));
}

/**
 * Create a new Guest
 */
export async function createGuest(
  companyId: string,
  guest: Omit<HotelGuest, 'id' | 'company_id' | 'created_at'>
): Promise<{ success: boolean; guest?: HotelGuest; error?: string }> {
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
    if (error) {
      return { success: false, error: error.message };
    }
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
export async function getReservations(companyId: string): Promise<HotelReservation[]> {
  const supabase = getSupabase();
  if (supabase) {
    const [resResult, roomsList, guestsList] = await Promise.all([
      supabase.from('hotel_reservations').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      getRooms(companyId),
      getGuests(companyId),
    ]);

    if (!resResult.error && resResult.data && resResult.data.length > 0) {
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

  // Fallback demo reservation if database empty
  const rooms = await getRooms(companyId);
  const guests = await getGuests(companyId);

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

  if (rooms.length > 0 && guests.length > 0) {
    return [
      {
        id: 'res-101',
        company_id: companyId,
        room_id: rooms[1].id,
        guest_id: guests[0].id,
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
        room_id: rooms[2].id,
        guest_id: guests[1].id,
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

  return [];
}

/**
 * Create a new Reservation
 */
export async function createReservation(
  companyId: string,
  reservation: Omit<HotelReservation, 'id' | 'company_id' | 'created_at' | 'room' | 'guest'>
): Promise<{ success: boolean; reservation?: HotelReservation; error?: string }> {
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
      // 1. Record revenue in shared finance ledger if paid_amount > 0
      if (reservation.paid_amount > 0) {
        await recordRevenue({
          workspaceId: companyId,
          moduleId: 'hotel-property',
          amount: reservation.paid_amount,
          currency: reservation.currency || 'XOF',
          source: `Acompte Réservation Chambre (${reservation.check_in_date})`,
          reference: `REF-HTL-RES-${data.id.substring(0, 8)}`,
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
  companyId: string,
  reservationId: string,
  roomId: string,
  paidAmountAdd: number = 0,
  currency: string = 'XOF'
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (supabase) {
    // 1. Fetch reservation to get current paid_amount
    const { data: currentRes } = await supabase
      .from('hotel_reservations')
      .select('paid_amount')
      .eq('id', reservationId)
      .maybeSingle();

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

    // 4. Post revenue into shared finance ledger if additional payment received
    if (paidAmountAdd > 0) {
      await recordRevenue({
        workspaceId: companyId,
        moduleId: 'hotel-property',
        amount: paidAmountAdd,
        currency,
        source: `Paiement Check-in Réservation #${reservationId.substring(0, 8)}`,
        reference: `REF-HTL-IN-${reservationId.substring(0, 8)}-${Date.now().toString(36)}`,
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
      reference: `REF-HTL-IN-${reservationId.substring(0, 8)}`,
    });
  }

  return { success: true };
}

/**
 * Check-out Guest (updates reservation to checked_out, room to cleaning/available, records final balance in finance)
 */
export async function checkOutGuest(
  companyId: string,
  reservationId: string,
  roomId: string,
  finalPaymentAdd: number = 0,
  nextRoomStatus: 'cleaning' | 'available' = 'cleaning',
  currency: string = 'XOF'
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (supabase) {
    // 1. Fetch reservation
    const { data: currentRes } = await supabase
      .from('hotel_reservations')
      .select('paid_amount')
      .eq('id', reservationId)
      .maybeSingle();

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

    // 4. Record final payment in shared finance ledger
    if (finalPaymentAdd > 0) {
      await recordRevenue({
        workspaceId: companyId,
        moduleId: 'hotel-property',
        amount: finalPaymentAdd,
        currency,
        source: `Règlement Solde Check-out Réservation #${reservationId.substring(0, 8)}`,
        reference: `REF-HTL-OUT-${reservationId.substring(0, 8)}-${Date.now().toString(36)}`,
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
      source: `Règlement Solde Check-out Réservation #${reservationId.substring(0, 8)}`,
      reference: `REF-HTL-OUT-${reservationId.substring(0, 8)}`,
    });
  }

  return { success: true };
}

/**
 * Fetch Consolidated Hotel Dashboard Metrics
 */
export async function getHotelDashboardMetrics(companyId: string): Promise<HotelDashboardMetrics> {
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
