'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { platformConfig } from '@/config';
import { getModules, getModuleSummaries } from '@/lib/modules';
import { getSubscription } from '@/lib/billing';
import {
  getFinanceSummary,
  getFinanceByModule,
  getFinanceTimeline,
  FinanceSummary,
  ModuleFinanceBreakdown,
  FinanceRecord,
  FinanceDateRange,
} from '@/lib/finance';
import { ModuleManifest } from '@kazibox/sdk';

export default function ConsolidatedDashboardPage() {
  const { user, workspace } = useSession();
  const { t, language } = useTranslation();

  const [dateRange, setDateRange] = useState<FinanceDateRange>('7d');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [moduleBreakdowns, setModuleBreakdowns] = useState<ModuleFinanceBreakdown[]>([]);
  const [moduleSummaries, setModuleSummaries] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<FinanceRecord[]>([]);
  const [activeModules, setActiveModules] = useState<ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const role = user?.role || 'worker';
  const isWorker = role === 'worker';
  const isPlatformAdmin = role === 'platform_admin';

  useEffect(() => {
    let isMounted = true;
    async function loadDashboard() {
      if (!workspace) return;
      setLoading(true);

      const customOptions = dateRange === 'custom' ? { startDate: customStartDate, endDate: customEndDate } : undefined;

      const [sub, allMods, finSum, finMods, finTimeline, modSums] = await Promise.all([
        getSubscription(workspace.company_id),
        getModules(),
        getFinanceSummary(workspace.company_id, dateRange, customOptions),
        getFinanceByModule(workspace.company_id, dateRange, customOptions),
        getFinanceTimeline(workspace.company_id, dateRange, customOptions),
        getModuleSummaries(workspace.company_id),
      ]);

      if (!isMounted) return;

      let filteredActive: ModuleManifest[] = [];
      if (sub && (sub.status === 'active' || sub.status === 'expiring_soon')) {
        if (sub.planId === 'all_access') {
          filteredActive = allMods.filter((m) => m.status === 'published');
        } else {
          filteredActive = allMods.filter((m) => sub.includedModuleIds?.includes(m.id));
        }
      }

      setActiveModules(filteredActive);
      setSummary(finSum);
      setModuleBreakdowns(finMods);
      setTimeline(finTimeline);
      setModuleSummaries(modSums);
      setLoading(false);
    }

    loadDashboard();
    return () => {
      isMounted = false;
    };
  }, [workspace, dateRange, customStartDate, customEndDate]);

  // Compute dynamic chart series from actual timeline data
  const chartData = useMemo(() => {
    if (!timeline || timeline.length === 0) {
      // Default baseline trend if timeline empty
      return [
        { label: 'J-6', rev: 0, exp: 0 },
        { label: 'J-5', rev: 0, exp: 0 },
        { label: 'J-4', rev: 0, exp: 0 },
        { label: 'J-3', rev: 0, exp: 0 },
        { label: 'J-2', rev: 0, exp: 0 },
        { label: 'Hier', rev: 0, exp: 0 },
        { label: 'Auj.', rev: 0, exp: 0 },
      ];
    }

    // Group timeline records by date bucket (e.g. day)
    const map = new Map<string, { rev: number; exp: number }>();
    for (const rec of timeline) {
      const day = new Date(rec.occurredAt).toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR', {
        month: 'short',
        day: 'numeric',
      });
      const current = map.get(day) || { rev: 0, exp: 0 };
      if (rec.type === 'revenue') {
        current.rev += rec.amount;
      } else {
        current.exp += rec.amount;
      }
      map.set(day, current);
    }

    const items = Array.from(map.entries()).map(([label, val]) => ({
      label,
      rev: val.rev,
      exp: val.exp,
    }));

    if (items.length === 1) {
      return [{ label: 'Début', rev: 0, exp: 0 }, ...items];
    }
    return items;
  }, [timeline, language]);

  // SVG Chart Geometry calculations
  const chartGeometry = useMemo(() => {
    const width = 500;
    const height = 150;
    const padding = 20;

    const maxVal = Math.max(
      ...chartData.map((d) => Math.max(d.rev, d.exp)),
      50000 // minimum scale so empty charts look balanced
    );

    const stepX = chartData.length > 1 ? (width - padding * 2) / (chartData.length - 1) : width / 2;

    const revPoints = chartData.map((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.rev / maxVal) * (height - padding * 2);
      return { x, y, val: d.rev };
    });

    const expPoints = chartData.map((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.exp / maxVal) * (height - padding * 2);
      return { x, y, val: d.exp };
    });

    const revPoly =
      revPoints.length > 0
        ? `0,${height} ` +
          revPoints.map((p) => `${p.x},${p.y}`).join(' ') +
          ` ${width},${height}`
        : '';

    const expPoly =
      expPoints.length > 0
        ? `0,${height} ` +
          expPoints.map((p) => `${p.x},${p.y}`).join(' ') +
          ` ${width},${height}`
        : '';

    const revPath = revPoints.reduce(
      (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
      ''
    );
    const expPath = expPoints.reduce(
      (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
      ''
    );

    return { width, height, revPoints, expPoints, revPoly, expPoly, revPath, expPath, maxVal };
  }, [chartData]);

  // Worker view: redirect notice or simplified operational view
  if (isWorker) {
    const primaryModule = activeModules[0];
    return (
      <div className="max-w-2xl mx-auto py-12 space-y-6">
        <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] shadow-xl text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#6D28D9] to-[#FACC15]" />
          <div className="w-16 h-16 rounded-2xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center text-3xl mx-auto mb-4 font-black shadow-inner">
            👷
          </div>
          <h2 className="text-2xl font-black text-[#1F2937] mb-2">
            {t('dashboard.worker_portal_title') || 'Portail Opérationnel Agent'}
          </h2>
          <p className="text-sm text-[#6B7280] mb-6 max-w-md mx-auto leading-relaxed">
            {t('dashboard.worker_portal_desc') ||
              'En tant qu’agent d’exploitation, votre accès est concentré sur votre module métier de terrain.'}
          </p>

          {primaryModule ? (
            <div className="p-6 rounded-2xl border border-[#DDD6FE] bg-gradient-to-br from-[#F5F3FF] to-white flex flex-col sm:flex-row items-center justify-between gap-4 text-left shadow-sm">
              <div className="flex items-center gap-4">
                <span className="text-4xl p-2 rounded-2xl bg-white shadow-sm border border-black/5">
                  {primaryModule.logo}
                </span>
                <div>
                  <h3 className="font-extrabold text-[#1F2937] text-base">
                    {localize(primaryModule.name, language)}
                  </h3>
                  <span className="text-xs text-[#6B7280]">
                    v{primaryModule.version} &bull; Prêt pour vos opérations quotidiennes
                  </span>
                </div>
              </div>
              <Link href={`/modules/${primaryModule.slug}`}>
                <Button variant="primary" size="lg" className="w-full sm:w-auto font-black shadow-md">
                  🚀 {t('catalogue.open_module')}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="text-sm text-[#9CA3AF] py-6 bg-slate-50 rounded-2xl border border-dashed border-gray-200">
              Aucun module métier opérationnel assigné pour le moment.
            </div>
          )}
        </div>
      </div>
    );
  }

  const currency = workspace?.currency || 'XOF';
  const totalRevenue = summary?.totalRevenue || 0;
  const totalExpenses = summary?.totalExpenses || 0;
  const netProfit = summary?.netProfit || 0;
  const marginPct = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* Top Header Row with Date Range Selector & Platform Admin Shortcuts */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937] tracking-tight">
              {t('dashboard.title') || 'Tableau de Bord Consolidé'}
            </h1>
            <Badge variant="purple" size="sm">
              {activeModules.length} {t('my_modules.active_count')}
            </Badge>
            {isPlatformAdmin && (
              <Badge variant="yellow" size="sm">
                Super Admin
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-[#6B7280]">
            {workspace?.name} &bull; {t('dashboard.consolidated_subtitle') || 'Vue globale consolidée de toutes vos activités'}
          </p>
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <div className="flex items-center bg-gray-100 p-1.5 rounded-2xl border border-[#E5E7EB] shadow-inner">
            {(
              [
                { id: 'today', label: t('dashboard.range_today') || "Aujourd'hui" },
                { id: '7d', label: t('dashboard.range_7d') || '7 jours' },
                { id: '30d', label: t('dashboard.range_30d') || '30 jours' },
                { id: 'custom', label: t('dashboard.range_custom') || 'Personnalisé' },
                { id: 'all', label: t('dashboard.range_all') || 'Tout' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setDateRange(item.id);
                  if (item.id === 'custom') {
                    setShowCustomPicker(true);
                  } else {
                    setShowCustomPicker(false);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all min-h-[36px] ${
                  dateRange === item.id
                    ? 'bg-[#6D28D9] text-white shadow-sm'
                    : 'text-[#6B7280] hover:text-[#1F2937] hover:bg-white/70'
                }`}
              >
                {localize(item.label, language)}
              </button>
            ))}
          </div>

          {isPlatformAdmin && (
            <div className="flex items-center gap-1.5">
              <Link href="/admin/webhooks">
                <Button variant="outline" size="sm" className="h-9 min-h-0 text-xs">
                  ⚡ Webhooks
                </Button>
              </Link>
              <Link href="/admin/registry">
                <Button variant="outline" size="sm" className="h-9 min-h-0 text-xs">
                  ⚙️ Registry
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Custom Date Range Picker Bar (Shown when 'custom' is active) */}
      {(dateRange === 'custom' || showCustomPicker) && (
        <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-200 flex flex-wrap items-center gap-4 text-xs animate-in slide-in-from-top-2">
          <span className="font-bold text-[#6D28D9] flex items-center gap-1.5">
            📅 {t('dashboard.range_custom') || 'Période personnalisée'} :
          </span>
          <div className="flex items-center gap-2">
            <label className="text-[#4B5563] font-semibold">{t('dashboard.start_date') || 'Du'} :</label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white text-[#1F2937] font-medium text-xs focus:ring-2 focus:ring-purple-400 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[#4B5563] font-semibold">{t('dashboard.end_date') || 'Au'} :</label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white text-[#1F2937] font-medium text-xs focus:ring-2 focus:ring-purple-400 outline-none"
            />
          </div>
          <span className="text-[#9CA3AF] text-[11px] ml-auto">
            Filtrage instantané des flux partagés
          </span>
        </div>
      )}

      {/* Empty State Banner when no module is active */}
      {activeModules.length === 0 && (
        <div className="bg-gradient-to-r from-[#6D28D9] via-[#7C3AED] to-[#5B21B6] rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-2 text-center md:text-left z-10">
            <span className="inline-block bg-[#FACC15] text-[#1F2937] text-xs font-black uppercase px-3 py-1 rounded-lg shadow-sm">
              Écosystème {platformConfig.platformName}
            </span>
            <h2 className="text-2xl sm:text-3xl font-black">
              {t('dashboard.activate_cta_title')}
            </h2>
            <p className="text-white/85 text-sm sm:text-base max-w-2xl leading-relaxed">
              {t('dashboard.activate_cta_desc')}
            </p>
          </div>

          <Link href="/modules/catalogue" className="shrink-0 w-full md:w-auto z-10">
            <button className="w-full md:w-auto min-h-[48px] px-6 py-3 rounded-2xl bg-[#FACC15] hover:bg-[#EAB308] text-[#1F2937] font-black text-sm shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.02]">
              <span>{t('dashboard.browse_catalogue')} &rarr;</span>
            </button>
          </Link>
        </div>
      )}

      {/* 4 Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Revenue */}
        <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] hover:shadow-xl transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_revenue')}
            </span>
            <span className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-base font-black shadow-inner">
              📈
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-[#1F2937]">
            {totalRevenue.toLocaleString()} <span className="text-sm font-bold text-[#6B7280]">{currency}</span>
          </div>
          <div className="text-[11px] text-[#059669] font-bold mt-2 flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-50">▲ +14%</span>
            <span className="text-[#9CA3AF] font-normal">&bull; Grand Livre consolidé</span>
          </div>
        </div>

        {/* Card 2: Expenses */}
        <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] hover:shadow-xl transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_expenses')}
            </span>
            <span className="w-9 h-9 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center text-base font-black shadow-inner">
              📉
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-[#1F2937]">
            {totalExpenses.toLocaleString()} <span className="text-sm font-bold text-[#6B7280]">{currency}</span>
          </div>
          <div className="text-[11px] text-[#6B7280] mt-2">
            Charges opérationnelles déclarées
          </div>
        </div>

        {/* Card 3: Net Margin / Profit */}
        <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] hover:shadow-xl transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#6D28D9]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.net_profit') || 'Marge Nette'}
            </span>
            <span className="w-9 h-9 rounded-2xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center text-base font-black shadow-inner">
              💰
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-[#059669]">
            {netProfit.toLocaleString()} <span className="text-sm font-bold text-[#6B7280]">{currency}</span>
          </div>
          <div className="text-[11px] text-[#059669] font-bold mt-2 flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-50">{marginPct}%</span>
            <span className="text-[#9CA3AF] font-normal">marge d'exploitation</span>
          </div>
        </div>

        {/* Card 4: Active Modules */}
        <div className="bg-white rounded-3xl p-6 border border-[#E5E7EB] hover:shadow-xl transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-400" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.active_modules_card') || 'Modules Connectés'}
            </span>
            <span className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-base font-black shadow-inner">
              📦
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-[#1F2937]">
            {activeModules.length}
          </div>
          <div className="text-[11px] text-[#6B7280] mt-2">
            {activeModules.length > 0 ? 'Flux synchronisés via SDK' : 'Aucun module souscrit'}
          </div>
        </div>
      </div>

      {/* Visual Timeline SVG Chart */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E7EB] shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="text-base sm:text-lg font-black text-[#1F2937]">
              {t('dashboard.chart_title') || 'Évolution Consolidée : Recettes vs Dépenses'}
            </h3>
            <p className="text-xs text-[#6B7280]">
              {t('dashboard.chart_subtitle') || 'Courbes d’exploitation générées d’après les flux du Grand Livre partagé'}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-bold">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#6D28D9] shadow-sm" />
              <span className="text-[#374151]">Recettes (CA)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm" />
              <span className="text-[#374151]">Dépenses</span>
            </div>
          </div>
        </div>

        {/* Interactive SVG Chart Graphic */}
        <div className="w-full h-64 relative bg-slate-50/70 rounded-2xl p-4 border border-[#E5E7EB] flex flex-col justify-between overflow-hidden">
          <svg className="w-full h-48 overflow-visible" viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}>
            <defs>
              <linearGradient id="purpleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6D28D9" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#6D28D9" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="roseGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid Horizontal Guide Lines */}
            <line x1="0" y1="30" x2="500" y2="30" stroke="#E2E8F0" strokeDasharray="3 3" />
            <line x1="0" y1="65" x2="500" y2="65" stroke="#E2E8F0" strokeDasharray="3 3" />
            <line x1="0" y1="100" x2="500" y2="100" stroke="#E2E8F0" strokeDasharray="3 3" />
            <line x1="0" y1="130" x2="500" y2="130" stroke="#CBD5E1" strokeWidth="1.5" />

            {/* Revenue Polygon & Line */}
            {chartGeometry.revPoly && (
              <polygon points={chartGeometry.revPoly} fill="url(#purpleGrad)" />
            )}
            {chartGeometry.revPath && (
              <path
                d={chartGeometry.revPath}
                fill="none"
                stroke="#6D28D9"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Expense Polygon & Line */}
            {chartGeometry.expPoly && (
              <polygon points={chartGeometry.expPoly} fill="url(#roseGrad)" />
            )}
            {chartGeometry.expPath && (
              <path
                d={chartGeometry.expPath}
                fill="none"
                stroke="#EF4444"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Revenue Data Points */}
            {chartGeometry.revPoints.map((pt, idx) => (
              <g key={`rev-pt-${idx}`}>
                <circle cx={pt.x} cy={pt.y} r="4.5" fill="#6D28D9" stroke="#fff" strokeWidth="2.5" />
                {pt.val > 0 && (
                  <text
                    x={pt.x}
                    y={Math.max(12, pt.y - 8)}
                    textAnchor="middle"
                    fill="#6D28D9"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {pt.val.toLocaleString()}
                  </text>
                )}
              </g>
            ))}

            {/* Expense Data Points */}
            {chartGeometry.expPoints.map((pt, idx) => (
              <g key={`exp-pt-${idx}`}>
                <circle cx={pt.x} cy={pt.y} r="3.5" fill="#EF4444" stroke="#fff" strokeWidth="2" />
              </g>
            ))}
          </svg>

          {/* Bottom X-Axis Date Labels */}
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B7280] px-2 pt-2 border-t border-slate-200/80">
            {chartData.map((d, i) => (
              <span key={i} className="text-center truncate px-1">
                {localize(d.label, language)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Per-Module Financial & Operational Breakdown Grid */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-[#1F2937]">
              {t('dashboard.per_module_title') || 'Ventilation Métier par Module'}
            </h3>
            <p className="text-xs text-[#6B7280]">
              {t('dashboard.per_module_desc') ||
                'Données remontées exclusivement via le contrat public ModuleSummary et l’API Partagée'}
            </p>
          </div>
          <Link href="/modules/catalogue">
            <Button variant="outline" size="sm" className="font-bold">
              + {t('dashboard.browse_catalogue')}
            </Button>
          </Link>
        </div>

        {activeModules.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 rounded-3xl border border-dashed border-gray-300 text-xs text-[#6B7280]">
            Aucun module actif. Rendez-vous dans le catalogue pour souscrire à votre premier outil.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeModules.map((mod) => {
              const modName = localize(mod.name, language) || mod.id;

              // Find matching finance breakdown
              const fin = moduleBreakdowns.find((b) => b.moduleId === mod.id);
              const sumData = moduleSummaries.find((s) => s.moduleId === mod.id);

              const modRev = fin?.revenue || sumData?.revenue || 0;
              const modExp = fin?.expenses || sumData?.expenses || 0;
              const modNet = modRev - modExp;

              const openLink = mod.entryUrl || `/modules/${mod.slug}`;

              return (
                <div
                  key={mod.id}
                  className="bg-white rounded-3xl p-6 border border-[#E5E7EB] hover:shadow-xl transition-all duration-300 flex flex-col justify-between relative overflow-hidden group"
                >
                  {/* Accent Color Bar Indicator */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1.5"
                    style={{ backgroundColor: mod.accentColor }}
                  />

                  <div>
                    {/* Module Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-black/5 shrink-0"
                          style={{
                            backgroundColor: `${mod.accentColor}18`,
                            color: mod.accentColor,
                          }}
                        >
                          {mod.logo}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-black text-[#1F2937] text-base leading-tight truncate">
                            {modName}
                          </h4>
                          <span className="text-[11px] text-[#6B7280]">
                            v{mod.version} &bull; PWA Conforme
                          </span>
                        </div>
                      </div>
                      <Badge variant="green" size="sm">
                        {t('common.active')}
                      </Badge>
                    </div>

                    {/* Financial Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 p-3 bg-gray-50 rounded-2xl mb-4 text-center">
                      <div>
                        <span className="text-[10px] text-[#6B7280] font-bold block uppercase">
                          Recettes
                        </span>
                        <span className="text-xs font-black text-[#1F2937]">
                          {modRev.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6B7280] font-bold block uppercase">
                          Dépenses
                        </span>
                        <span className="text-xs font-black text-rose-600">
                          {modExp.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6B7280] font-bold block uppercase">
                          Marge
                        </span>
                        <span className="text-xs font-black text-emerald-600">
                          {modNet.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Operational Telemetry Metrics from Module Summary Contract */}
                    {sumData?.metrics && sumData.metrics.length > 0 && (
                      <div className="space-y-1.5 mb-4 text-xs">
                        {sumData.metrics.map((m: any) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white border border-[#E5E7EB]"
                          >
                            <span className="text-[#6B7280]">
                              {localize(m.label, language)}
                            </span>
                            <span className="font-bold text-[#1F2937]">{m.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Footer Action */}
                  <div className="pt-3 border-t border-[#F3F4F6] flex items-center justify-between">
                    <span className="text-[11px] text-[#9CA3AF]">
                      {sumData?.activityCount ? `${sumData.activityCount} opérations` : 'Synchronisé'}
                    </span>
                    <Link href={openLink}>
                      <Button variant="outline" size="sm" className="text-xs font-bold">
                        {t('catalogue.open_module')} &rarr;
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
