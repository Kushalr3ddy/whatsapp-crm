import type { NextConfig } from 'next';

/**
 * Next configuration. Deliberately almost empty: the UI is a thin client over the HTTP API,
 * so there is no database access, no rewrite layer and nothing to configure here yet.
 */
const nextConfig: NextConfig = {
  // The API key and base URL are read at request time inside server components and actions,
  // never inlined into the client bundle. Nothing here may be prefixed NEXT_PUBLIC_.
  reactStrictMode: true,
  // Server actions refuse request bodies over 1 MB by default, and the import and attachment
  // uploads go through them. Set just above the API's own limits (20 MB imports, 16 MB
  // attachments) so the API, not Next, is the one that decides what is too large.
  experimental: {
    serverActions: { bodySizeLimit: '25mb' }
  }
};

export default nextConfig;
