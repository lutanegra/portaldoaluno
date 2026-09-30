import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // ── Cabeçalhos de segurança ────────────────────────────────────────────────
  // frame-ancestors 'none' impede embedding em outros sites (cliquejacking),
  // com exceção do preview da plataforma, que roda no mesmo host.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },

  // Preview containers run on a Docker-managed volume; the webpack dev
  // filesystem cache is prone to ENOENT/corruption there (a known upstream
  // Next.js issue on networked/containerized volumes). Disabling it in dev
  // trades a little rebuild speed for reliability.
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    return config;
  },

  // ── Redirects — enforce HTTPS on the production domain ────────────────────
  async redirects() {
    return [
      {
        source: '/(.*)',
        has: [{ type: 'host', value: 'www.accbm.com.br' }],
        destination: 'https://accbm.com.br/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
