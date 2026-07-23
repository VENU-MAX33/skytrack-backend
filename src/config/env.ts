import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}. Copy backend/.env.example to backend/.env and fill it in.`);
    process.exit(1);
  }
  return value;
}

// Allow a single CORS_ORIGIN (legacy) or a comma-separated CORS_ORIGINS list.
// Defaults cover admin (5173), driver-web (5174) and employee-web (5175) dev servers
// on both standard loopback hostnames. Opening Vite at 127.0.0.1 while its API URL
// uses localhost is otherwise a browser-level CORS failure that surfaces as
// "Failed to fetch".
const corsOrigins = (
  process.env.CORS_ORIGINS ??
  process.env.CORS_ORIGIN ??
  'http://localhost:5173,http://localhost:5174,http://localhost:5175,' +
    'http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Vite picks the next free port when one of the usual dev ports is occupied.
 * Accept any loopback port while developing so a browser request does not fail
 * merely because, for example, the admin app started on :5176 instead of :5173.
 * Production remains restricted to the explicitly configured origin list.
 */
export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin || corsOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

// Fail closed: production must use a real SMS provider. 'dev' mode sends no SMS
// (it only logs the code server-side), so silently running it in production
// would break OTP login entirely — refuse to start instead.
export function assertSmsProviderSafe(nodeEnv: string | undefined, smsProvider: string): void {
  if (nodeEnv === 'production' && smsProvider === 'dev') {
    throw new Error(
      "SMS_PROVIDER must be a real provider ('fast2sms' or 'msg91') in production — refusing to start in 'dev' mode, which sends no SMS."
    );
  }
}

export function assertProductionConfig(config: {
  nodeEnv?: string; jwtSecret: string; corsOrigins: string[]; smsProvider: string;
  fast2smsApiKey?: string; msg91AuthKey?: string; msg91SenderId?: string; msg91TemplateId?: string;
}): void {
  if (config.nodeEnv !== 'production') return;
  if (config.jwtSecret.length < 32 || /change-me|dev-secret|test-secret/i.test(config.jwtSecret)) {
    throw new Error('JWT_SECRET must be a unique production secret of at least 32 characters');
  }
  if (!config.corsOrigins.length || config.corsOrigins.some((origin) => {
    try { return new URL(origin).protocol !== 'https:'; } catch { return true; }
  })) throw new Error('Production CORS_ORIGINS must contain only valid HTTPS origins');
  if (config.smsProvider === 'fast2sms' && !config.fast2smsApiKey) throw new Error('FAST2SMS_API_KEY is required');
  if (config.smsProvider === 'msg91' && (!config.msg91AuthKey || !config.msg91SenderId || !config.msg91TemplateId)) {
    throw new Error('MSG91_AUTH_KEY, MSG91_SENDER_ID and MSG91_TEMPLATE_ID are required');
  }
}

function publicAppUrl(name: string, value: string, nodeEnv: string | undefined): string {
  try {
    const url = new URL(value);
    if (nodeEnv === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error(`${name} must be a public HTTPS URL in production`);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

// OTP / SMS delivery: 'dev' logs to console only; 'fast2sms'/'msg91' wire real SMS.
const smsProvider = (process.env.SMS_PROVIDER ?? 'dev') as 'dev' | 'msg91' | 'fast2sms';

try {
  assertSmsProviderSafe(process.env.NODE_ENV, smsProvider);
  assertProductionConfig({
    nodeEnv: process.env.NODE_ENV,
    jwtSecret: process.env.JWT_SECRET ?? '', corsOrigins, smsProvider,
    fast2smsApiKey: process.env.FAST2SMS_API_KEY,
    msg91AuthKey: process.env.MSG91_AUTH_KEY,
    msg91SenderId: process.env.MSG91_SENDER_ID,
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID,
  });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

export const env = {
  port: Number(process.env.PORT ?? 5000),
  mongodbUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  corsOrigins,
  trustProxy: process.env.TRUST_PROXY ?? '',
  // Optional seed-only passwords. When omitted, the seed command generates
  // cryptographically random development credentials and prints them once.
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
  seedStaffPassword: process.env.SEED_STAFF_PASSWORD ?? '',
  defaultEmployeePassword: process.env.DEFAULT_EMPLOYEE_PASSWORD ?? '',
  smsProvider,
  fast2smsApiKey: process.env.FAST2SMS_API_KEY ?? '',
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY ?? '',
    senderId: process.env.MSG91_SENDER_ID ?? '',
    templateId: process.env.MSG91_TEMPLATE_ID ?? '',
  },
  osrmBaseUrl: process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org',
  routeCorridorMaxMeters: Number(process.env.ROUTE_CORRIDOR_MAX_METERS ?? 2000),
  routeAmbiguityMeters: Number(process.env.ROUTE_AMBIGUITY_METERS ?? 250),
  driverAppPublicUrl: publicAppUrl('DRIVER_APP_PUBLIC_URL', process.env.DRIVER_APP_PUBLIC_URL ?? 'http://localhost:5174', process.env.NODE_ENV),
  employeeAppPublicUrl: publicAppUrl('EMPLOYEE_APP_PUBLIC_URL', process.env.EMPLOYEE_APP_PUBLIC_URL ?? 'http://localhost:5175', process.env.NODE_ENV),
};
