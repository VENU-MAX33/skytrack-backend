import { Router } from 'express';
import { Vehicle } from '../models/Vehicle.js';
import { Driver } from '../models/Driver.js';
import { toVehicleDTO, toVehiclePositionDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import type { Vehicle as VehicleDTO } from '../types/dto.js';

export const vehiclesRouter = Router();

const VEHICLE_FIELDS = [
  'rtoNo', 'seatCount', 'model', 'taxExpiry', 'insuranceEnd', 'permitEnd', 'fcExpiry',
  'emissionExpiry', 'maintenanceDue', 'vehicleType', 'vendor', 'imei', 'billingType',
  'fuelType', 'inductionDate', 'expired', 'active',
] as const;

// The frontend sends driver as a name string; resolve it to a Driver ref.
async function fromDTO(body: Partial<VehicleDTO>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of VEHICLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  const { driver } = body;
  if (driver !== undefined) {
    const driverDoc = driver ? await Driver.findOne({ name: driver }) : null;
    out.driverId = driverDoc?._id ?? null;
  }
  return out;
}

async function prepareVehicleBulk(rows: Partial<VehicleDTO>[]): Promise<{
  prepared: Record<string, unknown>[];
  errors: { row: number; reasons: string[] }[];
}> {
  const rtoNumbers = rows.map((row) => row.rtoNo?.trim()).filter((value): value is string => Boolean(value));
  const driverNames = rows.map((row) => row.driver?.trim()).filter((value): value is string => Boolean(value));
  const [existingVehicles, drivers] = await Promise.all([
    Vehicle.find({ rtoNo: { $in: rtoNumbers } }).select('rtoNo').lean(),
    Driver.find({ name: { $in: driverNames } }).select('name').lean(),
  ]);
  const existingRtos = new Set(existingVehicles.map((vehicle) => vehicle.rtoNo.toLowerCase()));
  const driversByName = new Map(drivers.map((driver) => [driver.name.toLowerCase(), driver]));
  const seenRtos = new Set<string>();
  const prepared: Record<string, unknown>[] = [];
  const errors: { row: number; reasons: string[] }[] = [];

  rows.forEach((body, index) => {
    const rtoNo = body.rtoNo?.trim() ?? '';
    const driver = body.driver?.trim() ?? '';
    const rtoKey = rtoNo.toLowerCase();
    const reasons: string[] = [];
    if (!rtoNo) reasons.push('Vehicle RTO No is required');
    if (!driver) reasons.push('Driver is required');
    if (rtoNo && seenRtos.has(rtoKey)) reasons.push('Duplicate Vehicle RTO No in this file');
    if (rtoNo && existingRtos.has(rtoKey)) reasons.push(`Vehicle ${rtoNo} already exists`);
    const driverDoc = driver ? driversByName.get(driver.toLowerCase()) : undefined;
    if (driver && !driverDoc) reasons.push(`Driver ${driver} does not exist`);
    if (rtoNo) seenRtos.add(rtoKey);
    if (reasons.length) {
      errors.push({ row: index + 2, reasons });
      return;
    }
    const data: Record<string, unknown> = {};
    for (const key of VEHICLE_FIELDS) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    data.rtoNo = rtoNo;
    data.driverId = driverDoc!._id;
    prepared.push(data);
  });
  return { prepared, errors };
}

const STALE_MS = 30 * 60_000; // legend: "No data from past 30 min" → no-gps

// Must be declared before '/:rtoNo'
vehiclesRouter.get(
  '/positions',
  asyncHandler(async (_req, res) => {
    const docs = await Vehicle.find({ active: 'Yes' });
    const now = Date.now();
    res.json(
      docs.map((d) => {
        const dto = toVehiclePositionDTO(d);
        if (d.lastPingAt && now - d.lastPingAt.getTime() > STALE_MS) {
          dto.status = 'no-gps';
        }
        return dto;
      })
    );
  })
);

vehiclesRouter.post(
  '/bulk/validate',
  asyncHandler(async (req, res) => {
    const { vehicles } = req.body as { vehicles?: Partial<VehicleDTO>[] };
    if (!Array.isArray(vehicles) || vehicles.length === 0) throw new HttpError(400, 'vehicles array is required');
    const result = await prepareVehicleBulk(vehicles);
    res.json({ valid: result.errors.length === 0, total: vehicles.length, errors: result.errors });
  })
);

vehiclesRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { vehicles } = req.body as { vehicles?: Partial<VehicleDTO>[] };
    if (!Array.isArray(vehicles) || vehicles.length === 0) throw new HttpError(400, 'vehicles array is required');
    const result = await prepareVehicleBulk(vehicles);
    if (result.errors.length > 0) {
      res.status(422).json({ error: 'Import contains invalid vehicles', created: 0, failed: result.errors.length, errors: result.errors });
      return;
    }
    await Vehicle.insertMany(result.prepared);
    res.status(201).json({ created: result.prepared.length, failed: 0, errors: [] });
  })
);

vehiclesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const docs = await Vehicle.find().sort({ rtoNo: 1 }).populate('driverId');
    res.json(docs.map((d) => toVehicleDTO(d as Parameters<typeof toVehicleDTO>[0])));
  })
);

vehiclesRouter.get(
  '/:rtoNo',
  asyncHandler(async (req, res) => {
    const doc = await Vehicle.findOne({ rtoNo: req.params.rtoNo }).populate('driverId');
    if (!doc) throw new HttpError(404, 'Vehicle not found');
    res.json(toVehicleDTO(doc as Parameters<typeof toVehicleDTO>[0]));
  })
);

vehiclesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as VehicleDTO;
    if (!body.rtoNo) throw new HttpError(400, 'rtoNo is required');
    const exists = await Vehicle.findOne({ rtoNo: body.rtoNo });
    if (exists) throw new HttpError(409, `Vehicle ${body.rtoNo} already exists`);
    const doc = await Vehicle.create(await fromDTO(body));
    await doc.populate('driverId');
    res.status(201).json(toVehicleDTO(doc as Parameters<typeof toVehicleDTO>[0]));
  })
);

vehiclesRouter.put(
  '/:rtoNo/active',
  asyncHandler(async (req, res) => {
    const { active } = req.body as { active: boolean };
    const doc = await Vehicle.findOneAndUpdate(
      { rtoNo: req.params.rtoNo },
      { active: active ? 'Yes' : 'No' },
      { new: true }
    ).populate('driverId');
    if (!doc) throw new HttpError(404, 'Vehicle not found');
    res.json(toVehicleDTO(doc as Parameters<typeof toVehicleDTO>[0]));
  })
);

vehiclesRouter.put(
  '/:rtoNo',
  asyncHandler(async (req, res) => {
    const doc = await Vehicle.findOneAndUpdate(
      { rtoNo: req.params.rtoNo },
      await fromDTO(req.body as Partial<VehicleDTO>),
      { new: true }
    ).populate('driverId');
    if (!doc) throw new HttpError(404, 'Vehicle not found');
    res.json(toVehicleDTO(doc as Parameters<typeof toVehicleDTO>[0]));
  })
);

vehiclesRouter.delete(
  '/:rtoNo',
  asyncHandler(async (req, res) => {
    const doc = await Vehicle.findOneAndDelete({ rtoNo: req.params.rtoNo });
    if (!doc) throw new HttpError(404, 'Vehicle not found');
    res.status(204).end();
  })
);
