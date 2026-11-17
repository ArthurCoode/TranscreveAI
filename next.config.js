/** @type {import('next').NextConfig} */

// Cabeçalhos de segurança aplicados a todas as respostas.
// Uma Content-Security-Policy completa ainda não é possível porque as
// páginas usam scripts inline e handlers onclick — ver README.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(self)' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig = {
  poweredByHeader: false,
  // o projeto não usa next/image; desligar remove o endpoint /_next/image
  images: { unoptimized: true },
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/landing.html',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
