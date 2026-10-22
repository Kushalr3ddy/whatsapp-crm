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
  }
};

export default nextConfig;
