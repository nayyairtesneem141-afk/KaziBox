'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Card } from '@kazibox/ui';
import { updatePassword } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';
import { createBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

type RecoveryState = 'verifying' | 'valid' | 'invalid_link' | 'success';

function ResetPasswordForm() {
  const { t, language, setLanguage } = useTranslation();
  const searchParams = useSearchParams();

  const [state, setState] = useState<RecoveryState>('verifying');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkRecoveryAccess() {
      // 1. Check for error parameters in URL (expired or invalid OTP)
      const errorParam = searchParams?.get('error');
      const errorDescription = searchParams?.get('error_description');
      const errorCode = searchParams?.get('error_code');

      if (errorParam || errorCode || (typeof window !== 'undefined' && window.location.hash.includes('error='))) {
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        if (isMounted) {
          setState('invalid_link');
          setError(errorDescription || t('auth.errors.invalid_recovery_link'));
        }
        return;
      }

      // If Supabase is not configured (demo/offline mode), allow direct password reset
      if (!isSupabaseConfigured() || typeof window === 'undefined') {
        if (isMounted) setState('valid');
        return;
      }

      const supabase = createBrowserClient();
      if (!supabase) {
        if (isMounted) setState('invalid_link');
        return;
      }

      // 2. PKCE code exchange flow
      const code = searchParams?.get('code');
      if (code) {
        try {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          // Safely cleanse recovery code from browser URL to prevent token leakage
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          if (exchangeError) {
            if (isMounted) {
              setState('invalid_link');
              setError(t('auth.errors.invalid_recovery_link'));
            }
            return;
          }
          if (isMounted) setState('valid');
          return;
        } catch {
          if (isMounted) {
            setState('invalid_link');
            setError(t('auth.errors.invalid_recovery_link'));
          }
          return;
        }
      }

      // 3. Listen for Supabase PASSWORD_RECOVERY auth event
      const { data: authListener } = supabase.auth.onAuthStateChange((event: string) => {
        if (event === 'PASSWORD_RECOVERY') {
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          if (isMounted) setState('valid');
        }
      });

      // 4. Check if session is already established
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        if (isMounted) setState('valid');
        return;
      }

      // 5. Brief delay for hash parsing if Supabase client is processing implicit token
      const timer = setTimeout(async () => {
        if (!isMounted) return;
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        if (retrySession) {
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          setState('valid');
        } else {
          setState('invalid_link');
        }
      }, 700);

      return () => {
        authListener?.subscription?.unsubscribe();
        clearTimeout(timer);
      };
    }

    checkRecoveryAccess();

    return () => {
      isMounted = false;
    };
  }, [searchParams, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError(t('auth.errors.password_short'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.errors.password_mismatch'));
      return;
    }

    setError('');
    setIsLoading(true);

    const { error: updateError } = await updatePassword(password);
    setIsLoading(false);

    if (updateError) {
      const msg = updateError.message?.toLowerCase() || '';
      if (msg.includes('expired') || msg.includes('jwt') || msg.includes('token') || msg.includes('session')) {
        setState('invalid_link');
        setError(t('auth.errors.invalid_recovery_link'));
      } else {
        setError(updateError.message);
      }
      return;
    }

    setState('success');
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
              {t('auth.reset_title')}
            </h2>
            <p className="text-sm text-[#6B7280] mt-1">
              {t('auth.reset_subtitle')}
            </p>
          </div>

          {state === 'verifying' && (
            <div className="py-8 text-center text-sm text-[#6B7280] font-medium flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          )}

          {state === 'invalid_link' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm font-medium">
                <p className="font-bold mb-1">{t('auth.errors.invalid_recovery_link')}</p>
                <p className="text-xs text-red-600">
                  {error || t('auth.errors.invalid_recovery_link')}
                </p>
              </div>

              <Link href="/forgot-password" className="block">
                <Button variant="primary" fullWidth size="md">
                  {t('auth.request_new_link')}
                </Button>
              </Link>

              <div className="text-center pt-2">
                <Link
                  href="/login"
                  className="text-sm font-semibold text-[#6B7280] hover:text-[#1F2937]"
                >
                  &larr; {t('auth.back_to_login')}
                </Link>
              </div>
            </div>
          )}

          {state === 'success' && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm font-medium">
                {t('auth.reset_success')}
              </div>

              <Link href="/login" className="block">
                <Button variant="primary" fullWidth size="lg">
                  {t('auth.login_button')}
                </Button>
              </Link>
            </div>
          )}

          {state === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
                  {error}
                </div>
              )}

              <Input
                label={t('auth.new_password_label')}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.new_password_placeholder')}
                helperText="Minimum 6 caractères"
              />

              <Input
                label={t('auth.confirm_password_label')}
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.confirm_password_placeholder')}
              />

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isLoading}
                >
                  {t('auth.reset_button')}
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
