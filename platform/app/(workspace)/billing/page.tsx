'use client';

import React from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function BillingPage() {
  const { user, workspace } = useSession();
  const { t } = useTranslation();

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  // Rule: Workers and Managers cannot see Billing
  if (!isOwner) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Accès restreint</h2>
        <p className="text-sm text-[#6B7280]">
          La facturation et les abonnements sont strictement réservés aux propriétaires de l'entreprise.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('placeholders.billing_title')}
            </h1>
            <Badge variant="yellow" size="sm">
              {t('placeholders.coming_next')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280]">
            {t('placeholders.billing_desc')}
          </p>
        </div>

        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>

      {/* Plan Preview */}
      <Card padding="lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#E5E7EB] pb-6 mb-6">
          <div>
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              Abonnement actuel
            </span>
            <h3 className="text-2xl font-black text-[#1F2937] mt-1">
              Formule {workspace?.plan?.toUpperCase()}
            </h3>
            <p className="text-sm text-[#6B7280] mt-1">
              Géré au niveau global par {platformConfig.platformName}. Un prélèvement unique pour l'ensemble des modules activés.
            </p>
          </div>
          <Badge variant="purple" size="md">
            Statut : Actif
          </Badge>
        </div>

        {/* Highlight Architecture Rule: Separation of payment streams */}
        <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl mb-8 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--kazibox-primary,#6D28D9)] text-white flex items-center justify-center shrink-0 font-bold">
            !
          </div>
          <div className="text-sm text-[#1F2937]">
            <p className="font-bold">Séparation stricte des flux financiers :</p>
            <p className="text-[#4B5563] mt-0.5">
              Les paiements de vos clients (chambres d'hôtel, réparations de garage, courses de taxi) sont 100% séparés de votre abonnement logiciel et sont crédités directement sur vos comptes marchands.
            </p>
          </div>
        </div>

        <div className="text-center py-6 border-2 border-dashed border-[#E5E7EB] rounded-2xl">
          <span className="text-4xl mb-3 block">💳</span>
          <h4 className="text-lg font-bold text-[#1F2937] mb-1">
            Module de facturation centralisée en cours de déploiement
          </h4>
          <p className="text-sm text-[#6B7280] max-w-md mx-auto mb-4">
            Vous pourrez bientôt ajouter vos cartes de paiement, consulter l'historique de vos factures et gérer vos licences multi-modules directement ici.
          </p>
          <Link href="/dashboard">
            <Button variant="primary" size="md">
              {t('placeholders.back_dashboard')}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
