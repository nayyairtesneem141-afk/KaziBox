import { ModuleManifest } from '@kazibox/sdk';

export const minimalSaasManifest: ModuleManifest = {
  id: 'fleet-courier',
  slug: 'fleet-courier',
  name: {
    en: 'Fleet & Courier Dispatch',
    fr: 'Flotte & Coursiers Express',
  },
  version: '1.0.0',
  tagline: {
    en: 'Minimal transport and dispatch SaaS demonstrating KaziBox SDK integration',
    fr: 'SaaS minimal de transport et coursiers démontrant l’intégration SDK KaziBox',
  },
  logo: '🚚',
  accentColor: '#0D9488',
  entryUrl: '/modules/fleet-courier',
  menuItems: [
    { label: { en: 'Dispatches & Trips', fr: 'Courses & Livraisons' }, path: '/modules/fleet-courier' },
    { label: { en: 'Fuel & Maintenance', fr: 'Carburant & Entretien' }, path: '/modules/fleet-courier/expenses' },
  ],
  scopes: ['read:context', 'write:finance', 'write:events', 'read:subscription'],
  languages: ['fr', 'en'],
  summaryUrl: 'https://fleet-courier.kazibox.internal/api/summary',
  webhookUrl: 'https://fleet-courier.kazibox.internal/api/webhooks/kazibox',
  pwa: {
    scope: '/modules/fleet-courier',
    startUrl: '/modules/fleet-courier',
    themeColor: '#0D9488',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  kind: 'external',
  status: 'published',
  developer: 'KaziBox Ecosystem Partner',
  category: 'logistics',
  pricing_type: 'paid',
  pricePerMonth: { amount: 12000, currency: 'XOF' },
  description: {
    en: 'Minimal reference SaaS microservice for urban couriers, transport fleets, and delivery logistics, integrated with KaziBox via @kazibox/sdk.',
    fr: 'Microservice SaaS de référence minimal pour coursiers urbains et transporteurs, connecté à KaziBox via le SDK officiel @kazibox/sdk.',
  },
  features: {
    en: [
      'Cryptographic SSO single sign-on with 5-minute replay-protected handoff',
      'HMAC-SHA256 signed webhook processing for lifecycle provisioning',
      'Idempotent shared ledger revenue and expense recording',
      'Consolidated operational telemetry summary endpoint',
      'Strict multi-tenant data segregation per workspace',
    ],
    fr: [
      'Connexion unique SSO avec protection anti-rejeu sur 5 minutes',
      'Traitement sécurisé des webhooks signés HMAC-SHA256 pour le provisionnement',
      'Écriture idempotente des recettes et dépenses au grand livre partagé',
      'Point de télémétrie consolidée pour le tableau de bord KaziBox',
      'Isolation stricte multi-locataires par espace de travail',
    ],
  },
  screenshots: [
    'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800&q=80',
  ],
};
