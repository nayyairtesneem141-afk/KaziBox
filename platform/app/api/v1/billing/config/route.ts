import { NextResponse } from 'next/server';
import { getTargetCountries, MOTEUR_PAYMENT_DESCRIPTION } from '@/lib/moteur/countries';
import { getMoteurConfigStatus } from '@/lib/moteur/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/billing/config
 *
 * Public client configuration: target countries, payment description, and provider status.
 * Never leaks server secrets.
 */
export async function GET() {
  const status = getMoteurConfigStatus();
  const countries = getTargetCountries();

  return NextResponse.json({
    paymentDescription: MOTEUR_PAYMENT_DESCRIPTION,
    countries,
    moteurReady: status.isConfigured,
    environment: status.environment,
    // Supported methods depend on providers actually enabled in Moteur
    note: {
      fr: 'Les moyens de paiement actifs dépendent des opérateurs confirmés dans Moteur pour chaque pays.',
      en: 'Active payment methods depend on providers confirmed in Moteur for each country.',
    },
  });
}
