import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  // Keep Node-oriented API packages in the Node.js function runtime.
  serverExternalPackages: ['express', 'cors', 'helmet', 'multer', 'nodemailer', 'pg', '@prisma/adapter-pg'],
};

export default config;
