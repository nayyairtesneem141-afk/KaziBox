'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { getModules } from '@/lib/modules';
import { updateModuleStatus, runPwaChecks } from '@/lib/registry';
import { ModuleManifest } from '@kazibox/sdk';

export default function AdminRegistryPage() {
  const { user } = useSession();
  const { t, language } = useTranslation();

  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const isPlatformAdmin = user?.role === 'platform_admin';

  const loadData = async () => {
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
    const result = await updateModuleStatus(moduleId, newStatus);
    if (!result.success) {
      setActionError(result.error || 'Erreur lors du changement de statut');
    } else {
      await loadData();
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

        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-semibold flex items-center gap-3">
          <span>⚠️</span>
          <span>{actionError}</span>
        </div>
      )}

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
              {modules.map((mod) => {
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
                            {mod.id}
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
                      {mod.pricePerMonth
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
                            ⚙️ Détails
                          </Button>
                        </Link>

                        {/* Status Action Dropdown / Buttons */}
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
    </div>
  );
}
