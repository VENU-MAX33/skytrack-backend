import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Driver } from '../models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { Trip } from '../models/Trip.js';
import { signToken, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { sendOtp, verifyOtp } from '../services/otp.service.js';
import { toVehicleDTO } from '../mappers.js';
import { resolvePhoneLogins } from '../services/phone-login.service.js';
import { tenantContext } from '../tenancy/context.js';
import { env } from '../config/env.js';

export const driverAuthRouter = Router();
const ONGOING_STATUSES = ['Trip Started', 'Pickup Started', 'Drop Started'];
const SELECTION_TOKEN_AUDIENCE = 'skytrack-driver-company-selection';
const TOKEN_ISSUER = 'skytrack-backend';

interface DriverSelectionPayload extends jwt.JwtPayload {
  kind: 'driver-company-selection';
  phone: string;
}

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

async function companyChoices(logins: Awaited<ReturnType<typeof resolvePhoneLogins>>) {
  return Promise.all(logins.map(async (login) => {
    const hasOngoingTrip = Boolean(await Trip.collection.findOne({
      companyId: login.company._id,
      driverId: login.accountId,
      completedAt: null,
      status: { $in: ONGOING_STATUSES },
    }, { projection: { _id: 1 } }));
    return {
      id: login.company._id.toString(),
      code: login.company.code,
      name: login.company.name,
      hasOngoingTrip,
    };
  }));
}

async function createDriverSession(rawPhone: string, companyId: string) {
  const logins = await resolvePhoneLogins('driver', rawPhone);
  const choices = await companyChoices(logins);
  const ongoing = choices.filter((choice) => choice.hasOngoingTrip);
  if (ongoing.length > 0 && !ongoing.some((choice) => choice.id === companyId)) {
    throw new HttpError(409, `Complete your ongoing trip in ${ongoing[0].name} before switching companies`);
  }
  const login = logins.find((candidate) => candidate.company._id.toString() === companyId);
  if (!login) throw new HttpError(403, 'Driver is not registered in the selected company');
  const driver = await tenantContext.run(
    { companyId },
    () => Driver.findById(login.accountId)
  );
  if (!driver || driver.active !== 'Yes') throw new HttpError(403, 'This driver membership is inactive');
  const token = signToken({ sub: driver._id.toString(), role: 'driver', companyId }, '30d');
  return {
    token,
    user: {
      ...driverProfile(driver),
      role: 'driver' as const,
      company: { id: companyId, code: login.company.code, name: login.company.name },
      companies: choices,
    },
  };
}

// POST /api/driver/request-otp — validate phone, send OTP
driverAuthRouter.post(
  '/request-otp',
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone?: string };
    if (!phone) throw new HttpError(400, 'Phone number is required');

    const [login] = await resolvePhoneLogins('driver', phone);
    const company = login.company;
    const driver = await tenantContext.run({ companyId: company._id.toString() }, () => Driver.findById(login.accountId));
    if (!driver) throw new HttpError(404, 'Phone number not registered');
    if (driver.active !== 'Yes') throw new HttpError(403, 'This account is inactive');

    const delivery = await tenantContext.run({ companyId: company._id.toString() }, () => sendOtp({
      purpose: 'login',
      phone: driver.contact,
      driverId: driver._id,
      requestIp: req.ip,
    }));

    res.json({ sent: true, status: delivery.status, deliveryId: delivery.deliveryId });
  })
);

// POST /api/driver/verify-otp — verify OTP and issue JWT
driverAuthRouter.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body as { phone?: string; code?: string };
    if (!phone || !code) throw new HttpError(400, 'Phone and OTP code are required');

    const logins = await resolvePhoneLogins('driver', phone);
    const login = logins[0];
    const company = login.company;
    const driver = await tenantContext.run({ companyId: company._id.toString() }, () => Driver.findById(login.accountId));
    if (!driver) throw new HttpError(404, 'Phone number not registered');
    if (driver.active !== 'Yes') throw new HttpError(403, 'This account is inactive');

    await tenantContext.run({ companyId: company._id.toString() }, () => verifyOtp({
      purpose: 'login',
      phone: driver.contact,
      code,
    }));

    const selectionToken = jwt.sign(
      { kind: 'driver-company-selection', phone: login.phone },
      env.jwtSecret,
      { algorithm: 'HS256', issuer: TOKEN_ISSUER, audience: SELECTION_TOKEN_AUDIENCE, expiresIn: '10m' }
    );
    res.json({ selectionToken, companies: await companyChoices(logins) });
  })
);

// POST /api/driver/select-company — exchange a verified, short-lived login
// challenge for a JWT scoped to exactly one active company membership.
driverAuthRouter.post(
  '/select-company',
  asyncHandler(async (req, res) => {
    const { selectionToken, companyId } = req.body as { selectionToken?: string; companyId?: string };
    if (!selectionToken || !companyId) throw new HttpError(400, 'Company selection is required');
    let payload: DriverSelectionPayload;
    try {
      payload = jwt.verify(selectionToken, env.jwtSecret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: SELECTION_TOKEN_AUDIENCE,
      }) as DriverSelectionPayload;
    } catch {
      throw new HttpError(401, 'Company selection expired. Verify OTP again.');
    }
    if (payload.kind !== 'driver-company-selection' || !payload.phone) {
      throw new HttpError(401, 'Invalid company selection');
    }
    res.json(await createDriverSession(payload.phone, companyId));
  })
);

// POST /api/driver/switch-company — an authenticated driver can exchange the
// current membership for another membership belonging to the same phone.
driverAuthRouter.post(
  '/switch-company',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const { companyId } = req.body as { companyId?: string };
    if (!companyId) throw new HttpError(400, 'Company selection is required');
    const current = await Driver.findById(req.auth!.sub).select('contact active');
    if (!current || current.active !== 'Yes') throw new HttpError(401, 'Driver account is inactive');
    res.json(await createDriverSession(current.contact, companyId));
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
