'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card, Badge } from '@kazibox/ui';
import { signInWithPassword } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';
import { INITIAL_USERS } from '@/lib/storage';

export default function LoginPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t('auth.errors.email_required'));
      return;
    }
    setError('');
    setIsLoading(true);

    const { error: loginError } = await signInWithPassword({ email, password });
    setIsLoading(false);

    if (loginError) {
      setError(loginError.message);
      return;
    }

    router.push('/dashboard');
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setIsLoading(true);
    const { error: loginError } = await signInWithPassword({
      email: demoEmail,
      password: 'password123',
    });
    setIsLoading(false);
    if (!loginError) {
      router.push('/dashboard');
    }
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
              {t('auth.login_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('auth.login_subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label={t('auth.email_label')}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.email_placeholder')}
              autoComplete="email"
            />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold text-[#1F2937]">
                  {t('auth.password_label')}
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-[var(--kazibox-primary,#6D28D9)] hover:underline"
                >
                  {t('auth.forgot_password_link')}
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.password_placeholder')}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-base text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[var(--kazibox-primary,#6D28D9)]"
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
                {t('auth.login_button')}
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-[#E5E7EB] text-center">
            <p className="text-sm text-[#6B7280]">
              {t('auth.no_account')}{' '}
              <Link
                href="/register"
                className="font-bold text-[var(--kazibox-primary,#6D28D9)] hover:underline"
              >
                {t('auth.register_link')}
              </Link>
            </p>
          </div>
        </Card>

        {/* Quick Demo Switcher - 1-Click login for testing RBAC */}
        <div className="mt-6 bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-[#6B7280] mb-3">
            {t('auth.demo_accounts_title')}
          </p>
          <div className="space-y-2">
            {INITIAL_USERS.map((u) => (
              <button
                key={u.id}
                onClick={() => handleQuickLogin(u.email)}
                className="w-full text-left p-2.5 rounded-xl hover:bg-[#F9FAFB] border border-transparent hover:border-[#E5E7EB] transition-all flex items-center justify-between text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-[#1F2937]">{u.name}</span>
                  <span className="text-xs text-[#6B7280]">{u.email}</span>
                </div>
                <Badge
                  variant={
                    u.role === 'owner'
                      ? 'yellow'
                      : u.role === 'platform_admin'
                      ? 'purple'
                      : u.role === 'manager'
                      ? 'green'
                      : 'gray'
                  }
                  size="sm"
                >
                  {t(`roles.${u.role}`)}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
