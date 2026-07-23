import { Router } from 'express';
import { Driver } from '../models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { signToken, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { sendOtp, verifyOtp } from '../services/otp.service.js';
import { toVehicleDTO } from '../mappers.js';
import { resolvePhoneLogin } from '../services/phone-login.service.js';
import { tenantContext } from '../tenancy/context.js';

export const driverAuthRouter = Router();

function driverProfile(driver: {
  name: string;
  contact: string;
  vendor: string;
  email: string;
  badgeNumber: string;
  dlNumber: string;
}) {
  return {
    name: driver.name,
    contact: driver.contact,
    vendor: driver.vendor,
    email: driver.email,
    badgeNumber: driver.badgeNumber,
    dlNumber: driver.dlNumber,
  };
}

// POST /api/driver/request-otp — validate phone, send OTP
driverAuthRouter.post(
  '/request-otp',
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone?: string };
    if (!phone) throw new HttpError(400, 'Phone number is required');

    const login = await resolvePhoneLogin('driver', phone);
    const company = login.company;
    const driver = await tenantContext.run({ companyId: company._id.toString() }, () => Driver.findById(login.accountId));
    if (!driver) throw new HttpError(404, 'Phone number not registered');
    if (driver.active !== 'Yes') throw new HttpError(403, 'This account is inactive');

    await tenantContext.run({ companyId: company._id.toString() }, () => sendOtp({
      purpose: 'login',
      phone: driver.contact,
      driverId: driver._id,
    }));

    res.json({ sent: true }); // the OTP is delivered by SMS only, never in the response
  })
);

// POST /api/driver/verify-otp — verify OTP and issue JWT
driverAuthRouter.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body as { phone?: string; code?: string };
    if (!phone || !code) throw new HttpError(400, 'Phone and OTP code are required');

    const login = await resolvePhoneLogin('driver', phone);
    const company = login.company;
    const driver = await tenantContext.run({ companyId: company._id.toString() }, () => Driver.findById(login.accountId));
    if (!driver) throw new HttpError(404, 'Phone number not registered');
    if (driver.active !== 'Yes') throw new HttpError(403, 'This account is inactive');

    await tenantContext.run({ companyId: company._id.toString() }, () => verifyOtp({
      purpose: 'login',
      phone: driver.contact,
      code,
    }));

    const token = signToken({ sub: driver._id.toString(), role: 'driver', companyId: company._id.toString() }, '30d');
    res.json({ token, user: { ...driverProfile(driver), role: 'driver', company: { code: company.code, name: company.name } } });
  })
);

// GET /api/driver/me — profile + assigned vehicle (driver role required)
driverAuthRouter.get(
  '/me',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const driver = await Driver.findById(req.auth!.sub);
    if (!driver) throw new HttpError(404, 'Driver not found');

    const vehicle = await Vehicle.findOne({ driverId: driver._id }).populate('driverId');
    res.json({
      ...driverProfile(driver),
      vehicle: vehicle ? toVehicleDTO(vehicle as unknown as Parameters<typeof toVehicleDTO>[0]) : null,
    });
  })
);
