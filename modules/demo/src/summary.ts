import { ModuleSummary } from '@kazibox/sdk';

/**
 * Exposes the standard summary function required by the KaziBox consolidated dashboard contract.
 * External modules implement this endpoint or function to provide telemetry data without exposing
 * internal database schemas.
 */
export async function getDemoSummary(companyId: string): Promise<ModuleSummary> {
  return {
    moduleId: 'demo',
    companyId,
    revenue: 25000,
    expenses: 7500,
    activityCount: 2,
    currency: 'XOF',
    lastUpdated: new Date().toISOString(),
    metrics: [
      {
        id: 'metric-demo-api',
        moduleId: 'demo',
        label: {
          fr: 'Appels API Démo',
          en: 'Demo API Calls',
        },
        value: 2,
        trend: 'up',
      },
      {
        id: 'metric-demo-uptime',
        moduleId: 'demo',
        label: {
          fr: 'Disponibilité PWA',
          en: 'PWA Availability',
        },
        value: '100%',
        trend: 'neutral',
      },
    ],
  };
}
