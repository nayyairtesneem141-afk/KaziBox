'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, Badge, Input } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { getModules } from '@/lib/modules';
import {
  updateModuleStatus,
  runPwaChecks,
  validateModuleInput,
} from '@/lib/registry';
import { getStore, setStoreItem } from '@/lib/storage';
import { ModuleManifest } from '@kazibox/sdk';

const AVAILABLE_CATEGORIES = [
  { value: 'services', label: 'Services & B2B' },
  { value: 'health', label: 'Santé & Pharmacie (Health)' },
  { value: 'logistics', label: 'Logistique & Flotte (Logistics)' },
  { value: 'retail', label: 'Commerce & POS (Retail)' },
  { value: 'hospitality', label: 'Hôtellerie & Immobilier (Hospitality)' },
  { value: 'automotive', label: 'Automobile & Atelier (Automotive)' },
  { value: 'beauty', label: 'Beauté & Bien-être (Beauty)' },
  { value: 'food', label: 'Restauration & Bar (Food)' },
  { value: 'utilities', label: 'Outils & Utilitaires (Utilities)' },
];

const AVAILABLE_SCOPES = [
  { id: 'read:context', label: 'read:context — Identité workspace & utilisateur' },
  { id: 'read:subscription', label: 'read:subscription — Droits & statut KaziBox Flex' },
  { id: 'write:finance', label: 'write:finance — Synchronisation Grand Livre (Recettes/Dépenses)' },
  { id: 'write:events', label: 'write:events — Publication d’événements inter-modules' },
  { id: 'read:profile', label: 'read:profile — Lecture profil collaborateur' },
  { id: 'read:telemetry', label: 'read:telemetry — Métriques consolidées' },
];

const AVAILABLE_EVENTS = [
  { id: 'module.activated', label: 'module.activated — Activation du module pour un tenant' },
  { id: 'module.deactivated', label: 'module.deactivated — Désactivation du module' },
  { id: 'subscription.activated', label: 'subscription.activated — Activation / renouvellement abonnement' },
  { id: 'subscription.expired', label: 'subscription.expired — Expiration d’abonnement' },
  { id: 'user.role_changed', label: 'user.role_changed — Changement de rôle utilisateur' },
];

const ICON_PRESETS = ['🚀', '💊', '🚚', '🛒', '🏨', '🔧', '✂️', '🍽️', '📊', '💼', '🏥', '📦'];

interface RevealedCredentials {
  moduleId: string;
  moduleName: string;
  apiKey?: string;
  ssoSecret?: string;
  webhookSecret?: string;
  createdAt: string;
}

export default function AdminRegistryPage() {
  const { user } = useSession();
  const { t, language } = useTranslation();

  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // No-Code Registration Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // Form Fields
  const [nameFr, setNameFr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [taglineFr, setTaglineFr] = useState('');
  const [taglineEn, setTaglineEn] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [category, setCategory] = useState('services');
  const [developer, setDeveloper] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [logo, setLogo] = useState('🚀');
  const [accentColor, setAccentColor] = useState('#10B981');
  const [appUrl, setAppUrl] = useState('');
  const [entryUrl, setEntryUrl] = useState('');
  const [summaryUrl, setSummaryUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [pricingType, setPricingType] = useState<'paid' | 'free'>('paid');
  const [priceAmount, setPriceAmount] = useState('15000');
  const [priceCurrency, setPriceCurrency] = useState('XOF');
  const [initialStatus, setInitialStatus] = useState<'published' | 'draft' | 'review'>('published');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'read:context',
    'read:subscription',
    'write:finance',
    'write:events',
  ]);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'module.activated',
    'module.deactivated',
    'subscription.activated',
    'subscription.expired',
  ]);
  const [pwaScope, setPwaScope] = useState('');
  const [pwaStartUrl, setPwaStartUrl] = useState('');
  const [icon192Url, setIcon192Url] = useState('');
  const [icon512Url, setIcon512Url] = useState('');
  const [iconMaskableUrl, setIconMaskableUrl] = useState('');

  // One-Time Revealed Credentials Modal
  const [revealedCredentials, setRevealedCredentials] = useState<RevealedCredentials | null>(null);

  const isPlatformAdmin = user?.role === 'platform_admin';

  const loadData = async () => {
    try {
      const res = await fetch('/api/v1/modules/register');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.modules)) {
          setModules(data.modules);
          setLoading(false);
          return;
        }
      }
    } catch {}
    const list = await getModules();
    setModules(list);
    setLoading(false);
  };

  useEffect(() => {
    if (isPlatformAdmin) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  const toSlug = (val: string) =>
    val
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

  const handleNameFrChange = (val: string) => {
    setNameFr(val);
    if (!slugTouched) {
      const generated = toSlug(val);
      setSlug(generated);
    }
  };

  const handleAppUrlChange = (val: string) => {
    setAppUrl(val);
    const cleanBase = val.trim().replace(/\/+$/, '');
    if (cleanBase.startsWith('http://') || cleanBase.startsWith('https://')) {
      const currentSlug = slug || 'mon-saas';
      if (!entryUrl || entryUrl.startsWith(appUrl.trim().replace(/\/+$/, '')) || entryUrl.startsWith('/modules/')) {
        setEntryUrl(`${cleanBase}/modules/${currentSlug}`);
      }
      if (!summaryUrl || summaryUrl.startsWith(appUrl.trim().replace(/\/+$/, ''))) {
        setSummaryUrl(`${cleanBase}/api/summary`);
      }
      if (!webhookUrl || webhookUrl.startsWith(appUrl.trim().replace(/\/+$/, ''))) {
        setWebhookUrl(`${cleanBase}/api/webhooks/kazibox`);
      }
    }
  };

  const toggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    );
  };

  const resetForm = () => {
    setNameFr('');
    setNameEn('');
    setSlug('');
    setSlugTouched(false);
    setTaglineFr('');
    setTaglineEn('');
    setDescriptionFr('');
    setDescriptionEn('');
    setCategory('services');
    setDeveloper('');
    setVersion('1.0.0');
    setLogo('🚀');
    setAccentColor('#10B981');
    setAppUrl('');
    setEntryUrl('');
    setSummaryUrl('');
    setWebhookUrl('');
    setPricingType('paid');
    setPriceAmount('15000');
    setPriceCurrency('XOF');
    setInitialStatus('published');
    setSelectedScopes(['read:context', 'read:subscription', 'write:finance', 'write:events']);
    setSelectedEvents([
      'module.activated',
      'module.deactivated',
      'subscription.activated',
      'subscription.expired',
    ]);
    setPwaScope('');
    setPwaStartUrl('');
    setIcon192Url('');
    setIcon512Url('');
    setIconMaskableUrl('');
    setFormErrors([]);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors([]);
    setActionError(null);
    setActionSuccess(null);

    const cleanSlug = slug.trim().toLowerCase();
    if (modules.some((m) => m.id === cleanSlug || m.slug === cleanSlug)) {
      setFormErrors([`Le slug '${cleanSlug}' est déjà utilisé par un module existant.`]);
      return;
    }

    const effectiveEntryUrl = entryUrl.trim() || (appUrl.trim() ? `${appUrl.trim().replace(/\/+$/, '')}/sso` : '');
    const effectiveSummaryUrl =
      summaryUrl.trim() || (appUrl.trim() ? `${appUrl.trim().replace(/\/+$/, '')}/api/summary` : '');
    const effectiveWebhookUrl =
      webhookUrl.trim() || (appUrl.trim() ? `${appUrl.trim().replace(/\/+$/, '')}/api/webhooks/kazibox` : '');

    const payload: Partial<ModuleManifest> & Record<string, any> = {
      id: cleanSlug,
      slug: cleanSlug,
      name: {
        fr: nameFr.trim(),
        en: (nameEn.trim() || nameFr.trim()),
      },
      tagline: {
        fr: (taglineFr.trim() || descriptionFr.trim().slice(0, 100) || nameFr.trim()),
        en: (taglineEn.trim() || descriptionEn.trim().slice(0, 100) || nameEn.trim() || nameFr.trim()),
      },
      description: {
        fr: descriptionFr.trim(),
        en: descriptionEn.trim(),
      },
      category,
      developer: developer.trim() || 'Partenaire SaaS KaziBox',
      version: version.trim() || '1.0.0',
      logo: logo.trim() || '🚀',
      accentColor: accentColor.trim() || '#10B981',
      appUrl: appUrl.trim() || undefined,
      entryUrl: effectiveEntryUrl,
      summaryUrl: effectiveSummaryUrl,
      webhookUrl: effectiveWebhookUrl,
      kind: 'external',
      status: initialStatus,
      pricing_type: pricingType,
      pricePerMonth: {
        amount: pricingType === 'free' ? 0 : Number(priceAmount) || 0,
        currency: priceCurrency,
      },
      scopes: selectedScopes,
      events: selectedEvents,
      languages: ['fr', 'en'],
      pwa: {
        scope: pwaScope.trim() || effectiveEntryUrl || `/modules/${cleanSlug}`,
        startUrl: pwaStartUrl.trim() || effectiveEntryUrl || `/modules/${cleanSlug}`,
        themeColor: accentColor.trim() || '#10B981',
        icons: [
          {
            src: icon192Url.trim() || `/icons/${cleanSlug}-192.png`,
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: icon512Url.trim() || `/icons/${cleanSlug}-512.png`,
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: iconMaskableUrl.trim() || `/icons/${cleanSlug}-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    };

    const validation = validateModuleInput(payload);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/modules/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setFormErrors(
          Array.isArray(data.details) && data.details.length > 0
            ? data.details
            : [data.error || "Erreur lors de l'enregistrement du module SaaS."]
        );
        return;
      }

      // Sync browser store cache as well
      const store = getStore();
      const idx = store.modules.findIndex((m) => m.id === data.module.id);
      if (idx >= 0) {
        store.modules[idx] = data.module;
      } else {
        store.modules.push(data.module);
      }
      setStoreItem('MODULES', store.modules);

      setShowRegisterModal(false);
      resetForm();
      await loadData();

      setActionSuccess(
        `Application SaaS "${data.module.name?.fr || data.module.id}" enregistrée avec succès !`
      );

      if (data.credentials) {
        setRevealedCredentials({
          moduleId: data.module.id,
          moduleName: data.module.name?.fr || data.module.id,
          apiKey: data.credentials.apiKey,
          ssoSecret: data.credentials.ssoSecret,
          webhookSecret: data.credentials.webhookSecret,
          createdAt: data.credentials.createdAt,
        });
      }
    } catch (err: any) {
      setFormErrors([err?.message || 'Erreur réseau lors de la soumission.']);
    } finally {
      setSubmitting(false);
    }
  };

  // Strict RBAC: platform_admin only
  if (!isPlatformAdmin) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 font-black text-2xl">
          🛑
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">
          {t('admin.access_denied_title')}
        </h2>
        <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
          {t('admin.access_denied_desc')}
        </p>
        <Link href="/dashboard">
          <Button variant="outline" size="md">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>
    );
  }

  const handleStatusChange = async (
    moduleId: string,
    newStatus: 'draft' | 'review' | 'published' | 'suspended'
  ) => {
    setActionError(null);
    setActionSuccess(null);
    const result = await updateModuleStatus(moduleId, newStatus);
    if (!result.success) {
      setActionError(result.error || 'Erreur lors du changement de statut');
    } else {
      setActionSuccess(`Statut du module "${moduleId}" mis à jour : ${newStatus}`);
      await loadData();
    }
  };

  const filteredModules = modules.filter((mod) => {
    if (statusFilter !== 'all' && mod.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameStr = localize(mod.name, language).toLowerCase();
      return (
        nameStr.includes(q) ||
        mod.id.toLowerCase().includes(q) ||
        (mod.developer || '').toLowerCase().includes(q) ||
        (mod.category || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('admin.registry_title')}
            </h1>
            <Badge variant="purple" size="sm">
              Super Admin
            </Badge>
          </div>
          <p className="text-sm text-[#6B7280]">
            {t('admin.registry_subtitle')}
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setFormErrors([]);
              setShowRegisterModal(true);
            }}
          >
            + Enregistrer un SaaS (No-Code)
          </Button>
          <Link href="/admin/webhooks">
            <Button variant="outline" size="sm">
              📡 File Webhooks
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              &larr; {t('placeholders.back_dashboard')}
            </Button>
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-xs underline">
            Fermer
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-xs underline">
            Fermer
          </button>
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto">
          {(['all', 'published', 'draft', 'review', 'suspended'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-[#6D28D9] text-white'
                  : 'bg-[#F9FAFB] text-[#4B5563] hover:bg-[#F3F4F6] border border-[#E5E7EB]'
              }`}
            >
              {st === 'all' ? `Tous (${modules.length})` : st}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-64">
          <Input
            placeholder="Rechercher par nom, slug, éditeur..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Registry Modules Table */}
      <Card padding="lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[#6B7280] text-[11px] uppercase tracking-wider font-bold">
                <th className="py-3 px-3">Module</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Version</th>
                <th className="py-3 px-3">Développeur</th>
                <th className="py-3 px-3">Prix</th>
                <th className="py-3 px-3 text-center">PWA</th>
                <th className="py-3 px-3 text-center">Statut</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {filteredModules.map((mod) => {
                const modName = localize(mod.name, language) || mod.id;
                const pwaStatus = runPwaChecks(mod);

                return (
                  <tr key={mod.id} className="hover:bg-[#F9FAFB] transition-colors">
                    {/* Logo & Name */}
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{mod.logo}</span>
                        <div>
                          <p className="font-bold text-[#1F2937] leading-none">
                            {modName}
                          </p>
                          <span className="text-[11px] text-[#9CA3AF] font-mono">
                            {mod.slug || mod.id}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Kind */}
                    <td className="py-3.5 px-3">
                      <Badge
                        variant={mod.kind === 'external' ? 'yellow' : 'purple'}
                        size="sm"
                      >
                        {mod.kind === 'external' ? 'Tiers (External)' : 'Interne'}
                      </Badge>
                    </td>

                    {/* Version */}
                    <td className="py-3.5 px-3 font-mono font-medium text-[#4B5563]">
                      v{mod.version}
                    </td>

                    {/* Developer */}
                    <td className="py-3.5 px-3 text-[#4B5563] text-xs">
                      {mod.developer || 'KaziBox'}
                    </td>

                    {/* Price */}
                    <td className="py-3.5 px-3 font-bold text-[#1F2937]">
                      {mod.pricing_type === 'free'
                        ? 'Gratuit'
                        : mod.pricePerMonth
                        ? `${mod.pricePerMonth.amount.toLocaleString()} ${mod.pricePerMonth.currency}`
                        : '—'}
                    </td>

                    {/* PWA Compliance */}
                    <td className="py-3.5 px-3 text-center">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          pwaStatus.allPassed
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {pwaStatus.allPassed ? '✓ 100%' : '✗ Incomplet'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-3 text-center">
                      <Badge
                        variant={
                          mod.status === 'published'
                            ? 'green'
                            : mod.status === 'review'
                            ? 'yellow'
                            : mod.status === 'suspended'
                            ? 'gray'
                            : 'purple'
                        }
                        size="sm"
                      >
                        {mod.status}
                      </Badge>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/admin/registry/${mod.id}`}>
                          <Button variant="outline" size="sm" className="text-xs h-8">
                            ⚙️ Gérer
                          </Button>
                        </Link>

                        {mod.status !== 'published' && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => handleStatusChange(mod.id, 'published')}
                          >
                            Publier
                          </Button>
                        )}

                        {mod.status === 'published' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8 text-amber-700 border-amber-300 hover:bg-amber-50"
                            onClick={() => handleStatusChange(mod.id, 'suspended')}
                          >
                            Suspendre
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

      {/* ==================================================================== */}
      {/* NO-CODE REGISTER NEW SAAS MODAL */}
      {/* ==================================================================== */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-[#E5E7EB] p-6 sm:p-8 space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🚀</span>
                  <h2 className="text-xl sm:text-2xl font-black text-[#1F2937]">
                    Enregistrer une Nouvelle Application SaaS
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                  Intégration sans code (No-Code) compatible avec le kit SDK KaziBox, le SSO 5 minutes, KaziBox Flex et le Grand Livre.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="text-sm font-bold text-[#6B7280] hover:text-[#1F2937] px-3 py-1 rounded-xl border border-[#E5E7EB]"
              >
                ✕ Fermer
              </button>
            </div>

            {formErrors.length > 0 && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs space-y-1">
                <p className="font-bold">Veuillez corriger les erreurs suivantes :</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {formErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-6 text-xs sm:text-sm">
              {/* Section 1: Identity & Metadata */}
              <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-4">
                <h3 className="font-black text-[#1F2937] text-sm uppercase tracking-wider">
                  1. Identité & Métadonnées Bilingues
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Nom de l'application (Français) *
                    </label>
                    <Input
                      required
                      placeholder="Ex: AgroTrace — Gestion Coopérative"
                      value={nameFr}
                      onChange={(e) => handleNameFrChange(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Application Name (English) *
                    </label>
                    <Input
                      required
                      placeholder="Ex: AgroTrace — Cooperative Management"
                      value={nameEn}
                      onChange={(e) => setNameEn(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Slug unique (ID) *
                    </label>
                    <Input
                      required
                      placeholder="agrotrace"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''));
                      }}
                    />
                    <span className="text-[11px] text-[#6B7280] font-mono">
                      /modules/{slug || 'mon-saas'}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Catégorie Métier *
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs font-semibold"
                    >
                      {AVAILABLE_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Version (SemVer) *
                    </label>
                    <Input
                      required
                      placeholder="1.0.0"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Éditeur / Société *
                    </label>
                    <Input
                      required
                      placeholder="Ex: AgroTech Africa"
                      value={developer}
                      onChange={(e) => setDeveloper(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Icône *
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={logo}
                        onChange={(e) => setLogo(e.target.value)}
                        className="w-16 text-center text-lg"
                      />
                      <div className="flex flex-wrap gap-1">
                        {ICON_PRESETS.slice(0, 6).map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={() => setLogo(ic)}
                            className={`w-7 h-7 rounded-lg border text-sm flex items-center justify-center ${
                              logo === ic ? 'border-[#6D28D9] bg-purple-50' : 'border-gray-200 bg-white'
                            }`}
                          >
                            {ic}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Couleur d'accentuation
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="h-9 w-12 rounded-lg border border-gray-300 cursor-pointer"
                      />
                      <Input
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Accroche courte (FR)
                    </label>
                    <Input
                      placeholder="Suivi des récoltes, pesées et paiements producteurs"
                      value={taglineFr}
                      onChange={(e) => setTaglineFr(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Short Tagline (EN)
                    </label>
                    <Input
                      placeholder="Harvest tracking, weighing and farmer payouts"
                      value={taglineEn}
                      onChange={(e) => setTaglineEn(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Description complète (Français) *
                    </label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Décrivez les fonctionnalités du SaaS en français..."
                      value={descriptionFr}
                      onChange={(e) => setDescriptionFr(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Full Description (English) *
                    </label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Describe the SaaS application in English..."
                      value={descriptionEn}
                      onChange={(e) => setDescriptionEn(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Application URLs & Webhook Endpoint */}
              <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-4">
                <h3 className="font-black text-[#1F2937] text-sm uppercase tracking-wider">
                  2. URLs de Connexion, Télémétrie & Webhooks
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      URL de base de l'application (Application URL)
                    </label>
                    <Input
                      placeholder="https://agrotrace.mon-domaine.com"
                      value={appUrl}
                      onChange={(e) => handleAppUrlChange(e.target.value)}
                    />
                    <span className="text-[11px] text-[#6B7280]">
                      Pré-remplit automatiquement les endpoints SSO, Summary et Webhook.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      URL d'entrée SSO (Entry URL) *
                    </label>
                    <Input
                      required
                      placeholder="https://agrotrace.mon-domaine.com/modules/agrotrace"
                      value={entryUrl}
                      onChange={(e) => setEntryUrl(e.target.value)}
                    />
                    <span className="text-[11px] text-[#6B7280]">
                      Reçoit le jeton SSO : <code>?token=&lt;jwt&gt;</code>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      URL de résumé télémétrique (Summary URL)
                    </label>
                    <Input
                      placeholder="https://agrotrace.mon-domaine.com/api/summary"
                      value={summaryUrl}
                      onChange={(e) => setSummaryUrl(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Endpoint Webhook KaziBox (Webhook URL) *
                    </label>
                    <Input
                      required
                      placeholder="https://agrotrace.mon-domaine.com/api/webhooks/kazibox"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Pricing & Subscription Settings */}
              <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-4">
                <h3 className="font-black text-[#1F2937] text-sm uppercase tracking-wider">
                  3. Configuration Tarifaire & Abonnement (KaziBox Flex)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Modèle d'accès
                    </label>
                    <select
                      value={pricingType}
                      onChange={(e) => setPricingType(e.target.value as 'paid' | 'free')}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs font-semibold"
                    >
                      <option value="paid">Payant (Abonnement KaziBox Flex)</option>
                      <option value="free">Gratuit (Utilitaire libre)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Prix indicatif / mois
                    </label>
                    <Input
                      type="number"
                      min="0"
                      disabled={pricingType === 'free'}
                      value={pricingType === 'free' ? '0' : priceAmount}
                      onChange={(e) => setPriceAmount(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Devise
                    </label>
                    <select
                      value={priceCurrency}
                      onChange={(e) => setPriceCurrency(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs font-semibold"
                    >
                      <option value="XOF">XOF (FCFA UEMOA)</option>
                      <option value="XAF">XAF (FCFA CEMAC)</option>
                      <option value="CDF">CDF (Franc Congolais)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#374151] mb-1">
                      Statut initial au catalogue
                    </label>
                    <select
                      value={initialStatus}
                      onChange={(e) => setInitialStatus(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-[#D1D5DB] bg-white text-xs font-semibold"
                    >
                      <option value="published">Publié (Actif immédiatement)</option>
                      <option value="review">En revue (Review)</option>
                      <option value="draft">Brouillon (Draft)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 4: Permissions (Scopes) & Events */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-3">
                  <h3 className="font-black text-[#1F2937] text-xs uppercase tracking-wider">
                    4A. Permissions API autorisées (Scopes)
                  </h3>
                  <div className="space-y-2">
                    {AVAILABLE_SCOPES.map((sc) => (
                      <label key={sc.id} className="flex items-start gap-2.5 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={selectedScopes.includes(sc.id)}
                          onChange={() => toggleScope(sc.id)}
                          className="mt-0.5 rounded border-gray-300 text-[#6D28D9]"
                        />
                        <span className="text-[#374151] font-medium">{sc.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-3">
                  <h3 className="font-black text-[#1F2937] text-xs uppercase tracking-wider">
                    4B. Événements Webhooks souscrits
                  </h3>
                  <div className="space-y-2">
                    {AVAILABLE_EVENTS.map((ev) => (
                      <label key={ev.id} className="flex items-start gap-2.5 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(ev.id)}
                          onChange={() => toggleEvent(ev.id)}
                          className="mt-0.5 rounded border-gray-300 text-[#6D28D9]"
                        />
                        <span className="text-[#374151] font-medium">{ev.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 5: PWA & Manifest Information */}
              <div className="bg-[#F9FAFB] p-4 sm:p-5 rounded-2xl border border-[#E5E7EB] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-[#1F2937] text-xs uppercase tracking-wider">
                    5. Configuration PWA & Icônes (Pré-configuré par défaut)
                  </h3>
                  <Badge variant="green" size="sm">
                    Conforme 6 critères PWA
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4B5563] mb-1">
                      Icône 192x192 (optionnel)
                    </label>
                    <Input
                      placeholder={`/icons/${slug || 'app'}-192.png`}
                      value={icon192Url}
                      onChange={(e) => setIcon192Url(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4B5563] mb-1">
                      Icône 512x512 (optionnel)
                    </label>
                    <Input
                      placeholder={`/icons/${slug || 'app'}-512.png`}
                      value={icon512Url}
                      onChange={(e) => setIcon512Url(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4B5563] mb-1">
                      Icône Maskable (optionnel)
                    </label>
                    <Input
                      placeholder={`/icons/${slug || 'app'}-512-maskable.png`}
                      value={iconMaskableUrl}
                      onChange={(e) => setIconMaskableUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E5E7EB]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRegisterModal(false)}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting}
                >
                  {submitting
                    ? 'Enregistrement & Provisionnement...'
                    : '✓ Enregistrer & Générer les Clés'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ONE-TIME CREDENTIALS REVEAL MODAL */}
      {/* ==================================================================== */}
      {revealedCredentials && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border-2 border-amber-300 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge variant="yellow" size="sm">
                  AFFICHAGE UNIQUE DE SÉCURITÉ
                </Badge>
                <h2 className="text-xl font-black text-[#1F2937] mt-1">
                  Identifiants d'Intégration — {revealedCredentials.moduleName}
                </h2>
                <p className="text-xs text-[#6B7280] mt-1">
                  Copiez ces 3 secrets maintenant pour configurer votre application SaaS. Ils sont stockés sous forme hachée/chiffrée et ne seront plus jamais affichés en clair.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {revealedCredentials.apiKey && (
                <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#374151]">1. Clé API (KAZIBOX_API_KEY)</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(revealedCredentials.apiKey!)}
                      className="text-[#6D28D9] font-bold hover:underline"
                    >
                      Copier
                    </button>
                  </div>
                  <code className="block font-mono text-[#111827] break-all bg-white p-2 rounded-lg border">
                    {revealedCredentials.apiKey}
                  </code>
                </div>
              )}

              {revealedCredentials.ssoSecret && (
                <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#374151]">2. Secret SSO (KAZIBOX_SSO_SECRET)</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(revealedCredentials.ssoSecret!)}
                      className="text-[#6D28D9] font-bold hover:underline"
                    >
                      Copier
                    </button>
                  </div>
                  <code className="block font-mono text-[#111827] break-all bg-white p-2 rounded-lg border">
                    {revealedCredentials.ssoSecret}
                  </code>
                </div>
              )}

              {revealedCredentials.webhookSecret && (
                <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#374151]">
                      3. Secret de Signature Webhook (KAZIBOX_WEBHOOK_SECRET)
                    </span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(revealedCredentials.webhookSecret!)}
                      className="text-[#6D28D9] font-bold hover:underline"
                    >
                      Copier
                    </button>
                  </div>
                  <code className="block font-mono text-[#111827] break-all bg-white p-2 rounded-lg border">
                    {revealedCredentials.webhookSecret}
                  </code>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#E5E7EB]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const envBlock = [
                    `KAZIBOX_MODULE_ID=${revealedCredentials.moduleId}`,
                    `KAZIBOX_API_KEY=${revealedCredentials.apiKey || ''}`,
                    `KAZIBOX_SSO_SECRET=${revealedCredentials.ssoSecret || ''}`,
                    `KAZIBOX_WEBHOOK_SECRET=${revealedCredentials.webhookSecret || ''}`,
                  ].join('\n');
                  navigator.clipboard.writeText(envBlock);
                }}
              >
                📋 Copier le bloc .env complet
              </Button>

              <div className="flex items-center gap-2">
                <Link href={`/admin/registry/${revealedCredentials.moduleId}`}>
                  <Button variant="secondary" size="sm">
                    ⚙️ Ouvrir la fiche du module
                  </Button>
                </Link>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setRevealedCredentials(null)}
                >
                  J'ai sauvegardé ces secrets
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
