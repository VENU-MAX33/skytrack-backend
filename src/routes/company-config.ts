import { Router } from 'express';
import { CompanyConfig, type CompanyConfigDoc } from '../models/CompanyConfig.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { Route } from '../models/Route.js';
import { rebuildAllRouteGeometries } from '../services/route-geometry.service.js';
import { Company } from '../models/Company.js';

export const companyConfigRouter = Router();

function toDTO(doc: Partial<CompanyConfigDoc> | null) {
  return {
    name: doc?.name ?? '',
    address: doc?.address ?? '',
    lat: doc?.lat ?? 0,
    lng: doc?.lng ?? 0,
    logoBase64: doc?.logoBase64 ?? '',
    vendors: doc?.vendors ?? [],
  };
}

companyConfigRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const doc = await CompanyConfig.findOne();
    res.json(toDTO(doc));
  })
);

companyConfigRouter.put(
  '/',
  requirePermission((role) => role === 'admin' || role === 'platform-owner'),
  asyncHandler(async (req, res) => {
    const { name, address, lat, lng, logoBase64, vendors } = req.body as Partial<CompanyConfigDoc>;
    if (lat !== undefined && (!Number.isFinite(lat) || Math.abs(lat) > 90)) {
      throw new HttpError(400, 'latitude must be between -90 and 90');
    }
    if (lng !== undefined && (!Number.isFinite(lng) || Math.abs(lng) > 180)) {
      throw new HttpError(400, 'longitude must be between -180 and 180');
    }
    const existing = await CompanyConfig.findOne().lean();
    const coordinatesChanged = (lat !== undefined && lat !== existing?.lat)
      || (lng !== undefined && lng !== existing?.lng);
    // Only overwrite fields the caller actually sent, so a save from one screen
    // (e.g. RouteForm's location card) never wipes the logo or vendor list.
    const update: Partial<CompanyConfigDoc> = {};
    if (name !== undefined) update.name = name;
    if (address !== undefined) update.address = address;
    if (lat !== undefined) update.lat = lat;
    if (lng !== undefined) update.lng = lng;
    if (logoBase64 !== undefined) update.logoBase64 = logoBase64;
    if (vendors !== undefined) {
      update.vendors = [...new Set(vendors.map((v) => String(v).trim()).filter(Boolean))];
    }
    const doc = await CompanyConfig.findOneAndUpdate({}, update, { new: true, upsert: true });
    await Company.updateOne({ _id: req.auth!.companyId }, update);
    if (coordinatesChanged) {
      await Route.updateMany({}, { geometryStatus: 'pending', geometryError: '' });
    }
    res.json(toDTO(doc));
    if (coordinatesChanged) {
      void rebuildAllRouteGeometries().catch((error) => {
        console.error(`[route-geometry] company-location rebuild failed: ${(error as Error).message}`);
      });
    }
  })
);
