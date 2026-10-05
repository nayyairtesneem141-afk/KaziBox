'use client';

import React from 'react';
import { usePwa } from '@/lib/pwa';
import { useTranslation } from '@/lib/i18n';
import { Modal, Button } from '@kazibox/ui';
import { platformConfig } from '@/config';

export const PwaBanners: React.FC = () => {
  const { updateAvailable, applyUpdate, showIOSPrompt, closeIOSPrompt } = usePwa();
  const { t } = useTranslation();

  return (
    <>
      {/* Update Available Banner */}
      {updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#6D28D9] text-white px-4 py-3 shadow-lg flex items-center justify-between text-sm sm:text-base animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-3">
            <span className="p-1.5 bg-white/20 rounded-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </span>
            <span className="font-semibold">{t('common.update_available')}</span>
          </div>
          <button
            onClick={applyUpdate}
            className="bg-[#FACC15] text-[#1F2937] hover:bg-[#EAB308] font-bold px-4 py-1.5 rounded-lg text-sm transition-colors min-h-[38px]"
          >
            {t('common.update_now')}
          </button>
        </div>
      )}

      {/* iOS Install Instructions Modal */}
      <Modal
        isOpen={showIOSPrompt}
        onClose={closeIOSPrompt}
        title={t('common.ios_install_title')}
        description={`${platformConfig.platformName}`}
      >
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3 p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] font-bold flex items-center justify-center">
              1
            </span>
            <p className="text-base text-[#1F2937] font-medium">
              {t('common.ios_install_step1')}
            </p>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] font-bold flex items-center justify-center">
              2
            </span>
            <p className="text-base text-[#1F2937] font-medium">
              {t('common.ios_install_step2')}
            </p>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] font-bold flex items-center justify-center">
              3
            </span>
            <p className="text-base text-[#1F2937] font-medium">
              {t('common.ios_install_step3')}
            </p>
          </div>

          <div className="pt-2">
            <Button variant="primary" fullWidth size="md" onClick={closeIOSPrompt}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
