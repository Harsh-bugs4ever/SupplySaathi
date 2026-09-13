import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['nodemailer'],
  // Supplier product images are remote; we only ever render them in an <img> with
  // an explicit allowlist-free plain tag (no next/image optimizer) to avoid
  // fetching untrusted hosts through our own server.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
