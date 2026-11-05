'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, Button, Badge, Input } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { getModule } from '@/lib/modules';
import {
  runPwaChecks,
  getApiKeysForModule,
  updateModuleStatus,
  updateModuleManifest,
  provisionModuleCredentials,
  ProvisionedCredentials,
} from '@/lib/registry';
import { StoredApiKey } from '@/lib/storage';
import { ModuleManifest, PwaCheckResult } from '@kazibox/sdk';

type ModuleCategory = string;
type ModuleScope = string;

const AVAILABLE_CATEGORIES: { value: ModuleCategory; label: string }[] = [
  { value: 'services', label: 'Services & Hospitality' },
  { value: 'operations', label: 'Operations & Logistics' },
  { value: 'inventory', label: 'Inventory & Pharmacy' },
  { value: 'finance', label: 'Finance & Accounting' },
  { value: 'sales', label: 'Sales & Point of Sale' },
  { value: 'hr', label: 'HR & Payroll' },
  { value: 'analytics', label: 'Analytics & BI' },
];

const AVAILABLE_SCOPES: { value: ModuleScope; label: string }[] = [
  { value: 'read:context', label: 'read:context (Lecture profil & entreprise)' },
  { value: 'read:subscription', label: 'read:subscription (Vérification abonnement Flex)' },
  { value: 'write:finance', label: 'write:finance (Synchronisation revenus & dépenses)' },
  { value: 'write:events', label: 'write:events (Émission événements métier)' },
];

const AVAILABLE_EVENTS: { value: string; label: string }[] = [
  { value: 'module.activated', label: 'module.activated' },
  { value: 'module.deactivated', label: 'module.deactivated' },
  { value: 'subscription.activated', label: 'subscription.activated' },
  { value: 'subscription.expired', label: 'subscription.expired' },
  { value: 'user.role_changed', label: 'user.role_changed' },
];

interface StructuredEditForm {
  nameFr: string;
  nameEn: string;
  taglineFr: string;
  taglineEn: string;
  descriptionFr: string;
  descriptionEn: string;
  category: ModuleCategory;
  developer: string;
  version: string;
  logo: string;
  accentColor: string;
  appUrl: string;
  entryUrl: string;
  summaryUrl: string;
  webhookUrl: string;
  pricingType: 'paid' | 'free';
  priceAmount: number;
  currency: string;
  scopes: ModuleScope[];
  events: string[];
  pwaStartUrl: string;
  pwaScope: string;
  pwaThemeColor: string;
  pwaIcon192: string;
  pwaIcon512: string;
  pwaMaskable: boolean;
}

function manifestToEditForm(mod: ModuleManifest): StructuredEditForm {
  const nameObj =
    typeof mod.name === 'object'
      ? mod.name
      : { fr: String(mod.name || ''), en: String(mod.name || '') };
  const tagObj =
    typeof mod.tagline === 'object'
      ? mod.tagline
      : { fr: String(mod.tagline || ''), en: String(mod.tagline || '') };
  const descObj =
    typeof mod.description === 'object'
      ? mod.description
      : { fr: String(mod.description || ''), en: String(mod.description || '') };
  const icon192 =
    mod.pwa?.icons?.find((i) => i.sizes.includes('192'))?.src || '/icons/icon-192x192.png';
  const icon512 =
    mod.pwa?.icons?.find((i) => i.sizes.includes('512'))?.src || '/icons/icon-512x512.png';
  const hasMaskable = Boolean(
    mod.pwa?.icons?.some((i) => i.purpose === 'maskable' || i.purpose === 'any maskable')
  );

  return {
    nameFr: nameObj.fr || nameObj.en || '',
    nameEn: nameObj.en || nameObj.fr || '',
    taglineFr: tagObj.fr || tagObj.en || '',
    taglineEn: tagObj.en || tagObj.fr || '',
    descriptionFr: descObj.fr || descObj.en || '',
    descriptionEn: descObj.en || descObj.fr || '',
    category: (mod.category as ModuleCategory) || 'services',
    developer: mod.developer || 'KaziBox Partner',
    version: mod.version || '1.0.0',
    logo: mod.logo || '🧩',
    accentColor: mod.accentColor || '#6D28D9',
    appUrl: mod.appUrl || mod.entryUrl || '',
    entryUrl: mod.entryUrl || mod.appUrl || '',
    summaryUrl: mod.summaryUrl || '',
    webhookUrl: mod.webhookUrl || '',
    pricingType: mod.pricing_type || 'paid',
    priceAmount: mod.pricePerMonth?.amount ?? 0,
    currency: mod.pricePerMonth?.currency || 'XOF',
    scopes: Array.isArray(mod.scopes) ? (mod.scopes as ModuleScope[]) : [],
    events: Array.isArray(mod.events) ? mod.events : [],
    pwaStartUrl: mod.pwa?.startUrl || mod.entryUrl || '',
    pwaScope: mod.pwa?.scope || '/',
    pwaThemeColor: mod.pwa?.themeColor || mod.accentColor || '#6D28D9',
    pwaIcon192: icon192,
    pwaIcon512: icon512,
    pwaMaskable: hasMaskable,
  };
}

export default function ModuleRegistryDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const { user } = useSession();
  const { language } = useTranslation();

  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);
  const [pwaResult, setPwaResult] = useState<PwaCheckResult | null>(null);
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([]);

  // One-time revealed credentials state
  const [revealedCredentials, setRevealedCredentials] = useState<ProvisionedCredentials | null>(
    null
  );

  // Webhook Test State
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Editor Mode ('structured' vs 'json')
  const [editorTab, setEditorTab] = useState<'structured' | 'json'>('structured');
  const [editForm, setEditForm] = useState<StructuredEditForm | null>(null);

  // Manifest JSON Editor State
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savingManifest, setSavingManifest] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Status Action Messages
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);

  const isPlatformAdmin = user?.role === 'platform_admin';

  const loadData = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/v1/modules/registry/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const payload = await res.json();
        const mod = (payload?.module || payload?.data?.module) as ModuleManifest | undefined;
        if (mod) {
          setModuleData(mod);
          setPwaResult(payload?.pwaCompliance || payload?.data?.pwa || runPwaChecks(mod));
          setEditForm(manifestToEditForm(mod));
          setJsonText(JSON.stringify(mod, null, 2));
          const meta = payload?.credentialsMetadata || payload?.data?.credentialsMetadata;
          setApiKeys(Array.isArray(meta) ? meta : await getApiKeysForModule(mod.id));
          return;
        }
      }
    } catch {
      // Fallback to local functions if fetch fails
    }

    const mod = await getModule(id);
    if (mod) {
      setModuleData(mod);
      setPwaResult(runPwaChecks(mod));
      setEditForm(manifestToEditForm(mod));
      setJsonText(JSON.stringify(mod, null, 2));
      const keys = await getApiKeysForModule(mod.id);
      setApiKeys(keys);
    }
  };

  useEffect(() => {
    if (isPlatformAdmin) {
      loadData();
    }
  }, [id, isPlatformAdmin]);

  // Strict RBAC: platform_admin only
  if (!isPlatformAdmin) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12 shadow-sm">
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Accès restreint</h2>
        <p className="text-sm text-[#6B7280] mb-4">
          Le registre des modules est exclusivement réservé aux administrateurs de la plateforme.
        </p>
        <Link href="/dashboard">
          <Button variant="outline">&larr; Retour</Button>
        </Link>
      </div>
    );
  }

  if (!moduleData || !editForm) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleStatusChange = async (
    newStatus: 'draft' | 'review' | 'published' | 'suspended'
  ) => {
    setStatusError(null);
    setStatusSuccess(null);

    try {
      const response = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleData.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        setStatusError(
          payload?.error?.message || payload?.error || 'Erreur lors de la mise à jour du statut.'
        );
      } else {
        setStatusSuccess(`Statut mis à jour avec succès : ${newStatus.toUpperCase()}`);
        await loadData();
      }
    } catch {
      const res = await updateModuleStatus(moduleData.id, newStatus);
      if (!res.success) {
        setStatusError(res.error || 'Erreur lors de la mise à jour du statut.');
      } else {
        setStatusSuccess(`Statut mis à jour avec succès : ${newStatus.toUpperCase()}`);
        await loadData();
      }
    }
  };

  const handleProvisionCredential = async (
    credType: 'api_key' | 'sso_secret' | 'webhook_secret' | 'all'
  ) => {
    try {
      const response = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleData.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'provision_credentials',
          credentialType: credType,
          scope: 'platform',
        }),
      });
      const payload = await response.json();
      const creds = payload?.credentials || payload?.data?.credentials;
      if (response.ok && creds) {
        setRevealedCredentials(creds);
        await loadData();
        return;
      }
    } catch {
      // Fallback
    }

    const fallback = await provisionModuleCredentials(
      moduleData.id,
      user?.company_id || (user as any)?.companyId,
      {
        credentialType: credType,
        scope: 'platform',
      }
    );
    setRevealedCredentials(fallback);
    const updatedKeys = await getApiKeysForModule(moduleData.id);
    setApiKeys(updatedKeys);
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      const response = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleData.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_webhook',
          event: 'module.activated',
        }),
      });
      const payload = await response.json();
      const evt = payload?.delivery || payload?.data?.webhookEvent;
      if (response.ok && evt) {
        const isDelivered = evt.status === 'delivered' || evt.status === 'sent';
        setWebhookTestResult({
          ok: isDelivered,
          message: isDelivered
            ? `Webhook délivré avec succès (HTTP ${evt.responseStatus || evt.responseCode || 200}) vers ${evt.targetUrl}`
            : `Échec de livraison (${evt.status}) vers ${evt.targetUrl} : ${evt.responseBody || evt.lastError || 'Erreur HTTP'}`,
        });
      } else {
        setWebhookTestResult({
          ok: false,
          message: payload?.error || 'Impossible de déclencher le webhook de test.',
        });
      }
    } catch (err: any) {
      setWebhookTestResult({
        ok: false,
        message: err?.message || 'Erreur réseau lors du test webhook.',
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  const toggleEditScope = (scope: ModuleScope) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scopes: prev.scopes.includes(scope)
          ? prev.scopes.filter((s) => s !== scope)
          : [...prev.scopes, scope],
      };
    });
  };

  const toggleEditEvent = (eventName: string) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.includes(eventName)
          ? prev.events.filter((e) => e !== eventName)
          : [...prev.events, eventName],
      };
    });
  };

  const handleSaveStructuredForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setJsonError(null);
    setSaveSuccess(false);
    setSavingManifest(true);

    const updatedPayload: Partial<ModuleManifest> = {
      ...moduleData,
      name: {
        fr: editForm.nameFr.trim(),
        en: (editForm.nameEn || editForm.nameFr).trim(),
      },
      tagline: {
        fr: (editForm.taglineFr || editForm.descriptionFr).trim(),
        en: (editForm.taglineEn || editForm.descriptionEn || editForm.taglineFr).trim(),
      },
      description: {
        fr: editForm.descriptionFr.trim(),
        en: (editForm.descriptionEn || editForm.descriptionFr).trim(),
      },
      category: editForm.category,
      developer: editForm.developer.trim(),
      version: editForm.version.trim(),
      logo: editForm.logo.trim() || '🧩',
      accentColor: editForm.accentColor || '#6D28D9',
      appUrl: (editForm.appUrl || editForm.entryUrl).trim(),
      entryUrl: editForm.entryUrl.trim(),
      summaryUrl: editForm.summaryUrl.trim() || '',
      webhookUrl: editForm.webhookUrl.trim() || '',
      pricing_type: editForm.pricingType,
      pricePerMonth: {
        amount: editForm.pricingType === 'free' ? 0 : Number(editForm.priceAmount) || 0,
        currency: (editForm.currency || 'XOF') as any,
      },
      scopes: editForm.scopes,
      events: editForm.events,
      pwa: {
        startUrl: (editForm.pwaStartUrl || editForm.entryUrl).trim(),
        scope: editForm.pwaScope.trim() || '/',
        themeColor: editForm.pwaThemeColor || editForm.accentColor || '#6D28D9',
        icons: [
          {
            src: editForm.pwaIcon192.trim() || '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: editForm.pwaIcon512.trim() || '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: editForm.pwaMaskable ? 'maskable' : 'any',
          },
        ],
      },
    };

    try {
      const response = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleData.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload),
      });
      const resData = await response.json();
      if (!response.ok || !resData?.success) {
        setJsonError(resData?.error?.message || resData?.error || 'Erreur lors de la sauvegarde.');
      } else {
        setSaveSuccess(true);
        await loadData();
      }
    } catch {
      const res = await updateModuleManifest(moduleData.id, updatedPayload);
      if (res.success) {
        setSaveSuccess(true);
        await loadData();
      } else {
        setJsonError(res.error || 'Erreur de sauvegarde');
      }
    } finally {
      setSavingManifest(false);
    }
  };

  const handleSaveJson = async () => {
    try {
      setJsonError(null);
      setSaveSuccess(false);
      setSavingManifest(true);
      const parsed = JSON.parse(jsonText);

      const response = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleData.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const resData = await response.json();
      if (response.ok && resData?.success) {
        setSaveSuccess(true);
        await loadData();
      } else {
        setJsonError(resData?.error?.message || resData?.error || 'Erreur de sauvegarde');
      }
    } catch (err: any) {
      setJsonError(`Erreur de syntaxe JSON : ${err.message}`);
    } finally {
      setSavingManifest(false);
    }
  };

  const modName = localize(moduleData.name, language) || moduleData.id;
  const apiKeyRecords = apiKeys.filter((k) => !k.type || k.type === 'api_key');
  const ssoSecretRecords = apiKeys.filter((k) => k.type === 'sso_secret');
  const webhookSecretRecords = apiKeys.filter((k) => k.type === 'webhook_secret');

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-16">
      {/* Top Breadcrumb & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Link
          href="/admin/registry"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#6D28D9] hover:underline"
        >
          &larr; Retour au Registre des Modules
        </Link>

        <div className="flex items-center gap-2">
          <Badge
            variant={moduleData.kind === 'external' ? 'yellow' : 'purple'}
            size="md"
          >
            {moduleData.kind === 'external' ? 'Externe (SDK Third-Party)' : 'Natif (Internal)'}
          </Badge>
          <Badge
            variant={
              moduleData.status === 'published'
                ? 'green'
                : moduleData.status === 'review'
                ? 'yellow'
                : 'gray'
            }
            size="md"
          >
            Statut : {moduleData.status.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Module Title Card */}
      <Card padding="lg" className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-sm"
            style={{ backgroundColor: `${moduleData.accentColor}18`, color: moduleData.accentColor }}
          >
            {moduleData.logo}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-[#1F2937]">{modName}</h1>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 text-[#4B5563]">
                {moduleData.id}
              </span>
            </div>
            <p className="text-xs text-[#6B7280] mt-1">
              Version {moduleData.version} &bull; Développeur : {moduleData.developer}
            </p>
          </div>
        </div>

        {/* Status Transition Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStatusChange('draft')}
            disabled={moduleData.status === 'draft'}
          >
            Brouillon
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStatusChange('review')}
            disabled={moduleData.status === 'review'}
          >
            Soumettre pour revue
          </Button>

          <Button
            variant="primary"
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => handleStatusChange('published')}
            disabled={moduleData.status === 'published'}
          >
            Publier / Activer
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-amber-700 border-amber-300 hover:bg-amber-50"
            onClick={() => handleStatusChange('suspended')}
            disabled={moduleData.status === 'suspended'}
          >
            Suspendre
          </Button>
        </div>
      </Card>

      {/* Action Error / Success Feedback */}
      {statusError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-semibold flex items-center gap-3">
          <span>❌</span>
          <span>{statusError}</span>
        </div>
      )}

      {statusSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-sm font-semibold flex items-center gap-3">
          <span>✓</span>
          <span>{statusSuccess}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 1. CREDENTIALS & SECRETS PROVISIONING (API KEY, SSO, WEBHOOK) */}
      {/* ==================================================================== */}
      <Card padding="lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4 border-b border-[#E5E7EB] pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937]">
              Identifiants & Secrets Cryptographiques du SaaS
            </h3>
            <p className="text-xs text-[#6B7280]">
              Provisionnez ou régénérez la clé API (`kz_live_`), le secret de signature SSO (`kz_sso_`) et le secret HMAC Webhook (`kz_whsec_`).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleProvisionCredential('api_key')}
            >
              + Générer Clé API
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleProvisionCredential('sso_secret')}
            >
              🔄 Régénérer Secret SSO
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleProvisionCredential('webhook_secret')}
            >
              🔄 Régénérer Secret Webhook
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleProvisionCredential('all')}
            >
              ⚡ Régénérer les 3 Secrets
            </Button>
          </div>
        </div>

        {/* One-Time Revealed Credentials Alert */}
        {revealedCredentials && (
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl mb-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm">
                <span>⚠️</span>
                <span>SECRETS GÉNÉRÉS (AFFICHÉS UNE SEULE FOIS) :</span>
              </div>
              <button
                type="button"
                onClick={() => setRevealedCredentials(null)}
                className="text-xs font-bold text-amber-800 hover:underline"
              >
                Masquer
              </button>
            </div>
            <p className="text-xs text-amber-800">
              Copiez ces secrets immédiatement dans la configuration `.env` de votre SaaS. Ils sont stockés sous forme hachée/chiffrée et ne seront plus jamais affichés en clair.
            </p>

            {revealedCredentials.apiKey && (
              <div className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] font-extrabold uppercase text-[#6B7280]">
                    KAZIBOX_API_KEY
                  </span>
                  <code className="text-xs font-mono font-bold text-[#1F2937] break-all">
                    {revealedCredentials.apiKey}
                  </code>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="text-xs py-1 h-8 shrink-0"
                  onClick={() => navigator.clipboard.writeText(revealedCredentials.apiKey!)}
                >
                  Copier
                </Button>
              </div>
            )}

            {revealedCredentials.ssoSecret && (
              <div className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] font-extrabold uppercase text-[#6B7280]">
                    KAZIBOX_SSO_SECRET
                  </span>
                  <code className="text-xs font-mono font-bold text-[#1F2937] break-all">
                    {revealedCredentials.ssoSecret}
                  </code>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="text-xs py-1 h-8 shrink-0"
                  onClick={() => navigator.clipboard.writeText(revealedCredentials.ssoSecret!)}
                >
                  Copier
                </Button>
              </div>
            )}

            {revealedCredentials.webhookSecret && (
              <div className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] font-extrabold uppercase text-[#6B7280]">
                    KAZIBOX_WEBHOOK_SECRET
                  </span>
                  <code className="text-xs font-mono font-bold text-[#1F2937] break-all">
                    {revealedCredentials.webhookSecret}
                  </code>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="text-xs py-1 h-8 shrink-0"
                  onClick={() => navigator.clipboard.writeText(revealedCredentials.webhookSecret!)}
                >
                  Copier
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Active Credential Summary Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="p-3.5 rounded-2xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-[#1F2937]">Clés API (`kz_live_`)</span>
              <Badge variant={apiKeyRecords.length > 0 ? 'green' : 'gray'} size="sm">
                {apiKeyRecords.length} active(s)
              </Badge>
            </div>
            <p className="text-[11px] text-[#6B7280] font-mono">
              {apiKeyRecords[0]?.prefix || 'Aucune clé générée'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-[#1F2937]">Secret SSO (`kz_sso_`)</span>
              <Badge variant={ssoSecretRecords.length > 0 ? 'green' : 'yellow'} size="sm">
                {ssoSecretRecords.length > 0 ? 'Configuré (Chiffré)' : 'Par défaut plateforme'}
              </Badge>
            </div>
            <p className="text-[11px] text-[#6B7280] font-mono">
              {ssoSecretRecords[0]?.prefix || 'Clé plateforme partagée'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-[#1F2937]">Secret Webhook (`kz_whsec_`)</span>
              <Badge variant={webhookSecretRecords.length > 0 ? 'green' : 'yellow'} size="sm">
                {webhookSecretRecords.length > 0 ? 'Configuré (Chiffré)' : 'Par défaut plateforme'}
              </Badge>
            </div>
            <p className="text-[11px] text-[#6B7280] font-mono">
              {webhookSecretRecords[0]?.prefix || 'Clé plateforme partagée'}
            </p>
          </div>
        </div>

        {/* Webhook Live Test Bar */}
        {moduleData.webhookUrl && (
          <div className="p-3.5 rounded-2xl bg-[#F3F4F6]/70 border border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#1F2937]">
                Endpoint Webhook configuré :{' '}
                <code className="font-mono text-[#6D28D9]">{moduleData.webhookUrl}</code>
              </p>
              {webhookTestResult && (
                <p
                  className={`text-xs font-semibold mt-1 ${
                    webhookTestResult.ok ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {webhookTestResult.ok ? '✓ ' : '✗ '}
                  {webhookTestResult.message}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestWebhook}
              disabled={testingWebhook}
            >
              {testingWebhook ? 'Envoi en cours...' : '📡 Tester le Webhook'}
            </Button>
          </div>
        )}
      </Card>

      {/* ==================================================================== */}
      {/* 2. NO-CODE CONFIGURATION EDITOR & ADVANCED JSON VIEWER */}
      {/* ==================================================================== */}
      <Card padding="lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-[#E5E7EB] pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937]">
              Configuration de l&apos;Application SaaS
            </h3>
            <p className="text-xs text-[#6B7280]">
              Modifiez les paramètres du module sans toucher au code source ni éditer le JSON manuellement.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-[#F3F4F6] p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setEditorTab('structured')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                editorTab === 'structured'
                  ? 'bg-white text-[#6D28D9] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1F2937]'
              }`}
            >
              Formulaire No-Code
            </button>
            <button
              type="button"
              onClick={() => setEditorTab('json')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                editorTab === 'json'
                  ? 'bg-white text-[#6D28D9] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1F2937]'
              }`}
            >
              JSON Avancé
            </button>
          </div>
        </div>

        {jsonError && (
          <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold">
            ❌ {jsonError}
          </div>
        )}

        {saveSuccess && (
          <div className="p-3 mb-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-semibold">
            ✓ Configuration enregistrée et synchronisée dans le registre persistant !
          </div>
        )}

        {editorTab === 'structured' ? (
          <form onSubmit={handleSaveStructuredForm} className="space-y-6">
            {/* Identity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nom du SaaS (Français) *"
                value={editForm.nameFr}
                onChange={(e) => setEditForm({ ...editForm, nameFr: e.target.value })}
                required
              />
              <Input
                label="Nom du SaaS (Anglais) *"
                value={editForm.nameEn}
                onChange={(e) => setEditForm({ ...editForm, nameEn: e.target.value })}
                required
              />
              <Input
                label="Accroche courte (FR)"
                value={editForm.taglineFr}
                onChange={(e) => setEditForm({ ...editForm, taglineFr: e.target.value })}
              />
              <Input
                label="Accroche courte (EN)"
                value={editForm.taglineEn}
                onChange={(e) => setEditForm({ ...editForm, taglineEn: e.target.value })}
              />
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  Description (Français) *
                </label>
                <textarea
                  rows={2}
                  value={editForm.descriptionFr}
                  onChange={(e) => setEditForm({ ...editForm, descriptionFr: e.target.value })}
                  className="w-full rounded-xl border border-[#D1D5DB] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#6D28D9]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  Description (Anglais) *
                </label>
                <textarea
                  rows={2}
                  value={editForm.descriptionEn}
                  onChange={(e) => setEditForm({ ...editForm, descriptionEn: e.target.value })}
                  className="w-full rounded-xl border border-[#D1D5DB] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#6D28D9]"
                  required
                />
              </div>
            </div>

            {/* Metadata & Visuals */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  Catégorie
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) =>
                    setEditForm({ ...editForm, category: e.target.value as ModuleCategory })
                  }
                  className="w-full h-10 rounded-xl border border-[#D1D5DB] px-3 text-xs bg-white"
                >
                  {AVAILABLE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Développeur"
                value={editForm.developer}
                onChange={(e) => setEditForm({ ...editForm, developer: e.target.value })}
              />
              <Input
                label="Version"
                value={editForm.version}
                onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
              />
              <Input
                label="Icône"
                value={editForm.logo}
                onChange={(e) => setEditForm({ ...editForm, logo: e.target.value })}
              />
              <Input
                label="Couleur (#Hex)"
                value={editForm.accentColor}
                onChange={(e) => setEditForm({ ...editForm, accentColor: e.target.value })}
              />
            </div>

            {/* Endpoints */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#F3F4F6]">
              <Input
                label="Application URL (Base URL)"
                value={editForm.appUrl}
                onChange={(e) => setEditForm({ ...editForm, appUrl: e.target.value })}
              />
              <Input
                label="Entry URL (SSO Launch) *"
                value={editForm.entryUrl}
                onChange={(e) => setEditForm({ ...editForm, entryUrl: e.target.value })}
                required
              />
              <Input
                label="Webhook URL (Réception événements signés)"
                value={editForm.webhookUrl}
                onChange={(e) => setEditForm({ ...editForm, webhookUrl: e.target.value })}
              />
              <Input
                label="Summary URL (KPIs Dashboard)"
                value={editForm.summaryUrl}
                onChange={(e) => setEditForm({ ...editForm, summaryUrl: e.target.value })}
              />
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#F3F4F6]">
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  Modèle Tarifaire
                </label>
                <select
                  value={editForm.pricingType}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      pricingType: e.target.value as 'paid' | 'free',
                    })
                  }
                  className="w-full h-10 rounded-xl border border-[#D1D5DB] px-3 text-xs bg-white"
                >
                  <option value="paid">Payant (Inclus dans KaziBox Flex / Module)</option>
                  <option value="free">Gratuit (Free)</option>
                </select>
              </div>
              <Input
                label="Prix Mensuel de Référence"
                type="number"
                value={String(editForm.priceAmount)}
                onChange={(e) =>
                  setEditForm({ ...editForm, priceAmount: Number(e.target.value) || 0 })
                }
                disabled={editForm.pricingType === 'free'}
              />
              <Input
                label="Devise"
                value={editForm.currency}
                onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
              />
            </div>

            {/* Scopes & Events */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#F3F4F6]">
              <div>
                <p className="text-xs font-bold text-[#374151] mb-2">
                  Permissions & Scopes SDK
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {AVAILABLE_SCOPES.map((sc) => (
                    <label
                      key={sc.value}
                      className="flex items-center gap-2 text-xs p-2 rounded-xl border border-[#E5E7EB] cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={editForm.scopes.includes(sc.value)}
                        onChange={() => toggleEditScope(sc.value)}
                      />
                      <span className="font-mono">{sc.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-[#374151] mb-2">
                  Événements Webhooks Souscrits
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {AVAILABLE_EVENTS.map((ev) => (
                    <label
                      key={ev.value}
                      className="flex items-center gap-2 text-xs p-2 rounded-xl border border-[#E5E7EB] cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={editForm.events.includes(ev.value)}
                        onChange={() => toggleEditEvent(ev.value)}
                      />
                      <span className="font-mono">{ev.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-[#E5E7EB]">
              <Button variant="primary" type="submit" disabled={savingManifest}>
                {savingManifest
                  ? 'Enregistrement...'
                  : 'Enregistrer la Configuration'}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              className="w-full font-mono text-xs p-4 rounded-2xl border border-[#E5E7EB] bg-[#111827] text-emerald-400 focus:outline-none focus:ring-2 focus:ring-[var(--kazibox-primary,#6D28D9)] leading-relaxed shadow-inner"
              spellCheck={false}
            />
            <div className="flex justify-end mt-4">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveJson}
                disabled={savingManifest}
              >
                {savingManifest ? 'Sauvegarde...' : 'Enregistrer le Manifeste JSON'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ==================================================================== */}
      {/* 3. PWA COMPLIANCE CHECKLIST */}
      {/* ==================================================================== */}
      <Card padding="lg">
        <div className="flex items-center justify-between mb-4 border-b border-[#E5E7EB] pb-3">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937]">
              Checklist de Conformité PWA (Obligatoire)
            </h3>
            <p className="text-xs text-[#6B7280]">
              Règle stricte d’architecture : aucun module ne peut être publié sans que les 6 critères soient 100% validés.
            </p>
          </div>
          <Badge
            variant={pwaResult?.allPassed ? 'green' : 'yellow'}
            size="md"
          >
            {pwaResult?.allPassed ? '✓ 100% Validé' : 'Critères incomplets'}
          </Badge>
        </div>

        <div className="space-y-3">
          {pwaResult?.checks.map((chk) => (
            <div
              key={chk.key}
              className={`p-3.5 rounded-2xl border flex items-start justify-between gap-4 transition-colors ${
                chk.passed
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-red-50/40 border-red-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5 ${
                    chk.passed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}
                >
                  {chk.passed ? '✓' : '✗'}
                </span>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-[#1F2937]">
                    {localize(chk.label, language)}
                  </p>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">
                    {chk.details}
                  </p>
                </div>
              </div>

              <span
                className={`text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                  chk.passed
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {chk.passed ? 'Validé' : 'Échoué'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
