import { ModuleSummary, ConsolidatedMetric } from '@kazibox/sdk';
import { PharmaInventoryService } from './inventory.js';

/**
 * Builds standard ModuleSummary payload for the KaziBox platform consolidated dashboard.
 */
export function buildPharmaStockSummary(companyId: string, currency: string = 'XOF'): ModuleSummary {
  const telemetry = PharmaInventoryService.getTelemetry(companyId);

  const metrics: ConsolidatedMetric[] = [
    {
      id: 'pharma-total-stock',
      moduleId: 'pharmastock',
      label: {
        fr: 'Unités de Médicaments en Stock',
        en: 'Total Medication Stock Units',
      },
      value: telemetry.totalStockUnits,
      trend: telemetry.totalStockUnits < 100 ? 'down' : 'neutral',
    },
    {
      id: 'pharma-expiring-batches',
      moduleId: 'pharmastock',
      label: {
        fr: 'Lots à Péremption Imminente (<30j)',
        en: 'Batches Expiring Soon (<30d)',
      },
      value: telemetry.expiringBatchesCount,
      trend: telemetry.expiringBatchesCount > 0 ? 'down' : 'neutral',
    },
    {
      id: 'pharma-prescriptions-count',
      moduleId: 'pharmastock',
      label: {
        fr: 'Délivrances / Ventes Comptoir',
        en: 'Prescriptions & Counter Sales',
      },
      value: telemetry.activityCount,
      trend: 'up',
    },
    {
      id: 'pharma-revenue',
      moduleId: 'pharmastock',
      label: {
        fr: 'Chiffre d’Affaires Officine',
        en: 'Pharmacy Sales Revenue',
      },
      value: telemetry.revenue,
      currency,
      trend: 'up',
    },
  ];

  return {
    moduleId: 'pharmastock',
    companyId,
    revenue: telemetry.revenue,
    expenses: telemetry.expenses,
    activityCount: telemetry.activityCount,
    currency,
    lastUpdated: new Date().toISOString(),
    metrics,
  };
}
