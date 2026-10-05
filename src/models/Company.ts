import { Schema, model } from 'mongoose';

export type CompanyStatus = 'active' | 'suspended' | 'archived';

export interface CompanyDoc {
  code: string;
  name: string;
  logoBase64: string;
  address: string;
  lat: number;
  lng: number;
  vendors: string[];
  timezone: string;
  /** DLT-approved sender ID and message templates. Managed by the platform owner only. */
  smsEntityId: string;
  smsSenderId: string;
  smsTemplates: {
    loginOtp: string;
    pickupOtp: string;
    sos: string;
    tripDriver: string;
    tripEmployee: string;
    tripEmployeeApproved: string;
    tripEmployeeRejected: string;
    locationRequest: string;
    otpEscalation: string;
  };
  status: CompanyStatus;
  createdBy?: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<CompanyDoc>({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  logoBase64: { type: String, default: '' },
  address: { type: String, default: '' },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  vendors: { type: [String], default: [] },
  timezone: { type: String, default: 'Asia/Kolkata' },
  smsEntityId: { type: String, default: '', trim: true },
  smsSenderId: { type: String, default: '', trim: true, uppercase: true },
  smsTemplates: {
    loginOtp: { type: String, default: '' },
    pickupOtp: { type: String, default: '' },
    sos: { type: String, default: '' },
    tripDriver: { type: String, default: '' },
    tripEmployee: { type: String, default: '' },
    tripEmployeeApproved: { type: String, default: '' },
    tripEmployeeRejected: { type: String, default: '' },
    locationRequest: { type: String, default: '' },
    otpEscalation: { type: String, default: '' },
  },
  status: { type: String, enum: ['active', 'suspended', 'archived'], default: 'active', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export const Company = model<CompanyDoc>('Company', companySchema);
