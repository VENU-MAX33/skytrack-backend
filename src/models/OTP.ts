import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type OtpPurpose = 'pickup' | 'password_reset' | 'login';

export interface OtpDoc {
  purpose: OtpPurpose;
  phone: string;
  otpHash: string;
  // Pickup-verification context (driver verifying an employee on a trip):
  tripId?: Types.ObjectId;
  employeeId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  attempts: number;
  expiresAt: Date;
  consumed: boolean;
}

const otpSchema = new Schema<OtpDoc>(
  {
    purpose: { type: String, enum: ['pickup', 'password_reset', 'login'], required: true },
    phone: { type: String, required: true, index: true },
    otpHash: { type: String, required: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// TTL index: documents are removed once expiresAt passes.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OTP = tenantModel<OtpDoc>('OTP', otpSchema);
