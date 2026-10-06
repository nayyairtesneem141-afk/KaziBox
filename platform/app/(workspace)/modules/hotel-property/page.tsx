'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, Button, Badge, Modal, Input, Select } from '@kazibox/ui';
import { useTranslation, localize } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { RequireAccess } from '../../components/RequireAccess';
import {
  getRooms,
  createRoom,
  updateRoomStatus,
  getGuests,
  createGuest,
  getReservations,
  createReservation,
  checkInGuest,
  checkOutGuest,
  getHotelDashboardMetrics,
  HotelRoom,
  HotelGuest,
  HotelReservation,
  HotelDashboardMetrics,
} from '@/lib/hotel';

export default function HotelModulePage() {
  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const companyId = workspace?.id || '11111111-1111-4111-8111-111111111111';
  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  // Active sub-view tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rooms' | 'reservations' | 'guests' | 'reports'>('dashboard');

  // Backend state
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [guests, setGuests] = useState<HotelGuest[]>([]);
  const [reservations, setReservations] = useState<HotelReservation[]>([]);
  const [metrics, setMetrics] = useState<HotelDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filters
  const [roomStatusFilter, setRoomStatusFilter] = useState<string>('all');
  const [resStatusFilter, setResStatusFilter] = useState<string>('all');
  const [guestSearch, setGuestSearch] = useState<string>('');

  // Modals state
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [isAddGuestOpen, setIsAddGuestOpen] = useState(false);
  const [isAddResOpen, setIsAddResOpen] = useState(false);
  const [selectedResForCheckIn, setSelectedResForCheckIn] = useState<HotelReservation | null>(null);
  const [selectedResForCheckOut, setSelectedResForCheckOut] = useState<HotelReservation | null>(null);

  // New Room form state
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState<'Standard' | 'Deluxe' | 'Suite' | 'Executive' | 'Family'>('Standard');
  const [newRoomCapacity, setNewRoomCapacity] = useState('2');
  const [newRoomPrice, setNewRoomPrice] = useState('45000');
  const [newRoomNotes, setNewRoomNotes] = useState('');

  // New Guest form state
  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestPhone, setNewGuestPhone] = useState('');
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [newGuestIdNumber, setNewGuestIdNumber] = useState('');
  const [newGuestNationality, setNewGuestNationality] = useState('');

  // New Reservation form state
  const [newResGuestId, setNewResGuestId] = useState('');
  const [newResRoomId, setNewResRoomId] = useState('');
  const [newResCheckIn, setNewResCheckIn] = useState(() => new Date().toISOString().split('T')[0]);
  const [newResCheckOut, setNewResCheckOut] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [newResDeposit, setNewResDeposit] = useState('0');
  const [newResNotes, setNewResNotes] = useState('');

  // Check-in payment collection form state
  const [checkInPayment, setCheckInPayment] = useState('0');

  // Check-out payment settlement form state
  const [checkOutPayment, setCheckOutPayment] = useState('0');
  const [checkOutNextStatus, setCheckOutNextStatus] = useState<'cleaning' | 'available'>('cleaning');

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Load backend data from real Supabase tables
  const loadData = async () => {
    setLoading(true);
    try {
      const [rData, gData, resData, mData] = await Promise.all([
        getRooms(companyId),
        getGuests(companyId),
        getReservations(companyId),
        getHotelDashboardMetrics(companyId),
      ]);
      setRooms(rData);
      setGuests(gData);
      setReservations(resData);
      setMetrics(mData);
    } catch (err) {
      showToast('error', 'Erreur lors du chargement des données Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [companyId]);

  // Calculated auto price for reservation creation
  const calculatedTotalAmount = useMemo(() => {
    const selectedRoom = rooms.find((r) => r.id === newResRoomId);
    if (!selectedRoom || !newResCheckIn || !newResCheckOut) return 0;
    const start = new Date(newResCheckIn).getTime();
    const end = new Date(newResCheckOut).getTime();
    const diffDays = Math.max(1, Math.ceil((end - start) / (1000 * 3600 * 24)));
    return diffDays * selectedRoom.price_per_night;
  }, [rooms, newResRoomId, newResCheckIn, newResCheckOut]);

  // Handlers for creating Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomNumber.trim()) {
      showToast('error', 'Veuillez saisir le numéro de chambre.');
      return;
    }
    const res = await createRoom(companyId, {
      room_number: newRoomNumber.trim(),
      category: newRoomCategory,
      capacity: parseInt(newRoomCapacity) || 2,
      price_per_night: parseFloat(newRoomPrice) || 0,
      currency: 'XOF',
      status: 'available',
      notes: newRoomNotes,
    });
    if (res.success) {
      showToast('success', `Chambre #${newRoomNumber} ajoutée avec succès.`);
      setIsAddRoomOpen(false);
      setNewRoomNumber('');
      setNewRoomNotes('');
      loadData();
    } else {
      showToast('error', res.error || "Impossible d'ajouter la chambre.");
    }
  };

  // Handlers for creating Guest
  const handleCreateGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGuestName.trim()) {
      showToast('error', 'Veuillez saisir le nom du client.');
      return;
    }
    const res = await createGuest(companyId, {
      full_name: newGuestName.trim(),
      phone: newGuestPhone,
      email: newGuestEmail,
      id_number: newGuestIdNumber,
      nationality: newGuestNationality,
    });
    if (res.success) {
      showToast('success', `Client ${newGuestName} enregistré avec succès.`);
      setIsAddGuestOpen(false);
      setNewGuestName('');
      setNewGuestPhone('');
      setNewGuestEmail('');
      setNewGuestIdNumber('');
      setNewGuestNationality('');
      loadData();
    } else {
      showToast('error', res.error || "Impossible d'enregistrer le client.");
    }
  };

  // Handlers for creating Reservation
  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResGuestId || !newResRoomId) {
      showToast('error', 'Veuillez sélectionner un client et une chambre.');
      return;
    }
    const deposit = parseFloat(newResDeposit) || 0;
    const res = await createReservation(companyId, {
      guest_id: newResGuestId,
      room_id: newResRoomId,
      check_in_date: newResCheckIn,
      check_out_date: newResCheckOut,
      status: 'confirmed',
      total_amount: calculatedTotalAmount,
      paid_amount: deposit,
      currency: 'XOF',
      notes: newResNotes,
    });

    if (res.success) {
      showToast('success', 'Réservation créée avec succès ! Acompte enregistré.');
      setIsAddResOpen(false);
      setNewResGuestId('');
      setNewResRoomId('');
      setNewResDeposit('0');
      setNewResNotes('');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur lors de la création de la réservation.');
    }
  };

  // Quick Room Status change
  const handleRoomStatusChange = async (roomId: string, newStatus: HotelRoom['status']) => {
    const res = await updateRoomStatus(companyId, roomId, newStatus);
    if (res.success) {
      showToast('success', 'Statut de la chambre mis à jour.');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur de mise à jour.');
    }
  };

  // Execute Check-in
  const handleConfirmCheckIn = async () => {
    if (!selectedResForCheckIn) return;
    const payment = parseFloat(checkInPayment) || 0;
    const res = await checkInGuest(
      companyId,
      selectedResForCheckIn.id,
      selectedResForCheckIn.room_id,
      payment,
      selectedResForCheckIn.currency
    );
    if (res.success) {
      showToast('success', `Check-in effectué pour la chambre #${selectedResForCheckIn.room?.room_number || ''}`);
      setSelectedResForCheckIn(null);
      setCheckInPayment('0');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur lors du check-in.');
    }
  };

  // Execute Check-out
  const handleConfirmCheckOut = async () => {
    if (!selectedResForCheckOut) return;
    const payment = parseFloat(checkOutPayment) || 0;
    const res = await checkOutGuest(
      companyId,
      selectedResForCheckOut.id,
      selectedResForCheckOut.room_id,
      payment,
      checkOutNextStatus,
      selectedResForCheckOut.currency
    );
    if (res.success) {
      showToast('success', `Check-out finalisé. Solde enregistré dans la comptabilité KaziBox.`);
      setSelectedResForCheckOut(null);
      setCheckOutPayment('0');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur lors du check-out.');
    }
  };

  // Room status badge helper
  const renderRoomBadge = (status: HotelRoom['status']) => {
    switch (status) {
      case 'available':
        return <Badge variant="green">🟢 Disponible</Badge>;
      case 'occupied':
        return <Badge variant="purple">🔵 Occupée</Badge>;
      case 'reserved':
        return <Badge variant="purple">🟣 Réservée</Badge>;
      case 'cleaning':
        return <Badge variant="yellow">🟡 Ménage</Badge>;
      case 'maintenance':
        return <Badge variant="red">🔴 Maintenance</Badge>;
      default:
        return <Badge variant="gray">{status}</Badge>;
    }
  };

  // Reservation status badge helper
  const renderResBadge = (status: HotelReservation['status']) => {
    switch (status) {
      case 'confirmed':
        return <Badge variant="purple">Confirmée</Badge>;
      case 'checked_in':
        return <Badge variant="purple">En séjour (Checked-in)</Badge>;
      case 'checked_out':
        return <Badge variant="green">Terminée (Checked-out)</Badge>;
      case 'cancelled':
        return <Badge variant="red">Annulée</Badge>;
      default:
        return <Badge variant="gray">{status}</Badge>;
    }
  };

  // Filtering lists
  const filteredRooms = useMemo(() => {
    if (roomStatusFilter === 'all') return rooms;
    return rooms.filter((r) => r.status === roomStatusFilter);
  }, [rooms, roomStatusFilter]);

  const filteredReservations = useMemo(() => {
    if (resStatusFilter === 'all') return reservations;
    return reservations.filter((r) => r.status === resStatusFilter);
  }, [reservations, resStatusFilter]);

  const filteredGuests = useMemo(() => {
    if (!guestSearch.trim()) return guests;
    const q = guestSearch.toLowerCase();
    return guests.filter(
      (g) =>
        g.full_name.toLowerCase().includes(q) ||
        (g.phone && g.phone.toLowerCase().includes(q)) ||
        (g.id_number && g.id_number.toLowerCase().includes(q))
    );
  }, [guests, guestSearch]);

  if (loading && !metrics) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#6D28D9] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <RequireAccess moduleId="hotel-property">
      <div className="space-y-6">
        {/* Toast Alert */}
        {notification && (
          <div
            className={`fixed top-5 right-5 z-50 p-4 rounded-xl shadow-xl border text-sm font-semibold flex items-center gap-3 animate-in slide-in-from-top-4 duration-200 ${
              notification.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <span>{notification.type === 'success' ? '✅' : '❌'}</span>
            <span>{notification.message}</span>
          </div>
        )}

        {/* Header Banner */}
        <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#E5E7EB] pb-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-100 text-[#6D28D9] flex items-center justify-center text-3xl shadow-sm">
                🏨
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-[#1F2937]">Gestion Hôtelière</h1>
                  <Badge variant="purple" size="sm">
                    v1.2.0
                  </Badge>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#6D28D9]" />
                </div>
                <p className="text-sm text-[#6B7280] mt-0.5">
                  Gestion intégrée des chambres, résidents, réservations et revenus hôteliers KaziBox.
                </p>
              </div>
            </div>

            {/* Centralized Billing Links */}
            <div className="flex items-center flex-wrap gap-2">
              {isOwner && (
                <>
                  <Link href="/billing">
                    <Button variant="outline" size="sm">
                      💳 {t('billing.my_subscription')}
                    </Button>
                  </Link>
                  <Link href="/billing?action=renew&module=hotel-property">
                    <Button variant="outline" size="sm">
                      🔄 {t('billing.renew_subscription')}
                    </Button>
                  </Link>
                </>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsAddResOpen(true)}
                className="bg-[#6D28D9] hover:bg-[#5B21B6]"
              >
                ➕ Nouvelle Réservation
              </Button>
            </div>
          </div>

          {/* Module Inner Tab Bar */}
          <div className="flex items-center gap-2 pt-4 overflow-x-auto">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                activeTab === 'dashboard'
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]'
              }`}
            >
              📊 Tableau de bord
            </button>
            <button
              onClick={() => setActiveTab('rooms')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                activeTab === 'rooms'
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]'
              }`}
            >
              🛏️ Chambres ({rooms.length})
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                activeTab === 'reservations'
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]'
              }`}
            >
              📅 Réservations ({reservations.length})
            </button>
            <button
              onClick={() => setActiveTab('guests')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                activeTab === 'guests'
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]'
              }`}
            >
              👥 Clients ({guests.length})
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                activeTab === 'reports'
                  ? 'bg-[#6D28D9] text-white shadow-sm'
                  : 'bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]'
              }`}
            >
              📈 Rapports & Comptabilité
            </button>
          </div>
        </div>

        {/* 1. DASHBOARD TAB */}
        {activeTab === 'dashboard' && metrics && (
          <div className="space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <div className="p-4 bg-white rounded-2xl border border-[#E5E7EB] text-center shadow-sm">
                <span className="text-xs text-[#6B7280] font-medium block">Total Chambres</span>
                <span className="text-2xl font-black text-[#1F2937] mt-1 block">{metrics.totalRooms}</span>
              </div>
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-center shadow-sm">
                <span className="text-xs text-emerald-700 font-medium block">Disponibles</span>
                <span className="text-2xl font-black text-emerald-800 mt-1 block">{metrics.availableRooms}</span>
              </div>
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200 text-center shadow-sm">
                <span className="text-xs text-blue-700 font-medium block">Occupées</span>
                <span className="text-2xl font-black text-blue-800 mt-1 block">{metrics.occupiedRooms}</span>
              </div>
              <div className="p-4 bg-purple-50 rounded-2xl border border-purple-200 text-center shadow-sm">
                <span className="text-xs text-purple-700 font-medium block">Réservées</span>
                <span className="text-2xl font-black text-purple-800 mt-1 block">{metrics.reservedRooms}</span>
              </div>
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-center shadow-sm">
                <span className="text-xs text-amber-700 font-medium block">Ménage</span>
                <span className="text-2xl font-black text-amber-800 mt-1 block">{metrics.cleaningRooms}</span>
              </div>
              <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200 text-center shadow-sm">
                <span className="text-xs text-rose-700 font-medium block">Maintenance</span>
                <span className="text-2xl font-black text-rose-800 mt-1 block">{metrics.maintenanceRooms}</span>
              </div>
              <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-200 text-center shadow-sm">
                <span className="text-xs text-indigo-700 font-medium block">Check-ins Jour</span>
                <span className="text-2xl font-black text-indigo-800 mt-1 block">{metrics.todayCheckIns}</span>
              </div>
              <div className="p-4 bg-teal-50 rounded-2xl border border-teal-200 text-center shadow-sm">
                <span className="text-xs text-teal-700 font-medium block">Check-outs Jour</span>
                <span className="text-2xl font-black text-teal-800 mt-1 block">{metrics.todayCheckOuts}</span>
              </div>
            </div>

            {/* Performance Summary Banner */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card padding="md" className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-black">
                  📊
                </div>
                <div>
                  <span className="text-xs text-[#6B7280] uppercase font-bold tracking-wider">Taux d'occupation</span>
                  <div className="text-2xl font-black text-[#1F2937]">{metrics.occupancyRate}%</div>
                  <div className="w-full bg-[#E5E7EB] rounded-full h-2 mt-2 w-48">
                    <div
                      className="bg-emerald-600 h-2 rounded-full transition-all"
                      style={{ width: `${metrics.occupancyRate}%` }}
                    />
                  </div>
                </div>
              </Card>

              <Card padding="md" className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 text-[#6D28D9] flex items-center justify-center text-2xl font-black">
                  💰
                </div>
                <div>
                  <span className="text-xs text-[#6B7280] uppercase font-bold tracking-wider">Recettes Hôtelières</span>
                  <div className="text-2xl font-black text-[#1F2937]">
                    {metrics.totalRevenue.toLocaleString()} XOF
                  </div>
                  <span className="text-xs text-emerald-600 font-semibold mt-1 inline-block">
                    ✓ Directement synchronisé avec le livre terrier KaziBox
                  </span>
                </div>
              </Card>

              <Card padding="md" className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-2xl font-black">
                  ⏳
                </div>
                <div>
                  <span className="text-xs text-[#6B7280] uppercase font-bold tracking-wider">Soldes à encaisser</span>
                  <div className="text-2xl font-black text-[#1F2937]">
                    {metrics.pendingBalance.toLocaleString()} XOF
                  </div>
                  <span className="text-xs text-[#6B7280]">Paiements en attente de check-out</span>
                </div>
              </Card>
            </div>

            {/* Quick Actions Panel & Active Reservations */}
            <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#1F2937]">Séjours et Arrivées Récentes</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setIsAddRoomOpen(true)}>
                    ➕ Ajouter Chambre
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setIsAddGuestOpen(true)}>
                    👤 Enregistrer Client
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#374151]">
                  <thead className="bg-[#F9FAFB] text-[#6B7280] uppercase font-bold border-b border-[#E5E7EB]">
                    <tr>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Chambre</th>
                      <th className="py-3 px-4">Dates</th>
                      <th className="py-3 px-4">Montant Total</th>
                      <th className="py-3 px-4">Payé</th>
                      <th className="py-3 px-4">Statut</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {reservations.slice(0, 6).map((res) => (
                      <tr key={res.id} className="hover:bg-[#F9FAFB]">
                        <td className="py-3 px-4 font-bold text-[#1F2937]">
                          {res.guest?.full_name || 'Client inconnu'}
                          {res.guest?.phone && <span className="block text-[11px] text-[#6B7280] font-normal">{res.guest.phone}</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-extrabold text-[#1F2937]">#{res.room?.room_number || '-'}</span>
                          <span className="block text-[11px] text-[#6B7280]">{res.room?.category}</span>
                        </td>
                        <td className="py-3 px-4">
                          {res.check_in_date} &rarr; {res.check_out_date}
                        </td>
                        <td className="py-3 px-4 font-bold">{res.total_amount.toLocaleString()} XOF</td>
                        <td className="py-3 px-4 font-bold text-emerald-600">{res.paid_amount.toLocaleString()} XOF</td>
                        <td className="py-3 px-4">{renderResBadge(res.status)}</td>
                        <td className="py-3 px-4 text-right space-x-2">
                          {res.status === 'confirmed' && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setSelectedResForCheckIn(res)}
                              className="bg-indigo-600 hover:bg-indigo-700"
                            >
                              🔑 Check-in
                            </Button>
                          )}
                          {res.status === 'checked_in' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedResForCheckOut(res)}
                              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                            >
                              🚪 Check-out
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. ROOMS TAB */}
        {activeTab === 'rooms' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#E5E7EB]">
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-xs font-bold text-[#6B7280] uppercase mr-2">Filtrer par statut:</span>
                {['all', 'available', 'occupied', 'reserved', 'cleaning', 'maintenance'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setRoomStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                      roomStatusFilter === st
                        ? 'bg-[#6D28D9] text-white border-[#6D28D9]'
                        : 'bg-[#F9FAFB] text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    {st === 'all'
                      ? 'Tous'
                      : st === 'available'
                      ? 'Disponibles'
                      : st === 'occupied'
                      ? 'Occupées'
                      : st === 'reserved'
                      ? 'Réservées'
                      : st === 'cleaning'
                      ? 'Ménage'
                      : 'Maintenance'}
                  </button>
                ))}
              </div>

              <Button variant="primary" size="sm" onClick={() => setIsAddRoomOpen(true)} className="bg-[#6D28D9]">
                ➕ Ajouter une Chambre
              </Button>
            </div>

            {/* Room Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-white rounded-2xl p-5 border border-[#E5E7EB] shadow-sm hover:shadow-md transition-shadow space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-2xl font-black text-[#1F2937]">#{room.room_number}</span>
                      <span className="block text-xs font-semibold text-[#6B7280]">{room.category}</span>
                    </div>
                    {renderRoomBadge(room.status)}
                  </div>

                  <div className="space-y-1 text-xs text-[#4B5563]">
                    <div className="flex justify-between">
                      <span className="text-[#9CA3AF]">Capacité:</span>
                      <span className="font-bold">{room.capacity} Personnes</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#9CA3AF]">Tarif / nuit:</span>
                      <span className="font-extrabold text-[#6D28D9]">{room.price_per_night.toLocaleString()} XOF</span>
                    </div>
                    {room.notes && <div className="text-[11px] text-[#6B7280] italic mt-1">{room.notes}</div>}
                  </div>

                  {/* Quick Status Updater */}
                  <div className="pt-2 border-t border-[#E5E7EB]">
                    <label className="text-[10px] uppercase font-bold text-[#9CA3AF] block mb-1">
                      Changer le statut :
                    </label>
                    <select
                      value={room.status}
                      onChange={(e) => handleRoomStatusChange(room.id, e.target.value as any)}
                      className="w-full text-xs font-semibold p-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]"
                    >
                      <option value="available">🟢 Disponible</option>
                      <option value="occupied">🔵 Occupée</option>
                      <option value="reserved">🟣 Réservée</option>
                      <option value="cleaning">🟡 Ménage en cours</option>
                      <option value="maintenance">🔴 En maintenance</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. RESERVATIONS TAB */}
        {activeTab === 'reservations' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#E5E7EB]">
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-xs font-bold text-[#6B7280] uppercase mr-2">Filtrer par statut:</span>
                {['all', 'confirmed', 'checked_in', 'checked_out', 'cancelled'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setResStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                      resStatusFilter === st
                        ? 'bg-[#6D28D9] text-white border-[#6D28D9]'
                        : 'bg-[#F9FAFB] text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    {st === 'all'
                      ? 'Toutes'
                      : st === 'confirmed'
                      ? 'Confirmées'
                      : st === 'checked_in'
                      ? 'Checked-in'
                      : st === 'checked_out'
                      ? 'Checked-out'
                      : 'Annulées'}
                  </button>
                ))}
              </div>

              <Button variant="primary" size="sm" onClick={() => setIsAddResOpen(true)} className="bg-[#6D28D9]">
                ➕ Nouvelle Réservation
              </Button>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs text-[#374151]">
                <thead className="bg-[#F9FAFB] text-[#6B7280] uppercase font-bold border-b border-[#E5E7EB]">
                  <tr>
                    <th className="py-3 px-4">Réservation ID</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Chambre</th>
                    <th className="py-3 px-4">Dates</th>
                    <th className="py-3 px-4">Montant Total</th>
                    <th className="py-3 px-4">Payé</th>
                    <th className="py-3 px-4">Solde Dû</th>
                    <th className="py-3 px-4">Statut</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {filteredReservations.map((res) => {
                    const balance = res.total_amount - res.paid_amount;
                    return (
                      <tr key={res.id} className="hover:bg-[#F9FAFB]">
                        <td className="py-3 px-4 font-mono font-bold text-[#6B7280]">
                          #{res.id.substring(0, 8)}
                        </td>
                        <td className="py-3 px-4 font-bold text-[#1F2937]">
                          {res.guest?.full_name || 'Client inconnu'}
                          {res.guest?.phone && (
                            <span className="block text-[11px] text-[#6B7280] font-normal">{res.guest.phone}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-extrabold text-[#1F2937]">#{res.room?.room_number || '-'}</span>
                        </td>
                        <td className="py-3 px-4">
                          {res.check_in_date} &rarr; {res.check_out_date}
                        </td>
                        <td className="py-3 px-4 font-bold">{res.total_amount.toLocaleString()} XOF</td>
                        <td className="py-3 px-4 font-bold text-emerald-600">{res.paid_amount.toLocaleString()} XOF</td>
                        <td className="py-3 px-4 font-bold text-rose-600">
                          {balance > 0 ? `${balance.toLocaleString()} XOF` : 'SDE (Réglé)'}
                        </td>
                        <td className="py-3 px-4">{renderResBadge(res.status)}</td>
                        <td className="py-3 px-4 text-right space-x-2">
                          {res.status === 'confirmed' && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setSelectedResForCheckIn(res)}
                              className="bg-indigo-600 hover:bg-indigo-700"
                            >
                              🔑 Check-in
                            </Button>
                          )}
                          {res.status === 'checked_in' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedResForCheckOut(res)}
                              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                            >
                              🚪 Check-out
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. GUESTS TAB */}
        {activeTab === 'guests' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#E5E7EB]">
              <div className="w-full sm:w-72">
                <Input
                  type="text"
                  placeholder="Rechercher par nom, tél, pièce..."
                  value={guestSearch}
                  onChange={(e) => setGuestSearch(e.target.value)}
                />
              </div>
              <Button variant="primary" size="sm" onClick={() => setIsAddGuestOpen(true)} className="bg-[#6D28D9]">
                👤 Enregistrer un Nouveau Client
              </Button>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs text-[#374151]">
                <thead className="bg-[#F9FAFB] text-[#6B7280] uppercase font-bold border-b border-[#E5E7EB]">
                  <tr>
                    <th className="py-3 px-4">Nom Complet</th>
                    <th className="py-3 px-4">Téléphone</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">N° Pièce / Passeport</th>
                    <th className="py-3 px-4">Nationalité</th>
                    <th className="py-3 px-4">Date Inscription</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {filteredGuests.map((g) => (
                    <tr key={g.id} className="hover:bg-[#F9FAFB]">
                      <td className="py-3 px-4 font-bold text-[#1F2937] flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-[#6D28D9] flex items-center justify-center font-bold">
                          {g.full_name.charAt(0)}
                        </div>
                        {g.full_name}
                      </td>
                      <td className="py-3 px-4 font-mono">{g.phone || '-'}</td>
                      <td className="py-3 px-4">{g.email || '-'}</td>
                      <td className="py-3 px-4 font-mono font-bold text-[#4B5563]">{g.id_number || '-'}</td>
                      <td className="py-3 px-4">{g.nationality || '-'}</td>
                      <td className="py-3 px-4 text-[#9CA3AF]">
                        {g.created_at ? new Date(g.created_at).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. REPORTS & FINANCE TAB */}
        {activeTab === 'reports' && metrics && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-bold text-[#1F2937]">Rapport de Performance Hôtelière</h3>
                <p className="text-xs text-[#6B7280]">
                  Synthèse d'activité hôtelière et écriture comptable synchronisée dans la comptabilité KaziBox.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card padding="md" className="space-y-3">
                  <h4 className="text-sm font-bold text-[#1F2937]">📊 Ventilation par statut de chambre</h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-[#4B5563]">Disponibles ({metrics.availableRooms})</span>
                      <span className="font-bold text-emerald-600">
                        {metrics.totalRooms > 0 ? Math.round((metrics.availableRooms / metrics.totalRooms) * 100) : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#4B5563]">Occupées ({metrics.occupiedRooms})</span>
                      <span className="font-bold text-blue-600">
                        {metrics.totalRooms > 0 ? Math.round((metrics.occupiedRooms / metrics.totalRooms) * 100) : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#4B5563]">Réservées ({metrics.reservedRooms})</span>
                      <span className="font-bold text-purple-600">
                        {metrics.totalRooms > 0 ? Math.round((metrics.reservedRooms / metrics.totalRooms) * 100) : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#4B5563]">Ménage / Maintenance ({metrics.cleaningRooms + metrics.maintenanceRooms})</span>
                      <span className="font-bold text-amber-600">
                        {metrics.totalRooms > 0 ? Math.round(((metrics.cleaningRooms + metrics.maintenanceRooms) / metrics.totalRooms) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                </Card>

                <Card padding="md" className="space-y-3">
                  <h4 className="text-sm font-bold text-[#1F2937]">🔗 Intégration comptable KaziBox Shared Finance</h4>
                  <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 text-xs text-purple-900 space-y-1">
                    <div className="font-bold">Statut du grand livre hôtelier:</div>
                    <p>
                      Tous les acomptes de réservation, paiements au check-in et règlements de solde au check-out créent automatiquement une écriture comptable de type <code className="bg-purple-100 px-1 py-0.5 rounded">revenue</code> sous l'identifiant <code className="bg-purple-100 px-1 py-0.5 rounded">hotel-property</code> dans le grand livre partagé KaziBox.
                    </p>
                  </div>
                  <div className="pt-2">
                    <Link href="/finance">
                      <Button variant="outline" size="sm">
                        Voir le Grand Livre Partagé &rarr;
                      </Button>
                    </Link>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: ADD ROOM */}
        <Modal isOpen={isAddRoomOpen} onClose={() => setIsAddRoomOpen(false)} title="➕ Ajouter une nouvelle chambre">
          <form onSubmit={handleCreateRoom} className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-[#374151] block mb-1">Numéro de chambre / Bungalow *</label>
              <Input
                type="text"
                placeholder="Ex: 104, 201-B..."
                value={newRoomNumber}
                onChange={(e) => setNewRoomNumber(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#374151] block mb-1">Catégorie</label>
                <select
                  value={newRoomCategory}
                  onChange={(e) => setNewRoomCategory(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium"
                >
                  <option value="Standard">Standard</option>
                  <option value="Deluxe">Deluxe</option>
                  <option value="Suite">Suite</option>
                  <option value="Executive">Executive</option>
                  <option value="Family">Family</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-[#374151] block mb-1">Capacité (personnes)</label>
                <Input
                  type="number"
                  value={newRoomCapacity}
                  onChange={(e) => setNewRoomCapacity(e.target.value)}
                  min="1"
                />
              </div>
            </div>
            <div>
              <label className="font-bold text-[#374151] block mb-1">Prix par nuit (XOF) *</label>
              <Input
                type="number"
                value={newRoomPrice}
                onChange={(e) => setNewRoomPrice(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="font-bold text-[#374151] block mb-1">Notes / Description</label>
              <Input
                type="text"
                placeholder="Ex: Vue mer, grand balcon..."
                value={newRoomNotes}
                onChange={(e) => setNewRoomNotes(e.target.value)}
              />
            </div>
            <div className="pt-4 flex justify-end gap-2 border-t border-[#E5E7EB]">
              <Button type="button" variant="outline" onClick={() => setIsAddRoomOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" className="bg-[#6D28D9]">
                Enregistrer la chambre
              </Button>
            </div>
          </form>
        </Modal>

        {/* MODAL: ADD GUEST */}
        <Modal isOpen={isAddGuestOpen} onClose={() => setIsAddGuestOpen(false)} title="👤 Enregistrer un nouveau client">
          <form onSubmit={handleCreateGuest} className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-[#374151] block mb-1">Nom complet du client *</label>
              <Input
                type="text"
                placeholder="Ex: Kouassi Jean-Marc"
                value={newGuestName}
                onChange={(e) => setNewGuestName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#374151] block mb-1">Téléphone</label>
                <Input
                  type="text"
                  placeholder="+225 07..."
                  value={newGuestPhone}
                  onChange={(e) => setNewGuestPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="font-bold text-[#374151] block mb-1">Email</label>
                <Input
                  type="email"
                  placeholder="client@email.com"
                  value={newGuestEmail}
                  onChange={(e) => setNewGuestEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#374151] block mb-1">N° Pièce d'identité / Passeport</label>
                <Input
                  type="text"
                  placeholder="CI-998822"
                  value={newGuestIdNumber}
                  onChange={(e) => setNewGuestIdNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="font-bold text-[#374151] block mb-1">Nationalité</label>
                <Input
                  type="text"
                  placeholder="Ivoirienne, Sénégalaise..."
                  value={newGuestNationality}
                  onChange={(e) => setNewGuestNationality(e.target.value)}
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end gap-2 border-t border-[#E5E7EB]">
              <Button type="button" variant="outline" onClick={() => setIsAddGuestOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" className="bg-[#6D28D9]">
                Créer la fiche client
              </Button>
            </div>
          </form>
        </Modal>

        {/* MODAL: NEW RESERVATION */}
        <Modal isOpen={isAddResOpen} onClose={() => setIsAddResOpen(false)} title="📅 Créer une nouvelle réservation">
          <form onSubmit={handleCreateReservation} className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-[#374151] block mb-1">Sélectionner le Client *</label>
              <select
                value={newResGuestId}
                onChange={(e) => setNewResGuestId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium"
                required
              >
                <option value="">-- Choisir un client --</option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.full_name} ({g.phone || 'Pas de tél'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-[#374151] block mb-1">Sélectionner la Chambre *</label>
              <select
                value={newResRoomId}
                onChange={(e) => setNewResRoomId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium"
                required
              >
                <option value="">-- Choisir une chambre --</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Chambre #{r.room_number} - {r.category} ({r.price_per_night.toLocaleString()} XOF/nuit) - [{r.status}]
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#374151] block mb-1">Date de Check-in *</label>
                <Input
                  type="date"
                  value={newResCheckIn}
                  onChange={(e) => setNewResCheckIn(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="font-bold text-[#374151] block mb-1">Date de Check-out *</label>
                <Input
                  type="date"
                  value={newResCheckOut}
                  onChange={(e) => setNewResCheckOut(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 flex justify-between items-center">
              <div>
                <span className="text-[#6D28D9] font-bold block">Montant Total Estimé:</span>
                <span className="text-[#6B7280]">Calculé sur la durée du séjour</span>
              </div>
              <span className="text-lg font-black text-[#6D28D9]">
                {calculatedTotalAmount.toLocaleString()} XOF
              </span>
            </div>

            <div>
              <label className="font-bold text-[#374151] block mb-1">Acompte Versé au moment de la réservation (XOF)</label>
              <Input
                type="number"
                value={newResDeposit}
                onChange={(e) => setNewResDeposit(e.target.value)}
                min="0"
              />
              <span className="text-[10px] text-[#6B7280] mt-1 block">
                L'acompte sera automatiquement crédité dans le Grand Livre Comptable KaziBox.
              </span>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-[#E5E7EB]">
              <Button type="button" variant="outline" onClick={() => setIsAddResOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" className="bg-[#6D28D9]">
                Valider la réservation
              </Button>
            </div>
          </form>
        </Modal>

        {/* MODAL: CHECK-IN */}
        {selectedResForCheckIn && (
          <Modal
            isOpen={Boolean(selectedResForCheckIn)}
            onClose={() => setSelectedResForCheckIn(null)}
            title={`🔑 Effectuer le Check-in — Chambre #${selectedResForCheckIn.room?.room_number || ''}`}
          >
            <div className="space-y-4 text-xs">
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 space-y-1">
                <div className="font-bold text-blue-900">
                  Client: {selectedResForCheckIn.guest?.full_name}
                </div>
                <div className="text-blue-800">
                  Dates: {selectedResForCheckIn.check_in_date} &rarr; {selectedResForCheckIn.check_out_date}
                </div>
                <div className="text-blue-800">
                  Montant total: {selectedResForCheckIn.total_amount.toLocaleString()} XOF | Déjà versé: {selectedResForCheckIn.paid_amount.toLocaleString()} XOF
                </div>
              </div>

              <div>
                <label className="font-bold text-[#374151] block mb-1">Paiement encaissé au check-in (XOF)</label>
                <Input
                  type="number"
                  value={checkInPayment}
                  onChange={(e) => setCheckInPayment(e.target.value)}
                  min="0"
                />
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-[#E5E7EB]">
                <Button variant="outline" onClick={() => setSelectedResForCheckIn(null)}>
                  Annuler
                </Button>
                <Button variant="primary" onClick={handleConfirmCheckIn} className="bg-indigo-600 hover:bg-indigo-700">
                  Valider le Check-in & Mettre la chambre Occupée
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* MODAL: CHECK-OUT */}
        {selectedResForCheckOut && (
          <Modal
            isOpen={Boolean(selectedResForCheckOut)}
            onClose={() => setSelectedResForCheckOut(null)}
            title={`🚪 Effectuer le Check-out — Chambre #${selectedResForCheckOut.room?.room_number || ''}`}
          >
            <div className="space-y-4 text-xs">
              {(() => {
                const remaining = selectedResForCheckOut.total_amount - selectedResForCheckOut.paid_amount;
                return (
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 space-y-1">
                    <div className="font-bold text-emerald-900">
                      Client: {selectedResForCheckOut.guest?.full_name}
                    </div>
                    <div className="text-emerald-800">
                      Montant Total: {selectedResForCheckOut.total_amount.toLocaleString()} XOF
                    </div>
                    <div className="text-emerald-800">
                      Total Déjà Réglé: {selectedResForCheckOut.paid_amount.toLocaleString()} XOF
                    </div>
                    <div className="font-extrabold text-rose-700 text-sm mt-1">
                      Solde Restant à Régler: {remaining > 0 ? `${remaining.toLocaleString()} XOF` : '0 XOF (Totalement réglé)'}
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="font-bold text-[#374151] block mb-1">Règlement final perçu au check-out (XOF)</label>
                <Input
                  type="number"
                  value={checkOutPayment}
                  onChange={(e) => setCheckOutPayment(e.target.value)}
                  min="0"
                />
              </div>

              <div>
                <label className="font-bold text-[#374151] block mb-1">Statut de la chambre après le départ</label>
                <select
                  value={checkOutNextStatus}
                  onChange={(e) => setCheckOutNextStatus(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium"
                >
                  <option value="cleaning">🟡 Ménage à faire (Cleaning)</option>
                  <option value="available">🟢 Prête et Disponible immédiatement</option>
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-[#E5E7EB]">
                <Button variant="outline" onClick={() => setSelectedResForCheckOut(null)}>
                  Annuler
                </Button>
                <Button variant="primary" onClick={handleConfirmCheckOut} className="bg-emerald-600 hover:bg-emerald-700">
                  Clôturer le séjour & Encaisser le solde
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </RequireAccess>
  );
}
