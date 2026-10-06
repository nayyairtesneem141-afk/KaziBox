'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation, localize, localizeArray } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { getModule } from '@/lib/modules';
import { RequireAccess } from '../../components/RequireAccess';
import { ModuleManifest } from '@kazibox/sdk';

export default function ModuleShellPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { t, language } = useTranslation();
  const { user } = useSession();

  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);
  const [loading, setLoading] = useState(true);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  useEffect(() => {
    async function load() {
      if (!slug) return;
      const mod = await getModule(slug);
      if (mod?.entryUrl && mod.entryUrl !== `/modules/${mod.slug}` && !mod.entryUrl.startsWith(`/modules/${mod.slug}`)) {
        router.replace(mod.entryUrl);
        return;
      }
      setModuleData(mod);
      setLoading(false);
    }
    load();
  }, [slug, router]);

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
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Module introuvable</h2>
        <Link href="/modules/my-modules">
          <Button variant="outline">Retour à mes modules</Button>
        </Link>
      </div>
    );
  }

  const moduleName = localize(moduleData.name, language) || moduleData.id;
  const moduleTagline = localize(moduleData.tagline, language);
  const features = localizeArray(moduleData.features, language);

  return (
    <RequireAccess moduleId={moduleData.id}>
      <div className="space-y-6">
        {/* Module Sub-Header & Navigation */}
        <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E5E7EB] pb-5">
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-sm"
                style={{ backgroundColor: `${moduleData.accentColor}15`, color: moduleData.accentColor }}
              >
                {moduleData.logo}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-[#1F2937]">{moduleName}</h1>
                  <Badge variant="purple" size="sm">
                    v{moduleData.version}
                  </Badge>
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: moduleData.accentColor }}
                  />
                </div>
                <p className="text-sm text-[#6B7280] mt-0.5">{moduleTagline}</p>
              </div>
            </div>

            {/* Centralized Billing Redirect Shortcuts (rule: modules never contain billing logic) */}
            <div className="flex items-center flex-wrap gap-2">
              {isOwner && (
                <>
                  <Link href="/billing">
                    <Button variant="outline" size="sm">
                      💳 {t('billing.my_subscription')}
                    </Button>
                  </Link>
                  <Link href={`/billing?action=renew&module=${moduleData.id}`}>
                    <Button variant="outline" size="sm">
                      🔄 {t('billing.renew_subscription')}
                    </Button>
                  </Link>
                  <Link href="/billing">
                    <Button variant="outline" size="sm">
                      ⚡ {t('billing.change_plan')}
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Module Inner Contextual Menu Bar */}
          <div className="flex items-center gap-2 pt-4 overflow-x-auto">
            <span className="text-xs font-bold text-[#9CA3AF] uppercase tracking-wider mr-2">
              {t('common.actions')} :
            </span>
            {moduleData.menuItems?.map((item, idx) => {
              const label = localize(item.label, language);
              return (
                <button
                  key={idx}
                  onClick={() => alert(`${label} : ${t('placeholders.coming_next')}`)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F9FAFB] hover:bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] transition-colors whitespace-nowrap min-h-[36px]"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Placeholder Content Area: "Module coming next" */}
        <Card padding="lg" className="text-center py-12">
          <div
            className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center text-4xl shadow-inner"
            style={{ backgroundColor: `${moduleData.accentColor}18`, color: moduleData.accentColor }}
          >
            🚀
          </div>

          <Badge variant="yellow" size="md" className="mb-3">
            {t('placeholders.coming_next')}
          </Badge>

          <h2 className="text-2xl font-black text-[#1F2937] mb-2">
            {moduleName} &bull; {t('placeholders.module_ready_soon')}
          </h2>

          <p className="text-sm text-[#6B7280] max-w-xl mx-auto mb-8 leading-relaxed">
            {t('placeholders.module_shell_notice')}
          </p>

          {/* Feature Highlights Grid */}
          <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-8">
            {features.map((feat: string, idx: number) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] flex items-center gap-2.5 text-xs text-[#374151] font-semibold"
              >
                <span style={{ color: moduleData.accentColor }} className="text-base font-black">
                  ✓
                </span>
                <span>{feat}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Link href="/modules/my-modules">
              <Button variant="outline" size="md">
                &larr; {t('nav.my_modules')}
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="primary" size="md">
                {t('placeholders.back_dashboard')}
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </RequireAccess>
  );
}
