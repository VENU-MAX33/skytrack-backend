import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type EmployeeNotificationType = 'trip-approved' | 'trip-rejected' | 'info';

export interface EmployeeNotificationDoc {
  employeeId: Types.ObjectId;
  type: EmployeeNotificationType;
  title: string;
  body: string;
  link: string;
  refId: string;
  read: boolean;
  createdAt: Date;
}

const employeeNotificationSchema = new Schema<EmployeeNotificationDoc>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  type: { type: String, enum: ['trip-approved', 'trip-rejected', 'info'], required: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true, trim: true },
  link: { type: String, default: '/' },
  refId: { type: String, default: '' },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

employeeNotificationSchema.index({ companyId: 1, employeeId: 1, createdAt: -1 });

export const EmployeeNotification = tenantModel<EmployeeNotificationDoc>('EmployeeNotification', employeeNotificationSchema);
