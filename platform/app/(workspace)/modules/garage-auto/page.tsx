'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, Button, Badge, Modal } from '@kazibox/ui';
import { useTranslation, localize } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { RequireAccess } from '@/app/(workspace)/components/RequireAccess';
import {
  GarageCustomer,
  GarageVehicle,
  GarageJob,
  GarageJobItem,
  GaragePayment,
  GarageMetrics,
  GarageReports,
  getGarageCustomers,
  createGarageCustomer,
  getGarageVehicles,
  createGarageVehicle,
  getGarageJobs,
  getGarageJobById,
  createGarageJob,
  updateGarageJobStatus,
  addGarageJobItem,
  recordGaragePayment,
  getGarageMetrics,
  getGarageReports,
} from '@/lib/garage';

export default function GarageModulePage() {
  return (
    <RequireAccess moduleId="garage-auto">
      <GarageModuleContent />
    </RequireAccess>
  );
}

function GarageModuleContent() {
  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const companyId = workspace?.company_id || workspace?.id || '22222222-2222-4222-8222-222222222222';
  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'jobs' | 'customers' | 'vehicles' | 'reports'>('dashboard');

  // Backend state
  const [customers, setCustomers] = useState<GarageCustomer[]>([]);
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [jobs, setJobs] = useState<GarageJob[]>([]);
  const [metrics, setMetrics] = useState<GarageMetrics | null>(null);
  const [reports, setReports] = useState<GarageReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filters & Search
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all');
  const [jobSearch, setJobSearch] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [vehicleSearch, setVehicleSearch] = useState<string>('');

  // Modals state
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [isAddJobOpen, setIsAddJobOpen] = useState(false);
  const [selectedJobForDetail, setSelectedJobForDetail] = useState<GarageJob | null>(null);
  const [selectedCustomerForDetail, setSelectedCustomerForDetail] = useState<GarageCustomer | null>(null);
  const [selectedVehicleForDetail, setSelectedVehicleForDetail] = useState<GarageVehicle | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  // New Customer Form State
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');

  // New Vehicle Form State
  const [newVehCustomerId, setNewVehCustomerId] = useState('');
  const [newVehReg, setNewVehReg] = useState('');
  const [newVehMake, setNewVehMake] = useState('');
  const [newVehModel, setNewVehModel] = useState('');
  const [newVehYear, setNewVehYear] = useState('');
  const [newVehColor, setNewVehColor] = useState('');
  const [newVehMileage, setNewVehMileage] = useState('');
  const [newVehVin, setNewVehVin] = useState('');
  const [newVehNotes, setNewVehNotes] = useState('');

  // New Job Form State
  const [newJobCustomerId, setNewJobCustomerId] = useState('');
  const [newJobVehicleId, setNewJobVehicleId] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newJobDesc, setNewJobDesc] = useState('');
  const [newJobDiagnosis, setNewJobDiagnosis] = useState('');
  const [newJobMechanic, setNewJobMechanic] = useState('');
  const [newJobExpectedDate, setNewJobExpectedDate] = useState('');
  const [newJobNotes, setNewJobNotes] = useState('');
  const [newJobEstimatedAmount, setNewJobEstimatedAmount] = useState('35000');
  const [newJobItems, setNewJobItems] = useState<{ item_type: 'service' | 'part'; name: string; quantity: number; unit_price: number }[]>([
    { item_type: 'service', name: 'Main d’œuvre révision', quantity: 1, unit_price: 20000 },
    { item_type: 'part', name: 'Filtre à huile & consommables', quantity: 1, unit_price: 15000 },
  ]);

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other'>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Add Item to Job Form State
  const [newItemType, setNewItemType] = useState<'service' | 'part'>('service');
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemPrice, setNewItemPrice] = useState('10000');

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Load all backend data
  const loadData = async () => {
    setLoading(true);
    try {
      const [cData, vData, jData, mData, rData] = await Promise.all([
        getGarageCustomers(companyId),
        getGarageVehicles(companyId),
        getGarageJobs(companyId),
        getGarageMetrics(companyId),
        getGarageReports(companyId),
      ]);
      setCustomers(cData);
      setVehicles(vData);
      setJobs(jData);
      setMetrics(mData);
      setReports(rData);

      // If a job detail modal is open, refresh its details
      if (selectedJobForDetail) {
        const refreshed = await getGarageJobById(companyId, selectedJobForDetail.id);
        if (refreshed) setSelectedJobForDetail(refreshed);
      }
    } catch {
      showToast('error', 'Erreur lors du chargement des données Garage.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [companyId]);

  // Vehicles filtered by selected customer in New Job modal
  const customerVehicles = useMemo(() => {
    if (!newJobCustomerId) return vehicles;
    return vehicles.filter((v) => v.customer_id === newJobCustomerId);
  }, [vehicles, newJobCustomerId]);

  // Total amount calculated from new job items
  const newJobCalculatedTotal = useMemo(() => {
    return newJobItems.reduce((acc, item) => acc + item.quantity * item.unit_price, 0);
  }, [newJobItems]);

  // Status badge styling helper
  const getStatusBadge = (status: GarageJob['status']) => {
    switch (status) {
      case 'open':
        return <Badge variant="purple" size="sm">Ouvert</Badge>;
      case 'diagnosing':
        return <Badge variant="purple" size="sm">Diagnostic</Badge>;
      case 'in_progress':
        return <Badge variant="yellow" size="sm">En cours</Badge>;
      case 'waiting_parts':
        return <Badge variant="red" size="sm">Attente pièces</Badge>;
      case 'completed':
        return <Badge variant="green" size="sm">Terminé</Badge>;
      case 'delivered':
        return <Badge variant="gray" size="sm">Livré</Badge>;
      case 'cancelled':
        return <Badge variant="gray" size="sm">Annulé</Badge>;
      default:
        return <Badge variant="gray" size="sm">{status}</Badge>;
    }
  };

  const getPaymentStatusBadge = (pStatus: GarageJob['payment_status']) => {
    switch (pStatus) {
      case 'paid':
        return <Badge variant="green" size="sm">Payé</Badge>;
      case 'partially_paid':
        return <Badge variant="yellow" size="sm">Partiel</Badge>;
      case 'unpaid':
        return <Badge variant="red" size="sm">Non payé</Badge>;
      default:
        return <Badge variant="gray" size="sm">{pStatus}</Badge>;
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim()) {
      showToast('error', 'Nom et téléphone obligatoires.');
      return;
    }
    const res = await createGarageCustomer(companyId, {
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      email: newCustEmail.trim() || null,
      address: newCustAddress.trim() || null,
      notes: newCustNotes.trim() || null,
    });
    if (res.success) {
      showToast('success', `Client ${newCustName} créé avec succès !`);
      setIsAddCustomerOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustEmail('');
      setNewCustAddress('');
      setNewCustNotes('');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur création client');
    }
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehReg.trim() || !newVehMake.trim() || !newVehModel.trim() || !newVehCustomerId) {
      showToast('error', 'Client, immatriculation, marque et modèle obligatoires.');
      return;
    }
    const res = await createGarageVehicle(companyId, {
      customer_id: newVehCustomerId,
      registration_number: newVehReg.trim().toUpperCase(),
      make: newVehMake.trim(),
      model: newVehModel.trim(),
      year: newVehYear ? parseInt(newVehYear) : null,
      color: newVehColor.trim() || null,
      mileage: newVehMileage ? parseInt(newVehMileage) : null,
      vin: newVehVin.trim() || null,
      notes: newVehNotes.trim() || null,
    });
    if (res.success) {
      showToast('success', `Véhicule ${newVehReg.toUpperCase()} enregistré !`);
      setIsAddVehicleOpen(false);
      setNewVehReg('');
      setNewVehMake('');
      setNewVehModel('');
      setNewVehYear('');
      setNewVehColor('');
      setNewVehMileage('');
      setNewVehVin('');
      setNewVehNotes('');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur création véhicule');
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobTitle.trim() || !newJobCustomerId || !newJobVehicleId) {
      showToast('error', 'Client, véhicule et motif de réparation obligatoires.');
      return;
    }
    const res = await createGarageJob(companyId, {
      customer_id: newJobCustomerId,
      vehicle_id: newJobVehicleId,
      title: newJobTitle.trim(),
      description: newJobDesc.trim() || null,
      diagnosis: newJobDiagnosis.trim() || null,
      mechanic_name: newJobMechanic.trim() || null,
      estimated_amount: parseFloat(newJobEstimatedAmount) || newJobCalculatedTotal,
      total_amount: newJobCalculatedTotal,
      expected_completion_at: newJobExpectedDate ? new Date(newJobExpectedDate).toISOString() : null,
      notes: newJobNotes.trim() || null,
      initial_items: newJobItems,
    });
    if (res.success) {
      showToast('success', `Ordre de réparation créé (${res.job?.job_number}) !`);
      setIsAddJobOpen(false);
      setNewJobTitle('');
      setNewJobDesc('');
      setNewJobDiagnosis('');
      setNewJobMechanic('');
      setNewJobExpectedDate('');
      setNewJobNotes('');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur création ordre');
    }
  };

  const handleStatusChange = async (jobId: string, status: GarageJob['status']) => {
    const res = await updateGarageJobStatus(companyId, jobId, status);
    if (res.success) {
      showToast('success', `Statut mis à jour vers "${status}" !`);
      loadData();
      if (selectedJobForDetail && selectedJobForDetail.id === jobId) {
        setSelectedJobForDetail((prev) => (prev ? { ...prev, status } : null));
      }
    } else {
      showToast('error', res.error || 'Erreur mise à jour statut');
    }
  };

  const handleAddItemToJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobForDetail) return;
    if (!newItemName.trim()) {
      showToast('error', 'Nom du service/pièce obligatoire.');
      return;
    }
    const res = await addGarageJobItem(companyId, selectedJobForDetail.id, {
      item_type: newItemType,
      name: newItemName.trim(),
      quantity: parseFloat(newItemQty) || 1,
      unit_price: parseFloat(newItemPrice) || 0,
    });
    if (res.success) {
      showToast('success', 'Ligne ajoutée avec succès !');
      setIsAddItemModalOpen(false);
      setNewItemName('');
      setNewItemQty('1');
      setNewItemPrice('10000');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur ajout ligne');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobForDetail) return;
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      showToast('error', 'Montant de règlement invalide (> 0).');
      return;
    }
    if (amt > selectedJobForDetail.outstanding_amount) {
      showToast('error', `Le montant dépasse le solde restant (${selectedJobForDetail.outstanding_amount.toLocaleString()} XOF).`);
      return;
    }

    const res = await recordGaragePayment(companyId, selectedJobForDetail.id, {
      amount: amt,
      payment_method: paymentMethod,
      reference: paymentReference.trim() || undefined,
      notes: paymentNotes.trim() || undefined,
    });

    if (res.success) {
      showToast('success', `Règlement de ${amt.toLocaleString()} XOF enregistré avec succès !`);
      setIsPaymentModalOpen(false);
      setPaymentAmount('0');
      setPaymentReference('');
      setPaymentNotes('');
      loadData();
    } else {
      showToast('error', res.error || 'Erreur enregistrement paiement');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-in fade-in slide-in-from-top duration-200 ${
            notification.type === 'success'
              ? 'bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]'
              : 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]'
          }`}
        >
          <span>{notification.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header & Sub-navigation */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#E5E7EB]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl shadow-sm">
              🔧
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-[#1F2937]">
                  {language === 'fr' ? 'Garage & Atelier Mécanique' : 'Garage & Auto Repair'}
                </h1>
                <Badge variant="yellow" size="sm">
                  MVP Actif
                </Badge>
              </div>
              <p className="text-sm text-[#6B7280]">
                {language === 'fr'
                  ? 'Gestion des réparations, historique des véhicules, clients et encaissements atelier'
                  : 'Work orders, vehicle maintenance history, customers, and garage payments'}
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddCustomerOpen(true)}
            >
              + Client
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (customers.length > 0) setNewVehCustomerId(customers[0].id);
                setIsAddVehicleOpen(true);
              }}
            >
              + Véhicule
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                if (customers.length > 0) setNewJobCustomerId(customers[0].id);
                if (vehicles.length > 0) setNewJobVehicleId(vehicles[0].id);
                setIsAddJobOpen(true);
              }}
            >
              + Nouvel Ordre (OR)
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex overflow-x-auto gap-2 border-b border-[#F3F4F6] pb-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'bg-amber-100 text-amber-900 font-bold'
                : 'text-[#4B5563] hover:bg-[#F9FAFB]'
            }`}
          >
            📊 {language === 'fr' ? 'Tableau de bord' : 'Dashboard'}
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'jobs'
                ? 'bg-amber-100 text-amber-900 font-bold'
                : 'text-[#4B5563] hover:bg-[#F9FAFB]'
            }`}
          >
            📋 {language === 'fr' ? 'Ordres de réparation' : 'Repair Jobs'} ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'customers'
                ? 'bg-amber-100 text-amber-900 font-bold'
                : 'text-[#4B5563] hover:bg-[#F9FAFB]'
            }`}
          >
            👥 {language === 'fr' ? 'Clients' : 'Customers'} ({customers.length})
          </button>
          <button
            onClick={() => setActiveTab('vehicles')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'vehicles'
                ? 'bg-amber-100 text-amber-900 font-bold'
                : 'text-[#4B5563] hover:bg-[#F9FAFB]'
            }`}
          >
            🚗 {language === 'fr' ? 'Véhicules & Historique' : 'Vehicles'} ({vehicles.length})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'reports'
                ? 'bg-amber-100 text-amber-900 font-bold'
                : 'text-[#4B5563] hover:bg-[#F9FAFB]'
            }`}
          >
            📈 {language === 'fr' ? 'Rapports & CA' : 'Reports'}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="min-h-[250px] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* =====================================================================
          TAB 1: DASHBOARD
      ===================================================================== */}
      {!loading && activeTab === 'dashboard' && metrics && (
        <div className="space-y-6">
          {/* Operational Status Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding="md" className="border-l-4 border-l-blue-500 bg-white shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">
                {language === 'fr' ? 'Ordres Ouverts' : 'Open Jobs'}
              </span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">{metrics.openJobs}</div>
              <span className="text-xs text-blue-600 font-medium">À diagnostiquer</span>
            </Card>

            <Card padding="md" className="border-l-4 border-l-amber-500 bg-white shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">
                {language === 'fr' ? 'En Cours' : 'In Progress'}
              </span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">{metrics.inProgressJobs}</div>
              <span className="text-xs text-amber-600 font-medium">Travaux à l’atelier</span>
            </Card>

            <Card padding="md" className="border-l-4 border-l-red-500 bg-white shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">
                {language === 'fr' ? 'Attente Pièces' : 'Waiting Parts'}
              </span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">{metrics.waitingPartsJobs}</div>
              <span className="text-xs text-red-600 font-medium">Bloqué appro</span>
            </Card>

            <Card padding="md" className="border-l-4 border-l-green-500 bg-white shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">
                {language === 'fr' ? 'Terminés / Livrés' : 'Completed / Delivered'}
              </span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">{metrics.completedJobs}</div>
              <span className="text-xs text-green-600 font-medium">Prêts ou remis</span>
            </Card>
          </div>

          {/* Financial Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padding="lg" className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-green-800 uppercase">
                    {language === 'fr' ? 'Encaissements Aujourd’hui' : 'Revenue Today'}
                  </span>
                  <div className="text-2xl font-black text-green-900 mt-1">
                    {metrics.revenueToday.toLocaleString()} XOF
                  </div>
                  <p className="text-xs text-green-700 mt-1">Paiements enregistrés ce jour</p>
                </div>
                <div className="text-3xl text-green-600">💵</div>
              </div>
            </Card>

            <Card padding="lg" className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-800 uppercase">
                    {language === 'fr' ? 'Chiffre d’affaires du Mois' : 'Revenue This Month'}
                  </span>
                  <div className="text-2xl font-black text-amber-900 mt-1">
                    {metrics.revenueThisMonth.toLocaleString()} XOF
                  </div>
                  <p className="text-xs text-amber-700 mt-1">Total réparations payées</p>
                </div>
                <div className="text-3xl text-amber-600">📊</div>
              </div>
            </Card>

            <Card padding="lg" className="bg-gradient-to-br from-rose-50 to-red-50 border border-red-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-red-800 uppercase">
                    {language === 'fr' ? 'Créances Restantes' : 'Outstanding Amount'}
                  </span>
                  <div className="text-2xl font-black text-red-900 mt-1">
                    {metrics.outstandingAmount.toLocaleString()} XOF
                  </div>
                  <p className="text-xs text-red-700 mt-1">Soldes clients à recouvrer</p>
                </div>
                <div className="text-3xl text-red-600">⏳</div>
              </div>
            </Card>
          </div>

          {/* Activity Timeline & Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card padding="lg" className="bg-white shadow-sm border border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-[#1F2937]">
                    {language === 'fr' ? 'Activité Récente Atelier' : 'Recent Repair Orders'}
                  </h3>
                  <button
                    onClick={() => setActiveTab('jobs')}
                    className="text-xs font-semibold text-amber-700 hover:underline"
                  >
                    Voir tout &rarr;
                  </button>
                </div>

                <div className="space-y-3">
                  {jobs.slice(0, 5).map((job) => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobForDetail(job)}
                      className="p-3 rounded-xl border border-[#F3F4F6] hover:border-amber-200 hover:bg-amber-50/30 transition-colors cursor-pointer flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-black text-xs text-gray-700">
                          {job.job_number}
                        </div>
                        <div>
                          <div className="font-bold text-sm text-[#1F2937] flex items-center gap-2">
                            <span>{job.vehicle?.make} {job.vehicle?.model}</span>
                            <span className="text-xs text-gray-500 font-mono">({job.vehicle?.registration_number})</span>
                          </div>
                          <p className="text-xs text-[#6B7280] line-clamp-1">{job.title}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {getStatusBadge(job.status)}
                        <div className="text-right">
                          <div className="text-sm font-black text-[#1F2937]">
                            {job.total_amount.toLocaleString()} XOF
                          </div>
                          {getPaymentStatusBadge(job.payment_status)}
                        </div>
                      </div>
                    </div>
                  ))}

                  {jobs.length === 0 && (
                    <div className="text-center py-8 text-sm text-[#9CA3AF]">
                      Aucun ordre de réparation pour le moment.
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Quick Summary Card */}
            <div>
              <Card padding="lg" className="bg-white shadow-sm border border-[#E5E7EB] space-y-4">
                <h3 className="text-base font-bold text-[#1F2937]">
                  {language === 'fr' ? 'Synthèse Opérationnelle' : 'Operational Summary'}
                </h3>

                <div className="divide-y divide-[#F3F4F6] text-sm">
                  <div className="py-2.5 flex justify-between items-center">
                    <span className="text-[#6B7280]">Clients enregistrés</span>
                    <span className="font-bold text-[#1F2937]">{metrics.totalCustomers}</span>
                  </div>
                  <div className="py-2.5 flex justify-between items-center">
                    <span className="text-[#6B7280]">Véhicules au parc</span>
                    <span className="font-bold text-[#1F2937]">{metrics.totalVehicles}</span>
                  </div>
                  <div className="py-2.5 flex justify-between items-center">
                    <span className="text-[#6B7280]">Ordres actifs</span>
                    <span className="font-bold text-amber-700">{metrics.activeJobs}</span>
                  </div>
                  <div className="py-2.5 flex justify-between items-center">
                    <span className="text-[#6B7280]">Taux de recouvrement</span>
                    <span className="font-bold text-green-700">
                      {metrics.revenueThisMonth + metrics.outstandingAmount > 0
                        ? `${Math.round(
                            (metrics.revenueThisMonth / (metrics.revenueThisMonth + metrics.outstandingAmount)) * 100
                          )}%`
                        : '100%'}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                  💡 <strong>Conseil Pro :</strong> Chaque paiement enregistré sur un ordre de réparation est automatiquement synchronisé dans le grand livre partagé KaziBox Finance avec référence déterministe.
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: REPAIR JOBS (Work Orders)
      ===================================================================== */}
      {!loading && activeTab === 'jobs' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-[#E5E7EB]">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                placeholder="Rechercher par n° OR, client, véhicule..."
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#D1D5DB] w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <select
                value={jobStatusFilter}
                onChange={(e) => setJobStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#D1D5DB] bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="all">Tous les statuts</option>
                <option value="open">Ouvert</option>
                <option value="diagnosing">Diagnostic</option>
                <option value="in_progress">En cours</option>
                <option value="waiting_parts">Attente pièces</option>
                <option value="completed">Terminé</option>
                <option value="delivered">Livré</option>
                <option value="cancelled">Annulé</option>
              </select>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white w-full sm:w-auto"
              onClick={() => {
                if (customers.length > 0) setNewJobCustomerId(customers[0].id);
                if (vehicles.length > 0) setNewJobVehicleId(vehicles[0].id);
                setIsAddJobOpen(true);
              }}
            >
              + Nouvel Ordre
            </Button>
          </div>

          {/* Jobs Table */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F9FAFB] text-[#6B7280] font-bold border-b border-[#E5E7EB] uppercase">
                  <tr>
                    <th className="py-3 px-4">N° OR</th>
                    <th className="py-3 px-4">Véhicule</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Motif / Travaux</th>
                    <th className="py-3 px-4">Statut</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-right">Solde Dû</th>
                    <th className="py-3 px-4 text-center">Paiement</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {jobs
                    .filter((j) => {
                      if (jobStatusFilter !== 'all' && j.status !== jobStatusFilter) return false;
                      if (jobSearch.trim()) {
                        const s = jobSearch.toLowerCase();
                        return (
                          j.job_number.toLowerCase().includes(s) ||
                          j.title.toLowerCase().includes(s) ||
                          (j.customer?.name || '').toLowerCase().includes(s) ||
                          (j.vehicle?.registration_number || '').toLowerCase().includes(s)
                        );
                      }
                      return true;
                    })
                    .map((job) => (
                      <tr key={job.id} className="hover:bg-amber-50/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-amber-900">
                          {job.job_number}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#1F2937]">{job.vehicle?.make} {job.vehicle?.model}</div>
                          <span className="text-[11px] font-mono text-gray-500">{job.vehicle?.registration_number}</span>
                        </td>
                        <td className="py-3 px-4 font-medium text-[#1F2937]">
                          {job.customer?.name}
                        </td>
                        <td className="py-3 px-4 max-w-xs truncate text-[#4B5563]">
                          {job.title}
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(job.status)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-[#1F2937]">
                          {job.total_amount.toLocaleString()} XOF
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-rose-700">
                          {job.outstanding_amount > 0 ? `${job.outstanding_amount.toLocaleString()} XOF` : '—'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {getPaymentStatusBadge(job.payment_status)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs py-1 px-2.5"
                            onClick={() => setSelectedJobForDetail(job)}
                          >
                            Détails &rarr;
                          </Button>
                        </td>
                      </tr>
                    ))}

                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-[#9CA3AF]">
                        Aucun ordre de réparation enregistré.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: CUSTOMERS
      ===================================================================== */}
      {!loading && activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-[#E5E7EB]">
            <input
              type="text"
              placeholder="Rechercher par nom, téléphone..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#D1D5DB] w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <Button
              variant="primary"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white w-full sm:w-auto"
              onClick={() => setIsAddCustomerOpen(true)}
            >
              + Nouveau Client
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customers
              .filter((c) => {
                if (!customerSearch.trim()) return true;
                const s = customerSearch.toLowerCase();
                return c.name.toLowerCase().includes(s) || c.phone.toLowerCase().includes(s);
              })
              .map((c) => {
                const cVehicles = vehicles.filter((v) => v.customer_id === c.id);
                const cJobs = jobs.filter((j) => j.customer_id === c.id);
                const outstanding = cJobs.reduce((sum, j) => sum + Number(j.outstanding_amount), 0);

                return (
                  <Card
                    key={c.id}
                    padding="md"
                    className="bg-white hover:border-amber-300 transition-all cursor-pointer shadow-sm"
                    onClick={() => setSelectedCustomerForDetail(c)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-base text-[#1F2937]">{c.name}</h4>
                      <Badge variant="purple" size="sm">
                        {cVehicles.length} véhicule(s)
                      </Badge>
                    </div>

                    <div className="text-xs text-[#6B7280] space-y-1">
                      <p>📞 {c.phone}</p>
                      {c.email && <p>✉️ {c.email}</p>}
                      {c.address && <p>📍 {c.address}</p>}
                    </div>

                    <div className="mt-3 pt-3 border-t border-[#F3F4F6] flex justify-between items-center text-xs">
                      <span className="text-[#6B7280]">Solde dû :</span>
                      <span className={`font-bold ${outstanding > 0 ? 'text-rose-600' : 'text-green-600'}`}>
                        {outstanding > 0 ? `${outstanding.toLocaleString()} XOF` : 'À jour (0 XOF)'}
                      </span>
                    </div>
                  </Card>
                );
              })}

            {customers.length === 0 && (
              <div className="col-span-full text-center py-8 text-sm text-[#9CA3AF]">
                Aucun client dans la base de données.
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: VEHICLES & SERVICE HISTORY
      ===================================================================== */}
      {!loading && activeTab === 'vehicles' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-[#E5E7EB]">
            <input
              type="text"
              placeholder="Rechercher par immatriculation, marque, modèle..."
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#D1D5DB] w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <Button
              variant="primary"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white w-full sm:w-auto"
              onClick={() => {
                if (customers.length > 0) setNewVehCustomerId(customers[0].id);
                setIsAddVehicleOpen(true);
              }}
            >
              + Nouveau Véhicule
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles
              .filter((v) => {
                if (!vehicleSearch.trim()) return true;
                const s = vehicleSearch.toLowerCase();
                return (
                  v.registration_number.toLowerCase().includes(s) ||
                  v.make.toLowerCase().includes(s) ||
                  v.model.toLowerCase().includes(s) ||
                  (v.customer?.name || '').toLowerCase().includes(s)
                );
              })
              .map((v) => {
                const vHistory = jobs.filter((j) => j.vehicle_id === v.id);

                return (
                  <Card
                    key={v.id}
                    padding="md"
                    className="bg-white hover:border-amber-300 transition-all cursor-pointer shadow-sm"
                    onClick={() => setSelectedVehicleForDetail(v)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-black text-xs px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded">
                        {v.registration_number}
                      </span>
                      <Badge variant={v.status === 'active' ? 'green' : 'gray'} size="sm">
                        {v.status === 'active' ? 'Actif' : 'Inactif'}
                      </Badge>
                    </div>

                    <h4 className="font-bold text-base text-[#1F2937]">
                      {v.make} {v.model} {v.year ? `(${v.year})` : ''}
                    </h4>

                    <div className="text-xs text-[#6B7280] space-y-1 mt-1">
                      <p>👤 Propriétaire : <strong>{v.customer?.name || 'Inconnu'}</strong></p>
                      {v.mileage && <p>⏱️ Kilométrage : {v.mileage.toLocaleString()} km</p>}
                      {v.color && <p>🎨 Couleur : {v.color}</p>}
                    </div>

                    <div className="mt-3 pt-3 border-t border-[#F3F4F6] flex justify-between items-center text-xs">
                      <span className="text-[#6B7280]">Interventions :</span>
                      <span className="font-bold text-amber-700">{vHistory.length} OR réalisé(s)</span>
                    </div>
                  </Card>
                );
              })}

            {vehicles.length === 0 && (
              <div className="col-span-full text-center py-8 text-sm text-[#9CA3AF]">
                Aucun véhicule enregistré.
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: REPORTS & REVENUE
      ===================================================================== */}
      {!loading && activeTab === 'reports' && reports && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card padding="md" className="bg-white border-l-4 border-l-green-500 shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">CA Aujourd’hui</span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">
                {reports.revenueToday.toLocaleString()} XOF
              </div>
            </Card>
            <Card padding="md" className="bg-white border-l-4 border-l-blue-500 shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">CA 7 Derniers Jours</span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">
                {reports.revenueThisWeek.toLocaleString()} XOF
              </div>
            </Card>
            <Card padding="md" className="bg-white border-l-4 border-l-amber-500 shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">CA Mensuel</span>
              <div className="text-2xl font-black text-[#1F2937] mt-1">
                {reports.revenueThisMonth.toLocaleString()} XOF
              </div>
            </Card>
            <Card padding="md" className="bg-white border-l-4 border-l-rose-500 shadow-sm">
              <span className="text-xs font-bold text-[#6B7280] uppercase">Créances à Recouvrer</span>
              <div className="text-2xl font-black text-rose-700 mt-1">
                {reports.totalOutstanding.toLocaleString()} XOF
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card padding="lg" className="bg-white shadow-sm border border-[#E5E7EB]">
              <h3 className="text-base font-bold text-[#1F2937] mb-4">
                Répartition des ordres par statut
              </h3>
              <div className="space-y-2 text-xs">
                {Object.entries(reports.jobsByStatus).map(([statusKey, count]) => (
                  <div key={statusKey} className="flex justify-between items-center py-1.5 border-b border-[#F9FAFB]">
                    <span className="capitalize text-[#4B5563]">{statusKey.replace('_', ' ')}</span>
                    <span className="font-bold text-[#1F2937]">{count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card padding="lg" className="bg-white shadow-sm border border-[#E5E7EB]">
              <h3 className="text-base font-bold text-[#1F2937] mb-4">
                Top Services & Interventions les plus demandées
              </h3>
              <div className="space-y-3 text-xs">
                {reports.topServices.map((srv, idx) => (
                  <div key={idx} className="flex justify-between items-center py-1 border-b border-[#F9FAFB]">
                    <div>
                      <p className="font-bold text-[#1F2937]">{srv.name}</p>
                      <span className="text-gray-500">{srv.count} interventions</span>
                    </div>
                    <span className="font-black text-amber-900">{srv.totalRevenue.toLocaleString()} XOF</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: NOUVEAU CLIENT
      ===================================================================== */}
      {isAddCustomerOpen && (
        <Modal
          isOpen={isAddCustomerOpen}
          onClose={() => setIsAddCustomerOpen(false)}
          title="Nouveau Client Garage"
        >
          <form onSubmit={handleCreateCustomer} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-[#374151] mb-1">Nom complet *</label>
              <input
                type="text"
                required
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                placeholder="Ex: Ibrahima Diallo"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block font-bold text-[#374151] mb-1">Téléphone *</label>
              <input
                type="text"
                required
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                placeholder="Ex: +221 77 123 45 67"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block font-bold text-[#374151] mb-1">Email</label>
              <input
                type="email"
                value={newCustEmail}
                onChange={(e) => setNewCustEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block font-bold text-[#374151] mb-1">Adresse</label>
              <input
                type="text"
                value={newCustAddress}
                onChange={(e) => setNewCustAddress(e.target.value)}
                placeholder="Quartier / Ville"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block font-bold text-[#374151] mb-1">Notes client</label>
              <textarea
                value={newCustNotes}
                onChange={(e) => setNewCustNotes(e.target.value)}
                rows={2}
                placeholder="Remarques particulières..."
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsAddCustomerOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                Enregistrer Client
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 2: NOUVEAU VÉHICULE
      ===================================================================== */}
      {isAddVehicleOpen && (
        <Modal
          isOpen={isAddVehicleOpen}
          onClose={() => setIsAddVehicleOpen(false)}
          title="Nouveau Véhicule"
        >
          <form onSubmit={handleCreateVehicle} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-[#374151] mb-1">Propriétaire (Client) *</label>
              <select
                required
                value={newVehCustomerId}
                onChange={(e) => setNewVehCustomerId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] bg-white focus:ring-2 focus:ring-amber-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Immatriculation *</label>
                <input
                  type="text"
                  required
                  value={newVehReg}
                  onChange={(e) => setNewVehReg(e.target.value)}
                  placeholder="Ex: DK-1234-AZ"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] font-mono uppercase focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block font-bold text-[#374151] mb-1">Marque *</label>
                <input
                  type="text"
                  required
                  value={newVehMake}
                  onChange={(e) => setNewVehMake(e.target.value)}
                  placeholder="Ex: Toyota"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Modèle *</label>
                <input
                  type="text"
                  required
                  value={newVehModel}
                  onChange={(e) => setNewVehModel(e.target.value)}
                  placeholder="Ex: Corolla"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block font-bold text-[#374151] mb-1">Année</label>
                <input
                  type="number"
                  value={newVehYear}
                  onChange={(e) => setNewVehYear(e.target.value)}
                  placeholder="Ex: 2018"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Kilométrage (km)</label>
                <input
                  type="number"
                  value={newVehMileage}
                  onChange={(e) => setNewVehMileage(e.target.value)}
                  placeholder="Ex: 120000"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block font-bold text-[#374151] mb-1">Couleur</label>
                <input
                  type="text"
                  value={newVehColor}
                  onChange={(e) => setNewVehColor(e.target.value)}
                  placeholder="Ex: Blanc"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">N° de Châssis (VIN - Optionnel)</label>
              <input
                type="text"
                value={newVehVin}
                onChange={(e) => setNewVehVin(e.target.value)}
                placeholder="Ex: JT11W009210082"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] font-mono focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsAddVehicleOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                Enregistrer Véhicule
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 3: NOUVEL ORDRE DE RÉPARATION (OR)
      ===================================================================== */}
      {isAddJobOpen && (
        <Modal
          isOpen={isAddJobOpen}
          onClose={() => setIsAddJobOpen(false)}
          title="Créer un Ordre de Réparation (OR)"
        >
          <form onSubmit={handleCreateJob} className="space-y-4 text-xs max-h-[75vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Client *</label>
                <select
                  required
                  value={newJobCustomerId}
                  onChange={(e) => {
                    const cId = e.target.value;
                    setNewJobCustomerId(cId);
                    const vList = vehicles.filter((v) => v.customer_id === cId);
                    if (vList.length > 0) setNewJobVehicleId(vList[0].id);
                    else setNewJobVehicleId('');
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] bg-white focus:ring-2 focus:ring-amber-500"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#374151] mb-1">Véhicule concerné *</label>
                <select
                  required
                  value={newJobVehicleId}
                  onChange={(e) => setNewJobVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] bg-white focus:ring-2 focus:ring-amber-500"
                >
                  {customerVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.make} {v.model} ({v.registration_number})
                    </option>
                  ))}
                  {customerVehicles.length === 0 && (
                    <option value="" disabled>Aucun véhicule pour ce client</option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Motif / Intitulé intervention *</label>
              <input
                type="text"
                required
                value={newJobTitle}
                onChange={(e) => setNewJobTitle(e.target.value)}
                placeholder="Ex: Révision complète & plaquettes de frein"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Mécanicien en charge</label>
                <input
                  type="text"
                  value={newJobMechanic}
                  onChange={(e) => setNewJobMechanic(e.target.value)}
                  placeholder="Ex: Moussa Diouf"
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block font-bold text-[#374151] mb-1">Date estimée restitution</label>
                <input
                  type="date"
                  value={newJobExpectedDate}
                  onChange={(e) => setNewJobExpectedDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Diagnostic initial / Symptômes constatés</label>
              <textarea
                value={newJobDiagnosis}
                onChange={(e) => setNewJobDiagnosis(e.target.value)}
                rows={2}
                placeholder="Bruits suspects au freinage, niveau d'huile bas..."
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Initial Items (Services & Parts) */}
            <div className="pt-2 border-t border-[#F3F4F6]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-[#374151]">Services & Pièces initiales</span>
                <span className="font-black text-amber-900">Total : {newJobCalculatedTotal.toLocaleString()} XOF</span>
              </div>
              <div className="space-y-2">
                {newJobItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-[#F9FAFB] p-2 rounded-lg">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.item_type === 'service' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                      {item.item_type === 'service' ? 'Service' : 'Pièce'}
                    </span>
                    <span className="flex-1 font-medium">{item.name}</span>
                    <span className="text-gray-500 font-mono">x{item.quantity}</span>
                    <span className="font-bold">{(item.quantity * item.unit_price).toLocaleString()} XOF</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#F3F4F6]">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsAddJobOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                Ouvrir l’Ordre (OR)
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 4: DÉTAIL DE L'ORDRE DE RÉPARATION
      ===================================================================== */}
      {selectedJobForDetail && (
        <Modal
          isOpen={Boolean(selectedJobForDetail)}
          onClose={() => setSelectedJobForDetail(null)}
          title={`Ordre de Réparation ${selectedJobForDetail.job_number}`}
        >
          <div className="space-y-5 text-xs max-h-[80vh] overflow-y-auto pr-1">
            {/* Header info */}
            <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="font-mono text-[11px] text-gray-500">Immatriculation</span>
                <div className="text-base font-black font-mono text-amber-900">
                  {selectedJobForDetail.vehicle?.registration_number}
                </div>
                <div className="text-xs text-[#4B5563]">
                  {selectedJobForDetail.vehicle?.make} {selectedJobForDetail.vehicle?.model}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-gray-500">Client</span>
                <div className="font-bold text-[#1F2937]">{selectedJobForDetail.customer?.name}</div>
                <div className="text-xs text-[#4B5563]">📞 {selectedJobForDetail.customer?.phone}</div>
              </div>

              <div>
                <span className="text-[11px] text-gray-500">Statut de l’OR</span>
                <div className="mt-0.5">{getStatusBadge(selectedJobForDetail.status)}</div>
              </div>
            </div>

            {/* Diagnosis & Notes */}
            <div className="space-y-2">
              <h4 className="font-bold text-[#1F2937]">Motif & Diagnostic</h4>
              <p className="p-2.5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[#374151]">
                <strong>Motif :</strong> {selectedJobForDetail.title}
                {selectedJobForDetail.diagnosis && (
                  <span className="block mt-1 text-[#6B7280]">
                    <strong>Diagnostic :</strong> {selectedJobForDetail.diagnosis}
                  </span>
                )}
                {selectedJobForDetail.mechanic_name && (
                  <span className="block mt-1 text-gray-500">
                    👨‍🔧 Mécanicien : <strong>{selectedJobForDetail.mechanic_name}</strong>
                  </span>
                )}
              </p>
            </div>

            {/* Status Workflow Actions */}
            <div className="space-y-2">
              <h4 className="font-bold text-[#1F2937]">Changer le statut d’intervention</h4>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2"
                  onClick={() => handleStatusChange(selectedJobForDetail.id, 'diagnosing')}
                >
                  Diagnostic
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2 text-amber-800 bg-amber-50 border-amber-300"
                  onClick={() => handleStatusChange(selectedJobForDetail.id, 'in_progress')}
                >
                  Démarrer travaux
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2 text-red-800 bg-red-50 border-red-300"
                  onClick={() => handleStatusChange(selectedJobForDetail.id, 'waiting_parts')}
                >
                  Attente pièces
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2 text-green-800 bg-green-50 border-green-300 font-bold"
                  onClick={() => handleStatusChange(selectedJobForDetail.id, 'completed')}
                >
                  ✓ Marquer Terminé
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2"
                  onClick={() => handleStatusChange(selectedJobForDetail.id, 'delivered')}
                >
                  🚗 Livrer au client
                </Button>
              </div>
            </div>

            {/* Items (Services & Parts) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-[#1F2937]">Prestations & Pièces utilisées</h4>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-0.5 px-2"
                  onClick={() => setIsAddItemModalOpen(true)}
                >
                  + Ajouter ligne
                </Button>
              </div>

              <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F9FAFB] text-[#6B7280] font-bold">
                    <tr>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Libellé</th>
                      <th className="py-2 px-3 text-center">Qté</th>
                      <th className="py-2 px-3 text-right">P.U.</th>
                      <th className="py-2 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {(selectedJobForDetail.items || []).map((it) => (
                      <tr key={it.id}>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${it.item_type === 'service' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                            {it.item_type === 'service' ? 'Main d’œuvre' : 'Pièce'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-medium text-[#1F2937]">{it.name}</td>
                        <td className="py-2 px-3 text-center font-mono">{it.quantity}</td>
                        <td className="py-2 px-3 text-right text-gray-500">{Number(it.unit_price).toLocaleString()} XOF</td>
                        <td className="py-2 px-3 text-right font-bold text-[#1F2937]">{Number(it.total).toLocaleString()} XOF</td>
                      </tr>
                    ))}
                    {(selectedJobForDetail.items || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-gray-400">Aucune prestation détaillée.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Status & Payment Recording */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-500">Montant Total :</span>
                  <div className="text-lg font-black text-[#1F2937]">
                    {selectedJobForDetail.total_amount.toLocaleString()} XOF
                  </div>
                </div>

                <div>
                  <span className="text-gray-500">Déjà réglé :</span>
                  <div className="text-lg font-black text-green-700">
                    {selectedJobForDetail.paid_amount.toLocaleString()} XOF
                  </div>
                </div>

                <div>
                  <span className="text-gray-500">Reste à payer :</span>
                  <div className="text-lg font-black text-rose-700">
                    {selectedJobForDetail.outstanding_amount.toLocaleString()} XOF
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">Statut de paiement :</span>
                  {getPaymentStatusBadge(selectedJobForDetail.payment_status)}
                </div>

                {selectedJobForDetail.outstanding_amount > 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => {
                      setPaymentAmount(String(selectedJobForDetail.outstanding_amount));
                      setIsPaymentModalOpen(true);
                    }}
                  >
                    💳 Encaisser Paiement
                  </Button>
                )}
              </div>
            </div>

            {/* Payment History */}
            <div className="space-y-2">
              <h4 className="font-bold text-[#1F2937]">Historique des encaissements</h4>
              <div className="space-y-1.5">
                {(selectedJobForDetail.payments || []).map((p) => (
                  <div key={p.id} className="p-2 rounded-lg bg-green-50/50 border border-green-200 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-green-900">{Number(p.amount).toLocaleString()} XOF</span>
                      <span className="text-gray-500 ml-2">({p.payment_method})</span>
                      {p.reference && <span className="text-gray-400 font-mono ml-2">[{p.reference}]</span>}
                    </div>
                    <span className="text-gray-400">
                      {new Date(p.paid_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                {(selectedJobForDetail.payments || []).length === 0 && (
                  <p className="text-gray-400 text-xs italic">Aucun règlement enregistré sur cet ordre.</p>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 5: ENCAISSER PAIEMENT
      ===================================================================== */}
      {isPaymentModalOpen && selectedJobForDetail && (
        <Modal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          title={`Encaisser Paiement — OR ${selectedJobForDetail.job_number}`}
        >
          <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50 rounded-lg text-amber-900">
              Solde restant à régler : <strong>{selectedJobForDetail.outstanding_amount.toLocaleString()} XOF</strong>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Montant à encaisser (XOF) *</label>
              <input
                type="number"
                required
                max={selectedJobForDetail.outstanding_amount}
                min={1}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] font-bold text-sm focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Mode de règlement *</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] bg-white focus:ring-2 focus:ring-amber-500"
              >
                <option value="cash">Espèces (Cash)</option>
                <option value="mobile_money">Mobile Money (Orange Money / Wave / MTN)</option>
                <option value="card">Carte bancaire</option>
                <option value="bank_transfer">Virement bancaire</option>
                <option value="other">Autre</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Référence transaction (Optionnel)</label>
              <input
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Ex: TX-OM-98214"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Notes règlement</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Ex: Reçu délivré au client"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsPaymentModalOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" type="submit" className="bg-green-600 hover:bg-green-700 text-white">
                Valider l’encaissement
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 6: AJOUTER LIGNE (SERVICE OU PIÈCE)
      ===================================================================== */}
      {isAddItemModalOpen && selectedJobForDetail && (
        <Modal
          isOpen={isAddItemModalOpen}
          onClose={() => setIsAddItemModalOpen(false)}
          title="Ajouter une prestation ou pièce"
        >
          <form onSubmit={handleAddItemToJob} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-[#374151] mb-1">Type *</label>
              <select
                value={newItemType}
                onChange={(e) => setNewItemType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] bg-white focus:ring-2 focus:ring-amber-500"
              >
                <option value="service">Main d’œuvre / Service</option>
                <option value="part">Pièce détachée</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-[#374151] mb-1">Désignation / Libellé *</label>
              <input
                type="text"
                required
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Ex: Remplacement filtre à carburant"
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[#374151] mb-1">Quantité *</label>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  required
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block font-bold text-[#374151] mb-1">Prix unitaire (XOF) *</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="p-2 bg-gray-50 rounded text-right font-bold text-gray-700">
              Total ligne : {((parseFloat(newItemQty) || 0) * (parseFloat(newItemPrice) || 0)).toLocaleString()} XOF
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsAddItemModalOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                Ajouter à l’OR
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 7: FICHE CLIENT & VÉHICULES
      ===================================================================== */}
      {selectedCustomerForDetail && (
        <Modal
          isOpen={Boolean(selectedCustomerForDetail)}
          onClose={() => setSelectedCustomerForDetail(null)}
          title={`Fiche Client — ${selectedCustomerForDetail.name}`}
        >
          <div className="space-y-4 text-xs max-h-[75vh] overflow-y-auto">
            <div className="p-3 bg-gray-50 rounded-xl space-y-1 text-[#374151]">
              <p>📞 <strong>Téléphone :</strong> {selectedCustomerForDetail.phone}</p>
              {selectedCustomerForDetail.email && <p>✉️ <strong>Email :</strong> {selectedCustomerForDetail.email}</p>}
              {selectedCustomerForDetail.address && <p>📍 <strong>Adresse :</strong> {selectedCustomerForDetail.address}</p>}
              {selectedCustomerForDetail.notes && <p className="italic text-gray-500">📝 {selectedCustomerForDetail.notes}</p>}
            </div>

            <div>
              <h4 className="font-bold text-[#1F2937] mb-2">Véhicules du client</h4>
              <div className="space-y-2">
                {vehicles
                  .filter((v) => v.customer_id === selectedCustomerForDetail.id)
                  .map((v) => (
                    <div key={v.id} className="p-2 rounded-lg border border-gray-200 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-[#1F2937]">{v.make} {v.model}</span>
                        <span className="font-mono text-gray-500 ml-2">({v.registration_number})</span>
                      </div>
                      <Badge variant="gray" size="sm">{v.mileage?.toLocaleString() || 0} km</Badge>
                    </div>
                  ))}
              </div>
            </div>

            <div>
              <h4 className="font-bold text-[#1F2937] mb-2">Historique des ordres de réparation</h4>
              <div className="space-y-2">
                {jobs
                  .filter((j) => j.customer_id === selectedCustomerForDetail.id)
                  .map((j) => (
                    <div key={j.id} className="p-2 rounded-lg bg-gray-50 flex justify-between items-center">
                      <div>
                        <span className="font-bold font-mono text-amber-900">{j.job_number}</span>
                        <span className="text-gray-600 ml-2">{j.title}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold">{j.total_amount.toLocaleString()} XOF</span>
                        <div className="text-[10px]">{getPaymentStatusBadge(j.payment_status)}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* =====================================================================
          MODAL 8: FICHE VÉHICULE & HISTORIQUE COMPLET
      ===================================================================== */}
      {selectedVehicleForDetail && (
        <Modal
          isOpen={Boolean(selectedVehicleForDetail)}
          onClose={() => setSelectedVehicleForDetail(null)}
          title={`Fiche Véhicule — ${selectedVehicleForDetail.registration_number}`}
        >
          <div className="space-y-4 text-xs max-h-[75vh] overflow-y-auto">
            <div className="p-3 bg-amber-50/60 rounded-xl space-y-1.5 border border-amber-200 text-[#374151]">
              <div className="flex justify-between items-center">
                <span className="text-base font-black text-amber-900">
                  {selectedVehicleForDetail.make} {selectedVehicleForDetail.model}
                </span>
                <span className="font-mono font-bold px-2 py-0.5 bg-white border border-amber-300 rounded">
                  {selectedVehicleForDetail.registration_number}
                </span>
              </div>
              <p>👤 <strong>Propriétaire :</strong> {selectedVehicleForDetail.customer?.name}</p>
              {selectedVehicleForDetail.mileage && <p>⏱️ <strong>Kilométrage actuel :</strong> {selectedVehicleForDetail.mileage.toLocaleString()} km</p>}
              {selectedVehicleForDetail.vin && <p className="font-mono">🔑 <strong>VIN (Châssis) :</strong> {selectedVehicleForDetail.vin}</p>}
            </div>

            <div>
              <h4 className="font-bold text-[#1F2937] mb-2">Historique d’entretien & interventions</h4>
              <div className="space-y-2">
                {jobs
                  .filter((j) => j.vehicle_id === selectedVehicleForDetail.id)
                  .map((j) => (
                    <div
                      key={j.id}
                      onClick={() => {
                        setSelectedVehicleForDetail(null);
                        setSelectedJobForDetail(j);
                      }}
                      className="p-3 rounded-lg border border-gray-200 hover:border-amber-300 cursor-pointer transition-colors"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono font-bold text-amber-900">{j.job_number}</span>
                        <span>{getStatusBadge(j.status)}</span>
                      </div>
                      <div className="font-medium text-[#1F2937]">{j.title}</div>
                      <div className="text-[11px] text-gray-500 mt-1 flex justify-between">
                        <span>Ouvert le {new Date(j.opened_at).toLocaleDateString('fr-FR')}</span>
                        <span className="font-bold text-[#1F2937]">{j.total_amount.toLocaleString()} XOF</span>
                      </div>
                    </div>
                  ))}

                {jobs.filter((j) => j.vehicle_id === selectedVehicleForDetail.id).length === 0 && (
                  <p className="text-gray-400 italic">Aucune réparation enregistrée pour ce véhicule.</p>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
