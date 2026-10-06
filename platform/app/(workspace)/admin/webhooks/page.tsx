'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, Badge, Modal } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import { getWebhookQueue, retryWebhook, WebhookQueueItem } from '@/lib/webhooks';

export default function WebhooksAdminPage() {
  const { user } = useSession();
  const { t } = useTranslation();

  const [queue, setQueue] = useState<WebhookQueueItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'delivered' | 'failed' | 'pending'>('all');
  const [selectedItem, setSelectedItem] = useState<WebhookQueueItem | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isPlatformAdmin = user?.role === 'platform_admin';

  const loadData = async () => {
    const data = await getWebhookQueue();
    setQueue(data);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    await retryWebhook(id);
    await loadData();
    setRetryingId(null);
  };

  if (!isPlatformAdmin) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 font-black text-2xl">
          🔒
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">
          {t('admin.access_denied_title')}
        </h2>
        <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
          {t('admin.access_denied_desc')}
        </p>
        <Link href="/dashboard">
          <Button variant="outline" size="md">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>
    );
  }

  const filteredQueue = queue.filter((item) => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
              {t('webhooks.admin_title')}
            </h1>
            <Badge variant="purple" size="sm">
              {queue.length} {t('webhooks.total_events')}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-[#6B7280]">
            {t('webhooks.admin_subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/admin/registry">
            <Button variant="outline" size="sm">
              ⚙️ {t('admin.registry_nav')}
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={loadData}>
            🔄 {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Security Signature & Protocol Banner */}
      <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl flex items-start gap-3.5 shadow-sm">
        <div className="w-9 h-9 rounded-xl bg-[var(--kazibox-primary,#6D28D9)] text-white flex items-center justify-center shrink-0 font-black text-sm">
          🛡️
        </div>
        <div className="text-xs sm:text-sm text-[#1F2937]">
          <p className="font-extrabold text-[var(--kazibox-primary,#6D28D9)]">
            {t('webhooks.hmac_security_title')}
          </p>
          <p className="text-[#4B5563] mt-0.5 leading-relaxed">
            {t('webhooks.hmac_security_desc')}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['all', 'delivered', 'failed', 'pending'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize min-h-[38px] ${
              filter === tab
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-sm'
                : 'bg-white border border-[#E5E7EB] text-[#6B7280] hover:text-[#1F2937] hover:bg-[#F9FAFB]'
            }`}
          >
            {t(`webhooks.status_${tab}`)} (
            {tab === 'all' ? queue.length : queue.filter((i) => i.status === tab).length}
            )
          </button>
        ))}
      </div>

      {/* Webhooks Queue Table */}
      <Card padding="lg">
        {loading ? (
          <div className="min-h-[240px] flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredQueue.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#6B7280]">
            {t('webhooks.no_events_match')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#6B7280] text-[11px] uppercase tracking-wider font-bold">
                  <th className="py-3 px-3">{t('webhooks.col_event')}</th>
                  <th className="py-3 px-3">{t('webhooks.col_module')}</th>
                  <th className="py-3 px-3">{t('webhooks.col_target')}</th>
                  <th className="py-3 px-3 text-center">{t('webhooks.col_status')}</th>
                  <th className="py-3 px-3 text-center">{t('webhooks.col_attempts')}</th>
                  <th className="py-3 px-3">{t('webhooks.col_date')}</th>
                  <th className="py-3 px-3 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {filteredQueue.map((item) => (
                  <tr key={item.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3.5 px-3">
                      <span className="font-mono font-bold text-[#1F2937] bg-gray-100 px-2 py-0.5 rounded-md text-xs">
                        {item.event}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-semibold text-[#1F2937]">
                      {item.moduleId}
                    </td>
                    <td className="py-3.5 px-3 text-[#6B7280] max-w-[200px] truncate">
                      <span className="font-mono text-xs">{item.targetUrl}</span>
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <Badge
                        variant={
                          item.status === 'delivered'
                            ? 'green'
                            : item.status === 'failed'
                            ? 'gray'
                            : 'yellow'
                        }
                        size="sm"
                      >
                        {item.status === 'delivered'
                          ? '✓ Livré'
                          : item.status === 'failed'
                          ? '✗ Échec'
                          : '⏳ En attente'}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-3 text-center text-xs font-bold text-[#4B5563]">
                      {item.attempts} / {item.maxAttempts}
                    </td>
                    <td className="py-3.5 px-3 text-xs text-[#6B7280] whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedItem(item)}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg border border-[#E5E7EB] hover:bg-gray-100 text-[#374151]"
                        >
                          🔍 {t('webhooks.view_payload')}
                        </button>
                        {item.status !== 'delivered' && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="text-xs px-2.5 py-1 h-7 min-h-0"
                            disabled={retryingId === item.id}
                            onClick={() => handleRetry(item.id)}
                          >
                            {retryingId === item.id ? '...' : t('webhooks.retry_btn')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Payload Inspection Modal */}
      {selectedItem && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedItem(null)}
          title={`Webhook: ${selectedItem.event}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs">
            <div>
              <span className="font-bold text-[#6B7280] block mb-1">Cible & Endpoint</span>
              <code className="block p-2 rounded-xl bg-gray-100 text-[#1F2937] font-mono break-all">
                {selectedItem.targetUrl}
              </code>
            </div>

            <div>
              <span className="font-bold text-[#6B7280] block mb-1">En-tête de Signature (HMAC-SHA256)</span>
              <code className="block p-2 rounded-xl bg-purple-50 text-purple-900 border border-purple-200 font-mono break-all">
                x-kazibox-signature: {selectedItem.signature}
              </code>
            </div>

            <div>
              <span className="font-bold text-[#6B7280] block mb-1">Payload JSON</span>
              <pre className="p-3 rounded-xl bg-[#111827] text-[#10B981] font-mono max-h-52 overflow-y-auto">
                {JSON.stringify(selectedItem.payload, null, 2)}
              </pre>
            </div>

            {selectedItem.responseBody && (
              <div>
                <span className="font-bold text-[#6B7280] block mb-1">Dernière Réponse HTTP ({selectedItem.responseStatus})</span>
                <pre className="p-2.5 rounded-xl bg-gray-100 text-[#374151] font-mono">
                  {selectedItem.responseBody}
                </pre>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E7EB]">
              {selectedItem.status !== 'delivered' && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    handleRetry(selectedItem.id);
                    setSelectedItem(null);
                  }}
                >
                  🔄 {t('webhooks.retry_btn')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSelectedItem(null)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
