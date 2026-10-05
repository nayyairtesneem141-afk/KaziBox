'use client';

import React from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function DashboardHomePage() {
  const { user, workspace } = useSession();
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E7EB] shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl sm:text-2xl font-black text-[#1F2937]">
              {t('dashboard.welcome')} {user?.name} 👋
            </span>
            {user?.role && (
              <Badge
                variant={
                  user.role === 'owner'
                    ? 'yellow'
                    : user.role === 'platform_admin'
                    ? 'purple'
                    : user.role === 'manager'
                    ? 'green'
                    : 'gray'
                }
                size="sm"
              >
                {t(`roles.${user.role}`)}
              </Badge>
            )}
          </div>
          <p className="text-sm sm:text-base text-[#6B7280]">
            {workspace?.name} &bull; {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/modules/catalogue">
            <Button variant="secondary" size="md">
              + {t('dashboard.browse_catalogue')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Prominent CTA to Activate First Module */}
      <div className="bg-gradient-to-r from-[var(--kazibox-primary,#6D28D9)] to-[#5B21B6] rounded-2xl p-6 sm:p-8 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 text-center md:text-left">
          <span className="inline-block bg-[#FACC15] text-[#1F2937] text-xs font-black uppercase px-3 py-1 rounded-lg">
            Écosystème {platformConfig.platformName}
          </span>
          <h2 className="text-2xl sm:text-3xl font-black">
            {t('dashboard.activate_cta_title')}
          </h2>
          <p className="text-white/80 text-base max-w-2xl leading-relaxed">
            {t('dashboard.activate_cta_desc')}
          </p>
        </div>

        <Link href="/modules/catalogue" className="shrink-0 w-full md:w-auto">
          <button className="w-full md:w-auto min-h-[50px] px-6 py-3 rounded-xl bg-[#FACC15] text-[#1F2937] hover:bg-[#EAB308] font-black text-base shadow transition-all duration-200 flex items-center justify-center gap-2">
            <span>{t('dashboard.browse_catalogue')}</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </Link>
      </div>

      {/* Consolidated Dashboard Widgets (Empty State Placeholders) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Widget 1: Revenue */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_revenue')}
            </span>
            <span className="w-8 h-8 rounded-lg bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <div className="text-2xl font-black text-[#1F2937] mb-1">
            0 {workspace?.currency || 'XOF'}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>{t('dashboard.waiting_module')}</span>
          </div>
        </Card>

        {/* Widget 2: Expenses */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_expenses')}
            </span>
            <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
            </span>
          </div>
          <div className="text-2xl font-black text-[#1F2937] mb-1">
            0 {workspace?.currency || 'XOF'}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>{t('dashboard.waiting_module')}</span>
          </div>
        </Card>

        {/* Widget 3: Operations */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_operations')}
            </span>
            <span className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </span>
          </div>
          <div className="text-2xl font-black text-[#1F2937] mb-1">
            0
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>{t('dashboard.waiting_module')}</span>
          </div>
        </Card>

        {/* Widget 4: Pending Tasks */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              {t('dashboard.empty_widget_pending')}
            </span>
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <div className="text-2xl font-black text-[#1F2937] mb-1">
            0
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>À jour</span>
          </div>
        </Card>
      </div>

      {/* Main Grid: Activity & Coming Modules Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity Column */}
        <div className="lg:col-span-2">
          <Card padding="lg">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB] mb-4">
              <h3 className="text-lg font-bold text-[#1F2937]">
                {t('dashboard.recent_activity')}
              </h3>
              <span className="text-xs font-medium text-[#6B7280]">
                {workspace?.company_id}
              </span>
            </div>

            <div className="py-10 text-center flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] text-[#9CA3AF] flex items-center justify-center mb-3">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-base font-bold text-[#1F2937] mb-1">
                {t('dashboard.no_activity')}
              </p>
              <p className="text-sm text-[#6B7280] max-w-sm mb-4">
                Dès que vous activerez un module métier, les réservations, ordres de réparation ou courses s'afficheront ici.
              </p>
              <Link href="/modules/catalogue">
                <Button variant="outline" size="sm">
                  {t('dashboard.browse_catalogue')}
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Modules Roadmap Preview */}
        <div className="space-y-4">
          <Card padding="md">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full bg-[#FACC15]" />
              <h4 className="font-bold text-base text-[#1F2937]">Modules en cours d'intégration</h4>
            </div>
            <p className="text-xs text-[#6B7280] mb-4">
              Les modules suivants seront disponibles très prochainement :
            </p>

            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#1F2937]">Hôtel &amp; Résidence</p>
                  <p className="text-xs text-[#6B7280]">Chambres, réservations, ménage</p>
                </div>
                <Badge variant="purple" size="sm">Module 1</Badge>
              </div>

              <div className="p-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#1F2937]">Garage &amp; Atelier Auto</p>
                  <p className="text-xs text-[#6B7280]">Ordres de réparation, pièces</p>
                </div>
                <Badge variant="yellow" size="sm">À venir</Badge>
              </div>

              <div className="p-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#1F2937]">Taxi &amp; Flotte de transport</p>
                  <p className="text-xs text-[#6B7280]">Courses, chauffeurs, entretien</p>
                </div>
                <Badge variant="yellow" size="sm">À venir</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
