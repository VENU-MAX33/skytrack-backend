import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface EmployeeDocumentDoc {
  employeeId: Types.ObjectId;
  name: string;
  mimeType: string;
  base64: string;
  uploadedAt: Date;
}

const employeeDocumentSchema = new Schema<EmployeeDocumentDoc>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  name: { type: String, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  base64: { type: String, required: true },
  uploadedAt: { type: Date, default: () => new Date() },
});

employeeDocumentSchema.index({ employeeId: 1 });

export const EmployeeDocument = tenantModel<EmployeeDocumentDoc>('EmployeeDocument', employeeDocumentSchema);
