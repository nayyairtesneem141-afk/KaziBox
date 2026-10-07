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
};

export default nextConfig;
