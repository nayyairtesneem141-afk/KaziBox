import { MoteurCountryCode, MoteurCountryConfig, MoteurCurrency } from './types';

/**
 * Priority Countries Configuration for KaziBox - Moteur Integration
 *
 * Client Requirements:
 * - Priority countries: DR Congo, Cameroon, Senegal, and Côte d'Ivoire.
 * - Payment description: "KaziBox".
 * - Supported payment methods depend on providers actually enabled in Moteur.
 * - Do NOT claim a provider is available until confirmed by Moteur backend.
 */

export const MOTEUR_PAYMENT_DESCRIPTION = 'KaziBox';

export const TARGET_COUNTRIES: Record<MoteurCountryCode, MoteurCountryConfig> = {
  CD: {
    code: 'CD',
    name: {
      fr: 'Rép. Dém. du Congo (RDC)',
      en: 'DR Congo',
    },
    currencies: ['CDF', 'USD'],
    defaultCurrency: 'CDF',
    callingCode: '+243',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  CM: {
    code: 'CM',
    name: {
      fr: 'Cameroun',
      en: 'Cameroon',
    },
    currencies: ['XAF'],
    defaultCurrency: 'XAF',
    callingCode: '+237',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  SN: {
    code: 'SN',
    name: {
      fr: 'Sénégal',
      en: 'Senegal',
    },
    currencies: ['XOF'],
    defaultCurrency: 'XOF',
    callingCode: '+221',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
  CI: {
    code: 'CI',
    name: {
      fr: 'Côte d’Ivoire',
      en: 'Côte d’Ivoire',
    },
    currencies: ['XOF'],
    defaultCurrency: 'XOF',
    callingCode: '+225',
    providerStatus: 'pending_moteur_confirmation',
    confirmedProviders: [],
  },
};

/**
 * Returns country configuration by code (case-insensitive)
 */
export function getCountryConfig(code: string): MoteurCountryConfig | null {
  const upper = code?.toUpperCase() as MoteurCountryCode;
  return TARGET_COUNTRIES[upper] || null;
}

/**
 * Returns all priority target countries
 */
export function getTargetCountries(): MoteurCountryConfig[] {
  return Object.values(TARGET_COUNTRIES);
}

/**
 * Resolves the appropriate currency for a country code
 */
export function resolveCurrencyForCountry(countryCode: string): MoteurCurrency {
  const cfg = getCountryConfig(countryCode);
  return cfg ? cfg.defaultCurrency : 'XOF';
}
