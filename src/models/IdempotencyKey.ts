import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

// Records the outcome of a non-idempotent request so a retry carrying the same
// Idempotency-Key returns the original result instead of acting twice.
export interface IdempotencyKeyDoc {
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  completed: boolean;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IdempotencyKeyDoc>({
  key: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  statusCode: { type: Number, default: 0 },
  responseBody: { type: Schema.Types.Mixed, default: null },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
});

// Keys expire after 24h — long enough to absorb client retries, short enough to
// not accumulate. (TTL index removes documents once createdAt passes the window.)
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const IdempotencyKey = tenantModel<IdempotencyKeyDoc>('IdempotencyKey', idempotencyKeySchema);
