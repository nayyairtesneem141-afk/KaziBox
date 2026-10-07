'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge, Modal } from '@kazibox/ui';
import { useTranslation, localize } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import { getModules, deactivateModule } from '@/lib/modules';
import { getSubscription } from '@/lib/billing';
import { ModuleManifest, Subscription } from '@kazibox/sdk';

export default function MyModulesPage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  // Deactivation confirmation modal state
  const [deactivatingModule, setDeactivatingModule] = useState<ModuleManifest | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  const loadData = async () => {
    if (!workspace) return;
    const [allMods, sub] = await Promise.all([
      getModules(),
      getSubscription(workspace.company_id),
    ]);
    setSubscription(sub);

    if (sub) {
      const activeList = allMods.filter((m) => {
        if (m.pricing_type === 'free') return true;
        const inc = sub.includedModuleIds || [];
        return inc.includes(m.id) || 
          inc.includes(m.slug) || 
          (m.id === 'garage-auto' && inc.includes('garage')) ||
          (m.id === 'garage' && inc.includes('garage-auto'));
      });
      setModules(activeList);
    } else {
      setModules([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [workspace]);

  const confirmDeactivation = async () => {
    if (!deactivatingModule || !workspace) return;
    setIsDeactivating(true);
    await deactivateModule(workspace.company_id, deactivatingModule.id);
    await loadData();
    setIsDeactivating(false);
    setDeactivatingModule(null);
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Format expiry date
  const expiryDate = subscription?.renewAt
    ? new Date(subscription.renewAt).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('my_modules.title')}
            </h1>
            <Badge variant="purple" size="sm">
              {modules.length} {t('my_modules.active_count')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280]">
            {t('my_modules.subtitle')}
          </p>
        </div>

        <Link href="/modules/catalogue">
          <Button variant="outline" size="sm">
            + {t('dashboard.browse_catalogue')}
          </Button>
        </Link>
      </div>

      {/* Subscription Summary Banner */}
      {subscription && (
        <div className="p-4 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center text-lg font-black shrink-0">
              💳
            </div>
            <div>
              <p className="text-sm font-bold text-[#1F2937]">
                {t('my_modules.plan_label')} : <span className="uppercase text-[var(--kazibox-primary,#6D28D9)]">{subscription.planId}</span> ({subscription.billingCycle === 'yearly' ? t('billing.yearly') : t('billing.monthly')})
              </p>
              <p className="text-xs text-[#6B7280]">
                {t('my_modules.renewal_date')} : <strong>{expiryDate}</strong>
              </p>
            </div>
          </div>

          {isOwner && (
            <Link href="/billing">
              <Button variant="secondary" size="sm">
                {t('billing.manage_subscription')} &rarr;
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Active Modules List */}
      {modules.length === 0 ? (
        <Card padding="lg" className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-3xl mx-auto mb-4">
            📦
          </div>
          <h3 className="text-xl font-bold text-[#1F2937] mb-2">
            {t('my_modules.empty_title')}
          </h3>
          <p className="text-sm text-[#6B7280] max-w-md mx-auto mb-6">
            {t('my_modules.empty_desc')}
          </p>
          <Link href="/modules/catalogue">
            <Button variant="primary" size="md">
              {t('dashboard.browse_catalogue')} &rarr;
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {modules.map((mod) => {
            const modName = localize(mod.name, language) || mod.id;
            const modTagline = localize(mod.tagline, language);

            const subStatus = subscription?.status || 'active';
            const statusBadgeVariant =
              subStatus === 'active' ? 'green' : subStatus === 'expiring_soon' ? 'yellow' : 'gray';

            return (
              <Card
                key={mod.id}
                padding="md"
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-[#E5E7EB] hover:shadow-md transition-shadow"
              >
                {/* Left: Logo & Details */}
                <div className="flex items-start sm:items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-sm shrink-0"
                    style={{ backgroundColor: `${mod.accentColor}18`, color: mod.accentColor }}
                  >
                    {mod.logo}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-[#1F2937]">{modName}</h3>
                      <Badge variant={statusBadgeVariant} size="sm">
                        {subStatus === 'active'
                          ? t('common.active')
                          : subStatus === 'expiring_soon'
                          ? t('my_modules.status_expiring_soon')
                          : t('my_modules.status_expired')}
                      </Badge>
                      <span className="text-xs text-[#9CA3AF]">v{mod.version}</span>
                    </div>
                    <p className="text-xs text-[#6B7280] line-clamp-1">{modTagline}</p>
                    <div className="text-[11px] text-[#6B7280] mt-1">
                      {t('my_modules.valid_until')} : <strong>{expiryDate}</strong>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center flex-wrap gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-[#E5E7EB]">
                  {/* Open Button: available to everyone */}
                  <Link href={mod.entryUrl || `/modules/${mod.slug}`}>
                    <Button variant="primary" size="sm" className="font-bold min-h-[40px]">
                      🚀 {t('my_modules.open_button')}
                    </Button>
                  </Link>

                  {/* Renew & Deactivate: strictly owner only */}
                  {isOwner && (
                    <>
                      <Link href={`/billing?action=renew&module=${mod.id}`}>
                        <Button variant="outline" size="sm" className="min-h-[40px]">
                          🔄 {t('my_modules.renew_button')}
                        </Button>
                      </Link>

                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 border-red-200 min-h-[40px]"
                        onClick={() => setDeactivatingModule(mod)}
                      >
                        {t('my_modules.deactivate_button')}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Deactivation Confirmation Modal */}
      {deactivatingModule && (
        <Modal
          isOpen={Boolean(deactivatingModule)}
          onClose={() => setDeactivatingModule(null)}
          title={t('my_modules.deactivate_modal_title')}
        >
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-3">
              <span className="text-2xl shrink-0">⚠️</span>
              <div className="text-xs sm:text-sm text-[#78350F]">
                <p className="font-bold mb-1">
                  {t('my_modules.deactivate_modal_warning')}
                </p>
                <p className="font-extrabold text-[var(--kazibox-primary,#6D28D9)]">
                  &laquo; {t('my_modules.data_kept_30_days')} &raquo;
                </p>
              </div>
            </div>

            <p className="text-sm text-[#4B5563]">
              {t('my_modules.deactivate_confirm_text', {
                moduleName: localize(deactivatingModule.name, language),
              })}
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E5E7EB]">
              <Button
                variant="outline"
                size="md"
                onClick={() => setDeactivatingModule(null)}
                disabled={isDeactivating}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="md"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={confirmDeactivation}
                disabled={isDeactivating}
              >
                {isDeactivating ? t('common.loading') : t('my_modules.confirm_deactivation')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
