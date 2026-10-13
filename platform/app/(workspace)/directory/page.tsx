'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import {
  BusinessDirectoryEntry,
  DirectoryCategory,
  DIRECTORY_CATEGORIES,
  DIRECTORY_COUNTRIES,
  resolveLocalizedString,
} from '@/lib/directory';

export default function DirectoryCataloguePage() {
  const { t, language } = useTranslation();
  const { user, workspace } = useSession();

  const [entries, setEntries] = useState<BusinessDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DirectoryCategory | 'all'>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const [selectedCity, setSelectedCity] = useState('');

  // Modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: 'services' as DirectoryCategory,
    country: 'CI',
    city: 'Abidjan',
    address: '',
    phone: '',
    email: '',
    website: '',
    taglineFr: '',
    taglineEn: '',
    descriptionFr: '',
    descriptionEn: '',
    openingHours: '',
  });

  const isOwnerOrManager = user?.role === 'owner' || user?.role === 'manager' || user?.role === 'platform_admin';

  // Load public directory entries
  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/directory');
      const data = await res.json();
      if (data.success && Array.isArray(data.entries)) {
        setEntries(data.entries);
      } else {
        setError(data.message || 'Impossible de charger l’annuaire.');
      }
    } catch {
      setError('Erreur de connexion au serveur.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (selectedCountry !== 'all' && e.country !== selectedCountry) return false;
      if (selectedCategory !== 'all' && e.category !== selectedCategory) return false;
      if (selectedCity.trim() && !e.city.toLowerCase().includes(selectedCity.trim().toLowerCase())) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const nameMatch = e.name.toLowerCase().includes(q);
        const cityMatch = e.city.toLowerCase().includes(q);
        const tag = resolveLocalizedString(e.tagline, language).toLowerCase();
        const desc = resolveLocalizedString(e.description, language).toLowerCase();
        if (!nameMatch && !cityMatch && !tag.includes(q) && !desc.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [entries, selectedCountry, selectedCategory, selectedCity, searchTerm, language]);

  // Check if current user's company already has an entry
  const myCompanyEntry = useMemo(() => {
    const targetComp = workspace?.company_id || workspace?.id;
    if (!targetComp) return null;
    return entries.find((e) => e.companyId === targetComp);
  }, [entries, workspace]);

  // Submit new registration
  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setModalFeedback(null);

    try {
      const payload = {
        name: formData.name,
        category: formData.category,
        country: formData.country,
        city: formData.city,
        address: formData.address,
        phone: formData.phone,
        email: formData.email,
        website: formData.website || undefined,
        tagline: { fr: formData.taglineFr, en: formData.taglineEn || formData.taglineFr },
        description: { fr: formData.descriptionFr, en: formData.descriptionEn || formData.descriptionFr },
        openingHours: formData.openingHours || undefined,
      };

      const res = await fetch('/api/v1/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setModalFeedback({
          type: 'success',
          message: language === 'fr'
            ? 'Votre entreprise a été soumise avec succès pour validation par l’équipe KaziBox.'
            : 'Your business listing was submitted successfully for review by the KaziBox team.',
        });
        await fetchEntries();
        setTimeout(() => {
          setShowRegisterModal(false);
          setModalFeedback(null);
        }, 1800);
      } else {
        setModalFeedback({ type: 'error', message: data.message || 'Erreur lors de l’inscription.' });
      }
    } catch {
      setModalFeedback({ type: 'error', message: 'Erreur réseau.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] pb-16">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white py-12 px-4 sm:px-6 lg:px-8 border-b border-indigo-950">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-xs font-bold mb-3 tracking-wide">
              <span>🌍</span>
              <span>{language === 'fr' ? 'Écosystème KaziBox' : 'KaziBox Ecosystem'}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              {language === 'fr' ? 'Annuaire des Entreprises' : 'African Business Directory'}
            </h1>
            <p className="mt-2 text-indigo-200 text-sm sm:text-base max-w-2xl leading-relaxed">
              {language === 'fr'
                ? 'Découvrez les entreprises certifiées, hôtels, garages, salons et prestataires de services utilisant la technologie KaziBox en Afrique.'
                : 'Discover certified businesses, hotels, garages, salons, and professional services powered by KaziBox across Africa.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isOwnerOrManager && (
              <button
                type="button"
                onClick={() => setShowRegisterModal(true)}
                className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all flex items-center gap-2 min-h-[44px]"
              >
                <span>➕</span>
                <span>{language === 'fr' ? 'Inscrire mon entreprise' : 'Register My Business'}</span>
              </button>
            )}

            {user?.role === 'platform_admin' && (
              <a
                href="/admin/directory"
                className="px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm transition-all flex items-center gap-2 min-h-[44px]"
              >
                <span>🛡️</span>
                <span>{language === 'fr' ? 'Espace Modération Admin' : 'Admin Moderation'}</span>
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6">
        {/* Search & Filter Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-4 sm:p-6 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search Input */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                {language === 'fr' ? 'Rechercher par mot-clé' : 'Search by Keyword'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={
                    language === 'fr'
                      ? 'Ex: Palmeraie, Mécanique, Coiffure, Abidjan...'
                      : 'Ex: Hotel, Garage, Salon, Dakar...'
                  }
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 text-sm font-medium outline-none min-h-[44px]"
                />
                <span className="absolute left-3.5 top-3 text-gray-400">🔍</span>
              </div>
            </div>

            {/* Country Selector */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                {language === 'fr' ? 'Pays' : 'Country'}
              </label>
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 text-sm font-medium outline-none min-h-[44px] bg-white"
              >
                <option value="all">{language === 'fr' ? 'Tous les pays' : 'All Countries'}</option>
                {DIRECTORY_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {resolveLocalizedString(c.name, language)}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Selector */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                {language === 'fr' ? 'Catégorie' : 'Category'}
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 text-sm font-medium outline-none min-h-[44px] bg-white"
              >
                <option value="all">{language === 'fr' ? 'Toutes les catégories' : 'All Categories'}</option>
                {DIRECTORY_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {resolveLocalizedString(cat.label, language)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pt-4 border-t border-gray-100 mt-4 pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all min-h-[36px] ${
                selectedCategory === 'all'
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {language === 'fr' ? 'Toutes' : 'All'}
            </button>
            {DIRECTORY_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 min-h-[36px] ${
                  selectedCategory === cat.id
                    ? 'bg-purple-700 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{resolveLocalizedString(cat.label, language)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Company Status Banner if user has a registered listing */}
        {myCompanyEntry && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 sm:p-5 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 text-sm sm:text-base">{myCompanyEntry.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      myCompanyEntry.status === 'published'
                        ? 'bg-emerald-100 text-emerald-800'
                        : myCompanyEntry.status === 'approved'
                        ? 'bg-blue-100 text-blue-800'
                        : myCompanyEntry.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {myCompanyEntry.status === 'published'
                      ? '✓ Publié dans l’annuaire'
                      : myCompanyEntry.status === 'approved'
                      ? 'Approuvé (en cours de publication)'
                      : myCompanyEntry.status === 'rejected'
                      ? 'Rejeté par l’administration'
                      : '⏳ En attente de validation'}
                  </span>
                </div>
                <p className="text-xs text-indigo-700 mt-1">
                  {resolveLocalizedString(myCompanyEntry.tagline, language)}
                </p>
                {myCompanyEntry.rejectionReason && (
                  <p className="text-xs text-red-700 mt-1 font-semibold">
                    Motif : {myCompanyEntry.rejectionReason}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`/directory/${myCompanyEntry.slug}`}
                className="px-4 py-2 rounded-xl bg-white border border-indigo-300 text-indigo-900 font-bold text-xs hover:bg-indigo-100 transition-all min-h-[38px] flex items-center"
              >
                {language === 'fr' ? 'Voir ma fiche publique' : 'View Public Listing'}
              </a>
            </div>
          </div>
        )}

        {/* Directory Results Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            {language === 'fr' ? 'Entreprises répertoriées' : 'Listed Businesses'}{' '}
            <span className="text-sm font-normal text-gray-500">({filteredEntries.length})</span>
          </h2>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="py-20 text-center text-gray-500 font-medium">
            <div className="animate-spin text-3xl mb-2">⏳</div>
            <p>{language === 'fr' ? 'Chargement des entreprises...' : 'Loading businesses...'}</p>
          </div>
        )}

        {error && !loading && (
          <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm font-medium text-center">
            {error}
          </div>
        )}

        {/* Directory Grid */}
        {!loading && !error && filteredEntries.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <span className="text-4xl block mb-2">🔍</span>
            <h3 className="text-base font-bold text-gray-800">
              {language === 'fr' ? 'Aucune entreprise trouvée' : 'No businesses found'}
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              {language === 'fr'
                ? 'Essayez de modifier vos filtres de recherche ou réinitialisez la sélection par pays et catégorie.'
                : 'Try adjusting your search filters or resetting your country and category selection.'}
            </p>
          </div>
        )}

        {!loading && !error && filteredEntries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredEntries.map((entry) => {
              const countryInfo = DIRECTORY_COUNTRIES.find((c) => c.code === entry.country);
              const catInfo = DIRECTORY_CATEGORIES.find((c) => c.id === entry.category);

              return (
                <div
                  key={entry.id}
                  className="bg-white rounded-2xl border border-[#E5E7EB] hover:border-purple-300 hover:shadow-md transition-all overflow-hidden flex flex-col"
                >
                  {/* Cover Header */}
                  <div className="h-32 bg-gradient-to-r from-purple-800 to-indigo-900 relative p-4 flex items-start justify-between">
                    {entry.coverImageUrl ? (
                      <img
                        src={entry.coverImageUrl}
                        alt={entry.name}
                        className="absolute inset-0 w-full h-full object-cover opacity-35"
                      />
                    ) : null}

                    <div className="relative z-10 flex items-center gap-1.5 flex-wrap">
                      {entry.isFeatured && (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[11px] font-black uppercase tracking-wider shadow-sm">
                          ⭐ {language === 'fr' ? 'Recommandé' : 'Featured'}
                        </span>
                      )}
                      {entry.isVerified && (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider shadow-sm">
                          ✓ {language === 'fr' ? 'Vérifié' : 'Verified'}
                        </span>
                      )}
                    </div>

                    <span className="relative z-10 px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-md text-white text-xs font-bold">
                      {countryInfo?.flag || '🌍'} {entry.city}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      {/* Logo & Category */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 h-10 rounded-xl bg-purple-50 text-xl flex items-center justify-center border border-purple-100">
                            {entry.logoUrl || catInfo?.icon || '🏢'}
                          </span>
                          <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">
                            {resolveLocalizedString(catInfo?.label, language)}
                          </span>
                        </div>
                      </div>

                      {/* Business Name */}
                      <h3 className="font-extrabold text-base text-gray-900 leading-snug line-clamp-1">
                        {entry.name}
                      </h3>

                      {/* Tagline */}
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">
                        {resolveLocalizedString(entry.tagline, language)}
                      </p>

                      {/* Contact Preview */}
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 text-xs text-gray-500">
                        <div className="flex items-center gap-2 truncate">
                          <span>📍</span>
                          <span className="truncate">{entry.address}, {entry.city}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>📞</span>
                          <a href={`tel:${entry.phone}`} className="hover:text-purple-700 font-semibold text-gray-700">
                            {entry.phone}
                          </a>
                        </div>
                        {entry.openingHours && (
                          <div className="flex items-center gap-2 text-emerald-700">
                            <span>🕒</span>
                            <span className="font-medium truncate">{entry.openingHours}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Button */}
                    <div className="mt-5 pt-3">
                      <a
                        href={`/directory/${entry.slug}`}
                        className="w-full py-2.5 rounded-xl bg-gray-50 hover:bg-purple-50 text-purple-900 font-bold text-xs border border-gray-200 hover:border-purple-200 transition-all flex items-center justify-center gap-1.5 min-h-[42px]"
                      >
                        <span>{language === 'fr' ? 'Consulter la fiche' : 'View Business Profile'}</span>
                        <span>→</span>
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Inscrire mon entreprise */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-gray-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-6">
              <div>
                <h3 className="text-xl font-extrabold text-gray-900">
                  {language === 'fr' ? 'Inscrire une entreprise à l’annuaire' : 'Register Business in Directory'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {language === 'fr'
                    ? 'Votre fiche sera examinée et validée par l’équipe de modération KaziBox.'
                    : 'Your listing will be reviewed and validated by the KaziBox moderation team.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {modalFeedback && (
              <div
                className={`p-4 rounded-xl text-xs font-semibold mb-5 ${
                  modalFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {modalFeedback.message}
              </div>
            )}

            <form onSubmit={handleSubmitRegistration} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Nom de l’entreprise *' : 'Business Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="Ex: Palmeraie Resort, Garage Express"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Catégorie d’activité *' : 'Category *'}
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px] bg-white"
                  >
                    {DIRECTORY_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {resolveLocalizedString(cat.label, language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Pays *' : 'Country *'}
                  </label>
                  <select
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px] bg-white"
                  >
                    {DIRECTORY_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {resolveLocalizedString(c.name, language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Ville *' : 'City *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="Ex: Abidjan, Dakar, Douala, Kinshasa"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Téléphone de contact *' : 'Phone *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="+225 07 12 34 56"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Email professionnel *' : 'Email *'}
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="contact@entreprise.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {language === 'fr' ? 'Adresse physique' : 'Address'}
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                  placeholder="Ex: Boulevard de la République, Quartier Plateau"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {language === 'fr' ? 'Slogan court (Tagline)' : 'Short Tagline'}
                </label>
                <input
                  type="text"
                  value={formData.taglineFr}
                  onChange={(e) => setFormData({ ...formData, taglineFr: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                  placeholder="Ex: Hôtel 4 étoiles avec suites climatisées et restaurant"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {language === 'fr' ? 'Description détaillée' : 'Detailed Description'}
                </label>
                <textarea
                  rows={3}
                  value={formData.descriptionFr}
                  onChange={(e) => setFormData({ ...formData, descriptionFr: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600"
                  placeholder="Présentez vos services, horaires, spécialités et atouts..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Horaires d’ouverture' : 'Opening Hours'}
                  </label>
                  <input
                    type="text"
                    value={formData.openingHours}
                    onChange={(e) => setFormData({ ...formData, openingHours: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="Lun - Sam: 08h00 - 19h00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {language === 'fr' ? 'Site web (optionnel)' : 'Website (optional)'}
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-purple-600 min-h-[42px]"
                    placeholder="https://mon-entreprise.com"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50 min-h-[42px]"
                >
                  {language === 'fr' ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-md transition-all min-h-[42px] disabled:opacity-50"
                >
                  {submitting
                    ? language === 'fr' ? 'Envoi...' : 'Submitting...'
                    : language === 'fr' ? 'Soumettre la fiche' : 'Submit Listing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
