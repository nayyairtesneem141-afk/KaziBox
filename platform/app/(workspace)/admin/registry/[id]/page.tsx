'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge, Input } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { getModule } from '@/lib/modules';
import {
  runPwaChecks,
  createApiKey,
  getApiKeysForModule,
  updateModuleStatus,
  updateModuleManifest,
} from '@/lib/registry';
import { StoredApiKey } from '@/lib/storage';
import { ModuleManifest, PwaCheckResult } from '@kazibox/sdk';

export default function ModuleRegistryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { user } = useSession();
  const { t, language } = useTranslation();

  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);
  const [pwaResult, setPwaResult] = useState<PwaCheckResult | null>(null);
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([]);
  const [newSecretAlert, setNewSecretAlert] = useState<string | null>(null);

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
    const mod = await getModule(id);
    if (mod) {
      setModuleData(mod);
      setPwaResult(runPwaChecks(mod));
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

  if (!moduleData) {
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

    const res = await updateModuleStatus(moduleData.id, newStatus);
    if (!res.success) {
      setStatusError(res.error || 'Erreur lors de la mise à jour du statut.');
    } else {
      setStatusSuccess(`Statut mis à jour avec succès : ${newStatus}`);
      await loadData();
    }
  };

  const handleGenerateApiKey = async () => {
    const res = await createApiKey(moduleData.id);
    setNewSecretAlert(res.secret);
    const updatedKeys = await getApiKeysForModule(moduleData.id);
    setApiKeys(updatedKeys);
  };

  const handleSaveJson = async () => {
    try {
      setJsonError(null);
      setSaveSuccess(false);
      setSavingManifest(true);
      const parsed = JSON.parse(jsonText);
      const res = await updateModuleManifest(moduleData.id, parsed);
      if (res.success) {
        setSaveSuccess(true);
        await loadData();
      } else {
        setJsonError(res.error || 'Erreur de sauvegarde');
      }
    } catch (err: any) {
      setJsonError(`Erreur de syntaxe JSON : ${err.message}`);
    } finally {
      setSavingManifest(false);
    }
  };

  const modName = localize(moduleData.name, language) || moduleData.id;

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
            Publier sur le catalogue
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
      {/* 1. PWA COMPLIANCE CHECKLIST */}
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

      {/* ==================================================================== */}
      {/* 2. API KEYS & CREDENTIALS MANAGEMENT */}
      {/* ==================================================================== */}
      <Card padding="lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 border-b border-[#E5E7EB] pb-3">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937]">
              Clés API d'Intégration Plateforme
            </h3>
            <p className="text-xs text-[#6B7280]">
              Générez des jetons d'accès pour les webhooks et l'échange de télémétrie du module.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateApiKey}
          >
            + Générer une Clé API
          </Button>
        </div>

        {/* Shown ONCE Secret Alert */}
        {newSecretAlert && (
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-1.5 text-amber-900 font-extrabold text-sm">
              <span>⚠️</span>
              <span>SECRET GÉNÉRÉ (AFFICHÉ UNE SEULE FOIS) :</span>
            </div>
            <p className="text-xs text-amber-800 mb-3">
              Copiez ce secret maintenant. Pour votre sécurité, il est immédiatement haché et ne sera plus jamais accessible.
            </p>
            <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-amber-200">
              <code className="text-xs font-mono font-bold text-[#1F2937] flex-1 break-all">
                {newSecretAlert}
              </code>
              <Button
                variant="primary"
                size="sm"
                className="text-xs py-1 h-8 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(newSecretAlert);
                  alert('Secret copié dans le presse-papiers !');
                }}
              >
                Copier
              </Button>
            </div>
          </div>
        )}

        {/* Existing API Keys Table */}
        {apiKeys.length === 0 ? (
          <p className="text-xs text-[#6B7280] py-4 text-center">
            Aucune clé API active pour ce module.
          </p>
        ) : (
          <div className="divide-y divide-[#F3F4F6] text-xs">
            {apiKeys.map((k) => (
              <div key={k.id} className="py-3 flex items-center justify-between">
                <div>
                  <span className="font-mono font-bold text-[#1F2937]">
                    {k.prefix}
                  </span>
                  <span className="text-[11px] text-[#9CA3AF] ml-3">
                    Créée le {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <Badge variant="purple" size="sm">
                  Active (Hashé)
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ==================================================================== */}
      {/* 3. MANIFEST JSON VIEWER & LIVE EDITOR */}
      {/* ==================================================================== */}
      <Card padding="lg">
        <div className="flex items-center justify-between mb-4 border-b border-[#E5E7EB] pb-3">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937]">
              Éditeur de Manifeste JSON (<code className="font-mono">ModuleManifest</code>)
            </h3>
            <p className="text-xs text-[#6B7280]">
              Visualisez et modifiez les métadonnées déclaratives : scopes, webhooks, URL d'entrée, icônes et configuration PWA.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveJson}
            disabled={savingManifest}
          >
            {savingManifest ? 'Sauvegarde...' : 'Enregistrer le Manifeste'}
          </Button>
        </div>

        {jsonError && (
          <div className="p-3 mb-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold">
            {jsonError}
          </div>
        )}

        {saveSuccess && (
          <div className="p-3 mb-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-semibold">
            ✓ Manifeste enregistré et rechargé avec succès !
          </div>
        )}

        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={16}
          className="w-full font-mono text-xs p-4 rounded-2xl border border-[#E5E7EB] bg-[#111827] text-emerald-400 focus:outline-none focus:ring-2 focus:ring-[var(--kazibox-primary,#6D28D9)] leading-relaxed shadow-inner"
          spellCheck={false}
        />
      </Card>
    </div>
  );
}
