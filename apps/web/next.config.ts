import type { NextConfig } from 'next';

/**
 * Next configuration. Deliberately almost empty: the UI is a thin client over the HTTP API,
 * so there is no database access, no rewrite layer and nothing to configure here yet.
 */
const nextConfig: NextConfig = {
  // The API key and base URL are read at request time inside server components and actions,
  // never inlined into the client bundle. Nothing here may be prefixed NEXT_PUBLIC_.
  reactStrictMode: true
};

export default nextConfig;
