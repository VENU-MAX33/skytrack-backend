import { Company } from '../models/Company.js';
import { Driver } from '../models/Driver.js';
import { Employee } from '../models/Employee.js';
import { HttpError } from '../middleware/errors.js';

export function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');
  return digits;
}

function storedPhonePattern(phone: string): RegExp {
  const separatedDigits = phone.split('').join('\\D*');
  return new RegExp(`^(?:\\+?91\\D*|0)?${separatedDigits}$`);
}

type AccountType = 'employee' | 'driver';

export async function resolvePhoneLogin(accountType: AccountType, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const collection = accountType === 'employee' ? Employee.collection : Driver.collection;
  const matches = await collection.find({
    contact: storedPhonePattern(phone),
    active: { $ne: 'No' },
    companyId: { $exists: true, $ne: null },
  }).limit(2).toArray();

  if (matches.length === 0) throw new HttpError(404, 'Phone number not registered');
  if (matches.length > 1) {
    throw new HttpError(409, 'This phone number is linked to multiple companies. Contact your administrator.');
  }
  const company = await Company.findOne({ _id: matches[0].companyId, status: 'active' });
  if (!company) throw new HttpError(403, 'Company account is not active');
  return { phone, company, accountId: matches[0]._id };
}

export async function assertPhoneAvailable(accountType: AccountType, rawPhone: string, excludeId?: unknown) {
  if (!rawPhone.trim()) return;
  const phone = normalizePhone(rawPhone);
  const collection = accountType === 'employee' ? Employee.collection : Driver.collection;
  const query: Record<string, unknown> = { contact: storedPhonePattern(phone) };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await collection.findOne(query);
  if (existing) throw new HttpError(409, 'This mobile number is already registered to another account');
}
