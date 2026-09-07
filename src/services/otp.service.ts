import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { OTP, type OtpPurpose } from '../models/OTP.js';
import { HttpError } from '../middleware/errors.js';
import { dltTextVariable, sendCompanySms } from './sms.service.js';
import { normalizePhone } from './phone-login.service.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_SENDS_PER_TTL = 3;
const MAX_SENDS_PER_HOUR = 10;
const MAX_SENDS_PER_IP_HOUR = 30;

interface OtpContext {
  purpose: OtpPurpose;
  phone: string;
  tripId?: Types.ObjectId;
  tripReference?: string;
  employeeId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  requestIp?: string;
}

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function otpIdentity(ctx: OtpContext, phone: string) {
  return {
    purpose: ctx.purpose,
    phone,
    tripId: ctx.tripId ?? null,
    employeeId: ctx.employeeId ?? null,
  };
}

/** Creates an OTP, activates it only after provider acceptance, and never returns the code. */
export async function sendOtp(ctx: OtpContext): Promise<{ deliveryId: string; status: 'accepted' }> {
  const phone = normalizePhone(ctx.phone);
  const now = new Date();
  const identity = otpIdentity(ctx, phone);
  const successfulStates = ['pending_delivery', 'active'] as const;

  const latest = await OTP.findOne({ ...identity, deliveryStatus: { $in: successfulStates } }).sort({ createdAt: -1 });
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const seconds = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000);
    throw new HttpError(429, `Please wait ${seconds} seconds before requesting another OTP.`);
  }

  const ttlSince = new Date(now.getTime() - OTP_TTL_MS);
  const hourSince = new Date(now.getTime() - HOURLY_WINDOW_MS);
  const [recentSends, hourlySends, ipHourlySends] = await Promise.all([
    OTP.countDocuments({ ...identity, deliveryStatus: { $in: successfulStates }, createdAt: { $gte: ttlSince } }),
    OTP.countDocuments({ phone, deliveryStatus: { $in: successfulStates }, createdAt: { $gte: hourSince } }),
    ctx.requestIp
      ? OTP.countDocuments({ requestIp: ctx.requestIp, deliveryStatus: { $in: successfulStates }, createdAt: { $gte: hourSince } })
      : Promise.resolve(0),
  ]);
  if (recentSends >= MAX_SENDS_PER_TTL) throw new HttpError(429, 'Too many OTP requests. Please wait a few minutes and try again.');
  if (hourlySends >= MAX_SENDS_PER_HOUR) throw new HttpError(429, 'Hourly OTP limit reached. Please try again later.');
  if (ipHourlySends >= MAX_SENDS_PER_IP_HOUR) throw new HttpError(429, 'Too many OTP requests from this network. Please try again later.');

  const code = generateOtp();
  const otpHash = await bcrypt.hash(code, 10);
  const otp = await OTP.create({
    ...identity,
    otpHash,
    driverId: ctx.driverId ?? null,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    deliveryStatus: 'pending_delivery',
    requestIp: ctx.requestIp ?? '',
  });

  try {
    const kind = ctx.purpose === 'pickup' ? 'pickup-otp' : 'login-otp';
    const variables = ctx.purpose === 'pickup'
      ? [code, dltTextVariable([ctx.tripReference ?? ctx.tripId?.toString()])]
      : [code];
    const delivery = await sendCompanySms({
      phone,
      kind,
      variables,
      fallbackBody: ctx.purpose === 'pickup'
        ? `Your OTP is ${code} for trip ${ctx.tripReference ?? 'verification'}. Valid for 5 minutes.`
        : `Your OTP is ${code}. Valid for 5 minutes.`,
      referenceId: otp._id.toString(),
    });

    // A newer code supersedes old codes only after its SMS was accepted.
    await OTP.updateMany(
      { ...identity, _id: { $ne: otp._id }, deliveryStatus: 'active', consumed: false },
      { $set: { deliveryStatus: 'superseded' } },
    );
    otp.deliveryStatus = 'active';
    otp.acceptedAt = new Date();
    otp.smsDeliveryId = new Types.ObjectId(delivery.deliveryId);
    await otp.save();
    return { deliveryId: delivery.deliveryId, status: 'accepted' };
  } catch (error) {
    otp.deliveryStatus = 'delivery_failed';
    otp.deliveryError = error instanceof Error ? error.message.slice(0, 500) : 'SMS delivery failed';
    await otp.save();
    throw error;
  }
}

interface VerifyContext {
  purpose: OtpPurpose;
  phone: string;
  code: string;
  tripId?: Types.ObjectId;
  employeeId?: Types.ObjectId;
}

export async function verifyOtp(ctx: VerifyContext): Promise<true> {
  const phone = normalizePhone(ctx.phone);
  const doc = await OTP.findOne({
    purpose: ctx.purpose,
    phone,
    tripId: ctx.tripId ?? null,
    employeeId: ctx.employeeId ?? null,
    consumed: false,
    deliveryStatus: 'active',
  }).sort({ createdAt: -1 });

  if (!doc) throw new HttpError(400, 'No active OTP. Please request a new one.');
  if (doc.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'OTP has expired.');
  if (doc.attempts >= MAX_VERIFY_ATTEMPTS) throw new HttpError(429, 'Too many incorrect attempts. Please request a new OTP.');

  const ok = await bcrypt.compare(ctx.code, doc.otpHash);
  if (!ok) {
    doc.attempts += 1;
    await doc.save();
    throw new HttpError(400, 'Incorrect OTP.');
  }

  doc.consumed = true;
  await doc.save();
  return true;
}
