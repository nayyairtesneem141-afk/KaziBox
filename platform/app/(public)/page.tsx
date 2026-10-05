'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Card, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function LandingPage() {
  const { t, language, setLanguage } = useTranslation();

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-[#E5E7EB] bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={platformConfig.logo} alt={platformConfig.platformName} className="h-10 w-auto object-contain" />
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Language Switch */}
            <div className="flex items-center bg-[#F3F4F6] rounded-xl p-1 border border-[#E5E7EB]">
              <button
                onClick={() => setLanguage('fr')}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold min-h-[36px] transition-colors ${
                  language === 'fr'
                    ? 'bg-white text-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                    : 'text-[#6B7280] hover:text-[#1F2937]'
                }`}
              >
                FR
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold min-h-[36px] transition-colors ${
                  language === 'en'
                    ? 'bg-white text-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                    : 'text-[#6B7280] hover:text-[#1F2937]'
                }`}
              >
                EN
              </button>
            </div>

            <Link href="/login">
              <Button variant="ghost" size="md">
                {t('landing.cta_login')}
              </Button>
            </Link>

            <Link href="/register" className="hidden sm:inline-block">
              <Button variant="primary" size="md">
                {t('landing.cta_start')}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="py-16 sm:py-24 px-4 sm:px-6 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center mb-6">
            <Badge variant="yellow" size="md">
              ★ {t('landing.badge')}
            </Badge>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-[#1F2937] tracking-tight leading-tight sm:leading-none mb-6">
            {t('landing.hero_title')}
          </h1>

          <p className="text-lg sm:text-2xl text-[#6B7280] max-w-3xl mx-auto mb-10 leading-relaxed font-normal">
            {t('landing.hero_subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
            <Link href="/register" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" fullWidth className="text-lg">
                {t('landing.cta_start')}
              </Button>
            </Link>
            <Link href="/login" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" fullWidth className="text-lg">
                {t('landing.cta_login')}
              </Button>
            </Link>
          </div>

          {/* Quick Mock Banner */}
          <div className="mt-16 p-4 sm:p-6 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl flex flex-col sm:flex-row items-center justify-between text-left gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--kazibox-primary,#6D28D9)] text-white flex items-center justify-center font-black text-xl shrink-0">
                PWA
              </div>
              <div>
                <h4 className="text-base font-bold text-[#1F2937]">
                  Accessible hors ligne &amp; installable en 1 clic
                </h4>
                <p className="text-sm text-[#6B7280]">
                  Fonctionne instantanément sur Android, iPhone, iPad et PC.
                </p>
              </div>
            </div>
            <Link href="/login">
              <Button variant="secondary" size="md">
                Tester la démo
              </Button>
            </Link>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="py-16 bg-[#FAFAFA] border-y border-[#E5E7EB] px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-center text-[#1F2937] mb-12">
              {t('landing.features_title')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card padding="lg" hoverEffect>
                <div className="w-12 h-12 rounded-xl bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center font-bold text-xl mb-4">
                  1
                </div>
                <h3 className="text-xl font-bold text-[#1F2937] mb-2">
                  {t('landing.feature1_title')}
                </h3>
                <p className="text-base text-[#6B7280] leading-relaxed">
                  {t('landing.feature1_desc')}
                </p>
              </Card>

              <Card padding="lg" hoverEffect>
                <div className="w-12 h-12 rounded-xl bg-[#FEF08A] text-[#854D0E] flex items-center justify-center font-bold text-xl mb-4">
                  2
                </div>
                <h3 className="text-xl font-bold text-[#1F2937] mb-2">
                  {t('landing.feature2_title')}
                </h3>
                <p className="text-base text-[#6B7280] leading-relaxed">
                  {t('landing.feature2_desc')}
                </p>
              </Card>

              <Card padding="lg" hoverEffect>
                <div className="w-12 h-12 rounded-xl bg-[#DCFCE7] text-[#166534] flex items-center justify-center font-bold text-xl mb-4">
                  3
                </div>
                <h3 className="text-xl font-bold text-[#1F2937] mb-2">
                  {t('landing.feature3_title')}
                </h3>
                <p className="text-base text-[#6B7280] leading-relaxed">
                  {t('landing.feature3_desc')}
                </p>
              </Card>

              <Card padding="lg" hoverEffect>
                <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center font-bold text-xl mb-4">
                  4
                </div>
                <h3 className="text-xl font-bold text-[#1F2937] mb-2">
                  {t('landing.feature4_title')}
                </h3>
                <p className="text-base text-[#6B7280] leading-relaxed">
                  {t('landing.feature4_desc')}
                </p>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E7EB] bg-white py-8 px-4 text-center">
        <p className="text-sm text-[#6B7280]">
          &copy; {new Date().getFullYear()} {platformConfig.platformName}. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
