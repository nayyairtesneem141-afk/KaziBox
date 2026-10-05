'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Card } from '@kazibox/ui';
import { signUp } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function RegisterPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('Côte d’Ivoire');
  const [currency, setCurrency] = useState(platformConfig.defaultCurrency);
  const [password, setPassword] = useState('');
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
    { value: 'France', label: 'France' },
  ];

  const currencyOptions = [
    { value: 'XOF', label: 'XOF (Franc CFA BCEAO)' },
    { value: 'XAF', label: 'XAF (Franc CFA BEAC)' },
    { value: 'GNF', label: 'GNF (Franc Guinéen)' },
    { value: 'EUR', label: 'EUR (€ Euro)' },
    { value: 'USD', label: 'USD ($ US Dollar)' },
  ];

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      setError(t('auth.errors.name_required'));
      return;
    }
    if (!email) {
      setError(t('auth.errors.email_required'));
      return;
    }
    if (!companyName) {
      setError(t('auth.errors.company_required'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.errors.password_short'));
      return;
    }

    setError('');
    setIsLoading(true);

    const { error: signUpError } = await signUp({
      name,
      email,
      phone,
      companyName,
      country,
      currency,
      password,
    });

    setIsLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Top Bar */}
      <div className="sm:mx-auto sm:w-full sm:max-w-lg flex items-center justify-between mb-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <img src={platformConfig.logo} alt={platformConfig.platformName} className="h-10 w-auto object-contain" />
        </Link>
        <div className="flex items-center bg-white rounded-xl p-1 border border-[#E5E7EB] shadow-sm">
          <button
            onClick={() => setLanguage('fr')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
              language === 'fr'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white'
                : 'text-[#6B7280]'
            }`}
          >
            FR
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
              language === 'en'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white'
                : 'text-[#6B7280]'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        <Card padding="lg">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-[#1F2937]">
              {t('auth.register_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('auth.register_subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4">
            <Input
              label={t('auth.name_label')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.name_placeholder')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('auth.email_label')}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email_placeholder')}
              />
              <Input
                label={t('auth.phone_label')}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('auth.phone_placeholder')}
              />
            </div>

            <div className="border-t border-[#E5E7EB] pt-4 mt-2">
              <Input
                label={t('auth.company_name_label')}
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t('auth.company_name_placeholder')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('auth.country_label')}
                options={countryOptions}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <Select
                label={t('auth.currency_label')}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>

            <Input
              label={t('auth.password_label')}
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              helperText="Minimum 6 caractères"
            />

            <div className="pt-3">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
                {t('auth.register_button')}
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-[#E5E7EB] text-center">
            <p className="text-sm text-[#6B7280]">
              {t('auth.has_account')}{' '}
              <Link
                href="/login"
                className="font-bold text-[var(--kazibox-primary,#6D28D9)] hover:underline"
              >
                {t('auth.login_button')}
              </Link>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
