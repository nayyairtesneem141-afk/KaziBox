'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Card } from '@kazibox/ui';
import { resetPasswordForEmail } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    await resetPasswordForEmail(email);
    setIsLoading(false);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center mb-6">
          <Link href="/" className="inline-block">
            <img src={platformConfig.logo} alt={platformConfig.platformName} className="h-10 w-auto mx-auto object-contain" />
          </Link>
        </div>

        <Card padding="lg">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-[#1F2937]">
              {t('auth.forgot_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('auth.forgot_subtitle')}
            </p>
          </div>

          {submitted ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm font-medium">
                {t('auth.forgot_success')}
              </div>
              <Link href="/login">
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
