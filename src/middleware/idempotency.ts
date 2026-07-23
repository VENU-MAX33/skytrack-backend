import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { IdempotencyKey } from '../models/IdempotencyKey.js';
import crypto from 'crypto';

const PENDING_LEASE_MS = 2 * 60 * 1000;

/**
 * Optional idempotency for non-idempotent POSTs. When a request carries an
 * `Idempotency-Key` header, the first request reserves the key (a unique index
 * makes the reservation atomic, so concurrent duplicates can't both proceed) and
 * its response is recorded; any later request with the same key replays that
 * stored response instead of running the handler again. Requests without the
 * header behave exactly as before.
 */
export function idempotent(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.header('Idempotency-Key');
    if (!rawKey) {
      next();
      return;
    }
    const companyId = req.auth?.companyId ?? 'platform';
    const key = `${companyId}:${req.method}:${req.baseUrl}${req.path}:${rawKey}`;
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

    // Reserve the key. A duplicate-key error means we've seen it before.
    try {
      await IdempotencyKey.create({ key, requestHash });
    } catch {
      const existing = await IdempotencyKey.findOne({ key });
      if (existing && existing.requestHash !== requestHash) {
        res.status(422).json({ error: 'Idempotency-Key was already used with a different request body' });
        return;
      }
      if (existing?.completed) {
        res.status(existing.statusCode).json(existing.responseBody);
      } else if (existing && Date.now() - existing.createdAt.getTime() > PENDING_LEASE_MS) {
        const reclaimed = await IdempotencyKey.findOneAndUpdate(
          { _id: existing._id, completed: false, createdAt: existing.createdAt },
          { requestHash, createdAt: new Date() },
          { new: true }
        );
        if (reclaimed) {
          installResponseCapture(res, key);
          next();
          return;
        }
        res.setHeader('Retry-After', '2');
        res.status(425).json({ error: 'The original request is still being processed' });
      } else {
        res.setHeader('Retry-After', '2');
        res.status(425).json({ error: 'The original request is still being processed' });
      }
      return;
    }

    installResponseCapture(res, key);
    next();
  };
}

function installResponseCapture(res: Response, key: string): void {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    // The result is durable before the response is sent, eliminating the retry
    // window where a successful response still looked "pending".
    void IdempotencyKey.updateOne(
      { key },
      { statusCode: res.statusCode, responseBody: body, completed: true }
    ).then(() => originalJson(body)).catch((error) => {
      console.error(`[idempotency] Could not persist response: ${(error as Error).message}`);
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Could not safely complete request' }));
      }
    });
    return res;
  };
}
