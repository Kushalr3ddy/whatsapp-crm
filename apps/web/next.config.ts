import type { NextConfig } from 'next';

/**
 * Next configuration. Deliberately almost empty: the UI is a thin client over the HTTP API,
 * so there is no database access, no rewrite layer and nothing to configure here yet.
 */
const nextConfig: NextConfig = {
  // The API key and base URL are read at request time inside server components and actions,
  // never inlined into the client bundle. Nothing here may be prefixed NEXT_PUBLIC_.
  reactStrictMode: true,
  // `next start` gzips its own responses, and in this app the gzip stream of a server action that ends in
  // `redirect()` never finishes: the browser keeps the button on "Creating…" / "Counting…" and never follows
  // the redirect (measured 2026-10-22: stuck for 30 s+ with compression, 0.3 s without). Compression belongs
  // in the reverse proxy in front of the app (Caddy, nginx, the host's edge), which does it without this hang.
  compress: false,
  // Server actions refuse request bodies over 1 MB by default, and the import and attachment
  // uploads go through them. Set just above the API's own limits (20 MB imports, 16 MB
  // attachments) so the API, not Next, is the one that decides what is too large.
  experimental: {
    serverActions: { bodySizeLimit: '25mb' }
  },
  // Headers on every page and file (R-040). No Content-Security-Policy yet: a policy that works with Next's own inline scripts needs
  // a per-request nonce, and a wrong one blanks the app. `frame-ancestors` gives the part that stops the app being framed.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
      ]
    }];
  }
};

export default nextConfig;
