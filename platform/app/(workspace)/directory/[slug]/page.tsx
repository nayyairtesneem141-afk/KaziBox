'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import {
  BusinessDirectoryEntry,
  DIRECTORY_CATEGORIES,
  DIRECTORY_COUNTRIES,
  resolveLocalizedString,
} from '@/lib/directory';

export default function DirectoryDetailPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const { language } = useTranslation();

  const [entry, setEntry] = useState<BusinessDirectoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntry = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/directory/${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (data.success && data.entry) {
          setEntry(data.entry);
        } else {
          setError(data.message || 'Fiche entreprise introuvable.');
        }
      } catch {
        setError('Erreur de chargement.');
      } finally {
        setLoading(false);
      }
    };

    fetchEntry();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center py-20 text-gray-500">
        <div className="text-center">
          <div className="animate-spin text-3xl mb-2">⏳</div>
          <p className="font-semibold text-sm">Chargement de la fiche entreprise...</p>
        </div>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] py-16 px-4 max-w-3xl mx-auto text-center">
        <div className="bg-white rounded-3xl border border-gray-200 p-10 shadow-sm">
          <span className="text-4xl block mb-3">⚠️</span>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Fiche non disponible</h1>
          <p className="text-sm text-gray-600 mb-6">{error || 'Cette fiche entreprise n’existe pas ou n’a pas encore été publiée.'}</p>
          <a
            href="/directory"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-700 text-white font-bold text-sm hover:bg-purple-800 transition-all min-h-[44px]"
          >
            ← Retour à l’annuaire
          </a>
        </div>
      </div>
    );
  }

  const countryInfo = DIRECTORY_COUNTRIES.find((c) => c.code === entry.country);
  const catInfo = DIRECTORY_CATEGORIES.find((c) => c.id === entry.category);

  return (
    <div className="min-h-screen bg-[#F9FAFB] pb-16">
      {/* Cover Header */}
      <div className="relative h-64 sm:h-80 bg-gradient-to-r from-purple-950 via-indigo-900 to-slate-900 overflow-hidden">
        {entry.coverImageUrl && (
          <img
            src={entry.coverImageUrl}
            alt={entry.name}
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        <div className="relative z-10 max-w-6xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex flex-col justify-between py-6">
          <div>
            <a
              href="/directory"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/20 backdrop-blur-md text-white text-xs font-bold hover:bg-white/30 transition-all min-h-[36px]"
            >
              <span>←</span>
              <span>{language === 'fr' ? 'Retour à l’annuaire' : 'Back to Directory'}</span>
            </a>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white text-3xl sm:text-4xl flex items-center justify-center shadow-xl border-2 border-white/80 shrink-0">
                {entry.logoUrl || catInfo?.icon || '🏢'}
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="px-2.5 py-0.5 rounded-full bg-purple-500/80 backdrop-blur-md text-white text-xs font-bold">
                    {catInfo?.icon} {resolveLocalizedString(catInfo?.label, language)}
                  </span>
                  {entry.isVerified && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-white text-xs font-black shadow-sm">
                      ✓ {language === 'fr' ? 'Entreprise certifiée' : 'Verified Business'}
                    </span>
                  )}
                  {entry.isFeatured && (
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-xs font-black shadow-sm">
                      ⭐ {language === 'fr' ? 'Recommandé' : 'Featured'}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {entry.name}
                </h1>
                <p className="text-indigo-200 text-xs sm:text-sm mt-0.5">
                  {countryInfo?.flag} {entry.city}, {resolveLocalizedString(countryInfo?.name, language)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`tel:${entry.phone}`}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2 min-h-[44px]"
              >
                <span>📞</span>
                <span>{language === 'fr' ? 'Appeler' : 'Call'}</span>
              </a>
              <a
                href={`mailto:${entry.email}`}
                className="px-5 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold backdrop-blur-md transition-all flex items-center gap-2 min-h-[44px]"
              >
                <span>✉️</span>
                <span>{language === 'fr' ? 'Email' : 'Email'}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Presentation Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tagline Card */}
            <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-sm">
              <h2 className="text-lg font-extrabold text-gray-900 mb-2">
                {language === 'fr' ? 'À propos de l’entreprise' : 'About the Business'}
              </h2>
              <p className="text-base font-semibold text-purple-900 mb-4 leading-relaxed">
                {resolveLocalizedString(entry.tagline, language)}
              </p>
              <div className="text-sm text-gray-700 leading-relaxed space-y-3 whitespace-pre-line">
                {resolveLocalizedString(entry.description, language)}
              </div>
            </div>

            {/* Services & Highlights */}
            <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-sm">
              <h3 className="text-base font-bold text-gray-900 mb-4">
                {language === 'fr' ? 'Garanties & Spécifications' : 'Features & Highlights'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <h4 className="font-bold text-xs text-gray-900">
                      {language === 'fr' ? 'Compte vérifié KaziBox' : 'Verified KaziBox Account'}
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {language === 'fr'
                        ? 'Membre authentifié de l’écosystème numérique africain.'
                        : 'Authenticated member of the African SaaS ecosystem.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <h4 className="font-bold text-xs text-gray-900">
                      {language === 'fr' ? 'Gestion Professionnelle' : 'Professional Management'}
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {language === 'fr'
                        ? 'Exploite les solutions cloud KaziBox certifiées.'
                        : 'Operates certified KaziBox cloud solutions.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Column: Contact & Location */}
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm space-y-5">
              <h3 className="text-base font-extrabold text-gray-900 pb-3 border-b border-gray-100">
                {language === 'fr' ? 'Coordonnées & Accès' : 'Contact & Location'}
              </h3>

              {/* Phone */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                  {language === 'fr' ? 'Téléphone' : 'Phone'}
                </label>
                <a
                  href={`tel:${entry.phone}`}
                  className="font-bold text-sm text-purple-700 hover:underline flex items-center gap-2"
                >
                  <span>📞</span>
                  <span>{entry.phone}</span>
                </a>
              </div>

              {/* Email */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                  {language === 'fr' ? 'Email' : 'Email'}
                </label>
                <a
                  href={`mailto:${entry.email}`}
                  className="font-bold text-sm text-gray-800 hover:text-purple-700 hover:underline flex items-center gap-2 truncate"
                >
                  <span>✉️</span>
                  <span className="truncate">{entry.email}</span>
                </a>
              </div>

              {/* Address */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                  {language === 'fr' ? 'Adresse' : 'Address'}
                </label>
                <div className="text-sm font-medium text-gray-700 flex items-start gap-2">
                  <span>📍</span>
                  <span>{entry.address}, {entry.city}, {countryInfo?.name ? resolveLocalizedString(countryInfo.name, language) : entry.country}</span>
                </div>
              </div>

              {/* Opening Hours */}
              {entry.openingHours && (
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                    {language === 'fr' ? 'Horaires d’ouverture' : 'Opening Hours'}
                  </label>
                  <div className="text-sm font-semibold text-emerald-800 bg-emerald-50 px-3 py-2 rounded-xl flex items-center gap-2">
                    <span>🕒</span>
                    <span>{entry.openingHours}</span>
                  </div>
                </div>
              )}

              {/* Website */}
              {entry.website && (
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                    {language === 'fr' ? 'Site Internet' : 'Website'}
                  </label>
                  <a
                    href={entry.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-purple-700 hover:underline flex items-center gap-1.5 truncate"
                  >
                    <span>🌐</span>
                    <span className="truncate">{entry.website}</span>
                    <span>↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
