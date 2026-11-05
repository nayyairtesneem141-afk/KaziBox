import { createWebhookHandler, GenericHttpRequest, GenericHttpResponse, IdempotencyStore } from '@kazibox/sdk';
import {
  getPharmaWebhookIdempotencyStore,
  saveTenantProvisioningRecord,
  getPersistedTenantProvisioningStatus,
  clearTenantProvisioningRecords,
  TenantProvisioningRecord,
} from './storage.js';

const tenantProvisioningLog = new Map<string, TenantProvisioningRecord>();

export function getPharmaStockWebhookHandler(
  webhookSecret: string = 'kazibox_mock_webhook_secret_pharma',
  store?: IdempotencyStore
) {
  const effectiveStore = store || getPharmaWebhookIdempotencyStore();

  return createWebhookHandler({
    webhookSecret,
    store: effectiveStore,
    onModuleActivated: async (event) => {
      const companyId = event.companyId;
      const record = {
        status: 'provisioned',
        updatedAt: new Date().toISOString(),
      };
      tenantProvisioningLog.set(companyId, record);
      saveTenantProvisioningRecord(companyId, record);
    },
    onModuleDeactivated: async (event) => {
      const companyId = event.companyId;
      const record = {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      };
      tenantProvisioningLog.set(companyId, record);
      saveTenantProvisioningRecord(companyId, record);
    },
    onSubscriptionUpdated: async (event) => {
      const companyId = event.companyId;
      const plan = event.data?.planId || 'standard';
      const record = {
        status: `active_${plan}`,
        updatedAt: new Date().toISOString(),
      };
      tenantProvisioningLog.set(companyId, record);
      saveTenantProvisioningRecord(companyId, record);
    },
  });
}

export function getTenantProvisioningStatus(companyId: string): TenantProvisioningRecord {
  const cached = tenantProvisioningLog.get(companyId);
  if (cached) return cached;
  const persisted = getPersistedTenantProvisioningStatus(companyId);
  if (persisted.status !== 'unprovisioned') {
    tenantProvisioningLog.set(companyId, persisted);
  }
  return persisted;
}

export function clearTenantProvisioningLog(): void {
  tenantProvisioningLog.clear();
  clearTenantProvisioningRecords();
}
