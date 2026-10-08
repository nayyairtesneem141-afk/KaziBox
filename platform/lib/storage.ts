import {
  User,
  Workspace,
  TeamMember,
  NotificationItem,
  ModuleManifest,
  Subscription,
  PaymentHistoryItem,
} from '@kazibox/sdk';

// Default mock workspaces
export const INITIAL_WORKSPACES: Workspace[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    company_id: '11111111-1111-4111-8111-111111111111',
    name: 'Hôtel & Résidence Palmeraie',
    country: 'Côte d’Ivoire',
    currency: 'XOF',
    language: 'fr',
    logo_url: '',
    created_at: '2026-01-15T08:00:00Z',
    plan: 'pro',
    status: 'active',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    company_id: '22222222-2222-4222-8222-222222222222',
    name: 'Garage & Mécanique Express',
    country: 'Sénégal',
    currency: 'XOF',
    language: 'fr',
    logo_url: '',
    created_at: '2026-02-10T10:30:00Z',
    plan: 'starter',
    status: 'active',
  },
];

// 5 initial users covering all roles
export const INITIAL_USERS: (User & { password_hash: string })[] = [
  {
    id: 'usr-owner-01',
    email: 'owner@palmeraie.com',
    name: 'Mamadou Diallo',
    role: 'owner',
    company_id: '11111111-1111-4111-8111-111111111111',
    phone: '+225 07 12 34 56',
    created_at: '2026-01-15T08:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-manager-02',
    email: 'manager@palmeraie.com',
    name: 'Fatou Cissé',
    role: 'manager',
    company_id: '11111111-1111-4111-8111-111111111111',
    phone: '+225 05 98 76 54',
    created_at: '2026-01-16T09:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-worker-03',
    email: 'worker@palmeraie.com',
    name: 'Kouamé Koffi',
    role: 'worker',
    company_id: '11111111-1111-4111-8111-111111111111',
    phone: '+225 01 23 45 67',
    created_at: '2026-01-20T11:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-owner-sn-04',
    email: 'owner@autoexpress.sn',
    name: 'Ibrahima Ndiaye',
    role: 'owner',
    company_id: '22222222-2222-4222-8222-222222222222',
    phone: '+221 77 654 32 10',
    created_at: '2026-02-10T10:30:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-admin-05',
    email: 'admin@kazibox.com',
    name: 'Amadou Ba',
    role: 'platform_admin',
    company_id: '11111111-1111-4111-8111-111111111111',
    phone: '+225 07 00 00 01',
    created_at: '2026-01-01T00:00:00Z',
    password_hash: 'password123',
  },
];

export const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: 'tm-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    user_id: 'usr-owner-01',
    name: 'Mamadou Diallo',
    email: 'owner@palmeraie.com',
    role: 'owner',
    status: 'active',
    joined_at: '2026-01-15T08:00:00Z',
  },
  {
    id: 'tm-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    user_id: 'usr-manager-02',
    name: 'Fatou Cissé',
    email: 'manager@palmeraie.com',
    role: 'manager',
    status: 'active',
    joined_at: '2026-01-16T09:00:00Z',
  },
  {
    id: 'tm-3',
    company_id: '11111111-1111-4111-8111-111111111111',
    user_id: 'usr-worker-03',
    name: 'Kouamé Koffi',
    email: 'worker@palmeraie.com',
    role: 'worker',
    status: 'active',
    joined_at: '2026-01-20T11:00:00Z',
  },
  {
    id: 'tm-4',
    company_id: '22222222-2222-4222-8222-222222222222',
    user_id: 'usr-owner-sn-04',
    name: 'Ibrahima Ndiaye',
    email: 'owner@autoexpress.sn',
    role: 'owner',
    status: 'active',
    joined_at: '2026-02-10T10:30:00Z',
  },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    company_id: '11111111-1111-4111-8111-111111111111',
    title: 'Module Hôtel actif',
    message: 'Votre module Hôtel & Résidence est opérationnel avec votre formule Single.',
    type: 'success',
    read: false,
    created_at: '2026-10-04T10:00:00Z',
    link: '/modules/hotel-property',
  },
  {
    id: 'notif-2',
    company_id: '11111111-1111-4111-8111-111111111111',
    title: 'Abonnement activé',
    message: 'Le paiement de votre abonnement mensuel a été validé avec succès.',
    type: 'info',
    read: true,
    created_at: '2026-10-01T08:00:00Z',
    link: '/billing',
  },
  {
    id: 'notif-3',
    company_id: '22222222-2222-4222-8222-222222222222',
    title: 'Abonnement expiré',
    message: 'Votre abonnement a expiré. Renouvelez-le pour réactiver vos modules.',
    type: 'alert',
    read: false,
    created_at: '2026-09-28T09:15:00Z',
    link: '/billing',
  },
];

// Phase 2 Modules
export const INITIAL_MODULES: ModuleManifest[] = [
  {
    id: 'hotel-property',
    slug: 'hotel-property',
    name: {
      en: 'Hotel & Property Rental',
      fr: 'Hôtel & Résidence',
    },
    version: '1.2.0',
    tagline: {
      en: 'Rooms, reservations, guest billing and housekeeping management',
      fr: 'Gestion des chambres, réservations, facturation séjours et ménage',
    },
    logo: '🏨',
    accentColor: '#6D28D9',
    entryUrl: '/modules/hotel-property',
    menuItems: [
      { label: { en: 'Rooms & Guests', fr: 'Chambres & Résidents' }, path: '/modules/hotel-property/rooms' },
      { label: { en: 'Calendar & Bookings', fr: 'Planning Réservations' }, path: '/modules/hotel-property/calendar' },
      { label: { en: 'Housekeeping', fr: 'Ménage & Entretien' }, path: '/modules/hotel-property/housekeeping' },
    ],
    scopes: ['read:bookings', 'write:bookings', 'read:rooms', 'write:invoices'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/modules/hotel-property/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/hotel-property',
    pwa: {
      scope: '/modules/hotel-property',
      startUrl: '/modules/hotel-property',
      themeColor: '#6D28D9',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Core Team',
    category: 'hospitality',
    pricing_type: 'paid',
    keywords: ['hotel', 'chambre', 'hebergement', 'reservation', 'tourisme', 'room', 'booking', 'hospitality', 'residence', 'lodge', 'guest'],
    pricePerMonth: { amount: 15000, currency: 'XOF' },
    description: {
      en: 'Comprehensive property and boutique hotel management engine. Coordinate front-desk check-ins, guest billing with local currencies, live room calendars, and real-time room turnarounds without paper logbooks.',
      fr: 'Système complet de gestion pour hôtels de charme, résidences meublées et appartements d’hôtes. Pilotez les arrivées, la facturation des séjours, le planning des chambres et l’état du ménage en temps réel.',
    },
    features: {
      en: [
        'Real-time interactive booking grid & room allocation',
        'Direct check-in / check-out and guest folio calculation',
        'Independent guest billing and receipt generation',
        'Housekeeping mobile checklist for cleaning staff',
        'Daily occupancy rate and revenue indicators',
      ],
      fr: [
        'Calendrier dynamique des réservations et occupation des chambres',
        'Enregistrement direct arrivées/départs avec fiche client',
        'Facturation des séjours et reçus séparés de la plateforme',
        'Suivi mobile du ménage et statut propre/à faire pour le personnel',
        'Indicateurs quotidiens du taux de remplissage et chiffre d’affaires',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80',
    ],
    demoVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
  },
  {
    id: 'garage-auto',
    slug: 'garage-auto',
    name: {
      en: 'Garage & Auto Repair',
      fr: 'Garage & Atelier Mécanique',
    },
    version: '1.0.4',
    tagline: {
      en: 'Repair orders, diagnostics, parts stock and vehicle history',
      fr: 'Ordres de réparation, devis, stocks de pièces et suivi des véhicules',
    },
    logo: '🔧',
    accentColor: '#D97706',
    entryUrl: '/modules/garage-auto',
    menuItems: [
      { label: { en: 'Work Orders', fr: 'Ordres de Réparation' }, path: '/modules/garage-auto/orders' },
      { label: { en: 'Vehicle Database', fr: 'Parc Véhicules' }, path: '/modules/garage-auto/vehicles' },
      { label: { en: 'Spare Parts Inventory', fr: 'Stock Pièces' }, path: '/modules/garage-auto/inventory' },
    ],
    scopes: ['read:repairs', 'write:repairs', 'read:inventory'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/v1/garage/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/garage-auto',
    pwa: {
      scope: '/modules/garage-auto',
      startUrl: '/modules/garage-auto',
      themeColor: '#D97706',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Automotive Labs',
    category: 'automotive',
    pricing_type: 'paid',
    keywords: [
      'garage', 'auto', 'automotive', 'repair', 'mechanic', 'mechanics',
      'vehicle', 'car', 'voiture', 'réparation', 'reparation', 'mécanique',
      'mecanique', 'atelier', 'pieces', 'vidange', 'panne'
    ],
    pricePerMonth: { amount: 15000, currency: 'XOF' },
    description: {
      en: 'Field-ready workshop software built for mechanics and collision centers. Digitize vehicle reception, track repair orders (OR), bill labor and replacement parts transparently.',
      fr: 'Logiciel d’atelier conçu pour les garages et carrosseries. Enregistrez les véhicules entrants par immatriculation, créez des devis précis et suivez la main d’œuvre et les pièces.',
    },
    features: {
      en: [
        'Digital repair orders (OR) with customer sign-off',
        'License plate and chassis VIN lookup with history',
        'Spare parts stock tracking and reorder thresholds',
        'SMS alerts to car owners upon job completion',
        'Technician time tracking per repair job',
      ],
      fr: [
        'Ordres de réparation numériques avec signature client',
        'Fiches véhicules par immatriculation avec historique d’interventions',
        'Gestion des pièces de rechange et alerte de réapprovisionnement',
        'Notification SMS automatique au client quand le véhicule est prêt',
        'Suivi du temps de main d’œuvre par mécanicien',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=800&q=80',
    ],
    demoVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
  },
  {
    id: 'taxi-fleet',
    slug: 'taxi-fleet',
    name: {
      en: 'Taxi & Fleet Management',
      fr: 'Taxi & Flotte de Véhicules',
    },
    version: '1.1.0',
    tagline: {
      en: 'Daily collections, driver tracking, maintenance log and fuel',
      fr: 'Recettes journalières, suivi chauffeurs, carnet d’entretien et carburant',
    },
    logo: '🚕',
    accentColor: '#2563EB',
    entryUrl: '/modules/taxi-fleet',
    menuItems: [
      { label: { en: 'Daily Collections', fr: 'Recettes Journalières' }, path: '/modules/taxi-fleet/collections' },
      { label: { en: 'Drivers & Assignments', fr: 'Chauffeurs & Affectations' }, path: '/modules/taxi-fleet/drivers' },
      { label: { en: 'Maintenance & Fuel', fr: 'Vidanges & Carburant' }, path: '/modules/taxi-fleet/maintenance' },
    ],
    scopes: ['read:fleet', 'write:fleet', 'read:collections'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/modules/taxi-fleet/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/taxi-fleet',
    pwa: {
      scope: '/modules/taxi-fleet',
      startUrl: '/modules/taxi-fleet',
      themeColor: '#2563EB',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Transport Systems',
    category: 'logistics',
    pricing_type: 'paid',
    keywords: ['taxi', 'flotte', 'chauffeur', 'transport', 'recettes', 'course', 'driver', 'fleet', 'vtc', 'logistique', 'carburant', 'reliquat'],
    pricePerMonth: { amount: 15000, currency: 'XOF' },
    description: {
      en: 'Fleet supervision for taxi companies, delivery dispatchers, and vehicle rental owners. Log daily cash turn-ins, audit mileage, and schedule preventive oil changes.',
      fr: 'Supervision de flotte pour exploitants de taxis, transporteurs urbains et loueurs de véhicules. Suivez les versements quotidiens par chauffeur et planifiez l’entretien préventif.',
    },
    features: {
      en: [
        'Daily cash remittance ledger per driver with shortfall alerts',
        'Vehicle assignment roster and driver deposit tracking',
        'Preventive maintenance schedules (oil, brakes, insurance, inspection)',
        'Fuel expenditure vs. distance audited in real time',
      ],
      fr: [
        'Enregistrement des recettes quotidiennes et gestion des reliquats',
        'Affectation des véhicules et carnet de cautions des chauffeurs',
        'Alertes visites techniques, vidanges, pneus et assurances',
        'Suivi de la consommation carburant et rentabilité par véhicule',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'hair-salon',
    slug: 'hair-salon',
    name: {
      en: 'Hair Salon & Beauty Spa',
      fr: 'Salon de Coiffure & Esthétique',
    },
    version: '1.0.2',
    tagline: {
      en: 'Appointment scheduling, stylist rosters, fast register and SMS reminders',
      fr: 'Prise de rendez-vous, planning des coiffeurs, caisse tactile et SMS',
    },
    logo: '✂️',
    accentColor: '#DB2777',
    entryUrl: '/modules/hair-salon',
    menuItems: [
      { label: { en: 'Stylist Schedule', fr: 'Planning Coiffeurs' }, path: '/modules/hair-salon/schedule' },
      { label: { en: 'Quick Checkout POS', fr: 'Caisse Rapide' }, path: '/modules/hair-salon/pos' },
      { label: { en: 'Client Directory', fr: 'Fichier Clients' }, path: '/modules/hair-salon/clients' },
    ],
    scopes: ['read:appointments', 'write:appointments', 'read:clients'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/v1/salon/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/hair-salon',
    pwa: {
      scope: '/modules/hair-salon',
      startUrl: '/modules/hair-salon',
      themeColor: '#DB2777',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Lifestyle',
    category: 'beauty',
    pricing_type: 'paid',
    keywords: [
      'salon', 'hair', 'beauty', 'spa', 'haircut', 'stylist', 'coiffure',
      'beauté', 'beaute', 'cheveux', 'esthétique', 'esthetique', 'massage',
      'manucure', 'pédicure', 'pedicure', 'barbier', 'barber', 'onglerie', 'tresse'
    ],
    pricePerMonth: { amount: 10000, currency: 'XOF' },
    description: {
      en: 'Designed specifically for barbershops, hair styling salons, and beauty studios. Keep calendars clear, commissions calculated, and customer loyalty high.',
      fr: 'Conçu pour salons de coiffure, instituts de beauté et barbiers. Gérez les rendez-vous, attribuez les prestations par coiffeur et calculez les commissions sans erreurs.',
    },
    features: {
      en: [
        'Multi-chair visual appointment booking grid',
        'Touch POS for services and retail beauty products',
        'Staff commission calculations per treatment',
        'Client profile with hair style preference notes',
      ],
      fr: [
        'Planning visuel par fauteuil et coiffeur/esthéticienne',
        'Caisse tactile adaptée aux prestations et produits vendus',
        'Calcul automatique des commissions des collaborateurs',
        'Historique des prestations et préférences clients',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'pharmacy',
    slug: 'pharmacy',
    name: {
      en: 'Pharmacy & Dispensary',
      fr: 'Pharmacie & Parapharmacie',
    },
    version: '1.3.1',
    tagline: {
      en: 'Prescription tracking, expiry date alerts, barcode scanning and stock',
      fr: 'Gestion des ordonnances, alertes de péremption, scan code-barres et stock',
    },
    logo: '💊',
    accentColor: '#059669',
    entryUrl: '/modules/pharmacy',
    menuItems: [
      { label: { en: 'Sales Counter', fr: 'Comptoir de Vente' }, path: '/modules/pharmacy/sales' },
      { label: { en: 'Medication Inventory', fr: 'Stock Médicaments' }, path: '/modules/pharmacy/inventory' },
      { label: { en: 'Expiry Alerts', fr: 'Alertes Péremption' }, path: '/modules/pharmacy/alerts' },
    ],
    scopes: ['read:pharmacy', 'write:prescriptions', 'read:medicines'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/modules/pharmacy/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/pharmacy',
    pwa: {
      scope: '/modules/pharmacy',
      startUrl: '/modules/pharmacy',
      themeColor: '#059669',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Health Systems',
    category: 'health',
    pricing_type: 'paid',
    keywords: ['pharmacie', 'medicaments', 'sante', 'ordonnance', 'officine', 'drugstore', 'health', 'peremption', 'medecine', 'soins'],
    pricePerMonth: { amount: 20000, currency: 'XOF' },
    description: {
      en: 'Compliant pharmacy inventory and point of sale. Prevent expiration waste, streamline prescription fulfillment, and maintain tight batch number control.',
      fr: 'Gestion d’officine et dispensaire pharmaceutique. Évitez les pertes de péremption, gérez les lots et ordonnances et assurez un encaissement rapide.',
    },
    features: {
      en: [
        'Batch number and expiration date monitoring with alert flags',
        'Fast barcode lookup and generic drug equivalence suggestions',
        'Prescription archiving and dosage instructions printout',
        'Third-party mutual health insurance deduction support',
      ],
      fr: [
        'Suivi rigoureux des lots et dates de péremption avec alertes',
        'Recherche rapide par code-barres et suggestion de génériques',
        'Gestion des ordonnances et posologies associées',
        'Prise en charge du tiers-payant et mutuelles de santé',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'restaurant',
    slug: 'restaurant',
    name: {
      en: 'Restaurant, Bar & Lounge',
      fr: 'Restaurant, Bar & Maquis',
    },
    version: '0.9.0',
    tagline: {
      en: 'Table ordering on mobile, kitchen orders, bar stock and daily Z-reports',
      fr: 'Prise de commande mobile, envoi cuisine, gestion bar et clôture Z',
    },
    logo: '🍽️',
    accentColor: '#DC2626',
    entryUrl: '/modules/restaurant',
    menuItems: [
      { label: { en: 'Table Floorplan', fr: 'Plan de Salle' }, path: '/modules/restaurant/tables' },
      { label: { en: 'Kitchen Display', fr: 'Écran Cuisine' }, path: '/modules/restaurant/kitchen' },
      { label: { en: 'Beverage Stock', fr: 'Cave & Boissons' }, path: '/modules/restaurant/beverages' },
    ],
    scopes: ['read:orders', 'write:orders', 'read:menu'],
    languages: ['fr', 'en'],
    summaryUrl: '/api/modules/restaurant/summary',
    webhookUrl: 'https://api.kazibox.com/webhooks/restaurant',
    pwa: {
      scope: '/modules/restaurant',
      startUrl: '/modules/restaurant',
      themeColor: '#DC2626',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'coming_soon',
    developer: 'KaziBox Hospitality',
    category: 'food',
    pricing_type: 'paid',
    keywords: ['restaurant', 'bar', 'maquis', 'repas', 'cuisine', 'table', 'menu', 'food', 'boisson', 'commande', 'dining', 'addition'],
    pricePerMonth: { amount: 15000, currency: 'XOF' },
    description: {
      en: 'Complete solution for African restaurants, maquis, and cocktail bars. Waiters take orders on smartphones, send tickets straight to kitchen, and settle bills in seconds.',
      fr: 'Solution pensée pour restaurants, maquis et bars. Prise de commande sur smartphone par les serveurs, envoi direct en cuisine et encaissements rapides.',
    },
    features: {
      en: [
        'Smartphone table ordering directly synchronized with kitchen ticket printer',
        'Beverage and keg inventory with depletion per serving',
        'Split billing and multi-payment (Cash + Mobile Money)',
        'Daily end-of-day Z-report with cashier reconciliation',
      ],
      fr: [
        'Prise de commande mobile à table synchronisée avec la cuisine',
        'Gestion des casiers de boissons et fûts avec décompte unitaire',
        'Partage d’addition et paiements mixtes (Espèces + Mobile Money)',
        'Clôture journalière (ticket Z) et contrôle de caisse par serveur',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'demo-module',
    slug: 'demo-module',
    name: {
      en: 'Demo Module (External)',
      fr: 'Module Démo (Externe)',
    },
    version: '1.0.0',
    tagline: {
      en: 'Reference integration built by third-party partner using KaziBox SDK',
      fr: 'Intégration de référence développée par un tiers via le SDK KaziBox',
    },
    logo: '⚡',
    accentColor: '#7C3AED',
    entryUrl: '/modules/demo-module',
    menuItems: [
      { label: { en: 'External Dashboard', fr: 'Tableau de Bord Tiers' }, path: '/modules/demo-module/dashboard' },
      { label: { en: 'Integration Logs', fr: 'Journaux d’Intégration' }, path: '/modules/demo-module/logs' },
    ],
    scopes: ['read:profile', 'read:telemetry'],
    languages: ['fr', 'en'],
    summaryUrl: 'https://demo.kazibox-partner.net/api/summary',
    webhookUrl: 'https://demo.kazibox-partner.net/api/webhook',
    pwa: {
      scope: '/modules/demo-module',
      startUrl: '/modules/demo-module',
      themeColor: '#7C3AED',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'external',
    status: 'published',
    developer: 'AfriCode Solutions (Third-Party)',
    category: 'services',
    pricing_type: 'paid',
    keywords: ['demo', 'sdk', 'tiers', 'externe', 'api', 'webhook', 'integration', 'partner', 'third-party'],
    pricePerMonth: { amount: 8000, currency: 'XOF' },
    description: {
      en: 'An example external SaaS module integrated into KaziBox using the open SDK contract. Demonstrates API keys, webhooks, and consolidated metrics.',
      fr: 'Exemple de module SaaS externe intégré à KaziBox via le contrat SDK ouvert. Démontre la gestion des clés API, des webhooks et de la télémétrie consolidée.',
    },
    features: {
      en: [
        'Secure token exchange with KaziBox platform session',
        'Consolidated dashboard metric telemetry pusher',
        'External webhook listener for activation / deactivation events',
        'Embedded responsive iframe or standalone PWA launch',
      ],
      fr: [
        'Échange sécurisé de tokens avec la session de la plateforme',
        'Envoi de métriques télémétriques au tableau de bord consolidé',
        'Écoute des webhooks d’activation et de désactivation',
        'Intégration fluide au sein du shell KaziBox',
      ],
    },
    screenshots: [
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
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
    pricing_type: 'paid',
    keywords: ['demo', 'internal', 'sso', 'sdk', 'telemetry', 'reference'],
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
  },
  // Phase 6: Lightweight Free Tools
  {
    id: 'tool-qr-code',
    slug: 'tool-qr-code',
    name: {
      en: 'QR Code Generator',
      fr: 'Générateur de QR Code',
    },
    version: '1.0.0',
    tagline: {
      en: 'Create custom QR codes for web links, phone numbers, Wi-Fi and payments',
      fr: 'Créez des QR codes pour liens web, numéros, Wi-Fi et coordonnées marchandes',
    },
    logo: '📱',
    accentColor: '#10B981',
    entryUrl: '/modules/tool-qr-code',
    menuItems: [
      { label: { en: 'QR Generator', fr: 'Générateur QR' }, path: '/modules/tool-qr-code' },
    ],
    scopes: ['read:profile'],
    languages: ['fr', 'en'],
    summaryUrl: '',
    webhookUrl: '',
    pwa: {
      scope: '/modules/tool-qr-code',
      startUrl: '/modules/tool-qr-code',
      themeColor: '#10B981',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Tools',
    category: 'utilities',
    pricing_type: 'free',
    keywords: ['qr', 'code', 'qrcode', 'wifi', 'lien', 'url', 'scan', 'scanner', 'carte', 'gratuit', 'free', 'utilitaire', 'partage'],
    pricePerMonth: { amount: 0, currency: 'XOF' },
    description: {
      en: 'Lightweight free utility to generate high-resolution QR codes directly in your browser. Supports custom URLs, Wi-Fi network sharing, contact cards, and mobile money prompt links with instant SVG/PNG export.',
      fr: 'Utilitaire gratuit et rapide pour générer des codes QR haute résolution directement dans le navigateur. Prend en charge les liens web, le partage Wi-Fi, les cartes de visite et liens de paiement avec téléchargement instantané.',
    },
    features: {
      en: [
        'Instant client-side QR rendering (no data sent to external servers)',
        'URL, Wi-Fi network credentials, phone and free-text formats',
        'Custom color customization with high contrast validation',
        'One-click SVG and high-res PNG download',
      ],
      fr: [
        'Génération instantanée 100% côté client (aucune donnée envoyée à l’extérieur)',
        'Formats URL, identifiants réseau Wi-Fi, téléphone et texte libre',
        'Personnalisation des couleurs avec contraste optimisé pour scan',
        'Téléchargement immédiat aux formats SVG et PNG haute résolution',
      ],
    },
    screenshots: [],
  },
  {
    id: 'tool-image-compressor',
    slug: 'tool-image-compressor',
    name: {
      en: 'Image Compressor & Resizer',
      fr: 'Compresseur d’Images & Photos',
    },
    version: '1.0.0',
    tagline: {
      en: 'Compress and resize photos instantly in your browser to reduce file weight',
      fr: 'Compressez et allégez vos photos instantanément pour économiser la bande passante',
    },
    logo: '🖼️',
    accentColor: '#3B82F6',
    entryUrl: '/modules/tool-image-compressor',
    menuItems: [
      { label: { en: 'Compressor', fr: 'Compresseur' }, path: '/modules/tool-image-compressor' },
    ],
    scopes: ['read:profile'],
    languages: ['fr', 'en'],
    summaryUrl: '',
    webhookUrl: '',
    pwa: {
      scope: '/modules/tool-image-compressor',
      startUrl: '/modules/tool-image-compressor',
      themeColor: '#3B82F6',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Tools',
    category: 'utilities',
    pricing_type: 'free',
    keywords: ['image', 'photo', 'compress', 'compression', 'redimensionner', 'resize', 'jpg', 'png', 'poids', 'reduire', 'gratuit', 'free', 'alléger', 'optimiser'],
    pricePerMonth: { amount: 0, currency: 'XOF' },
    description: {
      en: 'Lightweight client-side image compression tool. Drastically reduce photo sizes before uploading to your product catalog or sending over mobile networks, with real-time file size comparison.',
      fr: 'Outil gratuit de compression et redimensionnement d’images. Réduisez le poids de vos photos jusqu’à 80% avant de les envoyer sur WhatsApp ou votre catalogue sans perte visible de netteté.',
    },
    features: {
      en: [
        'Browser-based canvas compression with 0 server uploads',
        'Live before / after file size and savings percentage badge',
        'Custom quality slider (10% to 100%) and max dimension limits',
        'Instant download of optimized JPEG or WebP files',
      ],
      fr: [
        'Compression locale ultra-rapide sans téléversement sur serveur',
        'Comparateur en direct : poids original vs poids compressé (-75%)',
        'Curseur de qualité réglable et dimensions maximales configurables',
        'Téléchargement direct en JPEG optimisé ou WebP',
      ],
    },
    screenshots: [],
  },
  {
    id: 'tool-margin-calculator',
    slug: 'tool-margin-calculator',
    name: {
      en: 'Margin & Percentage Calculator',
      fr: 'Calculateur de Marge & Remise',
    },
    version: '1.0.0',
    tagline: {
      en: 'Fast calculations for profit margins, markups, VAT/TVA, and discounts',
      fr: 'Calcul immédiat des marges brutes, coefficients, TVA et remises commerciales',
    },
    logo: '🧮',
    accentColor: '#F59E0B',
    entryUrl: '/modules/tool-margin-calculator',
    menuItems: [
      { label: { en: 'Calculator', fr: 'Calculateur' }, path: '/modules/tool-margin-calculator' },
    ],
    scopes: ['read:profile'],
    languages: ['fr', 'en'],
    summaryUrl: '',
    webhookUrl: '',
    pwa: {
      scope: '/modules/tool-margin-calculator',
      startUrl: '/modules/tool-margin-calculator',
      themeColor: '#F59E0B',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Tools',
    category: 'utilities',
    pricing_type: 'free',
    keywords: ['calculatrice', 'marge', 'pourcentage', 'tva', 'remise', 'prix', 'commerce', 'benefice', 'calculator', 'margin', 'vat', 'discount', 'gratuit', 'free', 'taux', 'solde'],
    pricePerMonth: { amount: 0, currency: 'XOF' },
    description: {
      en: 'Dedicated financial calculator for shopkeepers, traders, and artisans. Compute gross margins, markup multipliers, VAT taxes (HT/TTC), and promotional discount prices in seconds.',
      fr: 'Calculatrice commerciale spécialement pensée pour commerçants et artisans. Calculez vos marges, coefficients multiplicateurs, conversions HT / TTC (TVA 18% UEMOA) et prix soldés.',
    },
    features: {
      en: [
        'Margin & Markup: Cost Price + Selling Price -> Gross Profit and %',
        'VAT / TVA Converter: HT to TTC and TTC to HT (standard 18% or custom)',
        'Commercial Discount: Original Price - % -> Final Price & Cash Savings',
        'Percentage Evolution: Growth/drop indicator between two sales periods',
      ],
      fr: [
        'Marge & Taux de marque : Prix d’achat + Prix de vente -> Marge et %',
        'Convertisseur TVA : Calcul HT vers TTC et TTC vers HT (taux UEMOA 18%)',
        'Remise commerciale : Prix de départ - % -> Prix final et gain client',
        'Évolution en pourcentage : Calculez la hausse ou baisse entre deux périodes',
      ],
    },
    screenshots: [],
  },
  {
    id: 'tool-img-to-pdf',
    slug: 'tool-img-to-pdf',
    name: {
      en: 'JPG to PDF Converter',
      fr: 'Convertisseur JPG en PDF',
    },
    version: '1.0.0',
    tagline: {
      en: 'Turn receipts, invoices and photos into a clean downloadable PDF document',
      fr: 'Assemblez vos photos de reçus, factures et documents en un PDF prêt à partager',
    },
    logo: '📄',
    accentColor: '#EC4899',
    entryUrl: '/modules/tool-img-to-pdf',
    menuItems: [
      { label: { en: 'JPG to PDF', fr: 'JPG en PDF' }, path: '/modules/tool-img-to-pdf' },
    ],
    scopes: ['read:profile'],
    languages: ['fr', 'en'],
    summaryUrl: '',
    webhookUrl: '',
    pwa: {
      scope: '/modules/tool-img-to-pdf',
      startUrl: '/modules/tool-img-to-pdf',
      themeColor: '#EC4899',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    kind: 'internal',
    status: 'published',
    developer: 'KaziBox Tools',
    category: 'utilities',
    pricing_type: 'free',
    keywords: ['pdf', 'jpg', 'jpeg', 'convertisseur', 'convert', 'document', 'scan', 'recu', 'facture', 'photo', 'gratuit', 'free', 'assembler'],
    pricePerMonth: { amount: 0, currency: 'XOF' },
    description: {
      en: 'Combine multiple image files, photo receipts, and document scans into a standardized PDF document right on your phone or computer.',
      fr: 'Regroupez rapidement vos photos de reçus papier, bons de livraison ou contrats dans un document PDF unique et partageable par email ou WhatsApp.',
    },
    features: {
      en: [
        'Multi-image batch selection (JPG, PNG, WebP)',
        'Page orientation (Portrait / Landscape) and margin settings',
        'Drag-and-drop or simple reordering of selected pages',
        'Instant offline PDF compilation and download',
      ],
      fr: [
        'Sélection de plusieurs images simultanément (JPG, PNG, WebP)',
        'Orientation de page (Portrait / Paysage) et ajustement automatique',
        'Réorganisation facile de l’ordre des pages avant génération',
        'Compilation et téléchargement PDF instantanés sans connexion externe requise',
      ],
    },
    screenshots: [],
  },
];

// Initial Subscriptions
export const INITIAL_SUBSCRIPTIONS: Subscription[] = [
  {
    id: 'sub-palmeraie-01',
    companyId: '11111111-1111-4111-8111-111111111111',
    planId: 'single',
    status: 'active',
    billingCycle: 'monthly',
    includedModuleIds: ['hotel-property', 'demo'],
    currentPeriodStart: '2026-10-01T00:00:00Z',
    currentPeriodEnd: '2026-11-01T00:00:00Z',
    renewAt: '2026-11-01T00:00:00Z',
    autoRenew: true,
    amount: 15000,
    currency: 'XOF',
  },
  {
    id: 'sub-garage-02',
    companyId: '22222222-2222-4222-8222-222222222222',
    planId: 'single',
    status: 'expired',
    billingCycle: 'monthly',
    includedModuleIds: ['garage-auto'],
    currentPeriodStart: '2026-08-15T00:00:00Z',
    currentPeriodEnd: '2026-09-15T00:00:00Z',
    renewAt: '2026-09-15T00:00:00Z',
    autoRenew: false,
    amount: 15000,
    currency: 'XOF',
  },
];

// 6 Initial Payment History Rows
export const INITIAL_PAYMENTS: PaymentHistoryItem[] = [
  {
    id: 'pay-6',
    invoiceNumber: 'INV-2026-006',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-10-01T08:30:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'mobile_money',
    operator: 'Wave',
    status: 'paid',
    receiptUrl: '#',
  },
  {
    id: 'pay-5',
    invoiceNumber: 'INV-2026-005',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-09-01T08:15:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'mobile_money',
    operator: 'Orange Money',
    status: 'paid',
    receiptUrl: '#',
  },
  {
    id: 'pay-4',
    invoiceNumber: 'INV-2026-004',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-08-01T09:00:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'card',
    operator: 'Visa •••• 4242',
    status: 'paid',
    receiptUrl: '#',
  },
  {
    id: 'pay-3',
    invoiceNumber: 'INV-2026-003',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-07-01T08:45:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'mobile_money',
    operator: 'MTN MoMo',
    status: 'paid',
    receiptUrl: '#',
  },
  {
    id: 'pay-2',
    invoiceNumber: 'INV-2026-002',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-06-01T08:00:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'mobile_money',
    operator: 'Wave',
    status: 'paid',
    receiptUrl: '#',
  },
  {
    id: 'pay-1',
    invoiceNumber: 'INV-2026-001',
    companyId: '11111111-1111-4111-8111-111111111111',
    date: '2026-05-01T10:12:00Z',
    amount: 15000,
    currency: 'XOF',
    planName: 'Formule Single (Hôtel & Résidence)',
    moduleCount: 1,
    paymentMethod: 'mobile_money',
    operator: 'Moov Money',
    status: 'failed',
    receiptUrl: '#',
  },
];

export interface StoredApiKey {
  id: string;
  moduleId: string;
  prefix: string;
  hashedSecret: string;
  createdAt: string;
}

export const INITIAL_API_KEYS: StoredApiKey[] = [];

// Persistent state accessor for browser & SSR
const STORAGE_KEYS = {
  WORKSPACES: 'kazibox_db_workspaces',
  USERS: 'kazibox_db_users',
  MEMBERS: 'kazibox_db_members',
  NOTIFICATIONS: 'kazibox_db_notifications',
  MODULES: 'kazibox_db_modules',
  SUBSCRIPTIONS: 'kazibox_db_subscriptions',
  PAYMENTS: 'kazibox_db_payments',
  API_KEYS: 'kazibox_db_api_keys',
  FINANCE: 'kazibox_db_finance_records',
  CURRENT_SESSION: 'kazibox_current_session',
};

// Storage versioning to invalidate stale localStorage data across releases
const STORE_VERSION = 'v3.3.0';
const STORE_VERSION_KEY = 'kazibox_db_schema_version';

export const getStore = () => {
  if (typeof window === 'undefined') {
    return {
      workspaces: [...INITIAL_WORKSPACES],
      users: [...INITIAL_USERS],
      members: [...INITIAL_MEMBERS],
      notifications: [...INITIAL_NOTIFICATIONS],
      modules: [...INITIAL_MODULES],
      subscriptions: [...INITIAL_SUBSCRIPTIONS],
      payments: [...INITIAL_PAYMENTS],
      apiKeys: [...INITIAL_API_KEYS],
    };
  }

  // Version check and migration: automatically clear old mock collections when version changes
  try {
    const savedVer = localStorage.getItem(STORE_VERSION_KEY);
    if (savedVer !== STORE_VERSION) {
      // Invalidate old collections so fresh module registry & subscriptions take effect
      Object.values(STORAGE_KEYS).forEach((k) => {
        if (k !== STORAGE_KEYS.CURRENT_SESSION) {
          localStorage.removeItem(k);
        }
      });
      localStorage.setItem(STORE_VERSION_KEY, STORE_VERSION);
    }
  } catch {}

  const getOrSet = <T>(key: string, initial: T): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && Array.isArray(initial)) {
          const existingIds = new Set(parsed.map((p: any) => p?.id).filter(Boolean));
          let changed = false;
          for (const item of initial as any[]) {
            if (item?.id && !existingIds.has(item.id)) {
              parsed.push(item);
              changed = true;
            }
          }
          if (changed) {
            localStorage.setItem(key, JSON.stringify(parsed));
          }
        }
        return parsed;
      }
      localStorage.setItem(key, JSON.stringify(initial));
      return initial;
    } catch {
      return initial;
    }
  };

  return {
    workspaces: getOrSet(STORAGE_KEYS.WORKSPACES, INITIAL_WORKSPACES),
    users: getOrSet(STORAGE_KEYS.USERS, INITIAL_USERS),
    members: getOrSet(STORAGE_KEYS.MEMBERS, INITIAL_MEMBERS),
    notifications: getOrSet(STORAGE_KEYS.NOTIFICATIONS, INITIAL_NOTIFICATIONS),
    modules: getOrSet(STORAGE_KEYS.MODULES, INITIAL_MODULES),
    subscriptions: getOrSet(STORAGE_KEYS.SUBSCRIPTIONS, INITIAL_SUBSCRIPTIONS),
    payments: getOrSet(STORAGE_KEYS.PAYMENTS, INITIAL_PAYMENTS),
    apiKeys: getOrSet(STORAGE_KEYS.API_KEYS, INITIAL_API_KEYS),
  };
};

export const setStoreItem = <T>(key: keyof typeof STORAGE_KEYS, val: T) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(val));
  } catch (err) {
    console.error('Storage error:', err);
  }
};
