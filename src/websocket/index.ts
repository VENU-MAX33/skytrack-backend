import type { Server as HttpServer } from 'http';
import { Server as IOServer, type Socket } from 'socket.io';
import { isCorsOriginAllowed } from '../config/env.js';
import { principalIsValid, verifyToken } from '../middleware/auth.js';
import { currentCompanyId } from '../tenancy/context.js';

let io: IOServer | null = null;

export const rooms = {
  admin: (companyId: string) => `company:${companyId}:admin`,
  driver: (driverId: string) => `driver:${driverId}`,
  employee: (employeeId: string) => `employee:${employeeId}`,
};

function activeAdminRoom(): string {
  return rooms.admin(currentCompanyId() ?? 'unscoped');
}

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
      methods: ['GET', 'POST'],
    },
  });

  // Authenticate every socket using the same JWT as the REST API.
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Missing auth token'));
    try {
      const payload = verifyToken(token);
      if (!(await principalIsValid(payload))) return next(new Error('Account is no longer active'));
      socket.data.auth = payload;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { role, sub, companyId } = socket.data.auth as { role: string; sub: string; companyId?: string };
    if (['platform-owner', 'admin', 'staff'].includes(role) && companyId) socket.join(rooms.admin(companyId));
    else if (role === 'driver') socket.join(rooms.driver(sub));
    else if (role === 'employee') socket.join(rooms.employee(sub));
  });

  return io;
}

export function getIo(): IOServer {
  if (!io) throw new Error('Socket.IO not initialised. Call initSocket() first.');
  return io;
}

// ---- Emitter helpers (server -> client events) ----

/** Notify a frozen trip's driver and employees, plus admins. */
export function emitTripFrozen(payload: {
  adminTrip: unknown;
  driverTrip: unknown;
  driverId: string;
  employeeTrips: { employeeId: string; trip: unknown }[];
}): void {
  const i = getIo();
  i.to(rooms.driver(payload.driverId)).emit('trip:frozen', payload.driverTrip);
  payload.employeeTrips.forEach(({ employeeId, trip }) =>
    i.to(rooms.employee(employeeId)).emit('trip:frozen', trip)
  );
  i.to(activeAdminRoom()).emit('trip:frozen', payload.adminTrip);
}

/** Tell all trip participants to refresh their displayed planned/live times. */
export function emitTripScheduleUpdate(payload: {
  tripId: string;
  driverId: string;
  employeeIds: string[];
}): void {
  const i = getIo();
  const event = { tripId: payload.tripId };
  i.to(rooms.driver(payload.driverId)).emit('trip:schedule', event);
  payload.employeeIds.forEach((id) => i.to(rooms.employee(id)).emit('trip:schedule', event));
  i.to(activeAdminRoom()).emit('trip:schedule', event);
}

/** Broadcast a trip status change (started/completed/etc.) to all parties. */
export function emitTripStatus(payload: {
  trip: unknown;
  driverId: string;
  employeeIds: string[];
}): void {
  const i = getIo();
  i.to(rooms.driver(payload.driverId)).emit('trip:status', payload.trip);
  payload.employeeIds.forEach((id) => i.to(rooms.employee(id)).emit('trip:status', payload.trip));
  i.to(activeAdminRoom()).emit('trip:status', payload.trip);
}

/** Remove a reassigned/inaccessible trip from the former driver's active view. */
export function emitTripUnassigned(driverId: string, payload: { tripId: string; reason: string }): void {
  getIo().to(rooms.driver(driverId)).emit('trip:unassigned', payload);
}

/** Notify a specific employee that a pickup OTP was sent (the code goes by SMS only). */
export function emitOtpSent(employeeId: string, payload: { tripId: string }): void {
  getIo().to(rooms.employee(employeeId)).emit('otp:sent', payload);
}

/** Tell the employee + admins that the employee has been OTP-verified for a trip. */
export function emitEmployeeVerified(payload: {
  employeeId: string;
  driverId: string;
  tripId: string;
}): void {
  const i = getIo();
  i.to(rooms.employee(payload.employeeId)).emit('employee:verified', payload);
  i.to(rooms.driver(payload.driverId)).emit('employee:verified', payload);
  i.to(activeAdminRoom()).emit('employee:verified', payload);
}

/** HIGH-PRIORITY: broadcast an SOS alert to admins and the assigned driver. */
export function emitSos(payload: { alert: unknown; driverId?: string }): void {
  const i = getIo();
  i.to(activeAdminRoom()).emit('sos:alert', payload.alert);
  if (payload.driverId) i.to(rooms.driver(payload.driverId)).emit('sos:alert', payload.alert);
}

export function emitSosAck(payload: { alert: unknown; driverId?: string }): void {
  const i = getIo();
  i.to(activeAdminRoom()).emit('sos:acknowledged', payload.alert);
  if (payload.driverId) i.to(rooms.driver(payload.driverId)).emit('sos:acknowledged', payload.alert);
}

/** Broadcast an employee's escort report to admins and the assigned driver. */
export function emitEscortReport(payload: { report: unknown; driverId?: string }): void {
  const i = getIo();
  i.to(activeAdminRoom()).emit('escort:report', payload.report);
  if (payload.driverId) i.to(rooms.driver(payload.driverId)).emit('escort:report', payload.report);
}

export function emitEscortReportAck(payload: { report: unknown; driverId?: string }): void {
  const i = getIo();
  i.to(activeAdminRoom()).emit('escort:report:acknowledged', payload.report);
  if (payload.driverId) i.to(rooms.driver(payload.driverId)).emit('escort:report:acknowledged', payload.report);
}

/** Broadcast an employee's live GPS location to their trip's driver and to admins. */
export function emitEmployeeLocation(payload: {
  employeeMongoId: string;
  empId: string;
  empName: string;
  tripId: string;
  lat: number;
  lng: number;
  timestamp: string;
  driverMongoId?: string;
}): void {
  const i = getIo();
  if (payload.driverMongoId) {
    i.to(rooms.driver(payload.driverMongoId)).emit('employee:location', payload);
  }
  i.to(activeAdminRoom()).emit('employee:location', payload);
}

/** Tell one employee that their assigned driver has requested a current GPS location. */
export function emitLocationRequest(employeeId: string, payload: {
  id: string;
  tripId: string;
  driverName: string;
  requestedAt: string;
}): void {
  getIo().to(rooms.employee(employeeId)).emit('location:requested', payload);
}

/** Push a new dashboard notification (SOS, location change, …) to admins. */
export function emitNotification(payload: unknown): void {
  getIo().to(activeAdminRoom()).emit('notification:new', payload);
}

/** Live vehicle GPS position (phone-as-GPS ping) for the admin tracking map. */
export function emitVehiclePosition(payload: {
  rtoNo: string;
  lat: number;
  lng: number;
  status: string;
  speed: number;
}): void {
  getIo().to(activeAdminRoom()).emit('vehicle:position', payload);
}

/** Notify admin that a new employee feedback entry has been submitted. */
export function emitFeedbackNew(payload: unknown): void {
  getIo().to(activeAdminRoom()).emit('feedback:new', payload);
}
