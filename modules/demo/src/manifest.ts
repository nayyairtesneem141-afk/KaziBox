import { ModuleManifest } from '@kazibox/sdk';

export const demoModuleManifest: ModuleManifest = {
  id: 'demo',
  slug: 'demo',
  name: {
    en: 'Demo Module by KaziBox',
    fr: 'Module Démo par KaziBox',
  },
  version: '1.0.0',
  tagline: {
    en: 'Standard integration module demonstrating KaziBox SDK & PWA contract',
    fr: 'Module d’intégration type démontrant le contrat SDK et PWA KaziBox',
  },
  logo: '⚡',
  accentColor: '#8B5CF6',
  entryUrl: '/m/demo',
  menuItems: [
    { label: { en: 'Operations', fr: 'Opérations' }, path: '/m/demo' },
    { label: { en: 'Context Info', fr: 'Infos Contexte' }, path: '/m/demo/context' },
  ],
  scopes: ['read:context', 'write:finance', 'write:events', 'read:subscription'],
  languages: ['fr', 'en'],
  summaryUrl: '/api/v1/context',
  webhookUrl: 'https://api.kazibox.internal/webhooks/demo',
  pwa: {
    scope: '/m/demo',
    startUrl: '/m/demo',
    themeColor: '#8B5CF6',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  kind: 'internal',
  status: 'published',
  developer: 'KaziBox Open SDK Team',
  category: 'services',
  pricePerMonth: { amount: 5000, currency: 'XOF' },
  description: {
    en: 'Reference module implementation illustrating the KaziBox SDK contracts: SSO token receipt, Integration API queries, shared finance logging, and consolidated metrics.',
    fr: 'Implémentation de référence illustrant les contrats du SDK KaziBox : réception de jeton SSO, requêtes Integration API, écriture au Grand Livre partagé et métriques consolidées.',
  },
  features: {
    en: [
      'SSO login handoff validation (5-minute token)',
      'Direct Integration API context and subscription queries',
      'Idempotent shared revenue and expense recording',
      'Consolidated telemetry metrics export for the main dashboard',
    ],
    fr: [
      'Validation de relais SSO (jeton à validité 5 minutes)',
      'Interrogation du contexte et de l’abonnement via Integration API',
      'Enregistrement idempotent des recettes et dépenses partagées',
      'Export de métriques consolidées pour le tableau de bord',
    ],
  },
  screenshots: [
    'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
  ],
  demoVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
};
