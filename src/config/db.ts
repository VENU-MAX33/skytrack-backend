import mongoose from 'mongoose';
import { env } from './env.js';

const RETRY_MS = 15_000;

/**
 * Connect to MongoDB, retrying forever instead of exiting. The dev Atlas
 * cluster regularly rejects us when the ISP rotates the public IP (whitelist)
 * or the mobile link blips — once the whitelist/network recovers, the server
 * comes up on its own without a manual restart.
 */
export async function connectDb(): Promise<void> {
  const safeTarget = (() => {
    try {
      const parsed = new URL(env.mongodbUri);
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
    } catch {
      return 'configured MongoDB server';
    }
  })();
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5000 });
      console.log(`MongoDB connected: ${safeTarget}`);
      return;
    } catch (err) {
      if (attempt === 1) {
        console.error(
          [
            '',
            `Could not connect to MongoDB at ${safeTarget}`,
            '',
            'Common causes:',
            '  1. MongoDB Atlas IP whitelist does not include your current public IP',
            '     (fix once: Network Access → "Allow access from anywhere" / 0.0.0.0/0).',
            '  2. Local MongoDB not running / wrong MONGODB_URI in backend/.env.',
            '  3. Flaky network link to Atlas.',
            '',
            `Underlying error: ${(err as Error).message}`,
          ].join('\n')
        );
      }
      console.error(`MongoDB connect attempt ${attempt} failed — retrying in ${RETRY_MS / 1000}s…`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}
