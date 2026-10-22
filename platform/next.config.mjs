/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@kazibox/ui', '@kazibox/sdk'],
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: false,
  },
  async rewrites() {
    return [
      {
        source: '/api/webhooks/moteur',
        destination: '/api/v1/webhooks/moteur',
      },
    ];
  },
};

export default nextConfig;
