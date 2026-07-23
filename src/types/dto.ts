// Wire types for API responses.
// Source of truth: frontend-vite/src/api/types.ts — keep these in sync.

export interface Employee {
  id: string;
  name: string;
  gender: string;
  contact: string;
  email: string;
  transportType: string;
  transportMode: string;
  distance: string;
  address: string;
  location: string;
  nodalPoint: string;
  manager: string;
  pinCode: string;
  shiftLogin: string;
  shiftLogout: string;
  fixedShift: string;
  latLong: string;
  team: string;
  specialNeed: string;
  route: string;
  active: string;
}

export interface Vehicle {
  rtoNo: string;
  seatCount: string;
  model: string;
  taxExpiry: string;
  insuranceEnd: string;
  permitEnd: string;
  fcExpiry: string;
  emissionExpiry: string;
  maintenanceDue: string;
  vehicleType: string;
  vendor: string;
  imei: string;
  driver: string;
  driverContact: string;
  billingType: string;
  fuelType: string;
  inductionDate: string;
  expired: string;
  active: string;
}

export interface VehiclePosition {
  rtoNo: string;
  lat: number;
  lng: number;
  status: string;
  speed: number;
}

export interface Driver {
  name: string;
  gender: string;
  dlNumber: string;
  badgeNumber: string;
  contact: string;
  email: string;
  vendor: string;
  dlEffectiveFrom: string;
  dlExpiry: string;
  address: string;
  aadhaar: string;
  pan: string;
  inductionDate: string;
  firstVaccination: string;
  secondVaccination: string;
  pvcExpiry: string;
  medicalExpiry: string;
  active: string;
}

export interface Route {
  id: number;
  name: string;
  count: number;
  type: string;
  destinationAddress: string;
  destLat: number | null;
  destLng: number | null;
  dropPath: { lat: number; lng: number }[];
  pickupPath: { lat: number; lng: number }[];
  geometryStatus: 'pending' | 'ready' | 'error';
  geometryProvider: string;
  geometryUpdatedAt: string | null;
  geometryError: string;
}

export interface CompanyConfig {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Company logo as a data-URL; replaces the initials badge in the header. */
  logoBase64: string;
  /** Vendor (cab company) names managed by the admin. */
  vendors: string[];
}

export interface Trip {
  id: string;
  status: string;
  statusColor: string;
  type: string;
  date: string;
  escort: string;
  escortName: string;
  shiftTime: string;
  empCount: number;
  location: string;
  route?: string;
  vendor: string;
  vehicleNo: string;
  frozen?: boolean;
  employees?: Employee[];
  verifiedEmployeeIds?: string[]; // empIds OTP-verified by the driver
  schedule: TripSchedule | null;
}

export interface TripScheduleStop {
  employeeId: string;
  employeeName: string;
  sequence: number;
  plannedAt: string;
  liveEtaAt: string | null;
  distanceMeters: number;
  durationSeconds: number;
}

export interface TripSchedule {
  shiftDeadlineAt: string | null;
  scheduledStartAt: string | null;
  driverReportAt: string | null;
  scheduledEndAt: string | null;
  mode: 'auto' | 'manual';
  calculatedAt: string | null;
  etaUpdatedAt: string | null;
  distanceMeters: number;
  durationSeconds: number;
  trafficModel: string;
  stops: TripScheduleStop[];
}

// ---- Driver/Employee app DTOs ----

export interface DriverTripEmployee {
  id: string; // empId
  name: string;
  contact: string;
  latLong: string;
  location: string;
  nodalPoint: string;
  shiftLogin: string;
  shiftLogout: string;
  verified: boolean;
}

export interface DriverTrip {
  id: string; // tripId
  status: string;
  statusColor: string;
  type: string;
  date: string;
  shiftTime: string;
  escort: string;
  escortName: string;
  location: string;
  route: string;
  vehicleNo: string;
  vendor: string;
  frozen: boolean;
  startedAt: string | null;
  completedAt: string | null;
  employees: DriverTripEmployee[];
  schedule: TripSchedule | null;
}

export interface EmployeeTrip {
  id: string; // tripId
  status: string;
  statusColor: string;
  type: string;
  date: string;
  shiftTime: string;
  location: string;
  route: string;
  vehicleNo: string;
  vendor: string;
  escort: string;
  escortName: string;
  frozen: boolean;
  startedAt: string | null;
  completedAt: string | null;
  verified: boolean; // is the requesting employee verified on this trip
  driver: { name: string; contact: string };
  // Contains only this employee's stop; other passengers' times stay private.
  schedule: TripSchedule | null;
}

export interface SosAlert {
  id: string;
  status: string;
  location: string;
  reason: string;
  photoBase64: string;
  createdAt: string;
  acknowledgedBy: string;
  acknowledgedAt: string | null;
  tripId: string | null;
  employee: { id: string; name: string; contact: string };
  driver: { name: string; contact: string } | null;
}

export interface EscortReportDTO {
  id: string;
  status: string; // 'open' | 'acknowledged'
  present: string; // 'Yes' | 'No'
  escortName: string;
  createdAt: string;
  acknowledgedBy: string;
  acknowledgedAt: string | null;
  tripId: string | null;
  employee: { id: string; name: string; contact: string };
  driver: { name: string; contact: string } | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  empId: string;
  date: string;
  tripType: string; // 'pickup' | 'drop'
  shiftTime: string;
  route: string;
  location?: string;
  status: string;
}

export interface DashboardStats {
  rostering: { label: string; value: number; subLabel: string }[];
  employeeTrips: { label: string; value: number; subLabel: string }[];
  liveTrips: { label: string; value: number; subLabel: string }[];
  tripsInProgress: TripTableRow[];
  upcomingTrips: TripTableRow[];
  completedTrips: TripTableRow[];
  autoCancel: TripTableRow[];
  vendorPerformance: VendorPerformanceRow[];
  approval: ApprovalData;
}

export interface TripTableRow {
  type: string;
  count: number;
  vehicle: string;
  vendor: string;
  driver: string;
}

export interface VendorPerformanceRow {
  vendor: string;
  percentage: number;
  tripCount: number;
  completed: number;
}

export interface ApprovalData {
  rostering: { pending: number; approved: number };
  employeeAddressChange: { pending: number; approved: number };
  workspaceBooking: { pending: number; approved: number };
}

export interface TripFilters {
  fromDate?: string;
  toDate?: string;
  shiftTime?: string;
  tripType?: string;
  vendor?: string;
  search?: string;
  status?: string;
}

// ---- Reports ----

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TripReportRow {
  id: string; // tripId
  date: string;
  type: string;
  shiftTime: string;
  status: string;
  route: string;
  vehicleNo: string;
  vendor: string;
  driverName: string;
  driverContact: string;
  escort: string;
  empCount: number;
  verifiedCount: number;
  employeeIds: string; // "; " joined empIds
  employeeNames: string; // "; " joined names
  startedAt: string;
  completedAt: string;
}

export interface ReportTotals {
  trips: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  cancelled: number;
  employeesTransported: number;
  verifiedEmployees: number;
}

export interface ReportVendorRow {
  vendor: string;
  trips: number;
  completed: number;
}

export interface ReportSummary {
  period: ReportPeriod;
  from: string;
  to: string;
  label: string;
  totals: ReportTotals;
  statusBreakdown: Record<string, number>;
  vendorBreakdown: ReportVendorRow[];
  trips: TripReportRow[];
}

export interface EmployeeLocationUpdate {
  employeeMongoId: string;
  empId: string;
  empName: string;
  tripId: string;
  lat: number;
  lng: number;
  timestamp: string;
  driverMongoId?: string;
}

export interface EmployeeDocumentDTO {
  id: string;
  name: string;
  mimeType: string;
  uploadedAt: string;
}

export interface FeedbackDTO {
  id: string;
  employee: { id: string; name: string; contact: string };
  message: string;
  read: boolean;
  submittedAt: string;
}
