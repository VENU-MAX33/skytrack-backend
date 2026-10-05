import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface PushDeviceDoc {
  employeeId: Types.ObjectId;
  token: string;
  platform: 'android';
  app: 'employee';
  active: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pushDeviceSchema = new Schema<PushDeviceDoc>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  token: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['android'], default: 'android' },
  app: { type: String, enum: ['employee'], default: 'employee' },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

pushDeviceSchema.index({ companyId: 1, token: 1 }, { unique: true });
pushDeviceSchema.index({ companyId: 1, employeeId: 1, active: 1 });

export const PushDevice = tenantModel<PushDeviceDoc>('PushDevice', pushDeviceSchema);
