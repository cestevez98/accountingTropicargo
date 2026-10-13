import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['xlsx'],
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
}

export default nextConfig
