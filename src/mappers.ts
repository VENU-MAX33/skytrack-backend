import type { HydratedDocument, Types } from 'mongoose';
import type {
  Employee,
  Vehicle,
  Driver,
  Route,
  Trip,
  RosterEntry,
  VehiclePosition,
  DriverTrip,
  EmployeeTrip,
  SosAlert,
  EscortReportDTO,
  EmployeeDocumentDTO,
  TripReportRow,
  FeedbackDTO,
} from './types/dto.js';
import type { EmployeeDoc } from './models/Employee.js';
import type { VehicleDoc } from './models/Vehicle.js';
import type { DriverDoc } from './models/Driver.js';
import type { RouteDoc } from './models/Route.js';
import type { TripDoc } from './models/Trip.js';
import type { RosterDoc } from './models/Roster.js';
import type { SOSAlertDoc } from './models/SOSAlert.js';
import type { EscortReportDoc } from './models/EscortReport.js';
import type { EmployeeDocumentDoc } from './models/EmployeeDocument.js';
import type { FeedbackDoc } from './models/Feedback.js';
import { STATUS_COLORS, type TripStatus } from './lib/statusBuckets.js';
import type { TripSchedule } from './types/dto.js';

export function toEmployeeDTO(doc: HydratedDocument<EmployeeDoc>): Employee {
  return {
    id: doc.empId,
    name: doc.name,
    gender: doc.gender,
    contact: doc.contact,
    email: doc.email,
    transportType: doc.transportType,
    transportMode: doc.transportMode,
    distance: doc.distance,
    address: doc.address,
    location: doc.location,
    nodalPoint: doc.nodalPoint,
    manager: doc.manager,
    pinCode: doc.pinCode,
    shiftLogin: doc.shiftLogin,
    shiftLogout: doc.shiftLogout,
    fixedShift: doc.fixedShift,
    latLong: doc.latLong,
    team: doc.team,
    specialNeed: doc.specialNeed,
    route: doc.route,
    active: doc.active,
  };
}

export function toDriverDTO(doc: HydratedDocument<DriverDoc>): Driver {
  return {
    name: doc.name,
    gender: doc.gender,
    dlNumber: doc.dlNumber,
    badgeNumber: doc.badgeNumber,
    contact: doc.contact,
    email: doc.email,
    vendor: doc.vendor,
    dlEffectiveFrom: doc.dlEffectiveFrom,
    dlExpiry: doc.dlExpiry,
    address: doc.address,
    aadhaar: doc.aadhaar,
    pan: doc.pan,
    inductionDate: doc.inductionDate,
    firstVaccination: doc.firstVaccination,
    secondVaccination: doc.secondVaccination,
    pvcExpiry: doc.pvcExpiry,
    medicalExpiry: doc.medicalExpiry,
    active: doc.active,
  };
}

// Vehicle docs are queried with .populate('driverId') so the DTO can carry driver name/contact.
type PopulatedVehicle = Omit<HydratedDocument<VehicleDoc>, 'driverId'> & {
  driverId: HydratedDocument<DriverDoc> | null;
};

export function toVehicleDTO(doc: PopulatedVehicle): Vehicle {
  return {
    rtoNo: doc.rtoNo,
    seatCount: doc.seatCount,
    model: doc.model,
    taxExpiry: doc.taxExpiry,
    insuranceEnd: doc.insuranceEnd,
    permitEnd: doc.permitEnd,
    fcExpiry: doc.fcExpiry,
    emissionExpiry: doc.emissionExpiry,
    maintenanceDue: doc.maintenanceDue,
    vehicleType: doc.vehicleType,
    vendor: doc.vendor,
    imei: doc.imei,
    driver: doc.driverId?.name ?? '',
    driverContact: doc.driverId?.contact ?? '',
    billingType: doc.billingType,
    fuelType: doc.fuelType,
    inductionDate: doc.inductionDate,
    expired: doc.expired,
    active: doc.active,
  };
}

export function toVehiclePositionDTO(doc: HydratedDocument<VehicleDoc>): VehiclePosition {
  return {
    rtoNo: doc.rtoNo,
    lat: doc.lat,
    lng: doc.lng,
    status: doc.trackStatus,
    speed: doc.speed,
  };
}

export function toRouteDTO(doc: HydratedDocument<RouteDoc>, count: number): Route {
  return {
    id: doc.routeId,
    name: doc.name,
    count,
    type: doc.type,
    destinationAddress: doc.destinationAddress ?? '',
    destLat: doc.destLat ?? null,
    destLng: doc.destLng ?? null,
    dropPath: (doc.dropPath ?? []).map((point) => ({ lat: point.lat, lng: point.lng })),
    pickupPath: (doc.pickupPath ?? []).map((point) => ({ lat: point.lat, lng: point.lng })),
    geometryStatus: doc.geometryStatus ?? 'pending',
    geometryProvider: doc.geometryProvider ?? '',
    geometryUpdatedAt: doc.geometryUpdatedAt?.toISOString() ?? null,
    geometryError: doc.geometryError ?? '',
  };
}

// Trip docs are queried with .populate('vehicleId driverId routeId employeeIds').
type PopulatedTrip = Omit<HydratedDocument<TripDoc>, 'vehicleId' | 'driverId' | 'routeId' | 'employeeIds'> & {
  vehicleId: HydratedDocument<VehicleDoc> | null;
  driverId: HydratedDocument<DriverDoc> | null;
  routeId: HydratedDocument<RouteDoc> | null;
  employeeIds: HydratedDocument<EmployeeDoc>[];
};

function toTripSchedule(
  doc: PopulatedTrip,
  selfId?: Types.ObjectId
): TripSchedule | null {
  if (!doc.scheduleStops?.length) return null;
  const employees = new Map(doc.employeeIds.map((employee) => [employee._id.toString(), employee]));
  const stops = doc.scheduleStops
    .filter((stop) => !selfId || stop.employeeId.equals(selfId))
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => {
      const employee = employees.get(stop.employeeId.toString());
      return {
        employeeId: employee?.empId ?? stop.employeeId.toString(),
        employeeName: employee?.name ?? '',
        sequence: stop.sequence,
        plannedAt: stop.plannedAt.toISOString(),
        liveEtaAt: stop.liveEtaAt ? stop.liveEtaAt.toISOString() : null,
        distanceMeters: stop.distanceMeters,
        durationSeconds: stop.durationSeconds,
      };
    });
  return {
    shiftDeadlineAt: doc.shiftDeadlineAt?.toISOString() ?? null,
    scheduledStartAt: doc.scheduledStartAt?.toISOString() ?? null,
    driverReportAt: doc.driverReportAt?.toISOString() ?? null,
    scheduledEndAt: doc.scheduledEndAt?.toISOString() ?? null,
    mode: doc.scheduleMode ?? 'auto',
    calculatedAt: doc.scheduleCalculatedAt?.toISOString() ?? null,
    etaUpdatedAt: doc.etaUpdatedAt?.toISOString() ?? null,
    distanceMeters: doc.scheduleDistanceMeters ?? 0,
    durationSeconds: doc.scheduleDurationSeconds ?? 0,
    trafficModel: doc.scheduleTrafficModel ?? '',
    stops,
  };
}

/**
 * Order a trip's employees by distance from the office (the `distance` field is
 * km home→office, set when the employee is created).
 *   PickUp: farthest first — the route ends at the office.
 *   Drop:   nearest first — the route starts at the office.
 * Employees with no recorded distance sort to the office-end.
 */
export function orderTripEmployees<T extends { distance: string }>(emps: T[], tripType: string): T[] {
  const pickup = tripType === 'PickUp';
  return [...emps].sort((a, b) => {
    const da = Number(a.distance), db = Number(b.distance);
    const va = Number.isFinite(da) ? da : (pickup ? -Infinity : Infinity);
    const vb = Number.isFinite(db) ? db : (pickup ? -Infinity : Infinity);
    return pickup ? vb - va : va - vb;
  });
}

export function toTripDTO(doc: PopulatedTrip): Trip {
  const verifiedSet = new Set((doc.verifiedEmployees ?? []).map((v) => v.toString()));
  return {
    id: doc.tripId,
    status: doc.status,
    statusColor: STATUS_COLORS[doc.status as TripStatus] ?? 'text-[#777777]',
    type: doc.type,
    date: doc.date,
    escort: doc.escort,
    escortName: doc.escortName ?? '',
    shiftTime: doc.shiftTime,
    empCount: doc.employeeIds.length,
    location: doc.location || doc.routeId?.name || '',
    route: doc.routeId?.name || '',
    vendor: doc.vendor || doc.vehicleId?.vendor || '',
    vehicleNo: doc.vehicleId?.rtoNo ?? '',
    frozen: doc.frozen ?? false,
    employees: orderTripEmployees(doc.employeeIds, doc.type).map(e => toEmployeeDTO(e)),
    verifiedEmployeeIds: doc.employeeIds
      .filter((e) => verifiedSet.has(e._id.toString()))
      .map((e) => e.empId),
    schedule: toTripSchedule(doc),
  };
}

// Flat, spreadsheet-friendly row for the Reports feature (CSV export + report table).
export function toTripReportRow(doc: PopulatedTrip): TripReportRow {
  const verifiedSet = new Set((doc.verifiedEmployees ?? []).map((v) => v.toString()));
  return {
    id: doc.tripId,
    date: doc.date,
    type: doc.type,
    shiftTime: doc.shiftTime,
    status: doc.status,
    route: doc.routeId?.name || doc.location || '',
    vehicleNo: doc.vehicleId?.rtoNo ?? '',
    vendor: doc.vendor || doc.vehicleId?.vendor || '',
    driverName: doc.driverId?.name ?? '',
    driverContact: doc.driverId?.contact ?? '',
    escort: doc.escort,
    empCount: doc.employeeIds.length,
    verifiedCount: doc.employeeIds.filter((e) => verifiedSet.has(e._id.toString())).length,
    employeeIds: doc.employeeIds.map((e) => e.empId).join('; '),
    employeeNames: doc.employeeIds.map((e) => e.name).join('; '),
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : '',
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : '',
  };
}

function statusColor(status: string): string {
  return STATUS_COLORS[status as TripStatus] ?? 'text-[#777777]';
}

function isVerified(verified: Types.ObjectId[], empId: Types.ObjectId): boolean {
  return verified.some((v) => v.equals(empId));
}

// Driver app: full trip with per-employee verification flags.
export function toDriverTripDTO(doc: PopulatedTrip): DriverTrip {
  return {
    id: doc.tripId,
    status: doc.status,
    statusColor: statusColor(doc.status),
    type: doc.type,
    date: doc.date,
    shiftTime: doc.shiftTime,
    escort: doc.escort,
    escortName: doc.escortName ?? '',
    location: doc.location || doc.routeId?.name || '',
    route: doc.routeId?.name || '',
    vehicleNo: doc.vehicleId?.rtoNo ?? '',
    vendor: doc.vendor || doc.vehicleId?.vendor || '',
    frozen: doc.frozen ?? false,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    employees: orderTripEmployees(doc.employeeIds, doc.type).map((e) => ({
      id: e.empId,
      name: e.name,
      contact: e.contact,
      latLong: e.latLong,
      location: e.location,
      nodalPoint: e.nodalPoint,
      shiftLogin: e.shiftLogin,
      shiftLogout: e.shiftLogout,
      verified: isVerified(doc.verifiedEmployees, e._id),
    })),
    schedule: toTripSchedule(doc),
  };
}

// Employee app: trip from the requesting employee's perspective.
export function toEmployeeTripDTO(doc: PopulatedTrip, selfId: Types.ObjectId): EmployeeTrip {
  return {
    id: doc.tripId,
    status: doc.status,
    statusColor: statusColor(doc.status),
    type: doc.type,
    date: doc.date,
    shiftTime: doc.shiftTime,
    location: doc.location || doc.routeId?.name || '',
    route: doc.routeId?.name || '',
    vehicleNo: doc.vehicleId?.rtoNo ?? '',
    vendor: doc.vendor || doc.vehicleId?.vendor || '',
    escort: doc.escort,
    escortName: doc.escortName ?? '',
    frozen: doc.frozen ?? false,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    verified: isVerified(doc.verifiedEmployees, selfId),
    driver: { name: doc.driverId?.name ?? '', contact: doc.driverId?.contact ?? '' },
    schedule: toTripSchedule(doc, selfId),
  };
}

type PopulatedSos = Omit<HydratedDocument<SOSAlertDoc>, 'employeeId' | 'driverId' | 'tripId'> & {
  employeeId: HydratedDocument<EmployeeDoc> | null;
  driverId: HydratedDocument<DriverDoc> | null;
  tripId: HydratedDocument<TripDoc> | null;
  createdAt: Date;
};

export function toSosDTO(doc: PopulatedSos): SosAlert {
  return {
    id: doc._id.toString(),
    status: doc.status,
    location: doc.location,
    reason: doc.reason ?? '',
    photoBase64: doc.photoBase64 ?? '',
    createdAt: doc.createdAt.toISOString(),
    acknowledgedBy: doc.acknowledgedBy ?? '',
    acknowledgedAt: doc.acknowledgedAt ? doc.acknowledgedAt.toISOString() : null,
    tripId: doc.tripId?.tripId ?? null,
    employee: {
      id: doc.employeeId?.empId ?? '',
      name: doc.employeeId?.name ?? '',
      contact: doc.employeeId?.contact ?? '',
    },
    driver: doc.driverId ? { name: doc.driverId.name, contact: doc.driverId.contact } : null,
  };
}

type PopulatedEscortReport = Omit<HydratedDocument<EscortReportDoc>, 'employeeId' | 'driverId' | 'tripId'> & {
  employeeId: HydratedDocument<EmployeeDoc> | null;
  driverId: HydratedDocument<DriverDoc> | null;
  tripId: HydratedDocument<TripDoc> | null;
  createdAt: Date;
};

export function toEscortReportDTO(doc: PopulatedEscortReport): EscortReportDTO {
  return {
    id: doc._id.toString(),
    status: doc.status,
    present: doc.present,
    escortName: doc.escortName ?? '',
    createdAt: doc.createdAt.toISOString(),
    acknowledgedBy: doc.acknowledgedBy ?? '',
    acknowledgedAt: doc.acknowledgedAt ? doc.acknowledgedAt.toISOString() : null,
    tripId: doc.tripId?.tripId ?? null,
    employee: {
      id: doc.employeeId?.empId ?? '',
      name: doc.employeeId?.name ?? '',
      contact: doc.employeeId?.contact ?? '',
    },
    driver: doc.driverId ? { name: doc.driverId.name, contact: doc.driverId.contact } : null,
  };
}

type PopulatedRoster = Omit<HydratedDocument<RosterDoc>, 'employeeId'> & {
  employeeId: HydratedDocument<EmployeeDoc> | null;
};

export function toRosterDTO(doc: PopulatedRoster): RosterEntry {
  return {
    id: doc._id.toString(),
    name: doc.employeeId?.name ?? '',
    empId: doc.employeeId?.empId ?? '',
    date: doc.date,
    tripType: doc.tripType,
    shiftTime: doc.timing,
    route: doc.employeeId?.route ?? '',
    location: doc.employeeId?.location ?? '',
    status: doc.status,
  };
}

export function toEmployeeDocDTO(doc: HydratedDocument<EmployeeDocumentDoc>): EmployeeDocumentDTO {
  return {
    id: doc._id.toString(),
    name: doc.name,
    mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt.toISOString(),
  };
}

type PopulatedFeedback = Omit<HydratedDocument<FeedbackDoc>, 'employeeId'> & {
  employeeId: HydratedDocument<EmployeeDoc> | null;
};

export function toFeedbackDTO(doc: PopulatedFeedback): FeedbackDTO {
  return {
    id: doc._id.toString(),
    employee: {
      id: doc.employeeId?.empId ?? '',
      name: doc.employeeId?.name ?? '',
      contact: doc.employeeId?.contact ?? '',
    },
    message: doc.message,
    read: doc.read,
    submittedAt: doc.submittedAt.toISOString(),
  };
}
