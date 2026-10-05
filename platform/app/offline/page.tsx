'use client';

import React from 'react';
import { Button } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function OfflinePage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center mb-6 shadow-sm">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21m2.829-15.364a9 9 0 0112.728 0M9.88 9.88a3 3 0 104.24 4.24m-4.24-4.24L3 3"
          />
        </svg>
      </div>

      <h1 className="text-3xl font-extrabold text-[#1F2937] mb-3">
        {t('offline.title')}
      </h1>
      <p className="text-lg text-[#6B7280] max-w-md mb-8">
        {t('offline.desc')}
      </p>

      <Button
        variant="primary"
        size="lg"
        onClick={() => window.location.reload()}
        leftIcon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        }
      >
        {t('offline.retry')}
      </Button>

      <p className="mt-12 text-sm text-[#9CA3AF]">
        {platformConfig.platformName} &bull; PWA
      </p>
    </div>
  );
}
