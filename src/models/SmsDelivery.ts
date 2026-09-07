import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type SmsDeliveryStatus = 'pending' | 'accepted' | 'delivered' | 'failed' | 'unknown';

export interface SmsDeliveryDoc {
  kind: string;
  recipient: string;
  provider: 'dev' | 'fast2sms' | 'msg91';
  route: 'dev' | 'quick' | 'dlt' | 'msg91';
  entityId: string;
  senderId: string;
  templateId: string;
  requestId: string;
  referenceId: string;
  status: SmsDeliveryStatus;
  smsCount?: number;
  amountDebited?: number;
  failureReason: string;
  attempt: number;
  acceptedAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const smsDeliverySchema = new Schema<SmsDeliveryDoc>({
  kind: { type: String, required: true, index: true },
  recipient: { type: String, required: true, index: true },
  provider: { type: String, enum: ['dev', 'fast2sms', 'msg91'], required: true },
  route: { type: String, enum: ['dev', 'quick', 'dlt', 'msg91'], required: true },
  entityId: { type: String, default: '' },
  senderId: { type: String, default: '' },
  templateId: { type: String, default: '' },
  requestId: { type: String, default: '', index: true },
  referenceId: { type: String, default: '', index: true },
  status: { type: String, enum: ['pending', 'accepted', 'delivered', 'failed', 'unknown'], default: 'pending', index: true },
  smsCount: { type: Number, min: 0, default: null },
  amountDebited: { type: Number, min: 0, default: null },
  failureReason: { type: String, default: '' },
  attempt: { type: Number, min: 1, default: 1 },
  acceptedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
}, { timestamps: true });

smsDeliverySchema.index({ companyId: 1, requestId: 1 }, { sparse: true });
smsDeliverySchema.index({ companyId: 1, referenceId: 1, kind: 1, createdAt: -1 });

export const SmsDelivery = tenantModel<SmsDeliveryDoc>('SmsDelivery', smsDeliverySchema);
