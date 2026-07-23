import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface VehicleDoc {
  rtoNo: string;
  seatCount: string;
  model: string;
  taxExpiry: string;
  insuranceEnd: string;
  permitEnd: string;
  fcExpiry: string;
  emissionExpiry: string;
  maintenanceDue: string;
  vehicleType: string;
  vendor: string;
  imei: string;
  driverId: Types.ObjectId | null;
  billingType: string;
  fuelType: string;
  inductionDate: string;
  expired: string;
  active: string;
  // live tracking
  lat: number;
  lng: number;
  trackStatus: string;
  speed: number;
  // phone-as-GPS: key the driver's phone must present with every position ping
  trackingKey: string;
  lastPingAt: Date | null;
}

const vehicleSchema = new Schema<VehicleDoc>({
  rtoNo: { type: String, required: true },
  seatCount: { type: String, default: '' },
  model: { type: String, default: '' },
  taxExpiry: { type: String, default: '' },
  insuranceEnd: { type: String, default: '' },
  permitEnd: { type: String, default: '' },
  fcExpiry: { type: String, default: '' },
  emissionExpiry: { type: String, default: '' },
  maintenanceDue: { type: String, default: '' },
  vehicleType: { type: String, default: '' },
  vendor: { type: String, default: '' },
  imei: { type: String, default: '' },
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
  billingType: { type: String, default: '' },
  fuelType: { type: String, default: '' },
  inductionDate: { type: String, default: '' },
  expired: { type: String, default: 'No' },
  active: { type: String, default: 'Yes' },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  trackStatus: { type: String, default: 'no-gps' },
  speed: { type: Number, default: 0 },
  trackingKey: { type: String, default: '' },
  lastPingAt: { type: Date, default: null },
});

vehicleSchema.index({ companyId: 1, rtoNo: 1 }, { unique: true });

export const Vehicle = tenantModel<VehicleDoc>('Vehicle', vehicleSchema);
