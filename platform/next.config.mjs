/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@kazibox/ui', '@kazibox/sdk'],
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
