import type { Metadata, Viewport } from 'next';
import './globals.css';
import { platformConfig } from '@/config';
import { I18nProvider } from '@/lib/i18n';
import { PwaProvider } from '@/lib/pwa';
import { PwaBanners } from './components/PwaBanners';

export const metadata: Metadata = {
  title: {
    default: platformConfig.platformName,
    template: `%s | ${platformConfig.platformName}`,
  },
  description: platformConfig.tagline,
  applicationName: platformConfig.platformName,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: platformConfig.platformName,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#6D28D9',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body className="min-h-screen bg-white text-[#1F2937] antialiased selection:bg-[#F3E8FF] selection:text-[#6D28D9]">
        <I18nProvider>
          <PwaProvider>
            <PwaBanners />
            {children}
          </PwaProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
