/**
 * One codebase, two deployments.
 *
 *   API host (Render)  — API_ORIGIN unset. Next serves its own /api routes,
 *                        which read the SQLite file the worker shares.
 *   UI host  (Vercel)  — API_ORIGIN set to the Render URL. Every /api request
 *                        is rewritten there before Next's own routes are
 *                        considered, so the copies bundled into this build are
 *                        never reached.
 *
 * Written as .mjs rather than .ts on purpose: `next start` parses this file at
 * runtime, and a .ts config would require TypeScript to stay installed in the
 * production image purely to read fifteen lines of configuration.
 *
 * `beforeFiles` is doing the load-bearing work: it runs ahead of the filesystem
 * and page routes. An ordinary `rewrites` entry (or one in vercel.json) is
 * checked only *after* a matching route is found, so Vercel would run its own
 * /api/cases, reach for a database that is not there, and fail.
 */
const API_ORIGIN = (process.env.API_ORIGIN ?? '').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['nodemailer'],
  // Supplier product images are remote; we only ever render them in an <img> with
  // an explicit allowlist-free plain tag (no next/image optimizer) to avoid
  // fetching untrusted hosts through our own server.
  eslint: { ignoreDuringBuilds: true },

  async rewrites() {
    if (!API_ORIGIN) return [];
    return {
      beforeFiles: [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
