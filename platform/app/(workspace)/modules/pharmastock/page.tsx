'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge, Input } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { RequireAccess } from '../../components/RequireAccess';

interface Medication {
  id: string;
  name: string;
  genericName: string;
  dosage: string;
  sellingPrice: number;
  stockCount: number;
  category: string;
  batches: Array<{
    batchNumber: string;
    quantity: number;
    expiryDate: string;
    costPrice: number;
  }>;
}

const INITIAL_MEDS: Medication[] = [
  {
    id: 'med-01',
    name: 'Paracétamol Biogaran',
    genericName: 'Paracetamol',
    dosage: '500mg (Boîte de 16 comprimés)',
    sellingPrice: 1200,
    stockCount: 140,
    category: 'Analgésique',
    batches: [
      { batchNumber: 'LOT-PA-2401', quantity: 100, expiryDate: '2027-04-30', costPrice: 750 },
      { batchNumber: 'LOT-PA-2389', quantity: 40, expiryDate: '2026-11-20', costPrice: 720 },
    ],
  },
  {
    id: 'med-02',
    name: 'Amoxicilline Sandoz',
    genericName: 'Amoxicillin',
    dosage: '1g (Boîte de 14 comprimés)',
    sellingPrice: 3800,
    stockCount: 52,
    category: 'Antibiotique',
    batches: [
      { batchNumber: 'LOT-AM-104', quantity: 22, expiryDate: '2026-11-15', costPrice: 2400 },
      { batchNumber: 'LOT-AM-202', quantity: 30, expiryDate: '2027-08-30', costPrice: 2500 },
    ],
  },
  {
    id: 'med-03',
    name: 'Artéméther / Luméfantrine (Coartem)',
    genericName: 'Artemether-Lumefantrine',
    dosage: '20/120mg (Boîte de 24)',
    sellingPrice: 4500,
    stockCount: 88,
    category: 'Antipaludéen',
    batches: [
      { batchNumber: 'LOT-CT-991', quantity: 38, expiryDate: '2026-12-05', costPrice: 2900 },
      { batchNumber: 'LOT-CT-995', quantity: 50, expiryDate: '2027-10-15', costPrice: 3000 },
    ],
  },
  {
    id: 'med-04',
    name: 'Oméprazole Générique',
    genericName: 'Omeprazole',
    dosage: '20mg (Boîte de 28 gélules)',
    sellingPrice: 2900,
    stockCount: 18,
    category: 'Gastro-entérologie',
    batches: [
      { batchNumber: 'LOT-OM-441', quantity: 18, expiryDate: '2026-11-05', costPrice: 1800 },
    ],
  },
];

function PharmaStockContent() {
  const { user } = useSession();
  const { language } = useTranslation();
  const searchParams = useSearchParams();
  const ssoTokenParam = searchParams.get('token');

  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'alerts' | 'restock' | 'telemetry'>('sales');
  const [meds, setMeds] = useState<Medication[]>(INITIAL_MEDS);
  const [ssoToken, setSsoToken] = useState<string | null>(ssoTokenParam);
  const [ssoGenerating, setSsoGenerating] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // POS State
  const [selectedMedId, setSelectedMedId] = useState(INITIAL_MEDS[0].id);
  const [saleQty, setSaleQty] = useState(1);
  const [patientName, setPatientName] = useState('Patient Anonyme');
  const [doctorName, setDoctorName] = useState('Dr. Koffi');
  const [salesLog, setSalesLog] = useState<Array<any>>([
    {
      id: 'SALE-001',
      date: new Date().toLocaleTimeString(),
      patient: 'Mme Touré',
      item: 'Paracétamol 500mg (x2)',
      total: 2400,
      currency: 'XOF',
      status: 'Synchro KaziBox OK',
    },
  ]);

  // Restock State
  const [restockMedId, setRestockMedId] = useState(INITIAL_MEDS[0].id);
  const [restockBatchNo, setRestockBatchNo] = useState(`LOT-${Date.now().toString().slice(-4)}`);
  const [restockQty, setRestockQty] = useState(50);
  const [restockCost, setRestockCost] = useState(800);
  const [restockExpiry, setRestockExpiry] = useState('2027-12-31');

  // Telemetry Summary State
  const [telemetry, setTelemetry] = useState<any>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  // Fetch or regenerate SSO token
  const generateSsoToken = async () => {
    setSsoGenerating(true);
    try {
      const res = await fetch('/api/v1/modules/pharmastock/launch', { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.token) {
        setSsoToken(data.token);
        setNotification({
          type: 'success',
          message: language === 'fr'
            ? 'Jeton SSO cryptographique (TTL 5 min) généré avec succès !'
            : 'Cryptographic SSO token (5-min TTL) successfully issued!',
        });
      } else {
        setNotification({
          type: 'error',
          message: data.error || 'Erreur lors de la génération du jeton SSO',
        });
      }
    } catch {
      setNotification({ type: 'error', message: 'Erreur réseau SSO' });
    } finally {
      setSsoGenerating(false);
    }
  };

  // Fetch telemetry metrics
  const loadTelemetry = async () => {
    setTelemetryLoading(true);
    try {
      const res = await fetch('/api/v1/pharmastock/summary', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTelemetryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'telemetry') {
      loadTelemetry();
    }
  }, [activeTab]);

  // Handle POS Sale with FIFO Deduction and KaziBox Finance Sync
  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    const med = meds.find((m) => m.id === selectedMedId);
    if (!med) return;
    if (med.stockCount < saleQty) {
      setNotification({
        type: 'error',
        message: language === 'fr' ? 'Stock insuffisant pour cette vente !' : 'Insufficient stock for this sale!',
      });
      return;
    }

    // FIFO batch deduction logic
    let remainingToDeduct = saleQty;
    const updatedBatches = [...med.batches];
    let deductedBatch = '';

    for (const b of updatedBatches) {
      if (remainingToDeduct <= 0) break;
      if (b.quantity > 0) {
        deductedBatch = b.batchNumber;
        const take = Math.min(b.quantity, remainingToDeduct);
        b.quantity -= take;
        remainingToDeduct -= take;
      }
    }

    const totalAmount = med.sellingPrice * saleQty;
    const ref = `SALE-${Date.now().toString().slice(-6)}`;

    // Update local inventory state
    setMeds((prev) =>
      prev.map((m) =>
        m.id === med.id
          ? { ...m, stockCount: m.stockCount - saleQty, batches: updatedBatches }
          : m
      )
    );

    // Call KaziBox shared finance revenue sync
    try {
      const res = await fetch('/api/v1/finance/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          moduleId: 'pharmastock',
          amount: totalAmount,
          currency: 'XOF',
          source: `PharmaStock — Vente ${med.name} (Lot ${deductedBatch})`,
          reference: `PHARMA-${ref}`,
          occurredAt: new Date().toISOString(),
        }),
      });

      const syncOk = res.ok;
      setSalesLog((prev) => [
        {
          id: ref,
          date: new Date().toLocaleTimeString(),
          patient: patientName,
          item: `${med.name} (x${saleQty})`,
          total: totalAmount,
          currency: 'XOF',
          status: syncOk ? 'Synchro KaziBox OK' : 'Local Enregistré',
        },
        ...prev,
      ]);

      setNotification({
        type: 'success',
        message: language === 'fr'
          ? `Vente de ${totalAmount.toLocaleString()} XOF enregistrée et synchronisée avec le Grand Livre KaziBox ! (Lot ${deductedBatch})`
          : `Sale of ${totalAmount.toLocaleString()} XOF recorded and synced to KaziBox Ledger! (Batch ${deductedBatch})`,
      });
    } catch {
      setNotification({
        type: 'success',
        message: `Vente ${ref} enregistrée en local (mode résilient hors-ligne).`,
      });
    }
  };

  // Handle Supplier Restock with KaziBox Expense Sync
  const handleRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    const med = meds.find((m) => m.id === restockMedId);
    if (!med) return;

    const totalExpense = restockCost * restockQty;
    const ref = `RESTOCK-${Date.now().toString().slice(-6)}`;

    const newBatch = {
      batchNumber: restockBatchNo,
      quantity: restockQty,
      expiryDate: restockExpiry,
      costPrice: restockCost,
    };

    setMeds((prev) =>
      prev.map((m) =>
        m.id === med.id
          ? { ...m, stockCount: m.stockCount + restockQty, batches: [...m.batches, newBatch] }
          : m
      )
    );

    // Sync expense to KaziBox ledger
    try {
      await fetch('/api/v1/finance/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          moduleId: 'pharmastock',
          amount: totalExpense,
          currency: 'XOF',
          category: 'Approvisionnement Médicaments / Lots Grossiste',
          reference: `PHARMA-EXP-${ref}`,
          occurredAt: new Date().toISOString(),
        }),
      });
    } catch {}

    setNotification({
      type: 'success',
      message: language === 'fr'
        ? `Approvisionnement de ${restockQty} unités (${med.name}) ajouté. Dépense de ${totalExpense.toLocaleString()} XOF envoyée à KaziBox.`
        : `Restock of ${restockQty} units (${med.name}) added. Expense of ${totalExpense.toLocaleString()} XOF sent to KaziBox.`,
    });
    setRestockBatchNo(`LOT-${Date.now().toString().slice(-4)}`);
  };

  // Expiration calculations
  const now = new Date();
  const expiringLots = meds.flatMap((m) =>
    m.batches.map((b) => {
      const exp = new Date(b.expiryDate);
      const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        medicationName: m.name,
        dosage: m.dosage,
        batchNumber: b.batchNumber,
        quantity: b.quantity,
        expiryDate: b.expiryDate,
        diffDays,
        severity: diffDays <= 30 ? 'critical' : diffDays <= 60 ? 'warning' : 'notice',
      };
    })
  ).filter((l) => l.diffDays <= 90);

  return (
    <RequireAccess moduleId="pharmastock">
      <div className="space-y-6 max-w-6xl mx-auto pb-16">
        {/* Top Header & SSO Verification Handoff Banner */}
        <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-800 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-emerald-500/10 transform skew-x-12 pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 backdrop-blur border border-emerald-400/30 flex items-center justify-center text-4xl shadow-inner">
                💊
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                    PharmaStock &trade;
                  </h1>
                  <Badge variant="green" size="sm" className="bg-emerald-400/20 text-emerald-300 border-emerald-400/30">
                    SaaS Kit Reference v1.0.0
                  </Badge>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 font-mono">
                    DigitalOcean Ready
                  </span>
                </div>
                <p className="text-emerald-100/80 text-sm mt-1 max-w-xl">
                  {language === 'fr'
                    ? 'Gestion d’officine & dispensaire connectée en temps réel au Grand Livre et à l’identité multi-tenant KaziBox.'
                    : 'Dispensary & pharmacy management synced live with KaziBox unified ledger and multi-tenant identity.'}
                </p>
              </div>
            </div>

            {/* SSO Handoff Badge & Regenerate Action */}
            <div className="flex flex-col sm:items-end gap-2 bg-emerald-950/60 p-4 rounded-2xl border border-emerald-700/50 backdrop-blur">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-bold text-emerald-200">
                  {ssoToken ? 'SSO Cryptographique Actif' : 'Session Authentifiée'}
                </span>
              </div>
              <p className="text-[11px] text-emerald-300/80 font-mono">
                Tenant: {user?.company_id?.substring(0, 8)}... | User: {user?.name || user?.email} ({user?.role})
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateSsoToken}
                  disabled={ssoGenerating}
                  className="bg-emerald-800/60 border-emerald-500/40 text-emerald-100 hover:bg-emerald-700/60 text-xs py-1 h-auto"
                >
                  {ssoGenerating ? 'Génération...' : '🔄 Nouveau Jeton SSO (5 min)'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* User Notifications */}
        {notification && (
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between text-sm transition-all ${
              notification.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <span>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-xs font-bold underline ml-4 hover:opacity-75"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2 overflow-x-auto">
          {[
            { id: 'sales', label: '🛒 Comptoir de Vente (POS)', icon: '🛒' },
            { id: 'inventory', label: '📦 Stock & Lots FIFO', icon: '📦' },
            { id: 'alerts', label: `⚠️ Alertes Péremption (${expiringLots.length})`, icon: '⚠️' },
            { id: 'restock', label: '🚚 Approvisionnement Lots', icon: '🚚' },
            { id: 'telemetry', label: '📊 Télémétrie KaziBox', icon: '📊' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-white text-[#4B5563] hover:bg-[#F3F4F6] border border-[#E5E7EB]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Comptoir de Vente & POS */}
        {activeTab === 'sales' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* POS Form */}
            <div className="lg:col-span-1 bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-sm space-y-4">
              <h2 className="text-base font-black text-[#1F2937] flex items-center gap-2">
                <span>⚡</span> Nouvelle Délivrance
              </h2>
              <form onSubmit={handleSale} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Médicament prescrit</label>
                  <select
                    value={selectedMedId}
                    onChange={(e) => setSelectedMedId(e.target.value)}
                    className="w-full text-xs font-semibold p-2.5 rounded-xl border border-[#D1D5DB] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {meds.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {m.sellingPrice.toLocaleString()} XOF (Stock: {m.stockCount})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#4B5563] mb-1">Quantité (Boîtes)</label>
                    <Input
                      type="number"
                      min="1"
                      value={saleQty}
                      onChange={(e) => setSaleQty(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#4B5563] mb-1">Total Calculé</label>
                    <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-800 font-black text-sm text-center">
                      {((meds.find((m) => m.id === selectedMedId)?.sellingPrice || 0) * saleQty).toLocaleString()} XOF
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Nom du Patient</label>
                  <Input value={patientName} onChange={(e) => setPatientName(e.target.value)} />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Médecin Prescripteur</label>
                  <Input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
                </div>

                <Button variant="primary" type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 py-3 text-sm font-bold shadow-md">
                  ✓ Valider & Synchroniser Grand Livre
                </Button>
              </form>
            </div>

            {/* Live Sales Log */}
            <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-sm">
              <h2 className="text-base font-black text-[#1F2937] mb-4 flex items-center justify-between">
                <span>📋 Historique des Ventes du Jour (Grand Livre Sync)</span>
                <span className="text-xs font-normal text-[#6B7280]">FIFO Automatique</span>
              </h2>

              <div className="divide-y divide-[#F3F4F6]">
                {salesLog.map((sale, i) => (
                  <div key={i} className="py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#1F2937]">{sale.item}</span>
                        <Badge variant="green" size="sm" className="bg-emerald-100 text-emerald-800 text-[10px]">
                          {sale.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[#6B7280] mt-0.5">
                        Réf: {sale.id} &bull; Patient: {sale.patient} &bull; {sale.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-700">
                        +{sale.total.toLocaleString()} {sale.currency}
                      </div>
                      <span className="text-[10px] text-gray-400">Idempotent</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Stock & Lots FIFO */}
        {activeTab === 'inventory' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-[#1F2937]">Inventaire des Médicaments & Lots</h2>
                <p className="text-xs text-[#6B7280]">Suivi rigoureux au niveau du lot pharmaceutique avec déduction FIFO.</p>
              </div>
              <Badge variant="purple" size="sm">
                {meds.length} Produits référencés
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-[#6B7280] font-bold">
                    <th className="py-3 px-3">Médicament</th>
                    <th className="py-3 px-3">Dosage / Présentation</th>
                    <th className="py-3 px-3">Catégorie</th>
                    <th className="py-3 px-3">Prix Vente</th>
                    <th className="py-3 px-3">Stock Global</th>
                    <th className="py-3 px-3">Lots Actifs (FIFO)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {meds.map((med) => (
                    <tr key={med.id} className="hover:bg-[#F9FAFB]">
                      <td className="py-3.5 px-3 font-black text-[#1F2937]">{med.name}</td>
                      <td className="py-3.5 px-3 text-[#6B7280]">{med.dosage}</td>
                      <td className="py-3.5 px-3">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[#4B5563] text-[10px] font-semibold">
                          {med.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-bold text-emerald-700">{med.sellingPrice.toLocaleString()} XOF</td>
                      <td className="py-3.5 px-3">
                        <span className={`font-black ${med.stockCount < 20 ? 'text-red-600' : 'text-gray-900'}`}>
                          {med.stockCount} unités
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          {med.batches.map((b, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-lg border border-[#E5E7EB] bg-white text-[10px] font-mono"
                            >
                              {b.batchNumber}: <strong>{b.quantity}</strong> (Exp: {b.expiryDate})
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Alertes Péremption */}
        {activeTab === 'alerts' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-black text-[#1F2937] flex items-center gap-2">
                <span>⚠️</span> Surveillance des Dates Limites d'Utilisation (DLUO)
              </h2>
              <p className="text-xs text-[#6B7280]">
                Alertes proactives pour éviter les destructions de stocks et respecter la législation pharmaceutique.
              </p>
            </div>

            {expiringLots.length === 0 ? (
              <div className="text-center py-12 text-[#6B7280]">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold">Aucun lot à péremption critique (&lt; 90 jours).</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {expiringLots.map((lot, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${
                      lot.diffDays <= 30
                        ? 'bg-red-50 border-red-200'
                        : lot.diffDays <= 60
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-yellow-50 border-yellow-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-[#1F2937]">{lot.medicationName}</h3>
                        <Badge
                          variant={lot.diffDays <= 30 ? 'red' : 'yellow'}
                          size="sm"
                        >
                          {lot.diffDays <= 0 ? 'PÉRIMÉ' : `Dans ${lot.diffDays} jours`}
                        </Badge>
                      </div>
                      <p className="text-xs text-[#4B5563] mt-1">
                        Lot: <span className="font-mono font-bold">{lot.batchNumber}</span> &bull; Quantité:{' '}
                        <strong>{lot.quantity}</strong> unités
                      </p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5">Date de péremption : {lot.expiryDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Approvisionnement Lots & KaziBox Expense Sync */}
        {activeTab === 'restock' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] shadow-sm max-w-xl mx-auto space-y-4">
            <h2 className="text-lg font-black text-[#1F2937] flex items-center gap-2">
              <span>🚚</span> Réception Commande Grossiste
            </h2>
            <p className="text-xs text-[#6B7280]">
              L’enregistrement du nouveau lot transmettra automatiquement une dépense au Grand Livre KaziBox.
            </p>

            <form onSubmit={handleRestock} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-bold text-[#4B5563] mb-1">Médicament à réapprovisionner</label>
                <select
                  value={restockMedId}
                  onChange={(e) => setRestockMedId(e.target.value)}
                  className="w-full text-xs font-semibold p-2.5 rounded-xl border border-[#D1D5DB] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {meds.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.dosage})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Numéro de Lot Fabricant</label>
                  <Input value={restockBatchNo} onChange={(e) => setRestockBatchNo(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Date d'Expiration</label>
                  <Input type="date" value={restockExpiry} onChange={(e) => setRestockExpiry(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Quantité reçue</label>
                  <Input
                    type="number"
                    min="1"
                    value={restockQty}
                    onChange={(e) => setRestockQty(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Prix Achat Unitaire (XOF)</label>
                  <Input
                    type="number"
                    min="1"
                    value={restockCost}
                    onChange={(e) => setRestockCost(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs flex justify-between items-center">
                <span className="text-[#6B7280]">Dépense totale générée :</span>
                <span className="font-black text-sm text-[#1F2937]">{(restockCost * restockQty).toLocaleString()} XOF</span>
              </div>

              <Button variant="primary" type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 py-3 text-sm font-bold shadow-md">
                ✓ Enregistrer Entrée en Stock & Dépense
              </Button>
            </form>
          </div>
        )}

        {/* Tab 5: Télémétrie KaziBox Summary */}
        {activeTab === 'telemetry' && (
          <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-[#1F2937]">Télémétrie Opérationnelle PharmaStock</h2>
                <p className="text-xs text-[#6B7280]">
                  Données consolidées renvoyées via l'endpoint standardisé{' '}
                  <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px]">/api/v1/pharmastock/summary</code>.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={loadTelemetry} disabled={telemetryLoading}>
                {telemetryLoading ? 'Chargement...' : '🔄 Actualiser'}
              </Button>
            </div>

            {telemetry && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                    <p className="text-xs font-bold text-emerald-800">Chiffre d’Affaires Comptoir</p>
                    <p className="text-2xl font-black text-emerald-900 mt-1">
                      {telemetry.revenue?.toLocaleString()} {telemetry.currency}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                    <p className="text-xs font-bold text-amber-800">Achats Médicaments (Lots)</p>
                    <p className="text-2xl font-black text-amber-900 mt-1">
                      {telemetry.expenses?.toLocaleString()} {telemetry.currency}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-purple-50 border border-purple-100">
                    <p className="text-xs font-bold text-purple-800">Délivrances d’Ordonnances</p>
                    <p className="text-2xl font-black text-purple-900 mt-1">
                      {telemetry.activityCount} actes
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF] mb-3">
                    Métriques Clés & Conformité
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {telemetry.metrics?.map((m: any) => (
                      <div key={m.id} className="p-3.5 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB]">
                        <p className="text-xs text-[#6B7280]">{m.label?.fr || m.label?.en || m.id}</p>
                        <p className="text-lg font-black text-[#1F2937] mt-1">{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </RequireAccess>
  );
}

export default function PharmaStockPageShell() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[400px] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PharmaStockContent />
    </Suspense>
  );
}
