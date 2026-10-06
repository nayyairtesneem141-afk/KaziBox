'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { usePwa } from '@/lib/pwa';
import { platformConfig } from '@/config';
import { getNotifications, markAllNotificationsAsRead, markNotificationAsRead } from '@/lib/notifications';
import { NotificationItem } from '@kazibox/sdk';

export const TopBar: React.FC = () => {
  const router = useRouter();
  const { user, workspace, allWorkspaces, switchCompany, signOut } = useSession();
  const { t, language, setLanguage } = useTranslation();
  const { isInstallable, installApp, isIOS, openIOSPrompt, isInstalled } = usePwa();

  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const wsRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) {
        setWsDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifDropdownOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch notifications
  useEffect(() => {
    if (workspace) {
      getNotifications(workspace.company_id).then(setNotifications);
    }
  }, [workspace]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = async () => {
    if (!workspace) return;
    await markAllNotificationsAsRead(workspace.company_id);
    const updated = await getNotifications(workspace.company_id);
    setNotifications(updated);
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    await markNotificationAsRead(notif.id);
    if (workspace) {
      const updated = await getNotifications(workspace.company_id);
      setNotifications(updated);
    }
    if (notif.link) {
      router.push(notif.link);
      setNotifDropdownOpen(false);
    }
  };

  return (
    <header className="h-16 sm:h-20 bg-white border-b border-[#E5E7EB] sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between">
      {/* Left: Mobile Brand & Workspace Switcher */}
      <div className="flex items-center gap-3">
        {/* Mobile Logo Mark */}
        <div className="md:hidden flex items-center gap-2">
          <Link href="/dashboard">
            <img src={platformConfig.icon} alt={platformConfig.platformName} className="w-9 h-9 rounded-xl object-contain" />
          </Link>
        </div>

        {/* Workspace Switcher */}
        <div className="relative" ref={wsRef}>
          <button
            onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] transition-all min-h-[44px] text-left"
            aria-label={t('nav.switch_workspace')}
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] font-black flex items-center justify-center text-sm shrink-0">
              {workspace?.name ? workspace.name.charAt(0).toUpperCase() : 'W'}
            </div>
            <div className="flex flex-col max-w-[130px] sm:max-w-[200px] truncate">
              <span className="text-xs text-[#6B7280] font-medium leading-none">
                {t('workspace.current_workspace')}
              </span>
              <span className="text-sm font-bold text-[#1F2937] truncate mt-0.5">
                {workspace?.name || 'Workspace'}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-[#6B7280] transition-transform duration-200 shrink-0 ${
                wsDropdownOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Workspace Dropdown */}
          {wsDropdownOpen && (
            <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-4 py-2 border-b border-[#E5E7EB]">
                <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
                  {t('nav.workspaces')}
                </p>
              </div>

              <div className="max-h-60 overflow-y-auto py-1">
                {allWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      switchCompany(ws.company_id);
                      setWsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors min-h-[44px] ${
                      workspace?.company_id === ws.company_id ? 'bg-[#F3E8FF]' : ''
                    }`}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="text-sm font-bold text-[#1F2937] truncate">
                        {ws.name}
                      </span>
                      <span className="text-xs text-[#6B7280]">
                        {ws.country} &bull; {ws.currency}
                      </span>
                    </div>
                    {workspace?.company_id === ws.company_id && (
                      <span className="text-[var(--kazibox-primary,#6D28D9)] font-bold text-sm">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="border-t border-[#E5E7EB] pt-1 px-2">
                <Link
                  href="/new-workspace"
                  onClick={() => setWsDropdownOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-[var(--kazibox-primary,#6D28D9)] hover:bg-[#F3E8FF] rounded-xl transition-colors min-h-[44px]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{t('nav.new_workspace')}</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Controls: Language Switch, Notifications, Account Menu */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Language Switch */}
        <div className="flex items-center bg-gray-100/90 rounded-2xl p-1 border border-[#E5E7EB] shadow-inner">
          <span className="text-xs px-2 text-[#9CA3AF] hidden lg:inline-flex items-center gap-1 font-bold">
            🌐
          </span>
          <button
            onClick={() => setLanguage('fr')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black min-h-[36px] transition-all cursor-pointer ${
              language === 'fr'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-[0_2px_8px_rgba(109,40,217,0.35)] scale-100'
                : 'text-[#6B7280] hover:text-[#1F2937] hover:bg-white/60'
            }`}
            title="Français"
          >
            FR
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black min-h-[36px] transition-all cursor-pointer ${
              language === 'en'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-[0_2px_8px_rgba(109,40,217,0.35)] scale-100'
                : 'text-[#6B7280] hover:text-[#1F2937] hover:bg-white/60'
            }`}
            title="English"
          >
            EN
          </button>
        </div>

        {/* Notifications Icon & Popover */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
            className="p-2.5 rounded-xl border border-[#E5E7EB] text-[#6B7280] hover:text-[#1F2937] hover:bg-[#F9FAFB] transition-colors relative min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label={t('notifications.title')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[11px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {notifDropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] py-3 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-4 pb-2 border-b border-[#E5E7EB] flex items-center justify-between">
                <span className="font-bold text-base text-[#1F2937]">
                  {t('notifications.title')}
                  {unreadCount > 0 && (
                    <span className="ml-2 text-xs text-[var(--kazibox-primary,#6D28D9)] font-semibold">
                      ({unreadCount} {t('notifications.unread')})
                    </span>
                  )}
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs font-semibold text-[var(--kazibox-primary,#6D28D9)] hover:underline"
                  >
                    {t('notifications.mark_all_read')}
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-[#F3F4F6]">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#6B7280]">
                    {t('notifications.empty')}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-3.5 hover:bg-[#F9FAFB] cursor-pointer transition-colors ${
                        !n.read ? 'bg-[#FDF8F0]' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                            !n.read ? 'bg-[#6D28D9]' : 'bg-transparent'
                          }`}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-[#1F2937] leading-snug">
                            {n.title}
                          </p>
                          <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                            {n.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Account Menu */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center gap-2 p-1.5 rounded-xl border border-[#E5E7EB] hover:bg-[#F9FAFB] transition-all min-h-[44px]"
            aria-label="User menu"
          >
            <Avatar name={user?.name || 'User'} size="sm" />
            <div className="hidden sm:flex flex-col text-left pr-1">
              <span className="text-sm font-bold text-[#1F2937] leading-none">
                {user?.name}
              </span>
              <span className="text-xs text-[#6B7280] capitalize mt-0.5">
                {user?.role ? t(`roles.${user.role}`) : ''}
              </span>
            </div>
            <svg className="w-4 h-4 text-[#6B7280] hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* User Menu Dropdown */}
          {userDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-4 py-3 border-b border-[#E5E7EB]">
                <p className="text-sm font-bold text-[#1F2937]">{user?.name}</p>
                <p className="text-xs text-[#6B7280] truncate">{user?.email}</p>
                <div className="mt-2">
                  <Badge
                    variant={
                      user?.role === 'owner'
                        ? 'yellow'
                        : user?.role === 'platform_admin'
                        ? 'purple'
                        : user?.role === 'manager'
                        ? 'green'
                        : 'gray'
                    }
                    size="sm"
                  >
                    {user?.role ? t(`roles.${user.role}`) : ''}
                  </Badge>
                </div>
              </div>

              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => setUserDropdownOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#1F2937] hover:bg-[#F9FAFB] transition-colors min-h-[44px]"
                >
                  <svg className="w-5 h-5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>{t('nav.profile')}</span>
                </Link>

                {/* PWA Install Button in Account Menu */}
                {!isInstalled && (
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      if (isIOS) {
                        openIOSPrompt();
                      } else {
                        installApp();
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-[var(--kazibox-primary,#6D28D9)] bg-[#F3E8FF] hover:bg-[#EDE9FE] transition-colors min-h-[44px]"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>{t('common.install_app')}</span>
                  </button>
                )}

                <div className="border-t border-[#E5E7EB] my-1" />

                <button
                  onClick={() => {
                    setUserDropdownOpen(false);
                    signOut();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors min-h-[44px]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>{t('nav.logout')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
