import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { CompanyConfig } from '../models/CompanyConfig.js';
import { isValidObjectId } from 'mongoose';

export const companiesRouter = Router();

companiesRouter.post('/exit', asyncHandler(async (req, res) => {
  const token = signToken({ sub: req.auth!.sub, role: 'platform-owner' });
  res.json({ token });
}));

companiesRouter.get('/', asyncHandler(async (_req, res) => {
  const companies = await Company.find().sort({ name: 1 }).lean();
  res.json(companies.map((company) => ({
    id: company._id.toString(), code: company.code, name: company.name,
    logoBase64: company.logoBase64, address: company.address, status: company.status,
  })));
}));

companiesRouter.post('/', asyncHandler(async (req, res) => {
  const { code, name, logoBase64 = '', address = '', lat = 0, lng = 0,
    timezone = 'Asia/Kolkata', adminName, adminEmail, adminPassword } = req.body as Record<string, unknown>;
  if (!code || !name || !adminName || !adminEmail || !adminPassword) {
    throw new HttpError(400, 'Company code, name and administrator credentials are required');
  }
  if (String(adminPassword).length < 8) throw new HttpError(400, 'Administrator password must be at least 8 characters');
  const normalizedCode = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(normalizedCode)) throw new HttpError(400, 'Company code must be 2-20 letters, numbers, underscores or hyphens');
  const normalizedEmail = String(adminEmail).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new HttpError(400, 'Administrator email is invalid');
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new HttpError(400, 'Latitude must be between -90 and 90');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new HttpError(400, 'Longitude must be between -180 and 180');
  if (String(logoBase64).length > 1_000_000 || (logoBase64 && !/^data:image\/(png|jpeg|webp);base64,/i.test(String(logoBase64)))) {
    throw new HttpError(400, 'Logo must be a PNG, JPEG or WebP image smaller than 1 MB');
  }
  if (await User.exists({ email: normalizedEmail })) throw new HttpError(409, 'Administrator email already exists');

  let company;
  try {
    company = await Company.create({
      code: normalizedCode, name: String(name).trim(), logoBase64,
      address: String(address).trim(), lat: latitude, lng: longitude, timezone,
      status: 'active', createdBy: req.auth!.sub,
    });
    await CompanyConfig.create({ companyId: company._id, name: company.name, logoBase64, address,
      lat: latitude, lng: longitude, vendors: [] });
    const passwordHash = await bcrypt.hash(String(adminPassword), 12);
    await User.create({ name: String(adminName).trim(), email: normalizedEmail, passwordHash,
      role: 'admin', companyId: company._id, active: true });
  } catch (error) {
    if (company) {
      await CompanyConfig.deleteMany({ companyId: company._id });
      await Company.deleteOne({ _id: company._id });
    }
    if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'Company code already exists');
    throw error;
  }
  res.status(201).json({ id: company._id.toString(), code: company.code, name: company.name, status: company.status });
}));

companiesRouter.post('/:id/switch', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Active company not found');
  const company = await Company.findOne({ _id: req.params.id, status: 'active' });
  if (!company) throw new HttpError(404, 'Active company not found');
  const token = signToken({ sub: req.auth!.sub, role: 'platform-owner', companyId: company._id.toString() });
  res.json({ token, company: { id: company._id.toString(), code: company.code, name: company.name, logoBase64: company.logoBase64 } });
}));

companiesRouter.put('/:id/status', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Company not found');
  const status = String(req.body?.status ?? '');
  if (!['active', 'suspended', 'archived'].includes(status)) throw new HttpError(400, 'Invalid company status');
  const company = await Company.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!company) throw new HttpError(404, 'Company not found');
  res.json({ id: company._id.toString(), status: company.status });
}));
