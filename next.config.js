/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["your-domain.com"],
    unoptimized: process.env.NODE_ENV !== "production",
  },
  // Handle any polyfills needed
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
