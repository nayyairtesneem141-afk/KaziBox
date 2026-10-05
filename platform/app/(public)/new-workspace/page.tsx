'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Card } from '@kazibox/ui';
import { createWorkspace } from '@/lib/workspace';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function NewWorkspacePage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [country, setCountry] = useState('Côte d’Ivoire');
  const [currency, setCurrency] = useState(platformConfig.defaultCurrency);
  const [language, setLanguage] = useState(platformConfig.defaultLanguage);
  const [logoUrl, setLogoUrl] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const countryOptions = [
    { value: 'Côte d’Ivoire', label: 'Côte d’Ivoire' },
    { value: 'Sénégal', label: 'Sénégal' },
    { value: 'Cameroun', label: 'Cameroun' },
    { value: 'Mali', label: 'Mali' },
    { value: 'Burkina Faso', label: 'Burkina Faso' },
    { value: 'Bénin', label: 'Bénin' },
    { value: 'Togo', label: 'Togo' },
    { value: 'Guinée', label: 'Guinée' },
  ];

  const currencyOptions = [
    { value: 'XOF', label: 'XOF (Franc CFA BCEAO)' },
    { value: 'XAF', label: 'XAF (Franc CFA BEAC)' },
    { value: 'GNF', label: 'GNF (Franc Guinéen)' },
    { value: 'EUR', label: 'EUR (€ Euro)' },
    { value: 'USD', label: 'USD ($ US Dollar)' },
  ];

  const languageOptions = [
    { value: 'fr', label: 'Français (Default)' },
    { value: 'en', label: 'English' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Veuillez saisir le nom de votre établissement.');
      return;
    }
    setError('');
    setIsLoading(true);

    const { error: wsError } = await createWorkspace({
      name,
      country,
      currency,
      language,
      logo_url: logoUrl,
    });

    setIsLoading(false);
    if (wsError) {
      setError(wsError.message);
      return;
    }

    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="text-center mb-6">
          <Link href="/dashboard" className="inline-block">
            <img src={platformConfig.logo} alt={platformConfig.platformName} className="h-10 w-auto mx-auto object-contain" />
          </Link>
        </div>

        <Card padding="lg">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-[#1F2937]">
              {t('workspace.create_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('workspace.create_subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('workspace.name_label')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('workspace.name_placeholder')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('workspace.country_label')}
                options={countryOptions}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <Select
                label={t('workspace.currency_label')}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>

            <Select
              label={t('workspace.language_label')}
              options={languageOptions}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />

            <Input
              label={t('workspace.logo_label')}
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              helperText="Optionnel. Vous pourrez également l'ajouter plus tard."
            />

            <div className="pt-3 flex items-center justify-end gap-3">
              <Link href="/dashboard">
                <Button variant="ghost" size="md">
                  {t('common.cancel')}
                </Button>
              </Link>
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isLoading}
              >
                {t('workspace.create_button')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
