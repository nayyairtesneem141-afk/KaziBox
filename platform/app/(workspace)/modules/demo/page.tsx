'use client';

import React from 'react';
import Link from 'next/link';
import { Card, Button } from '@kazibox/ui';
import { RequireAccess } from '../../components/RequireAccess';
import { useTranslation } from '@/lib/i18n';

import { useSearchParams } from 'next/navigation';

export default function WorkspaceDemoModuleShell() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const demoUrl = token ? `/m/demo?token=${encodeURIComponent(token)}` : '/m/demo';

  return (
    <RequireAccess moduleId="demo">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/modules/my-modules"
            className="text-xs font-bold text-[#6D28D9] hover:underline"
          >
            &larr; {t('my_modules.title')}
          </Link>
          <Link href={demoUrl} target="_blank">
            <Button variant="outline" size="sm">
              ↗ Ouvrir en Plein Écran PWA
            </Button>
          </Link>
        </div>

        <Card padding="none" className="overflow-hidden border-[#E5E7EB] rounded-3xl shadow-sm">
          <iframe
            src={demoUrl}
            className="w-full h-[780px] border-0"
            title="Demo Module by KaziBox"
          />
        </Card>
      </div>
    </RequireAccess>
  );
}
