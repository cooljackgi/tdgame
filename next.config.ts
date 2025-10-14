import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
       {
        protocol: 'https',
        hostname: 'i.pravatar.cc',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Die rewrite-Regel wird nur für die lokale Entwicklung benötigt und
  // wird jetzt nur in diesem Modus angewendet.
  async rewrites() {
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/ws',
          destination: 'http://localhost:8080/ws',
        },
      ]
    }
    return [];
  },
};

export default nextConfig;
