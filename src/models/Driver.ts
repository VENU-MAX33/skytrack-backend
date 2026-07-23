import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface DriverDoc {
  name: string;
  gender: string;
  dlNumber: string;
  badgeNumber: string;
  contact: string;
  email: string;
  vendor: string;
  dlEffectiveFrom: string;
  dlExpiry: string;
  address: string;
  aadhaar: string;
  pan: string;
  inductionDate: string;
  firstVaccination: string;
  secondVaccination: string;
  pvcExpiry: string;
  medicalExpiry: string;
  active: string;
  // Auth: driver logs in with contact (phone) + password they set themselves.
  passwordHash?: string;
  passwordSetAt?: Date;
}

const driverSchema = new Schema<DriverDoc>({
  name: { type: String, required: true, index: true },
  gender: { type: String, default: '' },
  dlNumber: { type: String, required: true },
  badgeNumber: { type: String, default: '' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  vendor: { type: String, default: '' },
  dlEffectiveFrom: { type: String, default: '' },
  dlExpiry: { type: String, default: '' },
  address: { type: String, default: '' },
  aadhaar: { type: String, default: '' },
  pan: { type: String, default: '' },
  inductionDate: { type: String, default: '' },
  firstVaccination: { type: String, default: '' },
  secondVaccination: { type: String, default: '' },
  pvcExpiry: { type: String, default: '' },
  medicalExpiry: { type: String, default: '' },
  active: { type: String, default: 'Yes' },
  passwordHash: { type: String, default: null },
  passwordSetAt: { type: Date, default: null },
});

driverSchema.index({ companyId: 1, dlNumber: 1 }, { unique: true });

export const Driver = tenantModel<DriverDoc>('Driver', driverSchema);
