'use client';

import React from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function ModuleCataloguePage() {
  const { t } = useTranslation();

  const previewModules = [
    {
      id: 'hotel-property',
      name: 'Hôtel & Résidence Meublée',
      category: 'Hospitality',
      desc: 'Gestion des chambres, réservations en direct & OTA, calendrier interactif, facturation des séjours et suivi du ménage.',
      price: '15 000 XOF / mois',
      features: ['Calendrier des réservations', 'Facturation clients séparée', 'PWA mobile pour réceptionnistes'],
      status: 'Phase 2 (En cours)',
      isFirst: true,
    },
    {
      id: 'garage-auto',
      name: 'Garage & Atelier Mécanique',
      category: 'Automotive',
      desc: 'Ordres de réparation (OR), devis, suivi des véhicules, fiches clients et stock des pièces détachées.',
      price: '15 000 XOF / mois',
      features: ['Fiches véhicules & immatriculations', 'Suivi de main-d’œuvre', 'Ordres de réparation numériques'],
      status: 'À venir',
      isFirst: false,
    },
    {
      id: 'taxi-fleet',
      name: 'Taxi & Flotte de Transport',
      category: 'Logistics',
      desc: 'Suivi des courses, gestion des chauffeurs, affectation des véhicules, carnet d’entretien et recettes quotidiennes.',
      price: '15 000 XOF / mois',
      features: ['Recettes journalières par chauffeur', 'Suivi carburant & vidanges', 'Gestion des pannes'],
      status: 'À venir',
      isFirst: false,
    },
    {
      id: 'salon-beauty',
      name: 'Salon de Coiffure & Esthétique',
      category: 'Services',
      desc: 'Prise de rendez-vous, planning des coiffeurs/esthéticiennes, encaissements rapides et historique des prestations.',
      price: '10 000 XOF / mois',
      features: ['Planning par collaborateur', 'Caisse simplifiée tactile', 'Fidélité client par SMS'],
      status: 'À venir',
      isFirst: false,
    },
    {
      id: 'pharmacy',
      name: 'Pharmacie & Parapharmacie',
      category: 'Health',
      desc: 'Gestion des ordonnances, inventaire des médicaments avec dates de péremption et caisse sécurisée.',
      price: '20 000 XOF / mois',
      features: ['Alerte dates de péremption', 'Code-barres & recherche rapide', 'Rapports d’inventaire'],
      status: 'À venir',
      isFirst: false,
    },
    {
      id: 'restaurant-bar',
      name: 'Restaurant, Bar & Maquis',
      category: 'Food & Beverage',
      desc: 'Prise de commande en salle sur mobile, envoi en cuisine, gestion des tables et clôture de caisse simplifiée.',
      price: '15 000 XOF / mois',
      features: ['Prise de commande mobile tactile', 'Gestion des stocks de boissons', 'Clôture Z journalière'],
      status: 'À venir',
      isFirst: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('placeholders.module_catalogue_title')}
            </h1>
            <Badge variant="yellow" size="sm">
              {t('placeholders.coming_next')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280] max-w-3xl">
            {t('placeholders.module_catalogue_desc')}
          </p>
        </div>

        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>

      {/* Integration Notice */}
      <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--kazibox-primary,#6D28D9)] text-white font-black flex items-center justify-center shrink-0">
            SDK
          </div>
          <div>
            <p className="text-sm font-bold text-[#1F2937]">
              Architecture Ouverte aux Développeurs Tiers
            </p>
            <p className="text-xs text-[#6B7280]">
              Chaque module se branche au noyau commun {platformConfig.platformName} via le package partagé <code className="font-mono bg-white/60 px-1 py-0.5 rounded">@kazibox/sdk</code> et respecte le standard PWA.
            </p>
          </div>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {previewModules.map((mod) => (
          <Card key={mod.id} padding="lg" hoverEffect className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <Badge variant={mod.isFirst ? 'purple' : 'gray'} size="sm">
                  {mod.category}
                </Badge>
                <Badge variant={mod.isFirst ? 'yellow' : 'gray'} size="sm">
                  {mod.status}
                </Badge>
              </div>

              <h3 className="text-xl font-bold text-[#1F2937] mb-2">{mod.name}</h3>
              <p className="text-sm text-[#6B7280] mb-4 leading-relaxed">{mod.desc}</p>

              <div className="space-y-1.5 mb-6">
                {mod.features.map((f, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs text-[#4B5563]">
                    <span className="text-[var(--kazibox-primary,#6D28D9)] font-bold">✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-[#E5E7EB] flex items-center justify-between">
              <div>
                <span className="text-xs text-[#9CA3AF] block">Tarif estimé</span>
                <span className="text-sm font-black text-[#1F2937]">{mod.price}</span>
              </div>
              <Button
                variant={mod.isFirst ? 'secondary' : 'outline'}
                size="sm"
                disabled
              >
                {mod.isFirst ? 'Bientôt disponible' : 'En développement'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
