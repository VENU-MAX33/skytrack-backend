import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';
import { TRIP_STATUSES } from '../lib/statusBuckets.js';

export interface TripDoc {
  tripId: string;
  status: string;
  type: string;
  date: string;
  escort: string;
  escortName: string;
  shiftTime: string;
  vehicleId: Types.ObjectId;
  driverId: Types.ObjectId;
  routeId: Types.ObjectId;
  employeeIds: Types.ObjectId[];
  vendor: string; // denormalized from vehicle at creation
  location: string;
  frozen: boolean;
  // Employees OTP-verified by the driver at pickup/drop:
  verifiedEmployees: Types.ObjectId[];
  startedAt?: Date;
  completedAt?: Date;
  // Operational-alert bookkeeping. These are independent so an overdue admin
  // notification never suppresses the separate incomplete-OTP SMS escalation.
  overdueNotifiedAt?: Date;
  incompleteOtpSmsSentAt?: Date;
  incompleteOtpSmsClaimedAt?: Date;
  driverSmsSentAt?: Date;
  driverSmsError?: string;
  reassignmentHistory: {
    at: Date;
    by: Types.ObjectId;
    reason: string;
    oldVehicleId: Types.ObjectId;
    newVehicleId: Types.ObjectId;
    oldDriverId?: Types.ObjectId;
    newDriverId?: Types.ObjectId;
  }[];
  // Planned schedule. `shiftTime` remains the roster deadline; these absolute
  // timestamps make cross-midnight trips and live ETA updates unambiguous.
  shiftDeadlineAt?: Date;
  scheduledStartAt?: Date;
  driverReportAt?: Date;
  scheduledEndAt?: Date;
  scheduleMode: 'auto' | 'manual';
  scheduleCalculatedAt?: Date;
  etaUpdatedAt?: Date;
  scheduleDistanceMeters: number;
  scheduleDurationSeconds: number;
  scheduleTrafficModel: string;
  scheduleStops: {
    employeeId: Types.ObjectId;
    sequence: number;
    plannedAt: Date;
    liveEtaAt?: Date;
    distanceMeters: number;
    durationSeconds: number;
  }[];
}

const scheduleStopSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    sequence: { type: Number, required: true },
    plannedAt: { type: Date, required: true },
    liveEtaAt: { type: Date, default: null },
    distanceMeters: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false }
);

const tripSchema = new Schema<TripDoc>({
  tripId: { type: String, required: true },
  status: { type: String, enum: TRIP_STATUSES, default: 'Not Started Yet', index: true },
  type: { type: String, enum: ['PickUp', 'Drop'], required: true },
  date: { type: String, required: true, index: true },
  escort: { type: String, default: 'No' },
  escortName: { type: String, default: '' },
  shiftTime: { type: String, default: '' },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  routeId: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
  employeeIds: {
    type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    required: true,
    validate: [(v: unknown[]) => v.length > 0, 'Trip needs at least one employee'],
  },
  vendor: { type: String, default: '' },
  location: { type: String, default: '' },
  frozen: { type: Boolean, default: false },
  verifiedEmployees: {
    type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    default: [],
  },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  overdueNotifiedAt: { type: Date, default: null },
  incompleteOtpSmsSentAt: { type: Date, default: null },
  incompleteOtpSmsClaimedAt: { type: Date, default: null },
  driverSmsSentAt: { type: Date, default: null },
  driverSmsError: { type: String, default: '' },
  reassignmentHistory: { type: [{
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: 'vehicle-reassignment' },
    oldVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    newVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    oldDriverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    newDriverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
  }], default: [] },
  shiftDeadlineAt: { type: Date, default: null },
  scheduledStartAt: { type: Date, default: null },
  driverReportAt: { type: Date, default: null },
  scheduledEndAt: { type: Date, default: null },
  scheduleMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  scheduleCalculatedAt: { type: Date, default: null },
  etaUpdatedAt: { type: Date, default: null },
  scheduleDistanceMeters: { type: Number, default: 0 },
  scheduleDurationSeconds: { type: Number, default: 0 },
  scheduleTrafficModel: { type: String, default: '' },
  scheduleStops: { type: [scheduleStopSchema], default: [] },
});

tripSchema.index({ companyId: 1, tripId: 1 }, { unique: true });

export const Trip = tenantModel<TripDoc>('Trip', tripSchema);
