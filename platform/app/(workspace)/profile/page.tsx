'use client';

import React, { useState } from 'react';
import { Card, Input, Select, Button, Avatar, Badge } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { updateUserProfile } from '@/lib/auth';
import { updateWorkspace } from '@/lib/workspace';

export default function ProfilePage() {
  const { user, workspace, refreshSession } = useSession();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<'user' | 'company'>('user');

  // User form state
  const [userName, setUserName] = useState(user?.name || '');
  const [userPhone, setUserPhone] = useState(user?.phone || '');
  const [userSuccess, setUserSuccess] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  // Company form state
  const [companyName, setCompanyName] = useState(workspace?.name || '');
  const [country, setCountry] = useState(workspace?.country || 'Côte d’Ivoire');
  const [currency, setCurrency] = useState(workspace?.currency || 'XOF');
  const [companySuccess, setCompanySuccess] = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);

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

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserLoading(true);
    setUserSuccess('');
    // Supabase replacement: await supabase.auth.updateUser(...)
    await updateUserProfile({ name: userName, phone: userPhone });
    await refreshSession();
    setUserLoading(false);
    setUserSuccess(t('common.saved'));
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setCompanyLoading(true);
    setCompanySuccess('');
    // Supabase replacement: await supabase.from('companies').update(...).eq('id', workspace.company_id)
    await updateWorkspace(workspace.company_id, {
      name: companyName,
      country,
      currency,
    });
    await refreshSession();
    setCompanyLoading(false);
    setCompanySuccess(t('common.saved'));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
          {activeTab === 'user' ? t('profile.user_title') : t('profile.company_title')}
        </h1>
        <p className="text-sm sm:text-base text-[#6B7280] mt-1">
          {activeTab === 'user' ? t('profile.user_subtitle') : t('profile.company_subtitle')}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E5E7EB] gap-2">
        <button
          onClick={() => setActiveTab('user')}
          className={`pb-3 px-4 font-bold text-base border-b-2 transition-all min-h-[44px] ${
            activeTab === 'user'
              ? 'border-[var(--kazibox-primary,#6D28D9)] text-[var(--kazibox-primary,#6D28D9)]'
              : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'
          }`}
        >
          {t('profile.user_title')}
        </button>
        <button
          onClick={() => setActiveTab('company')}
          className={`pb-3 px-4 font-bold text-base border-b-2 transition-all min-h-[44px] ${
            activeTab === 'company'
              ? 'border-[var(--kazibox-primary,#6D28D9)] text-[var(--kazibox-primary,#6D28D9)]'
              : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'
          }`}
        >
          {t('profile.company_title')}
        </button>
      </div>

      {/* Personal User Profile */}
      {activeTab === 'user' && (
        <Card padding="lg">
          <div className="flex items-center gap-4 pb-6 border-b border-[#E5E7EB] mb-6">
            <Avatar name={user?.name || 'User'} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-[#1F2937]">{user?.name}</h3>
                {user?.role && (
                  <Badge variant={user.role === 'owner' ? 'yellow' : 'purple'} size="sm">
                    {t(`roles.${user.role}`)}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-[#6B7280]">{user?.email}</p>
            </div>
          </div>

          {userSuccess && (
            <div className="mb-5 p-3 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-semibold">
              {userSuccess}
            </div>
          )}

          <form onSubmit={handleSaveUser} className="space-y-4">
            <Input
              label={t('profile.name')}
              required
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('profile.email')}
                type="email"
                disabled
                value={user?.email || ''}
                helperText="L'adresse email ne peut pas être modifiée ici."
              />
              <Input
                label={t('profile.phone')}
                type="tel"
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
                placeholder="+225 00 00 00 00"
              />
            </div>

            <div className="pt-3">
              <Button type="submit" variant="primary" size="md" isLoading={userLoading}>
                {t('profile.save_profile')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Company Profile */}
      {activeTab === 'company' && (
        <Card padding="lg">
          <div className="flex items-center justify-between pb-6 border-b border-[#E5E7EB] mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] font-black text-xl flex items-center justify-center">
                {workspace?.name ? workspace.name.charAt(0).toUpperCase() : 'C'}
              </div>
              <div>
                <h3 className="text-xl font-bold text-[#1F2937]">{workspace?.name}</h3>
                <p className="text-xs text-[#6B7280]">
                  Identifiant tenant : <span className="font-mono">{workspace?.company_id}</span>
                </p>
              </div>
            </div>
            <Badge variant="yellow" size="md">
              Plan {workspace?.plan?.toUpperCase()}
            </Badge>
          </div>

          {companySuccess && (
            <div className="mb-5 p-3 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-semibold">
              {companySuccess}
            </div>
          )}

          <form onSubmit={handleSaveCompany} className="space-y-4">
            <Input
              label={t('profile.company_name')}
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('profile.country')}
                options={countryOptions}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <Select
                label={t('profile.currency')}
                options={currencyOptions}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>

            <div className="pt-3">
              <Button type="submit" variant="primary" size="md" isLoading={companyLoading}>
                {t('profile.save_company')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
