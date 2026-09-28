/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  // Add any external image hostname here the moment you reference it via
  // next/image (e.g. { hostname: 'images.unsplash.com' }) — next/image
  // throws a hard runtime error on unconfigured hosts otherwise.
  images: {
    remotePatterns: [],
  },
  // Preview containers run on a Docker-managed volume; the webpack dev
  // filesystem cache is prone to ENOENT/corruption there (a known upstream
  // Next.js issue on networked/containerized volumes). Disabling it in dev
  // trades a little rebuild speed for reliability, which matters more for
  // short-lived preview containers than for a long-running local dev setup.
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
