'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { getModules, activateModule } from '@/lib/modules';
import { getSubscription } from '@/lib/billing';
import { ModuleManifest, Subscription } from '@kazibox/sdk';

export default function ModuleCataloguePage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  const loadData = async () => {
    if (!workspace) return;
    const [mods, sub] = await Promise.all([
      getModules(),
      getSubscription(workspace.company_id),
    ]);
    setModules(mods);
    setSubscription(sub);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [workspace]);

  const handleActivate = async (mod: ModuleManifest) => {
    if (!workspace || !isOwner) return;

    // Check if current subscription already covers it (or if All Access)
    const isCovered =
      subscription &&
      (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
      (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(mod.id));

    if (isCovered) {
      setActionLoading(mod.id);
      await activateModule(workspace.company_id, mod.id);
      await loadData();
      setActionLoading(null);
      router.push(`/modules/${mod.slug}`);
    } else {
      // Redirect to centralized billing plan selection with module preselected
      router.push(`/billing?plan=single&module=${mod.id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('catalogue.title')}
            </h1>
            <Badge variant="purple" size="sm">
              {modules.length} {t('catalogue.modules_count')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280] max-w-3xl">
            {t('catalogue.subtitle')}
          </p>
        </div>

        <Link href="/modules/my-modules">
          <Button variant="outline" size="sm">
            📦 {t('nav.my_modules')}
          </Button>
        </Link>
      </div>

      {/* Architecture Highlights Banner */}
      <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--kazibox-primary,#6D28D9)] text-white font-black flex items-center justify-center text-lg shrink-0">
            ★
          </div>
          <div>
            <p className="text-sm font-bold text-[#1F2937]">
              {t('catalogue.banner_title')}
            </p>
            <p className="text-xs text-[#6B7280]">
              {t('catalogue.banner_desc')}
            </p>
          </div>
        </div>

        {isOwner && (
          <Link href="/billing">
            <Button variant="secondary" size="sm" className="whitespace-nowrap">
              💳 {t('nav.billing')}
            </Button>
          </Link>
        )}
      </div>

      {/* Module Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((mod) => {
          const modName =
            typeof mod.name === 'string'
              ? mod.name
              : mod.name?.[language as 'fr' | 'en'] || mod.name?.fr || mod.id;

          const modTagline =
            typeof mod.tagline === 'string'
              ? mod.tagline
              : mod.tagline?.[language as 'fr' | 'en'] || mod.tagline?.fr || '';

          const isSubscribed =
            subscription &&
            (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
            (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(mod.id));

          const isComingSoon = mod.status === 'coming_soon';

          // Status Badge Determination
          let badgeVariant: 'green' | 'purple' | 'yellow' | 'gray' = 'purple';
          let badgeText = t('catalogue.status_available');

          if (isSubscribed) {
            badgeVariant = 'green';
            badgeText = t('catalogue.status_active');
          } else if (isComingSoon) {
            badgeVariant = 'gray';
            badgeText = t('catalogue.status_coming_soon');
          } else if (mod.kind === 'external') {
            badgeVariant = 'yellow';
            badgeText = t('catalogue.status_external');
          }

          const priceStr = mod.pricePerMonth
            ? `${mod.pricePerMonth.amount.toLocaleString()} ${mod.pricePerMonth.currency} ${t('billing.per_month')}`
            : t('billing.custom_price');

          return (
            <Card
              key={mod.id}
              padding="lg"
              hoverEffect
              className="flex flex-col justify-between border-[#E5E7EB] relative overflow-hidden"
            >
              {/* Accent Color Top Border Indicator */}
              <div
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ backgroundColor: mod.accentColor }}
              />

              <div>
                {/* Header Row */}
                <div className="flex items-start justify-between gap-3 mb-4 mt-1">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-sm border border-black/5"
                    style={{ backgroundColor: `${mod.accentColor}18`, color: mod.accentColor }}
                  >
                    {mod.logo}
                  </div>
                  <Badge variant={badgeVariant} size="sm">
                    {badgeText}
                  </Badge>
                </div>

                {/* Module Details */}
                <h3 className="text-xl font-bold text-[#1F2937] mb-1.5 line-clamp-1">
                  {modName}
                </h3>
                <p className="text-xs text-[#6B7280] mb-4 line-clamp-2 leading-relaxed min-h-[32px]">
                  {modTagline}
                </p>

                {/* Supported Languages & Category */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11px] font-bold text-[#9CA3AF] uppercase">
                    {t('catalogue.languages')} :
                  </span>
                  <div className="flex gap-1">
                    {mod.languages?.map((lang) => (
                      <span
                        key={lang}
                        className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#4B5563]"
                      >
                        {lang}
                      </span>
                    ))}
                  </div>
                  {mod.kind === 'external' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 ml-auto">
                      SDK Tiers
                    </span>
                  )}
                </div>
              </div>

              {/* Footer / Pricing & Actions */}
              <div className="pt-4 border-t border-[#E5E7EB]">
                <div className="flex items-baseline justify-between mb-4">
                  <span className="text-xs text-[#6B7280] font-medium">
                    {t('catalogue.subscription_price')} :
                  </span>
                  <span className="text-sm font-black text-[#1F2937]">
                    {priceStr}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/catalogue/${mod.slug}`} className="w-full">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      {t('catalogue.learn_more')}
                    </Button>
                  </Link>

                  {/* Activate button: strictly hidden/disabled for managers and workers */}
                  {isOwner ? (
                    isSubscribed ? (
                      <Link href={`/modules/${mod.slug}`} className="w-full">
                        <Button variant="secondary" size="sm" className="w-full text-xs font-bold text-[#059669]">
                          ✓ {t('common.active')}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full text-xs font-bold"
                        disabled={isComingSoon || actionLoading === mod.id}
                        onClick={() => handleActivate(mod)}
                      >
                        {actionLoading === mod.id
                          ? t('common.loading')
                          : isComingSoon
                          ? t('catalogue.coming_soon')
                          : t('catalogue.activate')}
                      </Button>
                    )
                  ) : (
                    <Button variant="outline" size="sm" className="w-full text-xs" disabled>
                      {isSubscribed ? t('common.active') : t('catalogue.view_only')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
