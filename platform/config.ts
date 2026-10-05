export interface PlatformConfig {
  platformName: string;
  tagline: string;
  logo: string;
  icon: string;
  defaultLanguage: 'fr' | 'en';
  defaultCurrency: string;
  supportEmail: string;
  version: string;
}

export const platformConfig: PlatformConfig = {
  platformName: 'KaziBox',
  tagline: 'Plateforme de gestion d’entreprise unifiée et modulaire',
  logo: '/logo.png',
  icon: '/icon.png',
  defaultLanguage: 'fr',
  defaultCurrency: 'XOF',
  supportEmail: 'contact@kazibox.com',
  version: '1.0.0',
};

export default platformConfig;
