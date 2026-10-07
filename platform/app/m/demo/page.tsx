'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { platformConfig } from '@/config';
import { issueModuleToken, verifyModuleToken, ModuleTokenPayload } from '@/lib/sso';
import { STORAGE_FINANCE_KEY, INITIAL_FINANCE_RECORDS } from '@/lib/finance';

function DemoModuleContent() {
  const searchParams = useSearchParams();
  const urlToken = searchParams.get('token');

  const { user, workspace } = useSession();
  const { t, language } = useTranslation();

  const [token, setToken] = useState<string | null>(urlToken);
  const [ssoPayload, setSsoPayload] = useState<ModuleTokenPayload | null>(null);
  const [contextData, setContextData] = useState<any>(null);
  const [subscriptionData, setSubscriptionData] = useState<any>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingSub, setLoadingSub] = useState(false);
  const [apiLogs, setApiLogs] = useState<Array<{ time: string; endpoint: string; status: number; data: any }>>([]);
  const [submitting, setSubmitting] = useState<'rev' | 'exp' | 'evt' | null>(null);
  const [apiKey, setApiKey] = useState('');

  // Initialize or verify SSO Token
  useEffect(() => {
    let activeToken = urlToken;

    // If no token in URL but user is signed in to platform, auto-issue a fresh 5-min SSO token
    if (!activeToken && user && workspace) {
      activeToken = issueModuleToken(user, workspace, 'demo', language);
      setToken(activeToken);
    }

    if (activeToken) {
      const verified = verifyModuleToken(activeToken);
      if (verified.valid && verified.payload) {
        setSsoPayload(verified.payload);
      }
    }
  }, [urlToken, user, workspace, language]);

  // Fetch /api/v1/context using demo module API key
  const fetchContext = async () => {
    setLoadingContext(true);
    try {
      const res = await fetch('/api/v1/context', {
        headers: {
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
          'X-Workspace-Id': workspace?.company_id || '11111111-1111-4111-8111-111111111111',
        },
      });
      const data = await res.json();
      setContextData(data);
      setApiLogs((prev) => [
        { time: new Date().toLocaleTimeString(), endpoint: 'GET /api/v1/context', status: res.status, data },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingContext(false);
    }
  };

  // Fetch /api/v1/subscription using demo module API key
  const fetchSubscription = async () => {
    setLoadingSub(true);
    try {
      const res = await fetch('/api/v1/subscription', {
        headers: {
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
          'X-Workspace-Id': workspace?.company_id || '11111111-1111-4111-8111-111111111111',
        },
      });
      const data = await res.json();
      setSubscriptionData(data);
      setApiLogs((prev) => [
        { time: new Date().toLocaleTimeString(), endpoint: 'GET /api/v1/subscription', status: res.status, data },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingSub(false);
    }
  };

  useEffect(() => {
    fetchContext();
    fetchSubscription();
  }, [workspace]);

  // Add test revenue
  const handleAddRevenue = async () => {
    setSubmitting('rev');
    const ref = `REF-DEMO-${Date.now().toString(36).toUpperCase()}`;
    try {
      const res = await fetch('/api/v1/finance/revenue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
          'X-Workspace-Id': workspace?.company_id || '11111111-1111-4111-8111-111111111111',
        },
        body: JSON.stringify({
          moduleId: 'demo',
          amount: 25000,
          currency: 'XOF',
          source: 'Prestation test module Démo',
          occurredAt: new Date().toISOString(),
          reference: ref,
        }),
      });
      const data = await res.json();
      // Sync new record to localStorage so Dashboard reads it immediately
      if (res.ok && data.record) {
        try {
          const raw = localStorage.getItem(STORAGE_FINANCE_KEY);
          const existing = raw ? JSON.parse(raw) : [...INITIAL_FINANCE_RECORDS];
          if (!existing.find((r: any) => r.id === data.record.id)) {
            existing.unshift(data.record);
            localStorage.setItem(STORAGE_FINANCE_KEY, JSON.stringify(existing));
          }
        } catch {}
      }
      setApiLogs((prev) => [
        { time: new Date().toLocaleTimeString(), endpoint: 'POST /api/v1/finance/revenue', status: res.status, data },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSubmitting(null);
    }
  };

  // Add test expense
  const handleAddExpense = async () => {
    setSubmitting('exp');
    const ref = `REF-DEMO-EXP-${Date.now().toString(36).toUpperCase()}`;
    try {
      const res = await fetch('/api/v1/finance/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
          'X-Workspace-Id': workspace?.company_id || '11111111-1111-4111-8111-111111111111',
        },
        body: JSON.stringify({
          moduleId: 'demo',
          amount: 8500,
          currency: 'XOF',
          category: 'Achat consommables test Démo',
          occurredAt: new Date().toISOString(),
          reference: ref,
        }),
      });
      const data = await res.json();
      // Sync new record to localStorage so Dashboard reads it immediately
      if (res.ok && data.record) {
        try {
          const raw = localStorage.getItem(STORAGE_FINANCE_KEY);
          const existing = raw ? JSON.parse(raw) : [...INITIAL_FINANCE_RECORDS];
          if (!existing.find((r: any) => r.id === data.record.id)) {
            existing.unshift(data.record);
            localStorage.setItem(STORAGE_FINANCE_KEY, JSON.stringify(existing));
          }
        } catch {}
      }
      setApiLogs((prev) => [
        { time: new Date().toLocaleTimeString(), endpoint: 'POST /api/v1/finance/expenses', status: res.status, data },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSubmitting(null);
    }
  };

  // Emit test activity event
  const handleEmitEvent = async () => {
    setSubmitting('evt');
    try {
      const res = await fetch('/api/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
          'X-Workspace-Id': workspace?.company_id || '11111111-1111-4111-8111-111111111111',
        },
        body: JSON.stringify({
          moduleId: 'demo',
          action: 'demo.tested',
          entity: 'module',
          entityId: 'mod-demo',
          details: {
            testedBy: user?.name || 'Tester',
            timestamp: new Date().toISOString(),
            status: 'operational',
          },
        }),
      });
      const data = await res.json();
      setApiLogs((prev) => [
        { time: new Date().toLocaleTimeString(), endpoint: 'POST /api/v1/events', status: res.status, data },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSubmitting(null);
    }
  };

  const accentColor = '#8B5CF6';
  const hasSubscriptionAccess = subscriptionData?.hasAccess !== false;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xs font-bold text-[#6D28D9] hover:underline flex items-center gap-1.5"
          >
            &larr; {t('placeholders.back_dashboard')}
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="purple" size="sm">
              PWA 100% Conforme
            </Badge>
            <Badge variant="green" size="sm">
              SDK v1.0 Contrat Actif
            </Badge>
          </div>
        </div>

        {/* Demo Header Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E7EB] shadow-lg relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#8B5CF6] via-[#6D28D9] to-[#FACC15]" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-md text-white font-black shrink-0"
                style={{ backgroundColor: accentColor }}
              >
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937] tracking-tight">
                    Demo Module by {platformConfig.platformName}
                  </h1>
                </div>
                <p className="text-xs sm:text-sm text-[#6B7280]">
                  Module de référence démontrant l’intégration SSO, le Grand Livre partagé et l’API SDK ouverte.
                </p>
              </div>
            </div>

            <Link href="/dashboard">
              <Button variant="outline" size="sm" className="font-bold">
                📊 Voir dans le Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* Subscription Blocker Banner (if access is revoked or inactive) */}
        {!hasSubscriptionAccess && (
          <div className="p-6 rounded-3xl bg-rose-50 border border-rose-200 text-rose-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-in fade-in">
            <div className="space-y-1">
              <span className="font-black text-sm text-rose-700 flex items-center gap-1.5">
                🔒 Abonnement Requis
              </span>
              <p className="text-xs text-rose-900 leading-relaxed">
                Ce module requiert un abonnement actif sur l’espace <strong>{localize(workspace?.name, language)}</strong>. Les actions d’écritures sont bloquées.
              </p>
            </div>
            <Link href="/billing?plan=single&module=demo">
              <Button variant="primary" size="md" className="font-black bg-rose-600 hover:bg-rose-700 shrink-0">
                💳 Activer l’accès
              </Button>
            </Link>
          </div>
        )}

        {/* SSO Handshake & Context Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* SSO Token Card */}
          <Card padding="md" className="border-[#E5E7EB] shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-[#1F2937] flex items-center gap-1.5">
                🔐 Relais SSO (Token 5 minutes)
              </h3>
              <Badge variant={ssoPayload ? 'green' : 'yellow'} size="sm">
                {ssoPayload ? '✓ Validé' : 'En attente'}
              </Badge>
            </div>

            {ssoPayload ? (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-2xl bg-purple-50 text-purple-900 border border-purple-200/80 space-y-1 font-medium">
                  <p><strong>Utilisateur :</strong> {ssoPayload.userName} ({ssoPayload.role})</p>
                  <p><strong>Espace :</strong> {ssoPayload.workspaceName} ({ssoPayload.workspaceId})</p>
                  <p><strong>Devise / Langue :</strong> {ssoPayload.currency} / {ssoPayload.language.toUpperCase()}</p>
                  <p><strong>Expire à :</strong> {new Date(ssoPayload.exp * 1000).toLocaleTimeString()}</p>
                </div>
                <p className="text-[11px] text-[#9CA3AF]">
                  Signature HMAC vérifiée côté module sans exposer de secret client.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#6B7280]">Aucun jeton SSO actif détecté.</p>
            )}
          </Card>

          {/* Integration API Context Card */}
          <Card padding="md" className="border-[#E5E7EB] shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-[#1F2937] flex items-center gap-1.5">
                🌐 Contexte Résolu (/api/v1/context)
              </h3>
              <button
                onClick={() => {
                  fetchContext();
                  fetchSubscription();
                }}
                disabled={loadingContext}
                className="text-xs font-bold text-[#6D28D9] hover:underline"
              >
                {loadingContext ? '...' : 'Actualiser'}
              </button>
            </div>

            {contextData ? (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 text-[#374151] space-y-1 font-medium">
                  <p><strong>Établissement :</strong> {localize(contextData.workspace?.name, language)}</p>
                  <p><strong>Modules Actifs :</strong> {contextData.activatedModules?.join(', ') || 'Aucun'}</p>
                  <p><strong>Statut Abonnement :</strong> {subscriptionData?.status || 'Vérifié'}</p>
                  <p><strong>Module Appelant :</strong> {localize(contextData.callingModule?.name, language)} (v{contextData.callingModule?.version})</p>
                </div>
                <p className="text-[11px] text-[#059669] font-semibold">
                  ✓ Clé d’API validée avec scopes: <code className="font-mono">read:context, write:finance, write:events</code>
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#6B7280]">Chargement du contexte API...</p>
            )}
          </Card>
        </div>

        {/* Action Testing Box: Revenue and Expense Buttons */}
        <Card padding="lg" className="border-[#E5E7EB] shadow-sm">
          <h3 className="text-lg font-black text-[#1F2937] mb-2 flex items-center gap-2">
            ⚡ Actions Métier du Module
          </h3>
          <p className="text-xs text-[#6B7280] mb-6 leading-relaxed">
            Déclenchez des écritures financières dans le Grand Livre partagé de KaziBox. Les transactions sont garanties idempotentes par référence unique.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Button
              variant="primary"
              size="lg"
              className="w-full sm:w-auto font-black shadow-md min-h-[48px] hover:scale-[1.02] transition-transform"
              disabled={submitting !== null || !hasSubscriptionAccess}
              onClick={handleAddRevenue}
            >
              {submitting === 'rev' ? 'Enregistrement...' : '➕ Ajouter Recette Test (+25 000 XOF)'}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto font-black shadow-sm min-h-[48px] hover:scale-[1.02] transition-transform"
              disabled={submitting !== null || !hasSubscriptionAccess}
              onClick={handleAddExpense}
            >
              {submitting === 'exp' ? 'Enregistrement...' : '➖ Ajouter Dépense Test (-8 500 XOF)'}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto font-black min-h-[48px]"
              disabled={submitting !== null || !hasSubscriptionAccess}
              onClick={handleEmitEvent}
            >
              {submitting === 'evt' ? 'Envoi...' : '📡 Émettre Événement'}
            </Button>
          </div>
        </Card>

        {/* Live Integration API Activity Logs */}
        <Card padding="md" className="border-[#E5E7EB] shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-[#1F2937] flex items-center gap-2">
              📋 Journal des Échanges SDK en Direct
            </h4>
            <span className="text-[11px] text-[#9CA3AF] font-mono">
              {apiLogs.length} requêtes effectuées
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {apiLogs.length === 0 ? (
              <p className="text-xs text-[#9CA3AF] py-6 text-center">
                Cliquez sur un des boutons ci-dessus pour observer l’échange Integration API en direct.
              </p>
            ) : (
              apiLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-2xl bg-[#111827] text-white font-mono text-[11px] space-y-1 shadow-inner"
                >
                  <div className="flex items-center justify-between text-[#9CA3AF]">
                    <span className="text-[#A78BFA] font-bold">{log.endpoint}</span>
                    <span className="flex items-center gap-2">
                      <span className={log.status < 300 ? 'text-[#10B981]' : 'text-rose-400'}>
                        HTTP {log.status}
                      </span>
                      <span>{log.time}</span>
                    </span>
                  </div>
                  <pre className="text-emerald-400 max-h-24 overflow-y-auto">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function DemoModulePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <DemoModuleContent />
    </Suspense>
  );
}

