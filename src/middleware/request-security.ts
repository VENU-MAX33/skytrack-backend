import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function findUnsafeKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const pending: unknown[] = [value];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key)) return key;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return null;
}

/** Reject MongoDB operators and prototype-pollution keys before route handling. */
export function rejectUnsafeInput(req: Request, _res: Response, next: NextFunction): void {
  const unsafeKey = findUnsafeKey(req.body);
  if (unsafeKey) throw new HttpError(400, 'Request contains a forbidden field name');
  next();
}

/** All mutating API requests use JSON; this also forces browser CORS preflight. */
export function requireJsonMutation(req: Request, _res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  next();
}
