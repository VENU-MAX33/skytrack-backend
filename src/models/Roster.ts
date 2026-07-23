import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface RosterDoc {
  employeeId: Types.ObjectId;
  date: string;
  tripType: string; // 'pickup' | 'drop'
  timing: string;
  rosterType: string;
  status: string; // 'pending' | 'approved' | 'completed'
}

const rosterSchema = new Schema<RosterDoc>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true, index: true },
  tripType: { type: String, enum: ['pickup', 'drop'], default: 'pickup' },
  timing: { type: String, default: '' },
  rosterType: { type: String, default: 'Regular' },
  status: { type: String, enum: ['pending', 'approved', 'completed'], default: 'pending', index: true },
});

rosterSchema.index(
  { companyId: 1, employeeId: 1, date: 1, tripType: 1 },
  { unique: true, name: 'unique_employee_roster_per_trip_type' }
);

export const Roster = tenantModel<RosterDoc>('Roster', rosterSchema);
