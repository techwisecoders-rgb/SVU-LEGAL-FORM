import type {NextApiRequest, NextApiResponse} from 'next';
import app from '../../src/api/index.js';

// One project, one domain: Next.js owns the website and this catch-all routes /api/*
// to the existing Express API. Disable Next's parser so Express can handle JSON,
// multipart uploads and raw Razorpay webhook bodies itself.
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
  maxDuration: 60,
};

export default function apiHandler(req: NextApiRequest, res: NextApiResponse) {
  return app(req as never, res as never);
}
