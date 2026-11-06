'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { SupportedCurrency, SUPPORTED_CURRENCIES, PricingTierConfig, PricingSettings } from '@/lib/pricing-tiers';

export default function AdminPricingPage() {
  const { session } = useSession();
  const { language } = useTranslation();
  const user = session?.user;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isPlatformAdmin = user?.role === 'platform_admin';

  useEffect(() => {
    fetch('/api/v1/admin/pricing')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setSettings(data.settings);
        }
      })
      .catch(() => {
        setMessage({ type: 'error', text: 'Impossible de charger la configuration tarifaire.' });
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePriceChange = (tierIndex: number, currency: SupportedCurrency, value: string) => {
    if (!settings) return;
    const newTiers = [...settings.tiers];
    const num = value === '' ? null : Number(value);
    newTiers[tierIndex].prices[currency] = num;
    setSettings({ ...settings, tiers: newTiers });
  };

  const handleAdditionalPriceChange = (currency: SupportedCurrency, value: string) => {
    if (!settings) return;
    const num = value === '' ? null : Number(value);
    setSettings({
      ...settings,
      additionalAppPrice: {
        prices: {
          ...settings.additionalAppPrice.prices,
          [currency]: num,
        },
      },
    });
  };

  const handleSave = async () => {
    if (!settings || !isPlatformAdmin) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSettings(data.settings);
        setMessage({ type: 'success', text: 'Grille tarifaire KaziBox Flex enregistrée avec succès.' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Erreur lors de la mise à jour.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Erreur réseau lors de la sauvegarde.' });
    } finally {
      setSaving(false);
    }
  };

  if (!isPlatformAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card padding="lg">
          <div className="text-center py-8">
            <h2 className="text-xl font-bold text-red-600">Accès Restreint</h2>
            <p className="text-sm text-gray-600 mt-2">
              Seuls les administrateurs de la plateforme KaziBox peuvent configurer les paliers de tarification.
            </p>
            <div className="mt-4">
              <Link href="/billing">
                <Button variant="outline">Retour à la Facturation</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[var(--kazibox-primary,#6D28D9)] uppercase tracking-wider">
              Administration KaziBox
            </span>
            <Badge variant="green" size="sm">Flex Multi-Devises</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 mt-1">
            Gestion des Paliers Tarifaires Multi-SaaS
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Chaque devise dispose de son propre prix de référence explicite. Aucune conversion automatique par taux de change n’est appliquée.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving || loading}
          className="shrink-0"
        >
          {saving ? 'Sauvegarde...' : '💾 Enregistrer la Grille'}
        </Button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm font-semibold border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading || !settings ? (
        <div className="text-center py-12 text-gray-500 font-medium">Chargement des paramètres...</div>
      ) : (
        <div className="space-y-6">
          {/* Tiers List */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-4 border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Paliers Mensuels Confirmés</h3>
                <p className="text-xs text-gray-500">Mois commercial fixe de 30 jours (2 592 000 secondes)</p>
              </div>
              <span className="text-xs font-semibold text-gray-500">Exclusion stricte des 50 outils gratuits</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs font-bold text-gray-700">
                    <th className="p-3">Palier</th>
                    <th className="p-3">Seuil Métiers</th>
                    <th className="p-3">USD ($) <span className="text-emerald-600 font-semibold">(Confirmé)</span></th>
                    <th className="p-3">EUR (€)</th>
                    <th className="p-3">XOF (FCFA)</th>
                    <th className="p-3">XAF (FCFA)</th>
                    <th className="p-3">CDF (FC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {settings.tiers.map((tier, idx) => (
                    <tr key={tier.id} className="hover:bg-gray-50">
                      <td className="p-3 font-bold text-gray-900">
                        {tier.name.fr}
                      </td>
                      <td className="p-3 font-semibold text-gray-600">
                        {tier.minModules === tier.maxModules
                          ? `${tier.minModules} métier`
                          : `${tier.minModules} à ${tier.maxModules} métiers`}
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          step="any"
                          value={tier.prices.USD ?? ''}
                          onChange={(e) => handlePriceChange(idx, 'USD', e.target.value)}
                          className="w-24 px-2 py-1 border rounded-lg font-bold bg-white text-gray-900"
                        />
                      </td>
                      {(['EUR', 'XOF', 'XAF', 'CDF'] as SupportedCurrency[]).map((curr) => (
                        <td key={curr} className="p-3">
                          <input
                            type="number"
                            step={curr === 'EUR' ? '0.01' : '1'}
                            placeholder="Non configuré"
                            value={tier.prices[curr] ?? ''}
                            onChange={(e) => handlePriceChange(idx, curr, e.target.value)}
                            className="w-28 px-2 py-1 border rounded-lg text-xs font-semibold bg-white text-gray-800 placeholder:text-gray-400"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Additional App Row (>6) */}
                  <tr className="bg-purple-50/50 font-semibold border-t-2">
                    <td className="p-3 font-bold text-[var(--kazibox-primary,#6D28D9)]">
                      Par métier supp. (&gt;6)
                    </td>
                    <td className="p-3 text-gray-600">
                      Chaque métier au-delà de 6
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        step="any"
                        value={settings.additionalAppPrice.prices.USD ?? ''}
                        onChange={(e) => handleAdditionalPriceChange('USD', e.target.value)}
                        className="w-24 px-2 py-1 border rounded-lg font-bold bg-white text-gray-900"
                      />
                    </td>
                    {(['EUR', 'XOF', 'XAF', 'CDF'] as SupportedCurrency[]).map((curr) => (
                      <td key={curr} className="p-3">
                        <input
                          type="number"
                          step={curr === 'EUR' ? '0.01' : '1'}
                          placeholder="Non configuré"
                          value={settings.additionalAppPrice.prices[curr] ?? ''}
                          onChange={(e) => handleAdditionalPriceChange(curr, e.target.value)}
                          className="w-28 px-2 py-1 border rounded-lg text-xs font-semibold bg-white text-gray-800 placeholder:text-gray-400"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              ℹ️ <strong>Règle de sécurité :</strong> Les devises dont le prix est vide (null) sont automatiquement désactivées au checkout. Le client ne peut finaliser de souscription dans une devise tant que son prix officiel n’a pas été configuré par l’administration.
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
