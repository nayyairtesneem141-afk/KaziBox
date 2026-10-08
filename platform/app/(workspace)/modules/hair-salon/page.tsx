'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge, Modal } from '@kazibox/ui';
import { RequireAccess } from '@/app/(workspace)/components/RequireAccess';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import {
  SalonCustomer,
  SalonStaff,
  SalonService,
  SalonAppointment,
  SalonMetrics,
  SalonReports,
  getSalonCustomers,
  createSalonCustomer,
  getSalonStaff,
  createSalonStaff,
  getSalonServices,
  createSalonService,
  getSalonAppointments,
  createSalonAppointment,
  updateSalonAppointmentStatus,
  recordSalonPayment,
  getSalonMetrics,
  getSalonReports,
  calculateEndTime,
} from '@/lib/salon';

export default function HairSalonPage() {
  const { workspace, user } = useSession();
  const { t, language } = useTranslation();
  const companyId = workspace?.company_id || '11111111-1111-4111-8111-111111111111';

  // Active Tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'appointments' | 'customers' | 'services' | 'staff' | 'reports'>('dashboard');

  // Loading & Data States
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<SalonAppointment[]>([]);
  const [customers, setCustomers] = useState<SalonCustomer[]>([]);
  const [staff, setStaff] = useState<SalonStaff[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [metrics, setMetrics] = useState<SalonMetrics | null>(null);
  const [reports, setReports] = useState<SalonReports | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Toast / Feedback Notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Modals
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedAppointmentForPayment, setSelectedAppointmentForPayment] = useState<SalonAppointment | null>(null);
  const [selectedCustomerForDetail, setSelectedCustomerForDetail] = useState<SalonCustomer | null>(null);

  // New Appointment Form State
  const [newAptCustomerId, setNewAptCustomerId] = useState('');
  const [newAptStaffId, setNewAptStaffId] = useState('');
  const [newAptServiceId, setNewAptServiceId] = useState('');
  const [newAptDate, setNewAptDate] = useState(new Date().toISOString().split('T')[0]);
  const [newAptStartTime, setNewAptStartTime] = useState('10:00');
  const [newAptPrice, setNewAptPrice] = useState<number>(15000);
  const [newAptNotes, setNewAptNotes] = useState('');

  // New Customer Form State
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');

  // New Service Form State
  const [newSrvName, setNewSrvName] = useState('');
  const [newSrvDescription, setNewSrvDescription] = useState('');
  const [newSrvDuration, setNewSrvDuration] = useState<number>(45);
  const [newSrvPrice, setNewSrvPrice] = useState<number>(15000);

  // New Staff Form State
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'stylist' | 'beautician' | 'receptionist' | 'manager'>('stylist');
  const [newStaffNotes, setNewStaffNotes] = useState('');

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other'>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [aptsData, custsData, staffData, srvsData, mData, rData] = await Promise.all([
        getSalonAppointments(companyId),
        getSalonCustomers(companyId),
        getSalonStaff(companyId),
        getSalonServices(companyId),
        getSalonMetrics(companyId),
        getSalonReports(companyId),
      ]);
      setAppointments(aptsData);
      setCustomers(custsData);
      setStaff(staffData);
      setServices(srvsData);
      setMetrics(mData);
      setReports(rData);

      // Pre-select defaults for appointment creation
      if (custsData.length > 0 && !newAptCustomerId) setNewAptCustomerId(custsData[0].id);
      if (staffData.length > 0 && !newAptStaffId) setNewAptStaffId(staffData[0].id);
      if (srvsData.length > 0 && !newAptServiceId) {
        setNewAptServiceId(srvsData[0].id);
        setNewAptPrice(srvsData[0].price);
      }
    } catch (err: any) {
      console.error('Error loading salon data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyId) {
      loadData();
    }
  }, [companyId]);

  // Update appointment price and duration when service selection changes
  const handleServiceChange = (serviceId: string) => {
    setNewAptServiceId(serviceId);
    const srv = services.find((s) => s.id === serviceId);
    if (srv) {
      setNewAptPrice(srv.price);
    }
  };

  const computedEndTime = useMemo(() => {
    const srv = services.find((s) => s.id === newAptServiceId);
    const duration = srv ? srv.duration_minutes : 45;
    return calculateEndTime(newAptStartTime, duration);
  }, [newAptStartTime, newAptServiceId, services]);

  // Status badge styling helper
  const getStatusBadge = (status: SalonAppointment['status']) => {
    switch (status) {
      case 'scheduled':
        return <Badge variant="purple" size="sm">{t('salon.status_scheduled')}</Badge>;
      case 'confirmed':
        return <Badge variant="purple" size="sm">{t('salon.status_confirmed')}</Badge>;
      case 'in_progress':
        return <Badge variant="yellow" size="sm">{t('salon.status_in_progress')}</Badge>;
      case 'completed':
        return <Badge variant="green" size="sm">{t('salon.status_completed')}</Badge>;
      case 'cancelled':
        return <Badge variant="gray" size="sm">{t('salon.status_cancelled')}</Badge>;
      case 'no_show':
        return <Badge variant="red" size="sm">{t('salon.status_no_show')}</Badge>;
      default:
        return <Badge variant="gray" size="sm">{status}</Badge>;
    }
  };

  // Staff role badge
  const getRoleBadge = (role: SalonStaff['role']) => {
    switch (role) {
      case 'stylist':
        return <Badge variant="purple" size="sm">{t('salon.role_stylist')}</Badge>;
      case 'beautician':
        return <Badge variant="green" size="sm">{t('salon.role_beautician')}</Badge>;
      case 'manager':
        return <Badge variant="yellow" size="sm">{t('salon.role_manager')}</Badge>;
      case 'receptionist':
        return <Badge variant="gray" size="sm">{t('salon.role_receptionist')}</Badge>;
      default:
        return <Badge variant="gray" size="sm">{role}</Badge>;
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName || !newCustPhone) {
      showToast(t('salon.error_required_fields'), 'error');
      return;
    }
    const res = await createSalonCustomer(companyId, {
      name: newCustName,
      phone: newCustPhone,
      email: newCustEmail || null,
      notes: newCustNotes || null,
    });
    if (res.success && res.customer) {
      showToast(t('salon.toast_customer_created'));
      setIsCustomerModalOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustEmail('');
      setNewCustNotes('');
      await loadData();
      setNewAptCustomerId(res.customer.id);
    } else {
      showToast(res.error || 'Erreur enregistrement client', 'error');
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName) {
      showToast(t('salon.error_required_fields'), 'error');
      return;
    }
    const res = await createSalonStaff(companyId, {
      name: newStaffName,
      phone: newStaffPhone || null,
      role: newStaffRole,
      notes: newStaffNotes || null,
    });
    if (res.success) {
      showToast(t('salon.toast_staff_created'));
      setIsStaffModalOpen(false);
      setNewStaffName('');
      setNewStaffPhone('');
      setNewStaffNotes('');
      await loadData();
    } else {
      showToast(res.error || 'Erreur enregistrement collaborateur', 'error');
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSrvName || newSrvDuration <= 0 || newSrvPrice < 0) {
      showToast(t('salon.error_required_fields'), 'error');
      return;
    }
    const res = await createSalonService(companyId, {
      name: newSrvName,
      description: newSrvDescription || null,
      duration_minutes: newSrvDuration,
      price: newSrvPrice,
    });
    if (res.success) {
      showToast(t('salon.toast_service_created'));
      setIsServiceModalOpen(false);
      setNewSrvName('');
      setNewSrvDescription('');
      await loadData();
    } else {
      showToast(res.error || 'Erreur enregistrement prestation', 'error');
    }
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAptCustomerId || !newAptStaffId || !newAptServiceId || !newAptDate || !newAptStartTime) {
      showToast(t('salon.error_required_fields'), 'error');
      return;
    }

    const res = await createSalonAppointment(companyId, {
      customer_id: newAptCustomerId,
      staff_id: newAptStaffId,
      service_id: newAptServiceId,
      appointment_date: newAptDate,
      start_time: newAptStartTime,
      price: newAptPrice,
      notes: newAptNotes || null,
    });

    if (res.success) {
      showToast(t('salon.toast_appointment_created'));
      setIsAppointmentModalOpen(false);
      setNewAptNotes('');
      await loadData();
    } else {
      showToast(res.error || t('salon.error_conflict'), 'error');
    }
  };

  const handleStatusChange = async (appointmentId: string, newStatus: SalonAppointment['status']) => {
    const res = await updateSalonAppointmentStatus(companyId, appointmentId, newStatus);
    if (res.success) {
      showToast(t('salon.toast_status_updated'));
      await loadData();
    } else {
      showToast(res.error || 'Erreur changement statut', 'error');
    }
  };

  const openPaymentModal = (apt: SalonAppointment) => {
    setSelectedAppointmentForPayment(apt);
    const paid = (apt.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Math.max(0, apt.price - paid);
    setPaymentAmount(remaining);
    setIsPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointmentForPayment || paymentAmount <= 0) return;

    const res = await recordSalonPayment(companyId, selectedAppointmentForPayment.id, {
      amount: paymentAmount,
      payment_method: paymentMethod,
      notes: paymentNotes || null,
    });

    if (res.success) {
      showToast(t('salon.toast_payment_recorded'));
      setIsPaymentModalOpen(false);
      setSelectedAppointmentForPayment(null);
      setPaymentNotes('');
      await loadData();
    } else {
      showToast(res.error || 'Erreur encaissement', 'error');
    }
  };

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const matchSearch =
        !searchTerm ||
        a.customer?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.staff?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.service?.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchDate = !dateFilter || a.appointment_date === dateFilter;
      const matchStaff = staffFilter === 'all' || a.staff_id === staffFilter;
      const matchStatus = statusFilter === 'all' || a.status === statusFilter;
      return matchSearch && matchDate && matchStaff && matchStatus;
    });
  }, [appointments, searchTerm, dateFilter, staffFilter, statusFilter]);

  return (
    <RequireAccess moduleId="hair-salon">
      <div className="min-h-screen bg-[#F9FAFB] pb-24 text-[#1F2937]">
        {/* Toast Alert */}
        {toastMessage && (
          <div
            className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 transition-all ${
              toastType === 'success'
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-rose-600 text-white shadow-rose-500/20'
            }`}
          >
            <span className="text-xl">{toastType === 'success' ? '✓' : '⚠️'}</span>
            <span className="text-sm font-semibold">{toastMessage}</span>
          </div>
        )}

        {/* Header Banner */}
        <div className="bg-white border-b border-[#E5E7EB] px-4 sm:px-8 py-6">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-400 flex items-center justify-center text-white text-2xl shadow-md shadow-pink-500/20">
                ✂️
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-[#1F2937]">
                    {t('salon.module_title')}
                  </h1>
                  <Badge variant="yellow" size="sm">
                    MVP Actif
                  </Badge>
                </div>
                <p className="text-sm text-[#6B7280]">
                  {t('salon.module_subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="primary"
                onClick={() => setIsAppointmentModalOpen(true)}
                className="bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white shadow-md shadow-pink-500/25 font-bold cursor-pointer"
              >
                + {t('salon.btn_new_appointment')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsCustomerModalOpen(true)}
                className="cursor-pointer"
              >
                + {t('salon.btn_new_customer')}
              </Button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="max-w-7xl mx-auto mt-6 flex overflow-x-auto gap-2 border-b border-gray-100 pb-1 scrollbar-none">
            {[
              { id: 'dashboard', label: t('salon.nav_dashboard'), icon: '📊' },
              { id: 'appointments', label: t('salon.nav_appointments'), icon: '📅' },
              { id: 'customers', label: t('salon.nav_customers'), icon: '👥' },
              { id: 'services', label: t('salon.nav_services'), icon: '💅' },
              { id: 'staff', label: t('salon.nav_staff'), icon: '✂️' },
              { id: 'reports', label: t('salon.nav_reports'), icon: '📈' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-pink-50 text-pink-700 border border-pink-200 shadow-sm'
                    : 'text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-100'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-6">
          {/* ================================================================= */}
          {/* TAB 1: DASHBOARD                                                 */}
          {/* ================================================================= */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Operational & Financial Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                  <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">
                    {t('salon.card_today_appointments')}
                  </div>
                  <div className="text-3xl font-black text-[#1F2937]">
                    {metrics?.todayAppointments || 0}
                  </div>
                  <div className="text-xs text-pink-600 mt-2 font-medium">
                    {metrics?.inProgressAppointments || 0} {t('salon.card_in_progress')}
                  </div>
                </Card>

                <Card className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                  <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">
                    {t('salon.card_completed_today')}
                  </div>
                  <div className="text-3xl font-black text-emerald-600">
                    {metrics?.completedToday || 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {metrics?.cancelledToday || 0} {t('salon.card_cancelled_today')}
                  </div>
                </Card>

                <Card className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                  <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">
                    {t('salon.card_revenue_today')}
                  </div>
                  <div className="text-2xl font-black text-[#1F2937]">
                    {(metrics?.revenueToday || 0).toLocaleString()} <span className="text-xs font-normal">XOF</span>
                  </div>
                  <div className="text-xs text-emerald-600 mt-2 font-semibold">
                    {(metrics?.revenueThisMonth || 0).toLocaleString()} XOF {t('salon.card_revenue_month')}
                  </div>
                </Card>

                <Card className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                  <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">
                    {t('salon.card_active_staff')}
                  </div>
                  <div className="text-3xl font-black text-pink-700">
                    {metrics?.activeStaff || 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {metrics?.totalCustomers || 0} {t('salon.card_total_customers')}
                  </div>
                </Card>
              </div>

              {/* Live Schedule & Quick Actions */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2 Cols: Today's Appointments List */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-[#1F2937] flex items-center gap-2">
                      <span>📅</span> {t('salon.recent_activity_title')}
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('appointments')}
                      className="cursor-pointer"
                    >
                      {t('common.all')} ({appointments.length}) →
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {appointments.slice(0, 5).map((apt) => (
                      <Card
                        key={apt.id}
                        className="p-4 bg-white border border-[#E5E7EB] hover:border-pink-300 transition-all shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl bg-pink-50 text-pink-700 font-bold flex flex-col items-center justify-center border border-pink-100 flex-shrink-0">
                            <span className="text-xs uppercase">{apt.appointment_date.slice(5)}</span>
                            <span className="text-sm font-black">{apt.start_time}</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-base text-[#1F2937]">
                                {apt.customer?.name || 'Client'}
                              </span>
                              {getStatusBadge(apt.status)}
                            </div>
                            <div className="text-sm font-medium text-pink-900 mt-0.5">
                              {apt.service?.name || 'Prestation'} • {apt.service?.duration_minutes || 30} min
                            </div>
                            <div className="text-xs text-[#6B7280] mt-1 flex items-center gap-2">
                              <span>✂️ {apt.staff?.name || 'Coiffeur'}</span>
                              <span>•</span>
                              <span className="font-semibold text-gray-800">
                                {Number(apt.price).toLocaleString()} XOF
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          {apt.status === 'scheduled' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStatusChange(apt.id, 'in_progress')}
                              className="text-xs cursor-pointer"
                            >
                              ▶ {t('salon.btn_start_service')}
                            </Button>
                          )}
                          {apt.status === 'in_progress' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => handleStatusChange(apt.id, 'completed')}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                            >
                              ✓ {t('salon.btn_complete_service')}
                            </Button>
                          )}
                          {apt.status === 'completed' && apt.payment_status !== 'paid' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openPaymentModal(apt)}
                              className="text-xs bg-pink-600 hover:bg-pink-700 text-white cursor-pointer"
                            >
                              💳 {t('salon.btn_record_payment')}
                            </Button>
                          )}
                          {apt.payment_status === 'paid' && (
                            <Badge variant="green" size="sm">
                              {t('salon.payment_paid')}
                            </Badge>
                          )}
                        </div>
                      </Card>
                    ))}

                    {appointments.length === 0 && (
                      <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                        <div className="text-3xl mb-2">✂️</div>
                        <p className="text-gray-500 font-medium">Aucun rendez-vous pour le moment.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Col: Staff Today & Top Services */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-[#1F2937] flex items-center gap-2">
                    <span>👥</span> {t('salon.nav_staff')}
                  </h3>

                  <Card className="p-4 bg-white border border-[#E5E7EB] shadow-sm divide-y divide-gray-100">
                    {staff.map((st) => {
                      const todayCount = appointments.filter(
                        (a) => a.staff_id === st.id && a.appointment_date === new Date().toISOString().split('T')[0]
                      ).length;
                      return (
                        <div key={st.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-sm text-[#1F2937]">{st.name}</div>
                            <div className="text-xs text-[#6B7280]">{getRoleBadge(st.role)}</div>
                          </div>
                          <Badge variant={todayCount > 0 ? 'purple' : 'gray'} size="sm">
                            {todayCount} RDV aujourd'hui
                          </Badge>
                        </div>
                      );
                    })}
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: APPOINTMENTS FULL LIST & MANAGEMENT                        */}
          {/* ================================================================= */}
          {activeTab === 'appointments' && (
            <div className="space-y-4">
              {/* Filters toolbar */}
              <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-sm flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="flex-1 max-w-sm">
                  <input
                    type="text"
                    placeholder="Rechercher par client, coiffeur ou prestation..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />

                  <select
                    value={staffFilter}
                    onChange={(e) => setStaffFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  >
                    <option value="all">Tous les coiffeurs</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="scheduled">{t('salon.status_scheduled')}</option>
                    <option value="confirmed">{t('salon.status_confirmed')}</option>
                    <option value="in_progress">{t('salon.status_in_progress')}</option>
                    <option value="completed">{t('salon.status_completed')}</option>
                    <option value="cancelled">{t('salon.status_cancelled')}</option>
                    <option value="no_show">{t('salon.status_no_show')}</option>
                  </select>

                  {(dateFilter || staffFilter !== 'all' || statusFilter !== 'all' || searchTerm) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDateFilter('');
                        setStaffFilter('all');
                        setStatusFilter('all');
                        setSearchTerm('');
                      }}
                      className="cursor-pointer text-xs"
                    >
                      Réinitialiser
                    </Button>
                  )}
                </div>
              </div>

              {/* Appointments List */}
              <div className="space-y-3">
                {filteredAppointments.map((apt) => (
                  <Card
                    key={apt.id}
                    className="p-4 bg-white border border-[#E5E7EB] hover:border-pink-300 transition-all shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-14 h-14 rounded-xl bg-pink-50 text-pink-700 font-bold flex flex-col items-center justify-center border border-pink-100 flex-shrink-0">
                        <span className="text-[10px] uppercase font-bold text-pink-800">{apt.appointment_date}</span>
                        <span className="text-sm font-black">{apt.start_time}</span>
                        <span className="text-[10px] text-gray-400">à {apt.end_time}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-[#1F2937]">
                            {apt.customer?.name}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">({apt.customer?.phone})</span>
                          {getStatusBadge(apt.status)}
                        </div>
                        <div className="text-sm font-medium text-pink-900 mt-1">
                          {apt.service?.name} • {apt.service?.duration_minutes} min
                        </div>
                        <div className="text-xs text-[#6B7280] mt-1 flex items-center gap-2">
                          <span>✂️ {apt.staff?.name}</span>
                          <span>•</span>
                          <span className="font-bold text-gray-800">
                            {Number(apt.price).toLocaleString()} XOF
                          </span>
                          {apt.notes && <span>• <em>« {apt.notes} »</em></span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap self-end md:self-center">
                      {apt.status === 'scheduled' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(apt.id, 'confirmed')}
                            className="text-xs cursor-pointer"
                          >
                            Confirmer
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleStatusChange(apt.id, 'in_progress')}
                            className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white cursor-pointer"
                          >
                            {t('salon.btn_start_service')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(apt.id, 'cancelled')}
                            className="text-xs text-red-600 border-red-200 cursor-pointer"
                          >
                            Annuler
                          </Button>
                        </>
                      )}

                      {apt.status === 'confirmed' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleStatusChange(apt.id, 'in_progress')}
                          className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white cursor-pointer"
                        >
                          {t('salon.btn_start_service')}
                        </Button>
                      )}

                      {apt.status === 'in_progress' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleStatusChange(apt.id, 'completed')}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        >
                          {t('salon.btn_complete_service')}
                        </Button>
                      )}

                      {apt.status === 'completed' && apt.payment_status !== 'paid' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openPaymentModal(apt)}
                          className="text-xs bg-pink-600 hover:bg-pink-700 text-white cursor-pointer"
                        >
                          💳 {t('salon.btn_record_payment')}
                        </Button>
                      )}

                      {apt.payment_status === 'paid' && (
                        <Badge variant="green" size="sm">
                          {t('salon.payment_paid')}
                        </Badge>
                      )}
                    </div>
                  </Card>
                ))}

                {filteredAppointments.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                    <p className="text-gray-500 font-medium">Aucun rendez-vous ne correspond aux critères.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: CUSTOMERS DIRECTORY                                        */}
          {/* ================================================================= */}
          {activeTab === 'customers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <input
                  type="text"
                  placeholder="Rechercher par nom ou téléphone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 w-72"
                />
                <Button
                  variant="primary"
                  onClick={() => setIsCustomerModalOpen(true)}
                  className="bg-pink-600 hover:bg-pink-700 text-white cursor-pointer text-sm font-bold"
                >
                  + {t('salon.btn_new_customer')}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customers
                  .filter((c) =>
                    !searchTerm ||
                    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    c.phone.includes(searchTerm)
                  )
                  .map((cust) => {
                    const custAppointments = appointments.filter((a) => a.customer_id === cust.id);
                    return (
                      <Card
                        key={cust.id}
                        className="p-4 bg-white border border-[#E5E7EB] hover:border-pink-300 transition-all shadow-sm cursor-pointer"
                        onClick={() => setSelectedCustomerForDetail(cust)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-bold text-base text-[#1F2937]">{cust.name}</h4>
                          <Badge variant="purple" size="sm">
                            {custAppointments.length} RDV
                          </Badge>
                        </div>
                        <div className="text-sm text-[#6B7280] font-mono mb-2">📞 {cust.phone}</div>
                        {cust.notes && (
                          <div className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded-lg mb-2">
                            {cust.notes}
                          </div>
                        )}
                        <div className="text-xs text-pink-700 font-semibold flex items-center justify-between">
                          <span>Voir l'historique complet</span>
                          <span>→</span>
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: SERVICES CATALOGUE                                         */}
          {/* ================================================================= */}
          {activeTab === 'services' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-[#1F2937]">Prestations & Tarifs Salon</h3>
                <Button
                  variant="primary"
                  onClick={() => setIsServiceModalOpen(true)}
                  className="bg-pink-600 hover:bg-pink-700 text-white cursor-pointer text-sm font-bold"
                >
                  + {t('salon.btn_new_service')}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {services.map((srv) => (
                  <Card key={srv.id} className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-base text-[#1F2937]">{srv.name}</h4>
                      <Badge variant={srv.status === 'active' ? 'green' : 'gray'} size="sm">
                        {srv.status === 'active' ? 'Actif' : 'Inactif'}
                      </Badge>
                    </div>
                    {srv.description && (
                      <p className="text-xs text-[#6B7280] mb-3">{srv.description}</p>
                    )}
                    <div className="flex items-center justify-between text-sm font-bold border-t border-gray-100 pt-3">
                      <span className="text-gray-500">⏱ {srv.duration_minutes} min</span>
                      <span className="text-pink-700 text-base">{Number(srv.price).toLocaleString()} XOF</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 5: STAFF & ROSTER                                             */}
          {/* ================================================================= */}
          {activeTab === 'staff' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-[#1F2937]">Équipe & Stylistes</h3>
                <Button
                  variant="primary"
                  onClick={() => setIsStaffModalOpen(true)}
                  className="bg-pink-600 hover:bg-pink-700 text-white cursor-pointer text-sm font-bold"
                >
                  + {t('salon.btn_new_staff')}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {staff.map((st) => {
                  const staffApts = appointments.filter((a) => a.staff_id === st.id);
                  return (
                    <Card key={st.id} className="p-4 bg-white border border-[#E5E7EB] shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-bold text-base text-[#1F2937]">{st.name}</h4>
                        {getRoleBadge(st.role)}
                      </div>
                      {st.phone && <div className="text-xs text-gray-500 font-mono mb-2">📞 {st.phone}</div>}
                      {st.notes && <p className="text-xs text-gray-600 mb-3 italic">{st.notes}</p>}
                      <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-xs font-semibold text-gray-600">
                        <span>Rendez-vous cumulés :</span>
                        <span className="text-pink-700 font-bold">{staffApts.length}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 6: REPORTS & REVENUE                                          */}
          {/* ================================================================= */}
          {activeTab === 'reports' && reports && (
            <div className="space-y-6">
              <h3 className="font-bold text-xl text-[#1F2937]">{t('salon.reports_title')}</h3>

              {/* Revenue Period Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="p-4 bg-white border border-[#E5E7EB]">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Aujourd'hui</div>
                  <div className="text-2xl font-black text-[#1F2937]">
                    {reports.revenueToday.toLocaleString()} <span className="text-xs">XOF</span>
                  </div>
                </Card>
                <Card className="p-4 bg-white border border-[#E5E7EB]">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Cette Semaine</div>
                  <div className="text-2xl font-black text-pink-700">
                    {reports.revenueThisWeek.toLocaleString()} <span className="text-xs">XOF</span>
                  </div>
                </Card>
                <Card className="p-4 bg-white border border-[#E5E7EB]">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Ce Mois-ci</div>
                  <div className="text-2xl font-black text-emerald-600">
                    {reports.revenueThisMonth.toLocaleString()} <span className="text-xs">XOF</span>
                  </div>
                </Card>
              </div>

              {/* Most Booked Services */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-5 bg-white border border-[#E5E7EB]">
                  <h4 className="font-bold text-base text-[#1F2937] mb-3">
                    💅 {t('salon.top_services_title')}
                  </h4>
                  <div className="divide-y divide-gray-100">
                    {reports.mostBookedServices.map((srv, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between text-sm">
                        <span className="font-semibold text-gray-800">{srv.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">{srv.count} fois</span>
                          <span className="font-bold text-pink-700">{srv.totalRevenue.toLocaleString()} XOF</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-5 bg-white border border-[#E5E7EB]">
                  <h4 className="font-bold text-base text-[#1F2937] mb-3">
                    ✂️ {t('salon.staff_performance_title')}
                  </h4>
                  <div className="divide-y divide-gray-100">
                    {reports.staffPerformance.map((st, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between text-sm">
                        <div>
                          <div className="font-semibold text-gray-800">{st.name}</div>
                          <div className="text-xs text-gray-500">{st.role}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-pink-700">{st.totalRevenue.toLocaleString()} XOF</div>
                          <div className="text-xs text-gray-500">{st.count} prestations</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* MODAL: NEW APPOINTMENT                                              */}
        {/* =================================================================== */}
        <Modal
          isOpen={isAppointmentModalOpen}
          onClose={() => setIsAppointmentModalOpen(false)}
          title={t('salon.btn_new_appointment')}
        >
          <form onSubmit={handleCreateAppointment} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_customer')} *
              </label>
              <div className="flex gap-2">
                <select
                  value={newAptCustomerId}
                  onChange={(e) => setNewAptCustomerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  required
                >
                  <option value="">Sélectionner un client...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCustomerModalOpen(true)}
                  className="whitespace-nowrap text-xs"
                >
                  + Nouveau
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_service')} *
              </label>
              <select
                value={newAptServiceId}
                onChange={(e) => handleServiceChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              >
                <option value="">Sélectionner une prestation...</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min - {s.price.toLocaleString()} XOF)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_staff')} *
              </label>
              <select
                value={newAptStaffId}
                onChange={(e) => setNewAptStaffId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              >
                <option value="">Sélectionner un collaborateur...</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('salon.label_date')} *
                </label>
                <input
                  type="date"
                  value={newAptDate}
                  onChange={(e) => setNewAptDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('salon.label_start_time')} *
                </label>
                <input
                  type="time"
                  value={newAptStartTime}
                  onChange={(e) => setNewAptStartTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  required
                />
              </div>
            </div>

            <div className="p-3 bg-pink-50 border border-pink-100 rounded-xl flex items-center justify-between text-xs text-pink-900 font-semibold">
              <span>{t('salon.label_end_time')} :</span>
              <span className="font-black text-sm">{computedEndTime}</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_price')} (XOF)
              </label>
              <input
                type="number"
                value={newAptPrice}
                onChange={(e) => setNewAptPrice(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_notes')}
              </label>
              <textarea
                value={newAptNotes}
                onChange={(e) => setNewAptNotes(e.target.value)}
                placeholder="Ex : cliente sensible du cuir chevelu, mèches fournies..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAppointmentModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" className="bg-pink-600 hover:bg-pink-700 text-white font-bold">
                {t('salon.btn_save_appointment')}
              </Button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* MODAL: NEW CUSTOMER                                                 */}
        {/* =================================================================== */}
        <Modal
          isOpen={isCustomerModalOpen}
          onClose={() => setIsCustomerModalOpen(false)}
          title={t('salon.btn_new_customer')}
        >
          <form onSubmit={handleCreateCustomer} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_customer')} *
              </label>
              <input
                type="text"
                placeholder="Ex : Fatou Diallo"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_phone')} *
              </label>
              <input
                type="text"
                placeholder="Ex : +221 77 123 45 67"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_email')}
              </label>
              <input
                type="email"
                placeholder="client@exemple.sn"
                value={newCustEmail}
                onChange={(e) => setNewCustEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_notes')}
              </label>
              <textarea
                placeholder="Habitudes, style préféré, allergies..."
                value={newCustNotes}
                onChange={(e) => setNewCustNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsCustomerModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" className="bg-pink-600 hover:bg-pink-700 text-white font-bold">
                {t('salon.btn_save_customer')}
              </Button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* MODAL: NEW SERVICE                                                  */}
        {/* =================================================================== */}
        <Modal
          isOpen={isServiceModalOpen}
          onClose={() => setIsServiceModalOpen(false)}
          title={t('salon.btn_new_service')}
        >
          <form onSubmit={handleCreateService} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_service')} *
              </label>
              <input
                type="text"
                placeholder="Ex : Soin Visage Anti-Âge"
                value={newSrvName}
                onChange={(e) => setNewSrvName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_duration')} *
              </label>
              <input
                type="number"
                value={newSrvDuration}
                onChange={(e) => setNewSrvDuration(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                min={5}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_price')} (XOF) *
              </label>
              <input
                type="number"
                value={newSrvPrice}
                onChange={(e) => setNewSrvPrice(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                min={0}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('salon.label_description')}
              </label>
              <textarea
                placeholder="Description des étapes du soin..."
                value={newSrvDescription}
                onChange={(e) => setNewSrvDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsServiceModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" className="bg-pink-600 hover:bg-pink-700 text-white font-bold">
                {t('salon.btn_save_service')}
              </Button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* MODAL: NEW STAFF                                                    */}
        {/* =================================================================== */}
        <Modal
          isOpen={isStaffModalOpen}
          onClose={() => setIsStaffModalOpen(false)}
          title={t('salon.btn_new_staff')}
        >
          <form onSubmit={handleCreateStaff} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Nom complet *
              </label>
              <input
                type="text"
                placeholder="Ex : Mariama Diallo"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Poste / Rôle
              </label>
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="stylist">{t('salon.role_stylist')}</option>
                <option value="beautician">{t('salon.role_beautician')}</option>
                <option value="receptionist">{t('salon.role_receptionist')}</option>
                <option value="manager">{t('salon.role_manager')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Téléphone
              </label>
              <input
                type="text"
                placeholder="+221 77 000 00 00"
                value={newStaffPhone}
                onChange={(e) => setNewStaffPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Spécialités / Notes
              </label>
              <textarea
                placeholder="Ex : Tresses, coloration, manucure..."
                value={newStaffNotes}
                onChange={(e) => setNewStaffNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsStaffModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" className="bg-pink-600 hover:bg-pink-700 text-white font-bold">
                {t('salon.btn_save_staff')}
              </Button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* MODAL: COLLECT PAYMENT                                              */}
        {/* =================================================================== */}
        <Modal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          title={t('salon.btn_record_payment')}
        >
          {selectedAppointmentForPayment && (
            <form onSubmit={handleRecordPayment} className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 text-xs text-gray-700">
                <div className="flex justify-between">
                  <span>Client :</span>
                  <span className="font-bold">{selectedAppointmentForPayment.customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Prestation :</span>
                  <span className="font-bold">{selectedAppointmentForPayment.service?.name}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1 text-sm font-black text-pink-700">
                  <span>Montant total :</span>
                  <span>{selectedAppointmentForPayment.price.toLocaleString()} XOF</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Montant à encaisser (XOF) *
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                  min={1}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('salon.label_payment_method')}
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  <option value="cash">{t('salon.payment_cash')}</option>
                  <option value="mobile_money">{t('salon.payment_mobile_money')} (Wave, Orange Money)</option>
                  <option value="card">{t('salon.payment_card')}</option>
                  <option value="bank_transfer">{t('salon.payment_bank_transfer')}</option>
                  <option value="other">{t('salon.payment_other')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('salon.label_notes')}
                </label>
                <input
                  type="text"
                  placeholder="Référence transaction ou note..."
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsPaymentModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" variant="primary" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  Confirmer l'encaissement
                </Button>
              </div>
            </form>
          )}
        </Modal>

        {/* =================================================================== */}
        {/* MODAL: CUSTOMER DETAIL & HISTORY                                    */}
        {/* =================================================================== */}
        <Modal
          isOpen={Boolean(selectedCustomerForDetail)}
          onClose={() => setSelectedCustomerForDetail(null)}
          title={selectedCustomerForDetail?.name || 'Fiche Client'}
        >
          {selectedCustomerForDetail && (
            <div className="space-y-4">
              <div className="p-3 bg-pink-50 border border-pink-100 rounded-xl space-y-1 text-xs">
                <div><strong>Téléphone :</strong> {selectedCustomerForDetail.phone}</div>
                {selectedCustomerForDetail.email && <div><strong>Email :</strong> {selectedCustomerForDetail.email}</div>}
                {selectedCustomerForDetail.notes && <div><strong>Préférences :</strong> {selectedCustomerForDetail.notes}</div>}
              </div>

              <h4 className="font-bold text-sm text-[#1F2937]">
                {t('salon.service_history_title')}
              </h4>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {appointments
                  .filter((a) => a.customer_id === selectedCustomerForDetail.id)
                  .map((a) => (
                    <div key={a.id} className="p-2.5 rounded-xl border border-gray-200 text-xs flex justify-between items-center">
                      <div>
                        <div className="font-bold text-[#1F2937]">{a.service?.name}</div>
                        <div className="text-gray-500">{a.appointment_date} à {a.start_time} • {a.staff?.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-pink-700">{Number(a.price).toLocaleString()} XOF</div>
                        {getStatusBadge(a.status)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </RequireAccess>
  );
}
