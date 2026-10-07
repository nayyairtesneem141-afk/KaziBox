import { UserRole } from './types';

export interface ModulePwaConfig {
  scope: string;
  startUrl: string;
  themeColor: string;
  icons: Array<{
    src: string;
    sizes: string;
    type?: string;
    purpose?: string;
  }>;
}

export interface ModuleMenuItem {
  label: string | { en: string; fr: string };
  icon?: string;
  path: string;
  requiredRole?: UserRole;
}

export interface ModuleManifest {
  id: string;
  slug: string;
  name: string | { en: string; fr: string };
  version: string;
  tagline: string | { en: string; fr: string };
  logo: string;
  accentColor: string;
  entryUrl: string;
  menuItems: ModuleMenuItem[];
  scopes: string[];
  languages: string[];
  summaryUrl: string;
  webhookUrl: string;
  pwa: ModulePwaConfig;

  // Extended metadata for platform operations and catalogue
  kind?: 'internal' | 'external';
  status: 'draft' | 'review' | 'published' | 'suspended' | 'available' | 'coming_soon' | 'beta';
  developer?: string;
  author?: string;
  isThirdParty?: boolean;
  category?: 'hospitality' | 'automotive' | 'retail' | 'health' | 'services' | 'logistics' | 'food' | 'utilities' | 'beauty' | string;
  pricing_type?: 'free' | 'paid';
  keywords?: string[];
  pricePerMonth?: {
    amount: number;
    currency: string;
  };
  features?: {
    en: string[];
    fr: string[];
  } | string[];
  description?: {
    en: string;
    fr: string;
  } | string;
  shortDescription?: {
    en: string;
    fr: string;
  };
  screenshots?: string[];
  demoVideoUrl?: string;
}

export interface ModuleSummary {
  moduleId: string;
  companyId: string;
  revenue: number;
  expenses: number;
  activityCount: number;
  currency: string;
  lastUpdated: string;
  metrics?: ConsolidatedMetric[];
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

export interface Plan {
  id: 'single' | 'bundle' | 'all_access' | 'custom' | string;
  name: string | { en: string; fr: string };
  description: string | { en: string; fr: string };
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  maxModules?: number;
  features: Array<string | { en: string; fr: string }>;
  badge?: string | { en: string; fr: string };
  isPopular?: boolean;
}

export interface Subscription {
  id: string;
  companyId: string;
  planId: string;
  status: 'active' | 'expiring_soon' | 'expired' | 'canceled';
  billingCycle: 'monthly' | 'yearly';
  includedModuleIds: string[];
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewAt: string;
  autoRenew: boolean;
  amount: number;
  currency: string;
}

export interface PlatformContext {
  companyId: string;
  userId: string;
  userRole: UserRole;
  language: string;
  currency: string;
  platformName: string;
  baseUrl?: string;
}

export type ModuleIntegrationContext = PlatformContext;

export interface WebhookEvent {
  id: string;
  event:
    | 'module.activated'
    | 'module.deactivated'
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.canceled'
    | 'payment.succeeded'
    | 'payment.failed';
  moduleId?: string;
  companyId: string;
  timestamp: string;
  data: Record<string, any>;
}

export interface PaymentHistoryItem {
  id: string;
  invoiceNumber: string;
  companyId: string;
  date: string;
  amount: number;
  currency: string;
  planName: string;
  moduleCount: number;
  paymentMethod: 'mobile_money' | 'card';
  operator?: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  receiptUrl?: string;
}

export interface PwaCheckItem {
  key: string;
  label: string | { en: string; fr: string };
  passed: boolean;
  details?: string;
}

export interface PwaCheckResult {
  allPassed: boolean;
  checks: PwaCheckItem[];
}
