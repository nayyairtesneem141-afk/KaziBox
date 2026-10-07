'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation, localize } from '@/lib/i18n';
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

  // Phase 6 Catalogue Controls
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [pricingFilter, setPricingFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [sortBy, setSortBy] = useState<'az' | 'za' | 'free_first' | 'paid_first'>('az');
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');

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

  // Handle module or free tool activation
  const handleActivate = async (mod: ModuleManifest) => {
    if (!workspace || !isOwner) return;

    const isFree = mod.pricing_type === 'free';

    // If it's a free tool, activate directly without billing
    if (isFree) {
      setActionLoading(mod.id);
      await activateModule(workspace.company_id, mod.id);
      await loadData();
      setActionLoading(null);
      router.push(mod.entryUrl || `/modules/${mod.slug}`);
      return;
    }

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
      router.push(mod.entryUrl || `/modules/${mod.slug}`);
    } else {
      // Redirect to centralized billing plan selection with module preselected
      router.push(`/billing?plan=single&module=${mod.id}`);
    }
  };

  // Helper for category localization
  const getCategoryLabel = (cat: string) => {
    const key = `catalogue.cat_${cat}`;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    // Fallback capitalized
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  // Compute unique dynamic categories from registered modules
  const categoriesList = useMemo(() => {
    const cats = new Set<string>();
    modules.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats);
  }, [modules]);

  // Filtered & Sorted Modules
  const filteredModules = useMemo(() => {
    return modules
      .filter((mod) => {
        // 1. Pricing Type Filter
        if (pricingFilter === 'free' && mod.pricing_type !== 'free') return false;
        if (pricingFilter === 'paid' && mod.pricing_type === 'free') return false;

        // 2. Category Filter
        if (selectedCategory !== 'all' && mod.category !== selectedCategory) return false;

        // 3. Search Query (Name, Keywords, Tagline, Description)
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const nameStr = (localize(mod.name, language) || '').toLowerCase();
          const taglineStr = (localize(mod.tagline, language) || '').toLowerCase();
          const descStr = (localize(mod.description, language) || '').toLowerCase();
          const keywords = Array.isArray(mod.keywords) ? mod.keywords : [];
          const matchesKeyword = keywords.some((k) => k.toLowerCase().includes(q));
          const matchesCategory = (mod.category || '').toLowerCase().includes(q);

          const matches =
            nameStr.includes(q) ||
            taglineStr.includes(q) ||
            descStr.includes(q) ||
            matchesKeyword ||
            matchesCategory;

          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const nameA = (localize(a.name, language) || a.id).toLowerCase();
        const nameB = (localize(b.name, language) || b.id).toLowerCase();

        if (sortBy === 'az') {
          return nameA.localeCompare(nameB, language === 'fr' ? 'fr' : 'en');
        }
        if (sortBy === 'za') {
          return nameB.localeCompare(nameA, language === 'fr' ? 'fr' : 'en');
        }
        if (sortBy === 'free_first') {
          const aFree = a.pricing_type === 'free' ? 0 : 1;
          const bFree = b.pricing_type === 'free' ? 0 : 1;
          if (aFree !== bFree) return aFree - bFree;
          return nameA.localeCompare(nameB);
        }
        if (sortBy === 'paid_first') {
          const aPaid = a.pricing_type === 'free' ? 1 : 0;
          const bPaid = b.pricing_type === 'free' ? 1 : 0;
          if (aPaid !== bPaid) return aPaid - bPaid;
          return nameA.localeCompare(nameB);
        }
        return 0;
      });
  }, [modules, pricingFilter, selectedCategory, searchQuery, sortBy, language]);

  const freeCount = useMemo(() => modules.filter((m) => m.pricing_type === 'free').length, [modules]);
  const paidCount = useMemo(() => modules.filter((m) => m.pricing_type !== 'free').length, [modules]);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
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

      {/* Architecture Highlights & Free Tools Callout */}
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

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="green" size="sm">
            {freeCount} {t('catalogue.cat_utilities')}
          </Badge>
          <Badge variant="purple" size="sm">
            {paidCount} {t('catalogue.type_paid')}
          </Badge>
        </div>
      </div>

      {/* Filter & Search Bar Section */}
      <div className="space-y-3 bg-white p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] shadow-sm">
        {/* Row 1: Search input + View Mode Toggle + A-Z Sort dropdown */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('catalogue.search_placeholder')}
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6D28D9] text-zinc-800 placeholder-zinc-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500 whitespace-nowrap hidden sm:inline">
              {t('catalogue.sort_label')}
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 rounded-xl border border-zinc-200 text-xs font-bold bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#6D28D9]"
            >
              <option value="az">A → Z ({t('catalogue.sort_az')})</option>
              <option value="za">Z → A ({t('catalogue.sort_za')})</option>
              <option value="free_first">{t('catalogue.sort_free_first')}</option>
              <option value="paid_first">{t('catalogue.sort_popular')}</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center p-1 bg-zinc-100 rounded-xl border border-zinc-200 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                viewMode === 'detailed'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
              title={t('catalogue.view_detailed')}
            >
              <span>▦</span>
              <span className="hidden sm:inline">{t('catalogue.view_detailed')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                viewMode === 'compact'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
              title={t('catalogue.view_compact')}
            >
              <span>≡</span>
              <span className="hidden sm:inline">{t('catalogue.view_compact')}</span>
            </button>
          </div>
        </div>

        {/* Row 2: Pricing Type Tabs (All / Free / Paid) */}
        <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 overflow-x-auto pb-1">
          {[
            { id: 'all', label: t('catalogue.type_all') },
            { id: 'free', label: `✨ ${t('catalogue.type_free')} (${freeCount})` },
            { id: 'paid', label: `💼 ${t('catalogue.type_paid')} (${paidCount})` },
          ].map((typeTab) => (
            <button
              key={typeTab.id}
              type="button"
              onClick={() => setPricingFilter(typeTab.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                pricingFilter === typeTab.id
                  ? 'bg-[#1F2937] text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {typeTab.label}
            </button>
          ))}
        </div>

        {/* Row 3: Categories Chips (Data-driven) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all whitespace-nowrap border ${
              selectedCategory === 'all'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white border-transparent'
                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
            }`}
          >
            {t('catalogue.cat_all')} ({modules.length})
          </button>
          {categoriesList.map((cat) => {
            const count = modules.filter((m) => m.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all whitespace-nowrap border ${
                  selectedCategory === cat
                    ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white border-transparent'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {getCategoryLabel(cat)} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Zero results empty state */}
      {filteredModules.length === 0 ? (
        <Card padding="lg" className="text-center py-12 border-[#E5E7EB] bg-white space-y-3">
          <span className="text-4xl block">🔍</span>
          <h3 className="text-base font-bold text-zinc-800">
            {t('catalogue.no_results_title')}
          </h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            {t('catalogue.no_results_desc')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setPricingFilter('all');
            }}
          >
            {t('catalogue.reset_filters')}
          </Button>
        </Card>
      ) : viewMode === 'compact' ? (
        /* COMPACT / LIST VIEW */
        <Card padding="none" className="overflow-hidden border-[#E5E7EB] rounded-2xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 font-bold border-b border-zinc-200">
                  <th className="py-3 px-4">{language === 'fr' ? 'Module / Outil' : 'Module / Tool'}</th>
                  <th className="py-3 px-4">{language === 'fr' ? 'Catégorie' : 'Category'}</th>
                  <th className="py-3 px-4">{language === 'fr' ? 'Type & Statut' : 'Type & Status'}</th>
                  <th className="py-3 px-4">{language === 'fr' ? 'Tarif' : 'Pricing'}</th>
                  <th className="py-3 px-4 text-right">{language === 'fr' ? 'Action' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm">
                {filteredModules.map((mod) => {
                  const modName = localize(mod.name, language) || mod.id;
                  const modTagline = localize(mod.tagline, language);
                  const isFree = mod.pricing_type === 'free';

                  const isSubscribed =
                    isFree ||
                    Boolean(
                      subscription &&
                      (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
                      (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(mod.id))
                    );

                  const isComingSoon = mod.status === 'coming_soon';

                  return (
                    <tr key={mod.id} className="hover:bg-zinc-50/70 transition-colors">
                      {/* Name & Icon */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border border-black/5"
                            style={{ backgroundColor: `${mod.accentColor}18`, color: mod.accentColor }}
                          >
                            {mod.logo}
                          </div>
                          <div className="min-w-0">
                            <Link href={`/catalogue/${mod.slug}`} className="font-bold text-zinc-900 hover:underline line-clamp-1">
                              {modName}
                            </Link>
                            <p className="text-xs text-zinc-500 line-clamp-1">{modTagline}</p>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700">
                          {getCategoryLabel(mod.category || 'services')}
                        </span>
                      </td>

                      {/* Status / Free or Paid */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {isFree ? (
                            <Badge variant="green" size="sm">
                              {t('catalogue.badge_free')}
                            </Badge>
                          ) : isComingSoon ? (
                            <Badge variant="gray" size="sm">
                              {t('catalogue.status_coming_soon')}
                            </Badge>
                          ) : (
                            <Badge variant="purple" size="sm">
                              {t('catalogue.badge_paid')}
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Price */}
                      <td className="py-3 px-4">
                        <span className="text-xs font-bold text-zinc-800">
                          {isFree
                            ? t('catalogue.badge_free')
                            : mod.pricePerMonth
                            ? `${mod.pricePerMonth.amount.toLocaleString()} ${mod.pricePerMonth.currency} / m`
                            : t('billing.custom_price')}
                        </span>
                      </td>

                      {/* Action Button */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/catalogue/${mod.slug}`}>
                            <Button variant="outline" size="sm" className="text-xs">
                              {t('catalogue.learn_more')}
                            </Button>
                          </Link>

                          {isFree ? (
                            <Link href={mod.entryUrl || `/modules/${mod.slug}`}>
                              <Button variant="primary" size="sm" className="text-xs font-bold">
                                {t('catalogue.open_tool')} &rarr;
                              </Button>
                            </Link>
                          ) : isOwner ? (
                            isSubscribed ? (
                              <Link href={mod.entryUrl || `/modules/${mod.slug}`}>
                                <Button variant="secondary" size="sm" className="text-xs font-bold text-[#059669]">
                                  ✓ {t('common.active')}
                                </Button>
                              </Link>
                            ) : (
                              <Button
                                variant="primary"
                                size="sm"
                                className="text-xs font-bold"
                                disabled={isComingSoon || actionLoading === mod.id}
                                onClick={() => handleActivate(mod)}
                              >
                                {isComingSoon ? t('catalogue.coming_soon') : t('catalogue.activate')}
                              </Button>
                            )
                          ) : (
                            <Button variant="outline" size="sm" className="text-xs" disabled>
                              {t('catalogue.view_only')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* DETAILED VIEW (RICH CARDS GRID) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredModules.map((mod) => {
            const modName = localize(mod.name, language) || mod.id;
            const modTagline = localize(mod.tagline, language);
            const isFree = mod.pricing_type === 'free';

            const isSubscribed =
              isFree ||
              Boolean(
                subscription &&
                (subscription.status === 'active' || subscription.status === 'expiring_soon') &&
                (subscription.planId === 'all_access' || subscription.includedModuleIds.includes(mod.id))
              );

            const isComingSoon = mod.status === 'coming_soon';

            // Status Badge
            let badgeVariant: 'green' | 'purple' | 'yellow' | 'gray' = 'purple';
            let badgeText = t('catalogue.status_available');

            if (isFree) {
              badgeVariant = 'green';
              badgeText = t('catalogue.badge_free');
            } else if (isSubscribed) {
              badgeVariant = 'green';
              badgeText = t('catalogue.status_active');
            } else if (isComingSoon) {
              badgeVariant = 'gray';
              badgeText = t('catalogue.status_coming_soon');
            } else if (mod.kind === 'external') {
              badgeVariant = 'yellow';
              badgeText = t('catalogue.status_external');
            }

            const priceStr = isFree
              ? t('catalogue.badge_free')
              : mod.pricePerMonth
              ? `${mod.pricePerMonth.amount.toLocaleString()} ${mod.pricePerMonth.currency} ${t('billing.per_month')}`
              : t('billing.custom_price');

            return (
              <Card
                key={mod.id}
                padding="lg"
                hoverEffect
                className="flex flex-col justify-between border-[#E5E7EB] relative overflow-hidden"
              >
                {/* Accent Color Top Indicator */}
                <div
                  className="absolute top-0 left-0 right-0 h-1.5"
                  style={{ backgroundColor: mod.accentColor }}
                />

                <div>
                  {/* Header Row: Logo + Badges */}
                  <div className="flex items-start justify-between gap-3 mb-4 mt-1">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-sm border border-black/5"
                      style={{ backgroundColor: `${mod.accentColor}18`, color: mod.accentColor }}
                    >
                      {mod.logo}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isFree && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          {t('catalogue.badge_free')}
                        </span>
                      )}
                      <Badge variant={badgeVariant} size="sm">
                        {badgeText}
                      </Badge>
                    </div>
                  </div>

                  {/* Module Details */}
                  <h3 className="text-xl font-bold text-[#1F2937] mb-1.5 line-clamp-1">
                    {modName}
                  </h3>
                  <p className="text-xs text-[#6B7280] mb-3 line-clamp-2 leading-relaxed min-h-[32px]">
                    {modTagline}
                  </p>

                  {/* Category & Languages */}
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#F3F4F6] text-[#4B5563]">
                      {getCategoryLabel(mod.category || 'services')}
                    </span>

                    <div className="flex gap-1">
                      {mod.languages?.map((lang) => (
                        <span
                          key={lang}
                          className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500"
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer / Pricing & Actions */}
                <div className="pt-4 border-t border-[#E5E7EB]">
                  <div className="flex items-baseline justify-between mb-4">
                    <span className="text-xs text-[#6B7280] font-medium">
                      {isFree ? t('catalogue.badge_free') : t('catalogue.subscription_price') + ' :'}
                    </span>
                    <span className={`text-sm font-black ${isFree ? 'text-emerald-700' : 'text-[#1F2937]'}`}>
                      {priceStr}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/catalogue/${mod.slug}`} className="w-full">
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        {t('catalogue.learn_more')}
                      </Button>
                    </Link>

                    {/* Action button */}
                    {isFree ? (
                      <Link href={mod.entryUrl || `/modules/${mod.slug}`} className="w-full">
                        <Button variant="primary" size="sm" className="w-full text-xs font-bold">
                          {t('catalogue.open_tool')} &rarr;
                        </Button>
                      </Link>
                    ) : isOwner ? (
                      isSubscribed ? (
                        <Link href={mod.entryUrl || `/modules/${mod.slug}`} className="w-full">
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
      )}
    </div>
  );
}
