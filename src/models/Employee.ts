import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface EmployeeDoc {
  empId: string;
  name: string;
  gender: string;
  contact: string;
  email: string;
  transportType: string;
  transportMode: string;
  distance: string;
  address: string;
  location: string;
  nodalPoint: string;
  manager: string;
  pinCode: string;
  shiftLogin: string;
  shiftLogout: string;
  fixedShift: string;
  latLong: string;
  team: string;
  specialNeed: string;
  route: string;
  active: string;
  // Auth: employee logs in with empId + password (seeded to a shared default).
  passwordHash?: string;
}

const employeeSchema = new Schema<EmployeeDoc>({
  empId: { type: String, required: true },
  name: { type: String, required: true },
  gender: { type: String, default: '' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  transportType: { type: String, default: '' },
  transportMode: { type: String, default: '' },
  distance: { type: String, default: '' },
  address: { type: String, default: '' },
  location: { type: String, default: '' },
  nodalPoint: { type: String, default: '' },
  manager: { type: String, default: '' },
  pinCode: { type: String, default: '' },
  shiftLogin: { type: String, default: '' },
  shiftLogout: { type: String, default: '' },
  fixedShift: { type: String, default: '' },
  latLong: { type: String, default: '' },
  team: { type: String, default: '' },
  specialNeed: { type: String, default: '' },
  route: { type: String, default: '' },
  active: { type: String, default: 'Yes' },
  passwordHash: { type: String, default: null },
});

employeeSchema.index({ companyId: 1, empId: 1 }, { unique: true });

export const Employee = tenantModel<EmployeeDoc>('Employee', employeeSchema);
