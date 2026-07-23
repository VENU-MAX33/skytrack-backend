import { Router } from 'express';
import { Driver } from '../models/Driver.js';
import { toDriverDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import type { Driver as DriverDTO } from '../types/dto.js';
import { assertPhoneAvailable, normalizePhone } from '../services/phone-login.service.js';

export const driversRouter = Router();

// Only these fields may be set through the API. Everything else the client sends
// (notably passwordHash / passwordSetAt, which are managed by the driver's own
// OTP/password flow) is ignored, so create/update cannot be used to inject them.
const DRIVER_FIELDS = [
  'name', 'gender', 'dlNumber', 'badgeNumber', 'contact', 'email', 'vendor',
  'dlEffectiveFrom', 'dlExpiry', 'address', 'aadhaar', 'pan', 'inductionDate',
  'firstVaccination', 'secondVaccination', 'pvcExpiry', 'medicalExpiry', 'active',
] as const;

function pickDriverFields(body: Partial<DriverDTO>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DRIVER_FIELDS) {
    if (body[key] !== undefined) out[key] = key === 'contact' && body[key] ? normalizePhone(String(body[key])) : body[key];
  }
  return out;
}

// A mobile number can belong to only one driver (excludeName skips the record being edited).
async function assertContactUnique(contact: string | undefined, excludeName?: string): Promise<void> {
  const c = contact?.trim();
  if (!c) return;
  const current = excludeName ? await Driver.findOne({ name: excludeName }).select('_id') : null;
  await assertPhoneAvailable('driver', c, current?._id);
}

async function prepareDriverBulk(rows: Partial<DriverDTO>[]): Promise<{
  prepared: Record<string, unknown>[];
  errors: { row: number; reasons: string[] }[];
}> {
  const dlNumbers = rows.map((row) => row.dlNumber?.trim()).filter((value): value is string => Boolean(value));
  const contacts = rows.map((row) => row.contact?.trim()).filter((value): value is string => Boolean(value));
  const existing = await Driver.find({ $or: [{ dlNumber: { $in: dlNumbers } }, { contact: { $in: contacts } }] })
    .select('name dlNumber contact')
    .lean();
  const existingDls = new Set(existing.map((driver) => driver.dlNumber.toLowerCase()));
  const existingContacts = new Map(existing.map((driver) => [driver.contact, driver.name]));
  const seenDls = new Set<string>();
  const seenContacts = new Set<string>();
  const globalContactErrors = new Map<string, string>();
  await Promise.all(contacts.map(async (contact) => {
    try { await assertPhoneAvailable('driver', contact); }
    catch (error) { globalContactErrors.set(contact, (error as Error).message); }
  }));
  const prepared: Record<string, unknown>[] = [];
  const errors: { row: number; reasons: string[] }[] = [];

  rows.forEach((body, index) => {
    const name = body.name?.trim() ?? '';
    const dlNumber = body.dlNumber?.trim() ?? '';
    const contact = body.contact?.trim() ?? '';
    const dlKey = dlNumber.toLowerCase();
    const reasons: string[] = [];
    if (!name) reasons.push('Name is required');
    if (!dlNumber) reasons.push('DL Number is required');
    if (!contact) reasons.push('Contact is required');
    if (dlNumber && seenDls.has(dlKey)) reasons.push('Duplicate DL Number in this file');
    if (contact && seenContacts.has(contact)) reasons.push('Duplicate contact in this file');
    if (dlNumber && existingDls.has(dlKey)) reasons.push(`Driver with DL ${dlNumber} already exists`);
    const contactOwner = contact ? existingContacts.get(contact) : undefined;
    if (contactOwner) reasons.push(`Contact is already registered to ${contactOwner}`);
    else if (contact && globalContactErrors.has(contact)) reasons.push(globalContactErrors.get(contact)!);
    if (dlNumber) seenDls.add(dlKey);
    if (contact) seenContacts.add(contact);
    if (reasons.length) errors.push({ row: index + 2, reasons });
    else prepared.push(pickDriverFields({ ...body, name, dlNumber, contact }));
  });
  return { prepared, errors };
}

driversRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const docs = await Driver.find().sort({ name: 1 });
    res.json(docs.map(toDriverDTO));
  })
);

// Drivers are keyed by name to match the existing frontend service signatures.
driversRouter.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const doc = await Driver.findOne({ name: req.params.name });
    if (!doc) throw new HttpError(404, 'Driver not found');
    res.json(toDriverDTO(doc));
  })
);

driversRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as DriverDTO;
    if (!body.name || !body.dlNumber) throw new HttpError(400, 'name and dlNumber are required');
    const exists = await Driver.findOne({ dlNumber: body.dlNumber });
    if (exists) throw new HttpError(409, `Driver with DL ${body.dlNumber} already exists`);
    await assertContactUnique(body.contact);
    const doc = await Driver.create(pickDriverFields(body));
    res.status(201).json(toDriverDTO(doc));
  })
);

driversRouter.post(
  '/bulk/validate',
  asyncHandler(async (req, res) => {
    const { drivers } = req.body as { drivers?: Partial<DriverDTO>[] };
    if (!Array.isArray(drivers) || drivers.length === 0) throw new HttpError(400, 'drivers array is required');
    const result = await prepareDriverBulk(drivers);
    res.json({ valid: result.errors.length === 0, total: drivers.length, errors: result.errors });
  })
);

driversRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { drivers } = req.body as { drivers?: Partial<DriverDTO>[] };
    if (!Array.isArray(drivers) || drivers.length === 0) {
      throw new HttpError(400, 'drivers array is required');
    }
    const result = await prepareDriverBulk(drivers);
    if (result.errors.length > 0) {
      res.status(422).json({ error: 'Import contains invalid drivers', created: 0, skipped: 0, failed: result.errors.length, errors: result.errors });
      return;
    }
    await Driver.insertMany(result.prepared);
    res.status(201).json({ created: result.prepared.length, skipped: 0, failed: 0, errors: [] });
  })
);

driversRouter.put(
  '/:name/active',
  asyncHandler(async (req, res) => {
    const { active } = req.body as { active: boolean };
    const doc = await Driver.findOneAndUpdate(
      { name: req.params.name },
      { active: active ? 'Yes' : 'No' },
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Driver not found');
    res.json(toDriverDTO(doc));
  })
);

driversRouter.put(
  '/:name',
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<DriverDTO>;
    await assertContactUnique(body.contact, req.params.name);
    const doc = await Driver.findOneAndUpdate({ name: req.params.name }, pickDriverFields(body), {
      new: true,
    });
    if (!doc) throw new HttpError(404, 'Driver not found');
    res.json(toDriverDTO(doc));
  })
);

driversRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const doc = await Driver.findOneAndDelete({ name: req.params.name });
    if (!doc) throw new HttpError(404, 'Driver not found');
    res.status(204).end();
  })
);
