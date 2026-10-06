'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation, localize, localizeArray } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { getModule, activateModule } from '@/lib/modules';
import { getSubscription } from '@/lib/billing';
import { ModuleManifest, Subscription } from '@kazibox/sdk';

export default function ModulePresentationPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;

  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const [activating, setActivating] = useState(false);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  const loadData = async () => {
    if (!slug || !workspace) return;
    const [mod, sub] = await Promise.all([
      getModule(slug),
      getSubscription(workspace.company_id),
    ]);
    setModuleData(mod);
    setSubscription(sub);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [slug, workspace]);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!moduleData) {
    return (
      <div className="max-w-md mx-auto my-12 text-center">
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">{t('catalogue.module_not_found')}</h2>
        <Link href="/modules/catalogue">
          <Button variant="outline">&larr; {t('catalogue.back_to_catalogue')}</Button>
        </Link>
      </div>
    );
  }

  const moduleName = localize(moduleData.name, language) || moduleData.id;
  const moduleTagline = localize(moduleData.tagline, language);
  const moduleDescription = localize(moduleData.description, language) || moduleTagline;
  const features = localizeArray(moduleData.features, language);

  const isSubscribed =
    subscription &&
    (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
    (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(moduleData.id));

  const isComingSoon = moduleData.status === 'coming_soon';

  const priceStr = moduleData.pricePerMonth
    ? `${moduleData.pricePerMonth.amount.toLocaleString()} ${moduleData.pricePerMonth.currency} ${t('billing.per_month')}`
    : t('billing.custom_price');

  const handleActivate = async () => {
    if (!workspace || !isOwner) return;

    if (isSubscribed) {
      router.push(moduleData.entryUrl || `/modules/${moduleData.slug}`);
      return;
    }

    // Check if covered by current subscription
    const isCovered =
      subscription &&
      (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
      (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(moduleData.id));

    if (isCovered) {
      setActivating(true);
      await activateModule(workspace.company_id, moduleData.id);
      setActivating(false);
      router.push(moduleData.entryUrl || `/modules/${moduleData.slug}`);
    } else {
      // Redirect to plan selection with module preselected
      router.push(`/billing?plan=single&module=${moduleData.id}`);
    }
  };

  const screenshots = moduleData.screenshots?.length
    ? moduleData.screenshots
    : [
        'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
      ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/modules/catalogue"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#6D28D9] hover:underline"
        >
          &larr; {t('catalogue.back_to_catalogue')}
        </Link>

        <div className="flex items-center gap-2">
          {isSubscribed ? (
            <Badge variant="green" size="md">
              ✓ {t('catalogue.status_active')}
            </Badge>
          ) : isComingSoon ? (
            <Badge variant="gray" size="md">
              {t('catalogue.status_coming_soon')}
            </Badge>
          ) : (
            <Badge variant="purple" size="md">
              {t('catalogue.status_available')}
            </Badge>
          )}
        </div>
      </div>

      {/* Hero Header Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E7EB] shadow-sm relative overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-2"
          style={{ backgroundColor: moduleData.accentColor }}
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-5">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl shadow-md border border-black/5 shrink-0"
              style={{
                backgroundColor: `${moduleData.accentColor}18`,
                color: moduleData.accentColor,
              }}
            >
              {moduleData.logo}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
                  {moduleName}
                </h1>
                <Badge variant="purple" size="sm">
                  v{moduleData.version}
                </Badge>
                {moduleData.kind === 'external' && (
                  <Badge variant="yellow" size="sm">
                    {t('catalogue.external_developer')}
                  </Badge>
                )}
              </div>
              <p className="text-base text-[#4B5563] font-medium leading-snug">
                {moduleTagline}
              </p>
              <div className="flex items-center gap-4 text-xs text-[#6B7280] mt-2">
                <span>
                  {t('catalogue.developed_by')} :{' '}
                  <strong className="text-[#1F2937]">{moduleData.developer}</strong>
                </span>
                <span>&bull;</span>
                <span>PWA 100% Compatible</span>
              </div>
            </div>
          </div>

          {/* Pricing Box & Activation CTA */}
          <div className="bg-[#F9FAFB] rounded-2xl p-5 border border-[#E5E7EB] min-w-[260px] flex flex-col justify-between shrink-0">
            <div className="mb-4">
              <span className="text-xs font-semibold text-[#6B7280] block">
                {t('catalogue.subscription_price')} :
              </span>
              <div className="text-2xl font-black text-[#1F2937] mt-0.5">
                {priceStr}
              </div>
              <span className="text-[11px] text-[#059669] font-bold block mt-0.5">
                {t('billing.annual_discount_hint')}
              </span>
            </div>

            {isOwner ? (
              isSubscribed ? (
                <Link href={moduleData.entryUrl || `/modules/${moduleData.slug}`}>
                  <Button variant="secondary" size="lg" className="w-full font-bold">
                    🚀 {t('catalogue.open_module')}
                  </Button>
                </Link>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full font-black text-sm"
                  disabled={isComingSoon || activating}
                  onClick={handleActivate}
                >
                  {activating
                    ? t('common.loading')
                    : isComingSoon
                    ? t('catalogue.coming_soon')
                    : t('catalogue.activate_module_now')}
                </Button>
              )
            ) : (
              <div className="text-center p-2 rounded-xl bg-gray-100 text-xs text-[#6B7280]">
                {t('catalogue.staff_no_billing')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Presentation Layout: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Description, Features, Screenshots & Demo Video */}
        <div className="lg:col-span-2 space-y-8">
          {/* Detailed Description */}
          <Card padding="lg">
            <h3 className="text-lg font-bold text-[#1F2937] mb-3">
              {t('catalogue.overview_title')}
            </h3>
            <p className="text-sm sm:text-base text-[#4B5563] leading-relaxed">
              {moduleDescription}
            </p>
          </Card>

          {/* Key Features List */}
          <Card padding="lg">
            <h3 className="text-lg font-bold text-[#1F2937] mb-4">
              {t('catalogue.key_features')}
            </h3>
            <div className="space-y-3">
              {features.map((feat: string, idx: number) => (
                <div key={idx} className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `${moduleData.accentColor}20`,
                      color: moduleData.accentColor,
                    }}
                  >
                    ✓
                  </div>
                  <span className="text-sm font-medium text-[#1F2937]">
                    {localize(feat, language)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Screenshots Gallery */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#1F2937]">
                {t('catalogue.screenshots_gallery')}
              </h3>
              <span className="text-xs text-[#6B7280]">
                {activeScreenshot + 1} / {screenshots.length}
              </span>
            </div>

            {/* Main Visual Frame */}
            <div className="rounded-2xl overflow-hidden border border-[#E5E7EB] bg-black/5 aspect-video relative shadow-inner">
              <img
                src={screenshots[activeScreenshot]}
                alt={moduleName}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1 rounded-xl text-xs text-white font-medium">
                {moduleName} &bull; Interface responsive PWA
              </div>
            </div>

            {/* Thumbnail Selectors */}
            {screenshots.length > 1 && (
              <div className="flex items-center gap-3 mt-4 overflow-x-auto pb-1">
                {screenshots.map((src, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveScreenshot(idx)}
                    className={`w-20 h-14 rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
                      activeScreenshot === idx
                        ? 'border-[var(--kazibox-primary,#6D28D9)] scale-105 shadow-md'
                        : 'border-[#E5E7EB] opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={src} alt="thumb" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Demo Video Placeholder */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-[#1F2937]">
                {t('catalogue.demo_video_title')}
              </h3>
              <Badge variant="yellow" size="sm">
                1:45 &bull; FR / EN
              </Badge>
            </div>
            <p className="text-xs text-[#6B7280] mb-4">
              {t('catalogue.demo_video_subtitle')}
            </p>

            <div className="relative rounded-2xl overflow-hidden bg-[#111827] aspect-video flex items-center justify-center group shadow-md">
              {!isPlayingVideo ? (
                <>
                  <img
                    src={screenshots[0]}
                    alt="video cover"
                    className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-500"
                  />
                  <button
                    onClick={() => setIsPlayingVideo(true)}
                    className="absolute w-16 h-16 rounded-full bg-[var(--kazibox-primary,#6D28D9)] text-white flex items-center justify-center text-2xl shadow-xl hover:scale-110 transition-all cursor-pointer"
                    aria-label="Play video"
                  >
                    ▶
                  </button>
                  <div className="absolute bottom-4 left-4 text-white text-xs font-semibold bg-black/60 px-3 py-1.5 rounded-xl backdrop-blur-sm">
                    {t('catalogue.click_to_play')}
                  </div>
                </>
              ) : (
                <video
                  src={moduleData.demoVideoUrl || 'https://www.w3schools.com/html/mov_bbb.mp4'}
                  controls
                  autoPlay
                  className="w-full h-full"
                />
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Technical Contract & Specifications */}
        <div className="space-y-6">
          <Card padding="lg">
            <h4 className="text-base font-bold text-[#1F2937] mb-4">
              {t('catalogue.tech_specs')}
            </h4>

            <div className="divide-y divide-[#E5E7EB] text-xs">
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-[#6B7280]">{t('catalogue.languages')}</span>
                <span className="font-bold text-[#1F2937]">
                  {moduleData.languages?.map((l) => l.toUpperCase()).join(' & ')}
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-[#6B7280]">PWA Standard</span>
                <span className="font-bold text-[#059669]">✓ {t('catalogue.compliant')}</span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-[#6B7280]">{t('catalogue.financial_isolation')}</span>
                <span className="font-bold text-[#6D28D9]">{t('catalogue.isolated')}</span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-[#6B7280]">Type</span>
                <span className="font-bold capitalize text-[#1F2937]">
                  {moduleData.kind === 'external' ? t('catalogue.type_external') : t('catalogue.type_native')}
                </span>
              </div>

              <div className="py-2.5 flex flex-col gap-1">
                <span className="text-[#6B7280]">{t('catalogue.scopes_title')}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {moduleData.scopes?.map((sc) => (
                    <code
                      key={sc}
                      className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono text-[#374151]"
                    >
                      {sc}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Financial Isolation Reminder */}
          <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-[var(--kazibox-primary,#6D28D9)]">
                🛡️ {t('catalogue.isolation_title')}
              </span>
            </div>
            <p className="text-xs text-[#4B5563] leading-relaxed">
              {t('catalogue.isolation_desc')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
