-- KaziBox Supabase Production Seed Data (seed.sql)

-- 1. SEED MODULES CATALOGUE
INSERT INTO public.modules (
  id, slug, name, description, tagline, category, icon, kind, status, developer, version, min_platform_version, features, pricing, manifest
) VALUES 
(
  'hotel-property',
  'hotel-property',
  '{"fr": "Gestion Hôtelière & Résidences", "en": "Hotel & Property Management"}'::jsonb,
  '{"fr": "Solution complète pour hôtels, gîtes et résidences meublées: chambres, réservations, facturation et ménage.", "en": "Complete hotel and property management solution."}'::jsonb,
  '{"fr": "Pilotez vos chambres et réservations en temps réel", "en": "Manage rooms and bookings in real-time"}'::jsonb,
  'Hospitality',
  'Bed',
  'internal',
  'active',
  'KaziBox Core',
  '1.2.0',
  '1.0.0',
  '["Gestion du planning des chambres", "Réservations directes", "Facturation & Encaissments", "Suivi du ménage"]'::jsonb,
  '{"monthly": 29000, "annual": 290000, "currency": "XOF"}'::jsonb,
  '{"id": "hotel-property", "name": "Gestion Hôtelière", "version": "1.2.0", "entryUrl": "/modules/hotel-property"}'::jsonb
),
(
  'garage',
  'garage',
  '{"fr": "Garage & Mécanique", "en": "Garage & Auto Repair"}'::jsonb,
  '{"fr": "Gestion d’atelier mécanique: ordres de réparation, devis, pièces détachées et historique véhicules.", "en": "Complete garage repair shop management."}'::jsonb,
  '{"fr": "Ordonnancez vos OR et vos pièces en toute sérénité", "en": "Manage repair orders and parts smoothly"}'::jsonb,
  'Automotive',
  'Wrench',
  'internal',
  'active',
  'KaziBox Core',
  '1.1.0',
  '1.0.0',
  '["Ordres de Réparation (OR)", "Devis & Factures atelier", "Stock de pièces détachées", "Historique client & véhicule"]'::jsonb,
  '{"monthly": 25000, "annual": 250000, "currency": "XOF"}'::jsonb,
  '{"id": "garage", "name": "Garage & Mécanique", "version": "1.1.0", "entryUrl": "/modules/garage"}'::jsonb
),
(
  'demo',
  'demo',
  '{"fr": "Module de Démonstration Interne", "en": "Internal Demo Module"}'::jsonb,
  '{"fr": "Module modèle illustrant l’intégration SDK, l’authentification SSO et les API de données consolidées.", "en": "Reference module for SDK integration testing."}'::jsonb,
  '{"fr": "Référence de développement pour le SDK KaziBox", "en": "Development reference for KaziBox SDK"}'::jsonb,
  'Development',
  'Code2',
  'internal',
  'active',
  'KaziBox Core',
  '1.0.0',
  '1.0.0',
  '["Test d’API de consolidation", "Validation SSO KaziBox", "Génération de flux financiers simulés"]'::jsonb,
  '{"monthly": 0, "annual": 0, "currency": "XOF"}'::jsonb,
  '{"id": "demo", "name": "Module Démo", "version": "1.0.0", "entryUrl": "/modules/demo"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, manifest = EXCLUDED.manifest;

-- 2. SEED COMPANIES
INSERT INTO public.companies (
  id, name, country, currency, language, plan, status, created_at
) VALUES 
('11111111-1111-4111-8111-111111111111', 'Hôtel & Résidence Palmeraie', 'Côte d’Ivoire', 'XOF', 'fr', 'pro', 'active', '2026-01-15 08:00:00+00'),
('22222222-2222-4222-8222-222222222222', 'Garage & Mécanique Express', 'Sénégal', 'XOF', 'fr', 'starter', 'active', '2026-02-10 10:30:00+00')
ON CONFLICT (id) DO NOTHING;

-- 3. SEED COMPANY MODULES
INSERT INTO public.company_modules (
  company_id, module_id, plan_id, status, activated_at
) VALUES
('11111111-1111-4111-8111-111111111111', 'hotel-property', 'pro', 'active', '2026-01-15 08:00:00+00'),
('11111111-1111-4111-8111-111111111111', 'demo', 'starter', 'active', '2026-01-15 08:00:00+00'),
('22222222-2222-4222-8222-222222222222', 'garage', 'starter', 'active', '2026-02-10 10:30:00+00')
ON CONFLICT (company_id, module_id) DO NOTHING;

-- 4. SEED SUBSCRIPTIONS
INSERT INTO public.subscriptions (
  company_id, plan_id, status, current_period_start, included_module_ids
) VALUES 
('11111111-1111-4111-8111-111111111111', 'pro', 'active', NOW(), '["hotel-property", "demo"]'::jsonb),
('22222222-2222-4222-8222-222222222222', 'starter', 'active', NOW(), '["garage"]'::jsonb);

-- 5. SEED DEMO FINANCE RECORDS
INSERT INTO public.finance_records (
  company_id, module_id, type, amount, currency, category_or_source, reference, occurred_at
) VALUES 
('11111111-1111-4111-8111-111111111111', 'hotel-property', 'revenue', 150000, 'XOF', 'Réservation #CH-102', 'REF-HOTEL-2026-001', NOW() - INTERVAL '2 days'),
('11111111-1111-4111-8111-111111111111', 'hotel-property', 'revenue', 95000, 'XOF', 'Réservation #CH-204', 'REF-HOTEL-2026-002', NOW() - INTERVAL '1 day'),
('11111111-1111-4111-8111-111111111111', 'hotel-property', 'expense', 35000, 'XOF', 'Produits d’entretien hôtelier', 'REF-HOTEL-EXP-001', NOW() - INTERVAL '1 day'),
('22222222-2222-4222-8222-222222222222', 'garage', 'revenue', 85000, 'XOF', 'Ordre Réparation #OR-409', 'REF-GARAGE-2026-001', NOW() - INTERVAL '3 days')
ON CONFLICT (company_id, reference, type) DO NOTHING;
