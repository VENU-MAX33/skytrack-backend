import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type LocationRequestStatus = 'pending' | 'shared' | 'expired';

export interface LocationRequestDoc {
  tripId: Types.ObjectId;
  driverId: Types.ObjectId;
  employeeId: Types.ObjectId;
  status: LocationRequestStatus;
  requestedAt: Date;
  expiresAt?: Date;
  sharedAt?: Date;
  sharedLat?: number;
  sharedLng?: number;
  driverViewedAt?: Date;
  smsSentAt?: Date;
  smsError: string;
}

const locationRequestSchema = new Schema<LocationRequestDoc>({
  tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  status: { type: String, enum: ['pending', 'shared', 'expired'], default: 'pending', index: true },
  requestedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null, index: true },
  sharedAt: { type: Date, default: null },
  sharedLat: { type: Number, min: -90, max: 90, default: null },
  sharedLng: { type: Number, min: -180, max: 180, default: null },
  driverViewedAt: { type: Date, default: null },
  smsSentAt: { type: Date, default: null },
  smsError: { type: String, default: '' },
}, { timestamps: true });

locationRequestSchema.index({ companyId: 1, tripId: 1, employeeId: 1, status: 1, requestedAt: -1 });

export const LocationRequest = tenantModel<LocationRequestDoc>('LocationRequest', locationRequestSchema);
