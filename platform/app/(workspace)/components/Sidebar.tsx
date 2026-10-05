'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { platformConfig } from '@/config';
import { getModules } from '@/lib/modules';
import { getSubscription } from '@/lib/billing';
import { ModuleManifest } from '@kazibox/sdk';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { user, workspace } = useSession();
  const { t, language } = useTranslation();

  const [activeModules, setActiveModules] = useState<ModuleManifest[]>([]);

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';
  const isPlatformAdmin = role === 'platform_admin';
  const isManager = role === 'manager';

  // Load active modules for current workspace
  useEffect(() => {
    let isMounted = true;
    async function fetchActive() {
      if (!workspace) return;
      const [allMods, sub] = await Promise.all([
        getModules(),
        getSubscription(workspace.company_id),
      ]);
      if (!isMounted) return;

      if (sub && (sub.status === 'active' || sub.status === 'expiring_soon')) {
        if (sub.planId === 'all_access') {
          setActiveModules(allMods.filter((m) => m.status === 'published'));
        } else {
          setActiveModules(allMods.filter((m) => sub.includedModuleIds?.includes(m.id)));
        }
      } else {
        setActiveModules([]);
      }
    }

    fetchActive();
    return () => {
      isMounted = false;
    };
  }, [workspace, pathname]);

  // Primary navigation items with role permissions
  const navItems = [
    {
      label: t('nav.home'),
      href: '/dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      visible: true,
    },
    {
      label: t('nav.my_modules'),
      href: '/modules/my-modules',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      visible: true,
    },
    {
      label: t('nav.module_catalogue'),
      href: '/modules/catalogue',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
      visible: true,
    },
    {
      // Billing: strictly hidden for workers and managers
      label: t('nav.billing'),
      href: '/billing',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
      visible: isOwner,
    },
    {
      // Team: strictly hidden for workers, visible for owner and platform_admin
      label: t('nav.team'),
      href: '/team',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      visible: isOwner,
    },
    {
      // Settings: hidden for workers, visible for owners and managers
      label: t('nav.settings'),
      href: '/settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      visible: isOwner || isManager,
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-[#E5E7EB] flex-col shrink-0 hidden md:flex min-h-screen">
      {/* Brand Logo Header */}
      <div className="h-20 px-6 border-b border-[#E5E7EB] flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img
            src={platformConfig.logo}
            alt={platformConfig.platformName}
            className="h-9 w-auto object-contain"
          />
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Core Platform Nav Items */}
        <div className="space-y-1.5">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3.5 px-4 py-3 rounded-xl font-bold text-sm min-h-[46px] transition-all ${
                    isActive
                      ? 'bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                      : 'text-[#4B5563] hover:text-[#1F2937] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <span
                    className={
                      isActive
                        ? 'text-[var(--kazibox-primary,#6D28D9)]'
                        : 'text-[#6B7280]'
                    }
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
        </div>

        {/* Activated Modules Dynamic Section */}
        {activeModules.length > 0 && (
          <div className="pt-2 border-t border-[#E5E7EB]">
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] font-black text-[#9CA3AF] uppercase tracking-wider">
                {t('sidebar.active_modules_section')}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                {activeModules.length}
              </span>
            </div>

            <div className="space-y-1 mt-1">
              {activeModules.map((mod) => {
                const modName =
                  typeof mod.name === 'string'
                    ? mod.name
                    : mod.name?.[language as 'fr' | 'en'] || mod.name?.fr || mod.id;

                const modHref = `/modules/${mod.slug}`;
                const isActive = pathname.startsWith(modHref);

                return (
                  <Link
                    key={mod.id}
                    href={modHref}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs min-h-[42px] transition-all ${
                      isActive
                        ? 'bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                        : 'text-[#4B5563] hover:text-[#1F2937] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-base shrink-0">{mod.logo}</span>
                      <span className="truncate">{modName}</span>
                    </div>

                    <span
                      className="w-2 h-2 rounded-full shrink-0 ml-2"
                      style={{ backgroundColor: mod.accentColor }}
                    />
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Platform Admin Registry Section: Strictly visible only for platform_admin */}
        {isPlatformAdmin && (
          <div className="pt-2 border-t border-[#E5E7EB]">
            <div className="px-4 py-2">
              <span className="text-[11px] font-black text-[#9CA3AF] uppercase tracking-wider">
                {t('sidebar.admin_section')}
              </span>
            </div>
            <div className="space-y-1 mt-1">
              <Link
                href="/admin/registry"
                className={`flex items-center gap-3.5 px-4 py-3 rounded-xl font-bold text-sm min-h-[46px] transition-all ${
                  pathname.startsWith('/admin/registry')
                    ? 'bg-purple-100 text-purple-900 shadow-sm'
                    : 'text-[#4B5563] hover:text-[#1F2937] hover:bg-[#F9FAFB]'
                }`}
              >
                <svg className="w-5 h-5 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>{t('admin.registry_nav')}</span>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Footer / Powered by platform */}
      <div className="p-4 border-t border-[#E5E7EB]">
        <div className="bg-[#F9FAFB] rounded-xl p-3 border border-[#E5E7EB] text-center">
          <p className="text-xs font-semibold text-[#6B7280]">
            {t('common.by')} <span className="font-bold text-[#1F2937]">{platformConfig.platformName}</span>
          </p>
          <p className="text-[11px] text-[#9CA3AF] mt-0.5">
            v{platformConfig.version} &bull; PWA Ready
          </p>
        </div>
      </div>
    </aside>
  );
};
