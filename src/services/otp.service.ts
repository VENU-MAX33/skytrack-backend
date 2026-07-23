import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import { OTP, type OtpPurpose } from '../models/OTP.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';
import { currentCompanyBrand, formatCompanySms } from './sms.service.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_SENDS_PER_WINDOW = 3; // per (purpose, phone, trip, employee) within the TTL window

interface OtpContext {
  purpose: OtpPurpose;
  phone: string;
  tripId?: Types.ObjectId;
  employeeId?: Types.ObjectId;
  driverId?: Types.ObjectId;
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// Pluggable SMS delivery. Dev-mode logs to console; fast2sms sends real SMS; msg91 is stubbed.
async function deliverSms(phone: string, code: string, purpose: OtpPurpose): Promise<void> {
  const companyName = await currentCompanyBrand();
  const kind = purpose === 'pickup' ? 'pickup-otp' : 'login-otp';
  const message = formatCompanySms(companyName, kind, `Your OTP is ${code}. Valid for 5 minutes.`);
  if (env.smsProvider === 'fast2sms') {
    if (!env.fast2smsApiKey) {
      throw new HttpError(500, 'Fast2SMS is selected but FAST2SMS_API_KEY is not set');
    }
    // Fast2SMS wants a bare 10-digit Indian mobile number (no +91 / spaces).
    const number = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^\d{10}$/.test(number)) {
      throw new HttpError(422, `Cannot send SMS: "${phone}" is not a valid 10-digit mobile number`);
    }

    interface Fast2SmsResponse { return?: boolean; message?: unknown }
    const send = async (body: Record<string, string>): Promise<Fast2SmsResponse> => {
      try {
        const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: { authorization: env.fast2smsApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return (await res.json()) as Fast2SmsResponse;
      } catch {
        throw new HttpError(502, 'Fast2SMS request failed — check network connection and API key');
      }
    };
    const detail = (d: Fast2SmsResponse): string =>
      Array.isArray(d.message) ? d.message.join('; ') : String(d.message ?? 'unknown error');

    // The bare OTP route always sends Fast2SMS's generic wording. Use Quick SMS
    // until this company has an approved DLT template, so recipients see the
    // correct company name in the message itself.
    const data = await send({ route: 'q', message, numbers: number });
    if (!data.return) {
      throw new HttpError(502, `Fast2SMS could not send the SMS: ${detail(data)}`);
    }
    return;
  }
  if (env.smsProvider === 'msg91') {
    if (!env.msg91.authKey || !env.msg91.templateId) {
      throw new HttpError(500, 'MSG91 is selected but not configured (set MSG91_* env vars)');
    }
    // TODO: real MSG91 call. Kept as a stub so the flow is provider-ready.
    console.warn('[otp] MSG91 send not yet implemented — falling back to console log');
  }
  console.log(`\n[otp] === DEV OTP === phone=${phone} code=${code} company=${companyName}\n`);
}

/**
 * Creates an OTP record and delivers it.
 *
 * The plain code is NEVER returned to callers — it must reach the user only via
 * SMS (or, in dev mode, the server console log inside deliverSms). Returning it
 * previously let routes echo it back to the client as `devCode`, which turned
 * OTP login into a no-op for anyone who knew a registered phone number.
 */
export async function sendOtp(ctx: OtpContext): Promise<void> {
  const since = new Date(Date.now() - OTP_TTL_MS);
  const recentSends = await OTP.countDocuments({
    purpose: ctx.purpose,
    phone: ctx.phone,
    tripId: ctx.tripId ?? null,
    employeeId: ctx.employeeId ?? null,
    createdAt: { $gte: since },
  });
  if (recentSends >= MAX_SENDS_PER_WINDOW) {
    throw new HttpError(429, 'Too many OTP requests. Please wait a few minutes and try again.');
  }

  const code = generateOtp();
  const otpHash = await bcrypt.hash(code, 10);
  await OTP.create({
    purpose: ctx.purpose,
    phone: ctx.phone,
    otpHash,
    tripId: ctx.tripId ?? null,
    employeeId: ctx.employeeId ?? null,
    driverId: ctx.driverId ?? null,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await deliverSms(ctx.phone, code, ctx.purpose);
}

interface VerifyContext {
  purpose: OtpPurpose;
  phone: string;
  code: string;
  tripId?: Types.ObjectId;
  employeeId?: Types.ObjectId;
}

/** Verifies the most recent matching OTP. Throws HttpError on failure. */
export async function verifyOtp(ctx: VerifyContext): Promise<true> {
  const doc = await OTP.findOne({
    purpose: ctx.purpose,
    phone: ctx.phone,
    tripId: ctx.tripId ?? null,
    employeeId: ctx.employeeId ?? null,
    consumed: false,
  }).sort({ createdAt: -1 });

  if (!doc) throw new HttpError(400, 'No active OTP. Please request a new one.');
  if (doc.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'OTP has expired.');
  if (doc.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new HttpError(429, 'Too many incorrect attempts. Please request a new OTP.');
  }

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
