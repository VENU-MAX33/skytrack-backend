import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type TripRequestStatus = 'submitted' | 'approved' | 'rejected' | 'confirmed';
export type TripRequestType = 'pickup' | 'drop' | 'both';

export interface TripRequestDoc {
  employeeId: Types.ObjectId;
  date: string;
  type: TripRequestType;
  loginTime: string;
  logoutTime: string;
  address: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  locationSource: 'saved' | 'custom' | 'current';
  routeName: string;
  notes: string;
  escort: string;
  status: TripRequestStatus;
  rejectionReason: string;
  tripId: string;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
}

const tripRequestSchema = new Schema<TripRequestDoc>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true },
  type: { type: String, enum: ['pickup', 'drop', 'both'], required: true },
  loginTime: { type: String, default: '' },
  logoutTime: { type: String, default: '' },
  address: { type: String, required: true, trim: true },
  formattedAddress: { type: String, default: '', trim: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  locationSource: { type: String, enum: ['saved', 'custom', 'current'], default: 'custom' },
  routeName: { type: String, default: '' },
  notes: { type: String, default: '', maxlength: 500 },
  escort: { type: String, default: 'No' },
  status: { type: String, enum: ['submitted', 'approved', 'rejected', 'confirmed'], default: 'submitted' },
  rejectionReason: { type: String, default: '' },
  tripId: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

tripRequestSchema.index({ companyId: 1, employeeId: 1, date: 1, type: 1 }, { unique: true });
tripRequestSchema.index({ companyId: 1, status: 1, date: 1 });

export const TripRequest = tenantModel<TripRequestDoc>('TripRequest', tripRequestSchema);
