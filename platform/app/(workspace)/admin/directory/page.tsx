'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useSession } from '@/lib/useSession';
import {
  BusinessDirectoryEntry,
  DirectoryCategory,
  DirectoryStatus,
  DIRECTORY_CATEGORIES,
  DIRECTORY_COUNTRIES,
  resolveLocalizedString,
} from '@/lib/directory';

export default function AdminDirectoryPage() {
  const { language } = useTranslation();
  const { user } = useSession();

  const isPlatformAdmin = user?.role === 'platform_admin';

  const [entries, setEntries] = useState<BusinessDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DirectoryStatus | 'all'>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Reject modal state
  const [rejectingEntry, setRejectingEntry] = useState<BusinessDirectoryEntry | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

  // Load all entries including pending and unapproved
  const loadEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/directory?status=all');
      const data = await res.json();
      if (data.success && Array.isArray(data.entries)) {
        setEntries(data.entries);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erreur lors du chargement des fiches.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  // Filtered list
  const filteredList = useMemo(() => {
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (countryFilter !== 'all' && e.country !== countryFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !e.name.toLowerCase().includes(q) &&
          !e.city.toLowerCase().includes(q) &&
          !e.phone.toLowerCase().includes(q) &&
          !e.email.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [entries, statusFilter, countryFilter, search]);

  // Status metrics
  const metrics = useMemo(() => {
    return {
      total: entries.length,
      pending: entries.filter((e) => e.status === 'pending_review').length,
      approved: entries.filter((e) => e.status === 'approved').length,
      published: entries.filter((e) => e.status === 'published').length,
      rejected: entries.filter((e) => e.status === 'rejected').length,
    };
  }, [entries]);

  // Execute admin action
  const handleAction = async (
    entry: BusinessDirectoryEntry,
    action: 'approve' | 'reject' | 'publish' | 'suspend' | 'activate' | 'hide' | 'verify' | 'feature',
    payload?: { rejectionReason?: string }
  ) => {
    setProcessingAction(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/v1/directory/${entry.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', message: data.message });
        await loadEntries();
        if (action === 'reject') {
          setRejectingEntry(null);
          setRejectionReason('');
        }
      } else {
        setFeedback({ type: 'error', message: data.message || 'Action échouée.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erreur de connexion serveur.' });
    } finally {
      setProcessingAction(false);
    }
  };

  if (!isPlatformAdmin) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 font-black text-2xl">
          🛑
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Accès Restreint</h2>
        <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
          Cet espace de modération est strictement réservé aux administrateurs de la plateforme KaziBox.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-700 text-white font-bold text-xs"
        >
          Retour au tableau de bord
        </a>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 text-purple-800 text-xs font-bold mb-2">
              <span>🛡️</span>
              <span>{language === 'fr' ? 'Supervision KaziBox' : 'KaziBox Administration'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              {language === 'fr' ? 'Modération de l’Annuaire Entreprises' : 'Business Directory Moderation'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {language === 'fr'
                ? 'Examinez, validez, rejetez et publiez les fiches d’entreprises sur l’écosystème panafricain.'
                : 'Review, approve, reject, and publish business directory entries across the pan-African platform.'}
            </p>
          </div>

          <a
            href="/directory"
            className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-50 transition-all flex items-center gap-2 self-start min-h-[42px]"
          >
            <span>👁️</span>
            <span>{language === 'fr' ? 'Voir l’annuaire public' : 'View Public Directory'}</span>
          </a>
        </div>

        {/* Global Feedback Banner */}
        {feedback && (
          <div
            className={`p-4 rounded-2xl text-xs font-bold flex items-center justify-between ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="font-black text-gray-500 hover:text-gray-900 ml-4"
            >
              ✕
            </button>
          </div>
        )}

        {/* Status Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Total</span>
            <span className="text-2xl font-black text-gray-900 mt-1 block">{metrics.total}</span>
          </div>

          <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-sm">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider block">
              ⏳ {language === 'fr' ? 'En examen' : 'Pending Review'}
            </span>
            <span className="text-2xl font-black text-amber-900 mt-1 block">{metrics.pending}</span>
          </div>

          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
            <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">
              ✓ {language === 'fr' ? 'Approuvés' : 'Approved'}
            </span>
            <span className="text-2xl font-black text-blue-900 mt-1 block">{metrics.approved}</span>
          </div>

          <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-sm">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">
              🚀 {language === 'fr' ? 'Publiés' : 'Published'}
            </span>
            <span className="text-2xl font-black text-emerald-900 mt-1 block">{metrics.published}</span>
          </div>

          <div className="bg-red-50 p-4 rounded-2xl border border-red-200 shadow-sm">
            <span className="text-xs font-bold text-red-700 uppercase tracking-wider block">
              ✕ {language === 'fr' ? 'Rejetés' : 'Rejected'}
            </span>
            <span className="text-2xl font-black text-red-900 mt-1 block">{metrics.rejected}</span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              {language === 'fr' ? 'Filtrer par statut' : 'Status Filter'}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-semibold outline-none min-h-[42px] bg-white"
            >
              <option value="all">{language === 'fr' ? 'Tous les statuts' : 'All Statuses'}</option>
              <option value="pending_review">⏳ En examen (Pending Review)</option>
              <option value="approved">✓ Approuvé (Approved)</option>
              <option value="published">🚀 Publié (Published)</option>
              <option value="rejected">✕ Rejeté (Rejected)</option>
              <option value="suspended">⛔ Suspendu (Suspended)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              {language === 'fr' ? 'Filtrer par pays' : 'Country Filter'}
            </label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-semibold outline-none min-h-[42px] bg-white"
            >
              <option value="all">{language === 'fr' ? 'Tous les pays' : 'All Countries'}</option>
              {DIRECTORY_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {resolveLocalizedString(c.name, language)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              {language === 'fr' ? 'Rechercher' : 'Search'}
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom, ville, téléphone, email..."
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-medium outline-none min-h-[42px]"
            />
          </div>
        </div>

        {/* Table of Entries */}
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider font-extrabold border-b border-gray-200">
                <tr>
                  <th className="py-3.5 px-4">Entreprise</th>
                  <th className="py-3.5 px-4">Catégorie</th>
                  <th className="py-3.5 px-4">Localisation</th>
                  <th className="py-3.5 px-4">Contact</th>
                  <th className="py-3.5 px-4">Statut</th>
                  <th className="py-3.5 px-4">Badges</th>
                  <th className="py-3.5 px-4 text-right">Actions de modération</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      Chargement des fiches...
                    </td>
                  </tr>
                )}

                {!loading && filteredList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      Aucune entreprise ne correspond aux critères de filtre.
                    </td>
                  </tr>
                )}

                {!loading &&
                  filteredList.map((entry) => {
                    const country = DIRECTORY_COUNTRIES.find((c) => c.code === entry.country);
                    const cat = DIRECTORY_CATEGORIES.find((c) => c.id === entry.category);

                    return (
                      <tr key={entry.id} className="hover:bg-gray-50/60 transition-colors">
                        {/* Name & Logo */}
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <span className="w-9 h-9 rounded-xl bg-purple-50 text-lg flex items-center justify-center shrink-0 border border-purple-100">
                              {entry.logoUrl || cat?.icon || '🏢'}
                            </span>
                            <div>
                              <div className="font-extrabold text-gray-900 text-sm">{entry.name}</div>
                              <div className="text-[11px] text-gray-500 line-clamp-1 max-w-xs">
                                {resolveLocalizedString(entry.tagline, language)}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="py-4 px-4">
                          <span className="px-2 py-1 rounded-md bg-purple-50 text-purple-700 font-bold text-[11px]">
                            {cat?.icon} {resolveLocalizedString(cat?.label, language)}
                          </span>
                        </td>

                        {/* Location */}
                        <td className="py-4 px-4 text-gray-700">
                          <div>
                            <span className="font-bold">{country?.flag} {entry.city}</span>
                            <div className="text-[11px] text-gray-400 truncate max-w-xs">{entry.address}</div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="py-4 px-4 text-gray-600">
                          <div>
                            <div className="font-semibold">{entry.phone}</div>
                            <div className="text-[11px] text-gray-400 truncate max-w-[140px]">{entry.email}</div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-black ${
                              entry.status === 'published'
                                ? 'bg-emerald-100 text-emerald-800'
                                : entry.status === 'approved'
                                ? 'bg-blue-100 text-blue-800'
                                : entry.status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : entry.status === 'suspended'
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {entry.status === 'published'
                              ? 'Publié'
                              : entry.status === 'approved'
                              ? 'Approuvé'
                              : entry.status === 'rejected'
                              ? 'Rejeté'
                              : entry.status === 'suspended'
                              ? 'Suspendu'
                              : 'En examen'}
                          </span>
                        </td>

                        {/* Badges */}
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleAction(entry, 'verify')}
                              title="Cliquer pour basculer le badge certifié"
                              className={`px-2 py-0.5 rounded text-[10px] font-black transition-all ${
                                entry.isVerified
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                              }`}
                            >
                              ✓ Vérifié
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(entry, 'feature')}
                              title="Cliquer pour basculer le statut recommandé"
                              className={`px-2 py-0.5 rounded text-[10px] font-black transition-all ${
                                entry.isFeatured
                                  ? 'bg-amber-400 text-amber-950'
                                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                              }`}
                            >
                              ⭐ Recommandé
                            </button>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {/* Approve */}
                            {entry.status === 'pending_review' && (
                              <button
                                type="button"
                                disabled={processingAction}
                                onClick={() => handleAction(entry, 'approve')}
                                className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] shadow-sm transition-all"
                              >
                                Approuver
                              </button>
                            )}

                            {/* Publish */}
                            {entry.status !== 'published' && (
                              <button
                                type="button"
                                disabled={processingAction}
                                onClick={() => handleAction(entry, 'publish')}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-sm transition-all"
                              >
                                Publier
                              </button>
                            )}

                            {/* Reject */}
                            {entry.status !== 'rejected' && (
                              <button
                                type="button"
                                disabled={processingAction}
                                onClick={() => {
                                  setRejectingEntry(entry);
                                  setRejectionReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold text-[11px] border border-red-200 transition-all"
                              >
                                Rejeter
                              </button>
                            )}

                            {/* Active / Hide Toggle */}
                            <button
                              type="button"
                              disabled={processingAction}
                              onClick={() => handleAction(entry, entry.isActive ? 'hide' : 'activate')}
                              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                                entry.isActive
                                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
                                  : 'bg-amber-50 text-amber-800 border-amber-300'
                              }`}
                            >
                              {entry.isActive ? 'Masquer' : 'Activer'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Rejeter une fiche avec motif */}
        {rejectingEntry && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Rejeter la fiche : {rejectingEntry.name}
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Veuillez spécifier le motif du rejet. Ce motif sera visible par le propriétaire de l’entreprise pour correction.
              </p>

              <textarea
                rows={4}
                required
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Ex: Coordonnées téléphoniques non vérifiables, adresse incomplète, catégorie inadéquate..."
                className="w-full p-3 rounded-xl border border-gray-300 text-xs font-medium outline-none focus:border-red-600 mb-4"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingEntry(null)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={!rejectionReason.trim() || processingAction}
                  onClick={() => handleAction(rejectingEntry, 'reject', { rejectionReason })}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  Confirmer le rejet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
