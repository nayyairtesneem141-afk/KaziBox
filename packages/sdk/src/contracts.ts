import { UserRole } from './types';

export interface ModuleManifest {
  id: string;
  name: {
    en: string;
    fr: string;
  };
  shortDescription: {
    en: string;
    fr: string;
  };
  icon: string;
  category: 'hospitality' | 'automotive' | 'retail' | 'health' | 'services';
  version: string;
  author: string;
  isThirdParty: boolean;
  entryRoute: string;
  requiredRole: UserRole;
  pricePerMonth: {
    amount: number;
    currency: string;
  };
  features: {
    en: string[];
    fr: string[];
  };
  pwaReady: boolean;
  status: 'available' | 'coming_soon' | 'beta';
}

export interface ConsolidatedMetric {
  id: string;
  moduleId: string;
  label: {
    en: string;
    fr: string;
  };
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  currency?: string;
}

export interface ModuleIntegrationContext {
  companyId: string;
  userId: string;
  userRole: UserRole;
  language: string;
  currency: string;
  platformName: string;
}
