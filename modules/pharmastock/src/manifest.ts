import { ModuleManifest } from '@kazibox/sdk';

export const pharmastockManifest: ModuleManifest = {
  id: 'pharmastock',
  slug: 'pharmastock',
  name: {
    fr: 'PharmaStock — Pharmacie & Dispensaire',
    en: 'PharmaStock — Pharmacy & Dispensary',
  },
  version: '1.0.0',
  tagline: {
    fr: 'Gestion d’officine, stocks de médicaments, alertes péremption et comptoir de vente',
    en: 'Dispensary management, medication stock, expiry alerts and sales counter',
  },
  logo: '💊',
  accentColor: '#10B981',
  entryUrl: '/modules/pharmastock',
  menuItems: [
    {
      label: { fr: 'Comptoir de Vente', en: 'Sales Counter' },
      path: '/modules/pharmastock/sales',
    },
    {
      label: { fr: 'Stock Médicaments', en: 'Medication Inventory' },
      path: '/modules/pharmastock/inventory',
    },
    {
      label: { fr: 'Alertes Péremption', en: 'Expiry Alerts' },
      path: '/modules/pharmastock/alerts',
    },
    {
      label: { fr: 'Ordonnances', en: 'Prescriptions' },
      path: '/modules/pharmastock/prescriptions',
    },
  ],
  scopes: ['read:context', 'write:finance', 'write:events', 'read:subscription'],
  languages: ['fr', 'en'],
  summaryUrl: '/api/modules/pharmastock/summary',
  webhookUrl: 'https://pharmastock.internal/api/webhooks/kazibox',
  pwa: {
    scope: '/modules/pharmastock',
    startUrl: '/modules/pharmastock',
    themeColor: '#10B981',
    icons: [
      { src: '/icons/pharmastock-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/pharmastock-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/pharmastock-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  kind: 'external',
  status: 'published',
  developer: 'KaziBox Ecosystem & Moteur Health',
  author: 'PharmaStock Labs',
  isThirdParty: true,
  category: 'health',
  pricing_type: 'paid',
  pricePerMonth: {
    amount: 15000,
    currency: 'XOF',
  },
  keywords: [
    'pharmacie',
    'officine',
    'medicament',
    'sante',
    'peremption',
    'ordonnance',
    'dispensaire',
    'pharmacy',
    'health',
    'batch',
  ],
  description: {
    fr: 'Solution SaaS de référence pour la gestion d’officine et de dispensaire en Afrique de l’Ouest. Suivi rigoureux des lots de médicaments, alertes intelligentes contre les pertes de péremption, délivrance d’ordonnances et encaissement direct connecté au Grand Livre KaziBox.',
    en: 'Reference SaaS solution for pharmacy and dispensary management across West Africa. Strict batch tracking, automated expiration alerts, prescription fulfillment, and point-of-sale checkout connected directly to the KaziBox unified ledger.',
  },
  features: {
    fr: [
      'Contrôle des stocks de médicaments par numéro de lot et DLUO',
      'Alertes proactives sur les lots à péremption imminente (< 30, 60, 90 jours)',
      'Comptoir de vente et délivrance rapide d’ordonnances',
      'Synchronisation financière automatique et idempotente avec KaziBox',
      'Prise en charge hors-ligne et PWA installable sur tablette et smartphone',
    ],
    en: [
      'Batch-level medication inventory control with shelf-life tracking',
      'Proactive alerts on imminent expiry batches (< 30, 60, 90 days)',
      'Fast sales counter and prescription dispensing',
      'Automated, idempotent financial sync with the KaziBox platform ledger',
      'Offline-capable PWA installable on tablet and smartphone',
    ],
  },
  screenshots: [
    'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1586015555751-63bb77f4322a?auto=format&fit=crop&w=800&q=80',
  ],
};
