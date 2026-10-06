import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface DriverPushDeviceDoc {
  driverId: Types.ObjectId;
  token: string;
  platform: 'android';
  active: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const driverPushDeviceSchema = new Schema<DriverPushDeviceDoc>({
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
  token: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['android'], default: 'android' },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

driverPushDeviceSchema.index({ companyId: 1, token: 1 }, { unique: true });
driverPushDeviceSchema.index({ companyId: 1, driverId: 1, active: 1 });

export const DriverPushDevice = tenantModel<DriverPushDeviceDoc>('DriverPushDevice', driverPushDeviceSchema);
