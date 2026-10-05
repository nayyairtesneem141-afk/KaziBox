'use client';

import React from 'react';
import Link from 'next/link';
import { EmptyState, Badge, Button } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function MyModulesPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('placeholders.my_modules_title')}
            </h1>
            <Badge variant="yellow" size="sm">
              {t('placeholders.coming_next')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280]">
            {t('placeholders.my_modules_desc')}
          </p>
        </div>

        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>

      {/* Empty State */}
      <EmptyState
        title="Aucun module activé sur cet établissement"
        description={`Votre entreprise ne dispose pas encore de module métier actif. Consultez le catalogue ${platformConfig.platformName} pour découvrir les solutions prêtes à l'emploi (Hôtel, Garage, Taxi...).`}
        actionLabel={t('dashboard.browse_catalogue')}
        onAction={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/modules/catalogue';
          }
        }}
      />
    </div>
  );
}
