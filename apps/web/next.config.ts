import type { NextConfig } from 'next';
import {config as loadDotEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
// The documented .env file lives at the monorepo root, while Next.js runs with apps/web as its project directory.
loadDotEnv({path: fileURLToPath(new URL('../../.env', import.meta.url))});
const config: NextConfig = { poweredByHeader: false, images: { remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }] } };
export default config;
