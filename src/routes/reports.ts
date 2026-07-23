import { Router } from 'express';
import type { Request } from 'express';
import { Trip } from '../models/Trip.js';
import { Driver } from '../models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { Employee } from '../models/Employee.js';
import { SOSAlert } from '../models/SOSAlert.js';
import { toTripReportRow } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { STATUS_BUCKETS, localToday, type TripStatus } from '../lib/statusBuckets.js';
import { reportRange, REPORT_PERIODS, type ReportPeriod } from '../lib/reportPeriod.js';
import type { ReportSummary, ReportTotals, ReportVendorRow, TripReportRow } from '../types/dto.js';

export const reportsRouter = Router();

const TRIP_POPULATE = 'vehicleId driverId routeId employeeIds';
type Populated = Parameters<typeof toTripReportRow>[0];

function parsePeriodDate(req: Request): { period: ReportPeriod; from: string; to: string; label: string } {
  const periodParam = (req.query.period as string) ?? 'daily';
  if (!REPORT_PERIODS.includes(periodParam as ReportPeriod)) {
    throw new HttpError(400, `period must be one of: ${REPORT_PERIODS.join(', ')}`);
  }
  const date = (req.query.date as string) ?? localToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date must be in YYYY-MM-DD format');
  const period = periodParam as ReportPeriod;
  const { from, to, label } = reportRange(period, date);
  return { period, from, to, label };
}

/** Inclusive [from, to] date strings → Date range covering local midnight to end-of-day. */
function dateWindow(from: string, to: string): { $gte: Date; $lte: Date } {
  return { $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999`) };
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : '';
}

// ---------------------------------------------------------------------------
// Trips (period-filtered summary — the original report)
// ---------------------------------------------------------------------------

async function loadTripRows(from: string, to: string): Promise<TripReportRow[]> {
  const docs = await Trip.find({ date: { $gte: from, $lte: to } })
    .sort({ date: 1, shiftTime: 1 })
    .populate(TRIP_POPULATE);
  return docs.map((d) => toTripReportRow(d as unknown as Populated));
}

function summarize(period: ReportPeriod, from: string, to: string, label: string, trips: TripReportRow[]): ReportSummary {
  const statusBreakdown: Record<string, number> = {};
  const vendorMap = new Map<string, ReportVendorRow>();
  let employeesTransported = 0;
  let verifiedEmployees = 0;

  for (const t of trips) {
    statusBreakdown[t.status] = (statusBreakdown[t.status] ?? 0) + 1;
    const vendorKey = t.vendor || 'Unknown';
    const v = vendorMap.get(vendorKey) ?? { vendor: vendorKey, trips: 0, completed: 0 };
    v.trips += 1;
    if (STATUS_BUCKETS.completed.includes(t.status as TripStatus)) v.completed += 1;
    vendorMap.set(vendorKey, v);
    employeesTransported += t.empCount;
    verifiedEmployees += t.verifiedCount;
  }

  const bucketCount = (bucket: string) =>
    STATUS_BUCKETS[bucket].reduce((sum: number, s: TripStatus) => sum + (statusBreakdown[s] ?? 0), 0);

  const totals: ReportTotals = {
    trips: trips.length,
    completed: bucketCount('completed'),
    inProgress: bucketCount('in-progress'),
    notStarted: bucketCount('not-started'),
    cancelled: bucketCount('cancelled'),
    employeesTransported,
    verifiedEmployees,
  };

  return {
    period,
    from,
    to,
    label,
    totals,
    statusBreakdown,
    vendorBreakdown: [...vendorMap.values()].sort((a, b) => b.trips - a.trips),
    trips,
  };
}

// ---------------------------------------------------------------------------
// Generic report types: drivers, cabs (vehicles), employees and SOS alerts.
// ---------------------------------------------------------------------------

type Row = Record<string, string | number>;

interface ReportTypeDef {
  /** Columns in display/CSV order: [row key, header]. */
  columns: [string, string][];
  /** Master lists ignore the period; dated types filter on it. */
  dated: boolean;
  load: (from: string, to: string) => Promise<Row[]>;
}

const REPORT_TYPES: Record<string, ReportTypeDef> = {
  drivers: {
    dated: false,
    columns: [
      ['name', 'Name'], ['gender', 'Gender'], ['contact', 'Contact'], ['email', 'Email'],
      ['vendor', 'Vendor'], ['dlNumber', 'DL Number'], ['dlEffectiveFrom', 'DL Effective From'],
      ['dlExpiry', 'DL Expiry'], ['badgeNumber', 'Badge No'], ['aadhaar', 'Aadhaar'], ['pan', 'PAN'],
      ['address', 'Address'], ['inductionDate', 'Induction Date'], ['pvcExpiry', 'PVC Expiry'],
      ['medicalExpiry', 'Medical Expiry'], ['active', 'Active'],
    ],
    load: async () => {
      const docs = await Driver.find().sort({ name: 1 });
      return docs.map((d) => ({
        name: d.name, gender: d.gender, contact: d.contact, email: d.email,
        vendor: d.vendor, dlNumber: d.dlNumber, dlEffectiveFrom: d.dlEffectiveFrom,
        dlExpiry: d.dlExpiry, badgeNumber: d.badgeNumber, aadhaar: d.aadhaar, pan: d.pan,
        address: d.address, inductionDate: d.inductionDate, pvcExpiry: d.pvcExpiry,
        medicalExpiry: d.medicalExpiry, active: d.active,
      }));
    },
  },
  cabs: {
    dated: false,
    columns: [
      ['rtoNo', 'Vehicle No'], ['model', 'Model'], ['vehicleType', 'Type'], ['seatCount', 'Seats'],
      ['vendor', 'Vendor'], ['driverName', 'Driver'], ['driverContact', 'Driver Contact'],
      ['fuelType', 'Fuel'], ['billingType', 'Billing'], ['imei', 'IMEI'],
      ['insuranceEnd', 'Insurance End'], ['permitEnd', 'Permit End'], ['fcExpiry', 'FC Expiry'],
      ['emissionExpiry', 'Emission Expiry'], ['taxExpiry', 'Tax Expiry'],
      ['maintenanceDue', 'Maintenance Due'], ['inductionDate', 'Induction Date'],
      ['expired', 'Expired'], ['active', 'Active'],
    ],
    load: async () => {
      const docs = await Vehicle.find().sort({ rtoNo: 1 }).populate<{ driverId: { name: string; contact: string } | null }>('driverId');
      return docs.map((v) => ({
        rtoNo: v.rtoNo, model: v.model, vehicleType: v.vehicleType, seatCount: v.seatCount,
        vendor: v.vendor, driverName: v.driverId?.name ?? '', driverContact: v.driverId?.contact ?? '',
        fuelType: v.fuelType, billingType: v.billingType, imei: v.imei,
        insuranceEnd: v.insuranceEnd, permitEnd: v.permitEnd, fcExpiry: v.fcExpiry,
        emissionExpiry: v.emissionExpiry, taxExpiry: v.taxExpiry,
        maintenanceDue: v.maintenanceDue, inductionDate: v.inductionDate,
        expired: v.expired, active: v.active,
      }));
    },
  },
  employees: {
    dated: false,
    columns: [
      ['empId', 'Employee ID'], ['name', 'Name'], ['gender', 'Gender'], ['contact', 'Contact'],
      ['email', 'Email'], ['route', 'Route'], ['address', 'Address'], ['location', 'Location'],
      ['nodalPoint', 'Nodal Point'], ['pinCode', 'PIN Code'], ['latLong', 'Lat/Long'],
      ['team', 'Team'], ['manager', 'Manager'], ['shiftLogin', 'Shift Login'],
      ['shiftLogout', 'Shift Logout'], ['transportType', 'Transport Type'],
      ['transportMode', 'Transport Mode'], ['specialNeed', 'Special Need'], ['active', 'Active'],
    ],
    load: async () => {
      const docs = await Employee.find().sort({ empId: 1 });
      return docs.map((e) => ({
        empId: e.empId, name: e.name, gender: e.gender, contact: e.contact, email: e.email,
        route: e.route, address: e.address, location: e.location, nodalPoint: e.nodalPoint,
        pinCode: e.pinCode, latLong: e.latLong, team: e.team, manager: e.manager,
        shiftLogin: e.shiftLogin, shiftLogout: e.shiftLogout, transportType: e.transportType,
        transportMode: e.transportMode, specialNeed: e.specialNeed, active: e.active,
      }));
    },
  },
  sos: {
    dated: true,
    columns: [
      ['raisedAt', 'Raised At'], ['empId', 'Employee ID'], ['empName', 'Employee'],
      ['empContact', 'Contact'], ['tripId', 'Trip ID'], ['driverName', 'Driver'],
      ['driverContact', 'Driver Contact'], ['location', 'Location (lat,lng)'], ['reason', 'Reason'],
      ['status', 'Status'], ['acknowledgedBy', 'Acknowledged By'],
      ['acknowledgedAt', 'Acknowledged At'], ['resolvedAt', 'Resolved At'],
    ],
    load: async (from, to) => {
      const docs = await SOSAlert.find({ createdAt: dateWindow(from, to) })
        .sort({ createdAt: 1 })
        .populate<{
          employeeId: { empId: string; name: string; contact: string } | null;
          driverId: { name: string; contact: string } | null;
          tripId: { tripId: string } | null;
        }>('employeeId driverId tripId');
      return docs.map((s) => ({
        raisedAt: iso((s as unknown as { createdAt: Date }).createdAt),
        empId: s.employeeId?.empId ?? '', empName: s.employeeId?.name ?? '',
        empContact: s.employeeId?.contact ?? '', tripId: s.tripId?.tripId ?? '',
        driverName: s.driverId?.name ?? '', driverContact: s.driverId?.contact ?? '',
        location: s.location, reason: s.reason, status: s.status,
        acknowledgedBy: s.acknowledgedBy ?? '', acknowledgedAt: iso(s.acknowledgedAt),
        resolvedAt: iso(s.resolvedAt),
      }));
    },
  },
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function csvEscape(value: unknown): string {
  let s = String(value ?? '');
  // Neutralise spreadsheet formula injection: a cell starting with = + - @ (or a
  // leading tab/CR that Excel trims) is evaluated as a formula. Employee-supplied
  // text (SOS reasons, address notes) flows into these exports, so prefix a quote.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns: [string, string][], rows: Row[]): string {
  const lines = [columns.map(([, header]) => csvEscape(header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(([key]) => csvEscape(row[key])).join(','));
  }
  return lines.join('\r\n');
}

const TRIP_CSV_COLUMNS: [keyof TripReportRow, string][] = [
  ['id', 'Trip ID'], ['date', 'Date'], ['type', 'Type'], ['shiftTime', 'Shift Time'],
  ['status', 'Status'], ['route', 'Route'], ['vehicleNo', 'Vehicle No'], ['vendor', 'Vendor'],
  ['driverName', 'Driver'], ['driverContact', 'Driver Contact'], ['escort', 'Escort'],
  ['empCount', 'Employee Count'], ['verifiedCount', 'Verified Count'],
  ['employeeIds', 'Employee IDs'], ['employeeNames', 'Employee Names'],
  ['startedAt', 'Started At'], ['completedAt', 'Completed At'],
];

function sendCsv(res: Parameters<Parameters<typeof asyncHandler>[0]>[1], csv: string, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// ---------------------------------------------------------------------------
// Routes  (register /trips before the generic /:type)
// ---------------------------------------------------------------------------

reportsRouter.get(
  '/trips',
  asyncHandler(async (req, res) => {
    const { period, from, to, label } = parsePeriodDate(req);
    const trips = await loadTripRows(from, to);
    res.json(summarize(period, from, to, label, trips));
  })
);

reportsRouter.get(
  '/trips/export',
  asyncHandler(async (req, res) => {
    const { period, from, to, label } = parsePeriodDate(req);
    const trips = await loadTripRows(from, to);
    const csv = toCsv(TRIP_CSV_COLUMNS as [string, string][], trips as unknown as Row[]);
    sendCsv(res, csv, `trip-report-${period}-${label.replace(/\s+/g, '_')}.csv`);
  })
);

function getTypeDef(type: string): ReportTypeDef {
  const def = REPORT_TYPES[type];
  if (!def) throw new HttpError(400, `Unknown report type: ${type}`);
  return def;
}

reportsRouter.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const def = getTypeDef(req.params.type);
    const { period, from, to, label } = parsePeriodDate(req);
    const rows = await def.load(from, to);
    res.json({
      period: def.dated ? period : 'all',
      from: def.dated ? from : '',
      to: def.dated ? to : '',
      label: def.dated ? label : 'All records',
      count: rows.length,
      rows,
    });
  })
);

reportsRouter.get(
  '/:type/export',
  asyncHandler(async (req, res) => {
    const type = req.params.type;
    const def = getTypeDef(type);
    const { period, from, to, label } = parsePeriodDate(req);
    const rows = await def.load(from, to);
    const suffix = def.dated ? `${period}-${label.replace(/\s+/g, '_')}` : 'all';
    sendCsv(res, toCsv(def.columns, rows), `${type}-report-${suffix}.csv`);
  })
);
