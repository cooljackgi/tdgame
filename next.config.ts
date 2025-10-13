
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
    ],
  },
  // Diese Regel leitet WebSocket-Anfragen im Entwicklungsmodus um.
  // Sie ist entscheidend, damit WebRTC-Signaling lokal funktioniert.
  async rewrites() {
    return [
      {
        source: '/ws',
        destination: 'http://localhost:8080/ws',
      },
    ]
  },
};

export default nextConfig;
