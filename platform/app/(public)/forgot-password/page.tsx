'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Card } from '@kazibox/ui';
import { resetPasswordForEmail } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function ForgotPasswordPage() {
  const { t, language, setLanguage } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t('auth.errors.email_required'));
      return;
    }
    setError('');
    setIsLoading(true);

    const redirectUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined;

    const { error: resetError } = await resetPasswordForEmail(email, redirectUrl);
    setIsLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Top Bar with Language switch and brand */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-between mb-4">
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

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Card padding="lg">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-[#1F2937]">
              {t('auth.forgot_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('auth.forgot_subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          {submitted ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm font-medium">
                {t('auth.forgot_success')}
              </div>
              <Link href="/login" className="block">
                <Button variant="primary" fullWidth size="md">
                  {t('auth.back_to_login')}
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label={t('auth.email_label')}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email_placeholder')}
              />

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isLoading}
                >
                  {t('auth.forgot_button')}
                </Button>
              </div>

              <div className="text-center pt-2">
                <Link
                  href="/login"
                  className="text-sm font-semibold text-[#6B7280] hover:text-[#1F2937]"
                >
                  &larr; {t('auth.back_to_login')}
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
