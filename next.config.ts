import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['xlsx'],
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
}

export default nextConfig
