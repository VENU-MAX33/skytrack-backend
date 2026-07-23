import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type EscortReportStatus = 'open' | 'acknowledged';

export interface EscortReportDoc {
  employeeId: Types.ObjectId;
  tripId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  present: string; // 'Yes' | 'No' — did the employee see an escort
  escortName: string;
  employeeName: string;   // denormalized for admin display
  employeeContact: string;
  status: EscortReportStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

const escortReportSchema = new Schema<EscortReportDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    present: { type: String, enum: ['Yes', 'No'], default: 'No' },
    escortName: { type: String, default: '' },
    employeeName: { type: String, default: '' },
    employeeContact: { type: String, default: '' },
    status: { type: String, enum: ['open', 'acknowledged'], default: 'open' },
    acknowledgedBy: { type: String, default: '' },
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

escortReportSchema.index({ status: 1, createdAt: -1 });

export const EscortReport = tenantModel<EscortReportDoc>('EscortReport', escortReportSchema);
