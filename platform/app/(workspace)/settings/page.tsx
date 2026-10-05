'use client';

import React, { useState } from 'react';
import { Card, Input, Select, Button, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, Language } from '@/lib/i18n';
import { updateWorkspace } from '@/lib/workspace';

export default function SettingsPage() {
  const { user, workspace, refreshSession } = useSession();
  const { t, language, setLanguage } = useTranslation();

  const [companyName, setCompanyName] = useState(workspace?.name || '');
  const [country, setCountry] = useState(workspace?.country || 'Côte d’Ivoire');
  const [currency, setCurrency] = useState(workspace?.currency || 'XOF');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    (workspace?.language as Language) || language
  );
  const [logoUrl, setLogoUrl] = useState(workspace?.logo_url || '');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const role = user?.role || 'worker';
  const canManage = role === 'owner' || role === 'platform_admin' || role === 'manager';

  if (!canManage) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12">
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Accès restreint</h2>
        <p className="text-sm text-[#6B7280]">
          Vous n'avez pas l'autorisation d'accéder aux paramètres de cet espace de travail.
        </p>
      </div>
    );
  }

  const countryOptions = [
    { value: 'Côte d’Ivoire', label: 'Côte d’Ivoire' },
    { value: 'Sénégal', label: 'Sénégal' },
    { value: 'Cameroun', label: 'Cameroun' },
    { value: 'Mali', label: 'Mali' },
    { value: 'Burkina Faso', label: 'Burkina Faso' },
    { value: 'Bénin', label: 'Bénin' },
    { value: 'Togo', label: 'Togo' },
    { value: 'Guinée', label: 'Guinée' },
    { value: 'France', label: 'France' },
  ];

  const currencyOptions = [
    { value: 'XOF', label: 'XOF (Franc CFA BCEAO)' },
    { value: 'XAF', label: 'XAF (Franc CFA BEAC)' },
    { value: 'GNF', label: 'GNF (Franc Guinéen)' },
    { value: 'EUR', label: 'EUR (€ Euro)' },
    { value: 'USD', label: 'USD ($ US Dollar)' },
  ];

  const languageOptions = [
    { value: 'fr', label: 'Français (Défaut)' },
    { value: 'en', label: 'English' },
  ];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setIsLoading(true);
    setSuccess('');

    // Update workspace settings in mock store (ready for Supabase)
    await updateWorkspace(workspace.company_id, {
      name: companyName,
      country,
      currency,
      language: selectedLanguage,
      logo_url: logoUrl,
    });

    // Update active interface language
    setLanguage(selectedLanguage);
    await refreshSession();

    setIsLoading(false);
    setSuccess(t('common.saved'));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
          {t('settings.title')}
        </h1>
        <p className="text-sm sm:text-base text-[#6B7280] mt-1">
          {t('settings.subtitle')}
        </p>
      </div>

      <Card padding="lg">
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-semibold flex items-center justify-between">
            <span>{success}</span>
            <span className="text-green-600 font-bold">✓</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-[#1F2937] mb-1">
              {t('settings.general_tab')}
            </h3>
            <p className="text-xs text-[#6B7280] mb-4">
              Informations relatives à votre société ou établissement
            </p>

            <div className="space-y-4">
              <Input
                label={t('settings.company_name')}
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label={t('settings.country')}
                  options={countryOptions}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                />
                <Input
                  label="Logo URL"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  helperText="Image ou logo carré pour l'en-tête"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-[#E5E7EB] pt-6">
            <h3 className="text-lg font-bold text-[#1F2937] mb-1">
              {t('settings.localization_tab')}
            </h3>
            <p className="text-xs text-[#6B7280] mb-4">
              Définissez la monnaie des factures et la langue d'affichage
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('settings.currency')}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />

              <Select
                label={t('settings.language')}
                options={languageOptions}
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as Language)}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E7EB] flex items-center justify-between">
            <Badge variant="purple" size="sm">
              Tenant ID : {workspace?.company_id}
            </Badge>

            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isLoading}
            >
              {t('settings.save_settings')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
