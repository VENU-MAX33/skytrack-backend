import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteDoc {
  routeId: number;
  name: string;
  type: string;
  destinationAddress: string;
  destLat: number | null;
  destLng: number | null;
  dropPath: RoutePoint[];
  pickupPath: RoutePoint[];
  geometryStatus: 'pending' | 'ready' | 'error';
  geometryProvider: string;
  geometryUpdatedAt: Date | null;
  geometryError: string;
}

const routePointSchema = new Schema<RoutePoint>({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
}, { _id: false });

const routeSchema = new Schema<RouteDoc>({
  routeId: { type: Number, required: true },
  name: { type: String, required: true },
  type: { type: String, default: 'Both' },
  destinationAddress: { type: String, default: '' },
  destLat: { type: Number, default: null },
  destLng: { type: Number, default: null },
  dropPath: { type: [routePointSchema], default: [] },
  pickupPath: { type: [routePointSchema], default: [] },
  geometryStatus: { type: String, enum: ['pending', 'ready', 'error'], default: 'pending' },
  geometryProvider: { type: String, default: '' },
  geometryUpdatedAt: { type: Date, default: null },
  geometryError: { type: String, default: '' },
});

routeSchema.index({ companyId: 1, routeId: 1 }, { unique: true });
routeSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const Route = tenantModel<RouteDoc>('Route', routeSchema);
