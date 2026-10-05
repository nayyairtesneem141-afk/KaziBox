import { MetadataRoute } from 'next';
import { platformConfig } from '@/config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: platformConfig.platformName,
    short_name: platformConfig.platformName,
    description: platformConfig.tagline,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#6D28D9',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
