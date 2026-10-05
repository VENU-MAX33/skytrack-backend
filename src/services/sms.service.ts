import { env } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';
import { Company } from '../models/Company.js';
import { SmsDelivery, type SmsDeliveryStatus } from '../models/SmsDelivery.js';
import { currentCompanyId } from '../tenancy/context.js';
import { normalizePhone } from './phone-login.service.js';

export type CompanySmsKind =
  | 'login-otp'
  | 'pickup-otp'
  | 'sos'
  | 'trip-driver'
  | 'trip-employee'
  | 'trip-employee-rejected'
  | 'location-request'
  | 'otp-escalation';

export interface SmsDeliveryResult {
  accepted: boolean;
  provider: 'dev' | 'fast2sms' | 'msg91';
  status: SmsDeliveryStatus;
  deliveryId: string;
  requestId?: string;
  smsCount?: number;
  amountDebited?: number;
}

export interface CompanySmsInput {
  phone: string;
  kind: CompanySmsKind;
  /** Ordered values matching {#var#} positions in the approved DLT template. */
  variables: string[];
  /** Temporary Quick/dev text. DLT mode never sends this free-form text. */
  fallbackBody: string;
  referenceId?: string;
  companyName?: string;
  retryPolicy?: {
    /** Block duplicates while an earlier request may already be delivered. */
    dedupeUncertain: boolean;
    maxAttempts: number;
    baseDelayMs: number;
  };
}

type SmsTemplateKey = 'loginOtp' | 'pickupOtp' | 'sos' | 'tripDriver' | 'tripEmployee' | 'tripEmployeeApproved' | 'tripEmployeeRejected' | 'locationRequest' | 'otpEscalation';
const TEMPLATE_KEYS: Record<CompanySmsKind, SmsTemplateKey> = {
  'login-otp': 'loginOtp',
  'pickup-otp': 'pickupOtp',
  sos: 'sos',
  'trip-driver': 'tripDriver',
  'trip-employee': 'tripEmployeeApproved',
  'trip-employee-rejected': 'tripEmployeeRejected',
  'location-request': 'locationRequest',
  'otp-escalation': 'otpEscalation',
};

const SMS_LABELS: Record<CompanySmsKind, string> = {
  'login-otp': 'Login OTP',
  'pickup-otp': 'Trip verification OTP',
  sos: 'SOS Alert',
  'trip-driver': 'Driver Trip',
  'trip-employee': 'Employee Trip Approved',
  'trip-employee-rejected': 'Employee Trip Rejected',
  'location-request': 'Location Request',
  'otp-escalation': 'OTP Alert',
};

interface Fast2SmsResponse {
  return?: boolean;
  message?: unknown;
  request_id?: string;
  sms_count?: number | string;
  amount_debited?: number | string;
  data?: { sms_count?: number | string; amount_debited?: number | string };
}

class ProviderSubmissionError extends Error {
  constructor(message: string, readonly outcome: 'failed' | 'unknown') {
    super(message);
  }
}

function providerDetail(data: Fast2SmsResponse): string {
  return Array.isArray(data.message) ? data.message.join('; ') : String(data.message ?? 'unknown error');
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * DLT alphanumeric values are capped at 40 characters. Keep operational
 * summaries short, remove Fast2SMS' pipe delimiter, and guarantee a value.
 */
export function dltTextVariable(
  parts: Array<string | null | undefined>,
  fallback = 'NA',
): string {
  const normalize = (value: string) => value.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  const combined = normalize(parts.filter((part): part is string => Boolean(part?.trim())).join(' '));
  const safe = combined || normalize(fallback) || 'NA';
  return safe.slice(0, 40).trimEnd();
}

export function buildFast2SmsRequest(input: {
  mode: 'quick' | 'dlt';
  senderId: string;
  templateId: string;
  variables: string[];
  number: string;
  deliveryId: string;
  quickMessage: string;
}): Record<string, string> {
  if (input.mode === 'dlt') {
    return {
      route: 'dlt', sender_id: input.senderId, message: input.templateId,
      variables_values: input.variables.join('|'), numbers: input.number,
      sms_details: '1', udf1: input.deliveryId,
    };
  }
  return {
    route: 'q', message: input.quickMessage, numbers: input.number,
    sms_details: '1', udf1: input.deliveryId,
  };
}

async function smsConfigForCurrentCompany() {
  const companyId = currentCompanyId();
  if (!companyId) return null;
  return Company.findById(companyId).select('name smsEntityId smsSenderId smsTemplates').lean();
}

export async function currentCompanyBrand(): Promise<string> {
  const company = await smsConfigForCurrentCompany();
  return company?.name?.trim() || 'SkyTrack';
}

/** Quick/dev formatting only. DLT messages are rendered by approved templates. */
export function formatCompanySms(companyName: string, kind: CompanySmsKind, body: string): string {
  return `${companyName} - ${SMS_LABELS[kind]}: ${body}`;
}

async function postFast2Sms(body: Record<string, string>): Promise<Fast2SmsResponse> {
  let response: Response;
  try {
    response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: env.fast2smsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Fast2SMS may have accepted a request before the connection failed.
    throw new ProviderSubmissionError('Fast2SMS request outcome is unknown - check delivery reports before retrying', 'unknown');
  }

  let data: Fast2SmsResponse;
  try {
    data = (await response.json()) as Fast2SmsResponse;
  } catch {
    throw new ProviderSubmissionError(`Fast2SMS returned an unreadable response (HTTP ${response.status})`, 'unknown');
  }
  if (!response.ok || !data.return) {
    throw new ProviderSubmissionError(`Fast2SMS could not send the SMS: ${providerDetail(data)}`, 'failed');
  }
  return data;
}

/** Single provider boundary. DLT mode never falls back to the Quick route. */
export async function sendCompanySms(input: CompanySmsInput): Promise<SmsDeliveryResult> {
  const number = normalizePhone(input.phone);
  const config = await smsConfigForCurrentCompany();
  const companyName = input.companyName ?? config?.name?.trim() ?? 'SkyTrack';
  const route = env.smsProvider === 'fast2sms'
    ? (env.fast2smsMode === 'dlt' ? 'dlt' : 'quick')
    : env.smsProvider === 'msg91' ? 'msg91' : 'dev';
  const templateId = config?.smsTemplates?.[TEMPLATE_KEYS[input.kind]]?.trim() ?? '';
  const senderId = config?.smsSenderId?.trim() ?? '';
  const entityId = config?.smsEntityId?.trim() ?? '';

  let attempt = 1;
  if (input.referenceId && input.retryPolicy) {
    const previous = await SmsDelivery.findOne({ kind: input.kind, referenceId: input.referenceId }).sort({ createdAt: -1 });
    if (previous) {
      attempt = previous.attempt + 1;
      if (input.retryPolicy.dedupeUncertain && ['pending', 'accepted', 'delivered', 'unknown'].includes(previous.status)) {
        throw new HttpError(409, 'An SMS for this event is already pending, accepted, delivered, or awaiting delivery confirmation');
      }
      if (previous.attempt >= input.retryPolicy.maxAttempts) throw new HttpError(429, 'Maximum SMS delivery attempts reached');
      const delay = input.retryPolicy.baseDelayMs * (2 ** Math.max(0, previous.attempt - 1));
      const retryAt = previous.updatedAt.getTime() + delay;
      if (retryAt > Date.now()) throw new HttpError(429, `SMS retry is available in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds`);
    }
  }

  const delivery = await SmsDelivery.create({
    kind: input.kind, recipient: number, provider: env.smsProvider, route,
    entityId, senderId, templateId, referenceId: input.referenceId ?? '', status: 'pending', attempt,
  });

  try {
    if (env.smsProvider === 'fast2sms') {
      if (!env.fast2smsApiKey) throw new ProviderSubmissionError('FAST2SMS_API_KEY is not configured', 'failed');
      const body = buildFast2SmsRequest({
        mode: env.fast2smsMode,
        senderId,
        templateId,
        variables: input.variables,
        number,
        deliveryId: delivery._id.toString(),
        quickMessage: formatCompanySms(companyName, input.kind, input.fallbackBody),
      });

      if (env.fast2smsMode === 'dlt') {
        if (!entityId) throw new ProviderSubmissionError('DLT PE/Entity ID is not configured for this company', 'failed');
        if (!/^[A-Z]{3,6}$/.test(senderId)) {
          throw new ProviderSubmissionError('An approved 3-6 letter DLT sender/header is not configured for this company', 'failed');
        }
        if (!templateId) throw new ProviderSubmissionError(`No approved Fast2SMS Message ID is configured for ${input.kind}`, 'failed');
        if (input.variables.some((value) => value.includes('|'))) {
          throw new ProviderSubmissionError('DLT variable values cannot contain the pipe character', 'failed');
        }
      }

      const data = await postFast2Sms(body);
      const smsCount = optionalNumber(data.sms_count ?? data.data?.sms_count);
      const amountDebited = optionalNumber(data.amount_debited ?? data.data?.amount_debited);
      delivery.status = 'accepted';
      delivery.requestId = data.request_id ?? '';
      delivery.acceptedAt = new Date();
      if (smsCount !== undefined) delivery.smsCount = smsCount;
      if (amountDebited !== undefined) delivery.amountDebited = amountDebited;
      await delivery.save();
      return {
        accepted: true, provider: 'fast2sms', status: 'accepted', deliveryId: delivery._id.toString(),
        requestId: delivery.requestId || undefined, smsCount, amountDebited,
      };
    }

    if (env.smsProvider === 'msg91') throw new ProviderSubmissionError('MSG91 delivery is not implemented', 'failed');

    console.log(`\n[sms] === DEV SMS === to=${number} kind=${input.kind} message=${formatCompanySms(companyName, input.kind, input.fallbackBody)}\n`);
    delivery.status = 'accepted';
    delivery.acceptedAt = new Date();
    await delivery.save();
    return { accepted: true, provider: 'dev', status: 'accepted', deliveryId: delivery._id.toString() };
  } catch (error) {
    const outcome = error instanceof ProviderSubmissionError ? error.outcome : 'unknown';
    delivery.status = outcome;
    delivery.failureReason = error instanceof Error ? error.message.slice(0, 500) : 'SMS submission failed';
    if (outcome === 'failed') delivery.failedAt = new Date();
    await delivery.save();
    throw new HttpError(outcome === 'unknown' ? 503 : 502, delivery.failureReason);
  }
}
