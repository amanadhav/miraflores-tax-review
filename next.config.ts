import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen depends on the session cookie and the database, so the
  // classic dynamic-rendering model is the right fit. Cache Components would
  // force Suspense boundaries around every read without any benefit here.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The packet is read from disk at import time (byte-identical, hashed), so
  // the file must travel with the server bundle on serverless hosts.
  outputFileTracingIncludes: {
    "/**": ["./data/packet.json"],
  },
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
