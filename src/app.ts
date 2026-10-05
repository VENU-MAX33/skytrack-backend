import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, isCorsOriginAllowed } from './config/env.js';
import { requireBackOfficeWrite, requireCompanyContext, requireRole } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { vehiclesRouter } from './routes/vehicles.js';
import { driversRouter } from './routes/drivers.js';
import { routesRouter } from './routes/routes.js';
import { tripsRouter } from './routes/trips.js';
import { rostersRouter } from './routes/rosters.js';
import { dashboardRouter } from './routes/dashboard.js';
import { driverAuthRouter } from './routes/driver-auth.js';
import { driverTripsRouter } from './routes/driver-trips.js';
import { driverTrackingRouter } from './routes/driver-tracking.js';
import { employeeAuthRouter } from './routes/employee-auth.js';
import { employeeTripsRouter } from './routes/employee-trips.js';
import { sosRouter } from './routes/sos.js';
import { escortReportRouter } from './routes/escort-report.js';
import { companyConfigRouter } from './routes/company-config.js';
import { employeeLocationRouter } from './routes/employee-location.js';
import { employeeDocumentsRouter } from './routes/employee-documents.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';
import { staffRouter } from './routes/staff.js';
import { employeeFeedbackRouter } from './routes/employee-feedback.js';
import { feedbackRouter } from './routes/feedback.js';
import { companiesRouter } from './routes/companies.js';
import { smsWebhookRouter } from './routes/sms-webhook.js';
import { smsDeliveriesRouter } from './routes/sms-deliveries.js';
import { employeeTripRequestsRouter, adminTripRequestsRouter } from './routes/trip-requests.js';
import { employeeNotificationsRouter } from './routes/employee-notifications.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

// Back-office data endpoints serve the admin dashboard only. Both the main
// admin and limited "staff" logins may reach them; drivers and employees
// (who authenticate with their own low-trust tokens) must NOT — otherwise any
// employee could read every driver's Aadhaar/PAN or delete records. Plain
// requireAuth accepted ANY valid token regardless of role, so it is replaced
// with an explicit role gate on every back-office mount.
const requireBackOfficeRead = [requireRole('platform-owner', 'admin', 'staff'), requireCompanyContext];
const requireBackOffice = [...requireBackOfficeRead, requireBackOfficeWrite];

// Brute-force protection on the credential endpoints. Limits are per client IP.
// (OTP sends also have a per-phone cap inside otp.service.) validate.xForwardedForHeader
// is disabled because the proxy/trust-proxy setup is a deployment concern, not
// something these limiters should warn about on every boot.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
  validate: { xForwardedForHeader: false },
});

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait a few minutes and try again.' },
  validate: { xForwardedForHeader: false },
});

/**
 * Builds the Express app with all routes and middleware wired up, but without
 * connecting to the database, opening a WebSocket, or listening on a port.
 * Kept separate from server.ts so tests can import the app in isolation.
 */
export function createApp(): Express {
  const app = express();

  if (env.trustProxy) app.set('trust proxy', /^\d+$/.test(env.trustProxy) ? Number(env.trustProxy) : env.trustProxy);

  app.disable('x-powered-by');
  app.use(helmet({
    strictTransportSecurity: process.env.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  }));
  app.use(cors({ origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)) }));
  app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] ?? crypto.randomUUID()).slice(0, 128);
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // 5 MB: company logo + employee document uploads travel as base64 JSON.
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/api/health/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ ok: ready, database: ready ? 'connected' : 'unavailable' });
  });
  app.get('/api/health', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ ok: ready });
  });

  // Provider callback: authenticated by a high-entropy secret in the URL and
  // deliberately mounted before user authentication middleware.
  app.use('/api/webhooks/fast2sms', smsWebhookRouter);

  // --- Public auth endpoints (rate-limited; brute-force protection) ---
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/driver/request-otp', otpRequestLimiter);
  app.use('/api/employee/request-otp', otpRequestLimiter);
  app.use('/api/auth', authRouter); // admin
  app.use('/api/platform/companies', requireRole('platform-owner'), companiesRouter);
  app.use('/api/driver', driverAuthRouter); // driver login/set/reset (public sub-paths)
  app.use('/api/employee', employeeAuthRouter); // employee login (public sub-paths)

  // --- Admin / back-office (main admin + staff only) ---
  app.use('/api/employees', requireBackOffice, employeesRouter);
  app.use('/api/vehicles', requireBackOffice, vehiclesRouter);
  app.use('/api/drivers', requireBackOffice, driversRouter);
  app.use('/api/routes', requireBackOffice, routesRouter);
  app.use('/api/company-config', requireBackOffice, companyConfigRouter);
  // Trips and rostering are operational workflows. Staff are intentionally
  // allowed only here; all other back-office mutation routes stay read-only.
  app.use('/api/trips', requireBackOfficeRead, tripsRouter);
  app.use('/api/rosters', requireBackOfficeRead, rostersRouter);
  app.use('/api/dashboard', requireBackOffice, dashboardRouter);
  app.use('/api/reports', requireRole('platform-owner', 'admin'), requireCompanyContext, reportsRouter);
  app.use('/api/auth/staff', requireRole('platform-owner', 'admin'), requireCompanyContext, staffRouter);
  app.use('/api/feedback', requireBackOffice, feedbackRouter); // admin-only role check also happens per-route inside

  // --- Role-scoped app endpoints ---
  app.use('/api/driver/trips', requireRole('driver'), driverTripsRouter);
  app.use('/api/driver/tracking', requireRole('driver'), driverTrackingRouter);
  app.use('/api/employee/trips', requireRole('employee'), employeeTripsRouter);
  app.use('/api/employee/trip-requests', requireRole('employee'), employeeTripRequestsRouter);
  app.use('/api/employee/notifications', requireRole('employee'), employeeNotificationsRouter);
  app.use('/api/employee/location', requireRole('employee'), employeeLocationRouter);
  app.use('/api/employee/feedback', requireRole('employee'), employeeFeedbackRouter);
  // SOS: employees raise alerts; admins acknowledge (router enforces per-route roles)
  app.use('/api/sos', sosRouter);
  app.use('/api/escort-report', escortReportRouter);

  // --- Back-office: employee documents + notifications ---
  app.use('/api/employees', requireBackOffice, employeeDocumentsRouter);
  app.use('/api/notifications', requireBackOffice, notificationsRouter);
  app.use('/api/sms-deliveries', requireBackOfficeRead, smsDeliveriesRouter);
  app.use('/api/trip-requests', requireBackOffice, adminTripRequestsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
