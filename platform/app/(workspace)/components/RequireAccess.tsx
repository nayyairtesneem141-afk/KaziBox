'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/useSession';
import { hasModuleAccess, getModule } from '@/lib/modules';
import { useTranslation, localize } from '@/lib/i18n';
import { Card, Button, Badge } from '@kazibox/ui';
import { ModuleManifest } from '@kazibox/sdk';

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
  const [hasAccess, setHasAccess] = useState(false);
  const [moduleData, setModuleData] = useState<ModuleManifest | null>(null);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  useEffect(() => {
    let isMounted = true;
    async function checkAccess() {
      if (!workspace) return;
      try {
        const [access, mod] = await Promise.all([
          hasModuleAccess(workspace.company_id, moduleId),
          getModule(moduleId),
        ]);
        if (isMounted) {
          setHasAccess(access);
          setModuleData(mod);
          setLoading(false);

          if (!access && autoRedirect && isOwner) {
            router.push(`/billing?plan=single&module=${moduleId}`);
          }
        }
      } catch (err) {
        if (isMounted) {
          setHasAccess(false);
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

  if (hasAccess) {
    return <>{children}</>;
  }

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
