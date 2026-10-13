'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/useSession';
import { getModuleEntitlement, getModule, ModuleEntitlement } from '@/lib/modules';
import { useTranslation, localize } from '@/lib/i18n';
import { Card, Button, Badge } from '@kazibox/ui';
import { ModuleManifest } from '@kazibox/sdk';

export interface ModuleAccessContextType {
  moduleId: string;
  entitlement: ModuleEntitlement;
  isReadOnly: boolean;
  isActive: boolean;
}

const ModuleAccessContext = createContext<ModuleAccessContextType>({
  moduleId: '',
  entitlement: 'none',
  isReadOnly: false,
  isActive: false,
});

export const useModuleAccess = () => useContext(ModuleAccessContext);

interface RequireAccessProps {
  moduleId: string;
  children: React.ReactNode;
  autoRedirect?: boolean;
}

export const RequireAccess: React.FC<RequireAccessProps> = ({
  moduleId,
  children,
  autoRedirect = false,
}) => {
  const router = useRouter();
  const { workspace, user } = useSession();
  const { t, language } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState<ModuleEntitlement>('none');
  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  useEffect(() => {
    let isMounted = true;
    async function checkAccess() {
      const companyId = workspace?.company_id || workspace?.id;
      if (!companyId) return;
      try {
        const [ent, mod] = await Promise.all([
          getModuleEntitlement(companyId, moduleId),
          getModule(moduleId),
        ]);
        if (isMounted) {
          setEntitlement(ent);
          setModuleData(mod);
          setLoading(false);

          if (ent === 'none' && autoRedirect && isOwner) {
            router.push(`/billing?plan=single&module=${moduleId}`);
          }
        }
      } catch (err) {
        if (isMounted) {
          setEntitlement('none');
          setLoading(false);
        }
      }
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [workspace, moduleId, autoRedirect, isOwner, router]);

  if (loading) {
    return (
      <div className="min-h-[300px] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-[#6B7280]">
          {t('common.loading')}
        </p>
      </div>
    );
  }

  // Active full access
  if (entitlement === 'active') {
    return (
      <ModuleAccessContext.Provider
        value={{
          moduleId,
          entitlement: 'active',
          isReadOnly: false,
          isActive: true,
        }}
      >
        {children}
      </ModuleAccessContext.Provider>
    );
  }

  // Read-only historical access for expired/cancelled subscriptions
  if (entitlement === 'read_only') {
    return (
      <ModuleAccessContext.Provider
        value={{
          moduleId,
          entitlement: 'read_only',
          isReadOnly: true,
          isActive: false,
        }}
      >
        <div className="space-y-6">
          <div
            role="alert"
            aria-label="Subscription Expired"
            className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm text-amber-950 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl select-none" aria-hidden="true">⚠️</span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-amber-900">
                    {t('billing.read_only_banner_title')}
                  </h3>
                  <Badge variant="yellow" size="sm">
                    {t('billing.read_only_badge')}
                  </Badge>
                </div>
                <p className="text-xs text-amber-800 mt-1 max-w-2xl leading-relaxed">
                  {t('billing.read_only_banner_desc')}
                </p>
              </div>
            </div>

            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                className="whitespace-nowrap bg-white border-amber-300 hover:bg-amber-100 text-amber-900 font-semibold shadow-xs"
                onClick={() => router.push(`/billing?plan=single&module=${moduleId}`)}
              >
                {t('billing.activate_module_plan')} &rarr;
              </Button>
            )}
          </div>

          {children}
        </div>
      </ModuleAccessContext.Provider>
    );
  }

  // No entitlement (never subscribed)
  const moduleName = localize(moduleData?.name, language) || moduleId;

  return (
    <div className="max-w-xl mx-auto my-12 px-4">
      <Card padding="lg" className="text-center shadow-lg border-[#E5E7EB]">
        <div className="w-16 h-16 rounded-2xl bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center text-3xl mx-auto mb-4">
          {moduleData?.logo || '🔒'}
        </div>

        <Badge variant="purple" size="md" className="mb-2">
          {t('billing.module_required_badge')}
        </Badge>

        <h2 className="text-2xl font-black text-[#1F2937] mb-2">
          {moduleName}
        </h2>

        <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
          {isOwner
            ? t('billing.module_not_covered_owner')
            : t('billing.module_not_covered_staff')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {isOwner ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => router.push(`/billing?plan=single&module=${moduleId}`)}
            >
              {t('billing.activate_module_plan')} &rarr;
            </Button>
          ) : null}

          <Button
            variant="outline"
            size="lg"
            onClick={() => router.push('/dashboard')}
          >
            {t('placeholders.back_dashboard')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

