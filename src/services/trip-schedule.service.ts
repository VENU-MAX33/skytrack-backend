import { Types } from 'mongoose';
import { CompanyConfig } from '../models/CompanyConfig.js';
import { Trip } from '../models/Trip.js';
import { localToday } from '../lib/statusBuckets.js';

export type LatLng = { lat: number; lng: number };

interface ScheduleEmployee {
  _id: Types.ObjectId;
  empId: string;
  name: string;
  distance: string;
  latLong: string;
}

interface ScheduleVehicle {
  lat: number;
  lng: number;
}

interface PopulatedScheduleTrip {
  _id: Types.ObjectId;
  tripId: string;
  type: string;
  date: string;
  shiftTime: string;
  status: string;
  completedAt?: Date | null;
  frozen: boolean;
  scheduleMode: 'auto' | 'manual';
  vehicleId: ScheduleVehicle | null;
  driverId: { _id: Types.ObjectId } | null;
  employeeIds: ScheduleEmployee[];
  verifiedEmployees: Types.ObjectId[];
  scheduleStops: {
    employeeId: Types.ObjectId;
    sequence: number;
    plannedAt: Date;
    liveEtaAt?: Date | null;
    distanceMeters: number;
    durationSeconds: number;
  }[];
}

export interface ScheduleStopResult {
  employeeId: Types.ObjectId;
  sequence: number;
  plannedAt: Date;
  liveEtaAt: Date;
  distanceMeters: number;
  durationSeconds: number;
}

export interface CalculatedSchedule {
  shiftDeadlineAt: Date;
  scheduledStartAt: Date;
  driverReportAt: Date;
  scheduledEndAt: Date;
  scheduleDistanceMeters: number;
  scheduleDurationSeconds: number;
  scheduleTrafficModel: string;
  scheduleStops: ScheduleStopResult[];
}

const ARRIVAL_BUFFER_MINUTES = Number(process.env.SCHEDULE_ARRIVAL_BUFFER_MINUTES ?? 5);
const DRIVER_REPORT_BUFFER_MINUTES = Number(process.env.SCHEDULE_DRIVER_BUFFER_MINUTES ?? 5);
const STOP_DWELL_MINUTES = Number(process.env.SCHEDULE_STOP_DWELL_MINUTES ?? 2);
const LIVE_ETA_THROTTLE_MS = Number(process.env.LIVE_ETA_THROTTLE_MS ?? 30_000);
const LIVE_ETA_NOTIFY_SECONDS = Number(process.env.LIVE_ETA_NOTIFY_SECONDS ?? 120);
const GOOGLE_ROUTES_API_KEY = process.env.GOOGLE_ROUTES_API_KEY ?? '';

const lastLiveCalculation = new Map<string, number>();

export function parseLatLng(raw: string): LatLng | null {
  const [latRaw, lngRaw] = raw.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) return null;
  if (latRaw < -90 || latRaw > 90 || lngRaw < -180 || lngRaw > 180) return null;
  return { lat: latRaw, lng: lngRaw };
}

export function scheduleDeadline(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const result = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function haversineMeters(from: LatLng, to: LatLng): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Deterministic traffic model used when no paid live-routing provider is
 * configured. Speeds intentionally vary by Bengaluru morning/evening peaks.
 * The routing-provider boundary can later replace this without changing trip
 * or UI contracts.
 */
export function trafficSpeedKmh(at: Date): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at)
  );
  if (hour >= 7 && hour < 11) return 22;
  if (hour >= 16 && hour < 21) return 20;
  if (hour >= 22 || hour < 6) return 38;
  return 30;
}

interface SegmentEstimate {
  distanceMeters: number;
  durationSeconds: number;
  source?: 'fallback' | 'google';
}

function segmentEstimate(from: LatLng, to: LatLng, at: Date): SegmentEstimate {
  // Road distance is normally longer than a straight line. The 1.25 factor is
  // a conservative fallback until a traffic-routing provider is configured.
  const distanceMeters = Math.max(100, Math.round(haversineMeters(from, to) * 1.25));
  const durationSeconds = Math.max(
    60,
    Math.round((distanceMeters / 1000 / trafficSpeedKmh(at)) * 3600)
  );
  return { distanceMeters, durationSeconds, source: 'fallback' };
}

async function trafficAwareSegmentEstimate(from: LatLng, to: LatLng, at: Date): Promise<SegmentEstimate> {
  if (!GOOGLE_ROUTES_API_KEY) return segmentEstimate(from, to, at);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const futureDeparture = at.getTime() > Date.now();
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_ROUTES_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        trafficModel: 'BEST_GUESS',
        ...(futureDeparture ? { departureTime: at.toISOString() } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Google Routes returned ${response.status}`);
    const data = await response.json() as {
      routes?: { distanceMeters?: number; duration?: string }[];
    };
    const route = data.routes?.[0];
    const durationSeconds = Number(route?.duration?.replace(/s$/, ''));
    if (!route?.distanceMeters || !Number.isFinite(durationSeconds)) throw new Error('Google Routes returned no route');
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      source: 'google',
    };
  } catch (error) {
    console.warn(`[schedule] live traffic fallback: ${(error as Error).message}`);
    return segmentEstimate(from, to, at);
  } finally {
    clearTimeout(timeout);
  }
}

function orderedEmployees(employees: ScheduleEmployee[], type: string): ScheduleEmployee[] {
  const pickup = type === 'PickUp';
  return [...employees].sort((a, b) => {
    const aDistance = Number(a.distance);
    const bDistance = Number(b.distance);
    const av = Number.isFinite(aDistance) ? aDistance : pickup ? -Infinity : Infinity;
    const bv = Number.isFinite(bDistance) ? bDistance : pickup ? -Infinity : Infinity;
    return pickup ? bv - av : av - bv;
  });
}

export function calculateSchedule(
  input: {
    type: string;
    deadline: Date;
    origin: LatLng;
    office: LatLng;
    employees: { employeeId: Types.ObjectId; point: LatLng }[];
  }
): CalculatedSchedule {
  const points = input.employees.map((employee) => employee.point);
  const finalPoint = input.type === 'PickUp' ? input.office : null;
  const segmentPoints = [input.origin, ...points, ...(finalPoint ? [finalPoint] : [])];
  const estimates = segmentPoints.slice(1).map((point, index) =>
    segmentEstimate(segmentPoints[index], point, input.deadline)
  );
  return buildSchedule(input, estimates, 'time-of-day-traffic-v1');
}

function buildSchedule(
  input: {
    type: string;
    deadline: Date;
    origin: LatLng;
    office: LatLng;
    employees: { employeeId: Types.ObjectId; point: LatLng }[];
  },
  estimates: SegmentEstimate[],
  trafficModel: string
): CalculatedSchedule {
  const isPickup = input.type === 'PickUp';
  const dwellSeconds = Math.max(0, STOP_DWELL_MINUTES * 60);
  const targetEnd = isPickup
    ? new Date(input.deadline.getTime() - ARRIVAL_BUFFER_MINUTES * 60_000)
    : input.deadline;
  const travelSeconds = estimates.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const totalDurationSeconds = travelSeconds + dwellSeconds * input.employees.length;
  const scheduledStartAt = isPickup
    ? new Date(targetEnd.getTime() - totalDurationSeconds * 1000)
    : new Date(input.deadline);

  let cursor = new Date(scheduledStartAt);
  const scheduleStops: ScheduleStopResult[] = input.employees.map((employee, index) => {
    const segment = estimates[index];
    cursor = new Date(cursor.getTime() + segment.durationSeconds * 1000);
    const plannedAt = new Date(cursor);
    cursor = new Date(cursor.getTime() + dwellSeconds * 1000);
    return {
      employeeId: employee.employeeId,
      sequence: index + 1,
      plannedAt,
      liveEtaAt: plannedAt,
      distanceMeters: segment.distanceMeters,
      durationSeconds: segment.durationSeconds,
    };
  });

  const scheduledEndAt = isPickup ? targetEnd : scheduleStops.at(-1)?.plannedAt ?? scheduledStartAt;
  return {
    shiftDeadlineAt: input.deadline,
    scheduledStartAt,
    driverReportAt: new Date(scheduledStartAt.getTime() - DRIVER_REPORT_BUFFER_MINUTES * 60_000),
    scheduledEndAt,
    scheduleDistanceMeters: estimates.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    scheduleDurationSeconds: totalDurationSeconds,
    scheduleTrafficModel: trafficModel,
    scheduleStops,
  };
}

async function calculateTrafficAwareSchedule(
  input: {
    type: string;
    deadline: Date;
    origin: LatLng;
    office: LatLng;
    employees: { employeeId: Types.ObjectId; point: LatLng }[];
  }
): Promise<CalculatedSchedule> {
  if (!GOOGLE_ROUTES_API_KEY) return calculateSchedule(input);
  const fallback = calculateSchedule(input);
  const finalPoint = input.type === 'PickUp' ? input.office : null;
  const segmentPoints = [input.origin, ...input.employees.map((employee) => employee.point), ...(finalPoint ? [finalPoint] : [])];
  let cursor = new Date(fallback.scheduledStartAt);
  const estimates: SegmentEstimate[] = [];
  for (let index = 1; index < segmentPoints.length; index += 1) {
    const estimate = await trafficAwareSegmentEstimate(segmentPoints[index - 1], segmentPoints[index], cursor);
    estimates.push(estimate);
    cursor = new Date(cursor.getTime() + estimate.durationSeconds * 1000 + STOP_DWELL_MINUTES * 60_000);
  }
  return buildSchedule(
    input,
    estimates,
    estimates.some((estimate) => estimate.source === 'google')
      ? 'google-routes-live-traffic'
      : 'time-of-day-traffic-v1'
  );
}

async function loadScheduleTrip(tripId: string): Promise<PopulatedScheduleTrip | null> {
  return Trip.findOne({ tripId })
    .populate('vehicleId driverId employeeIds') as unknown as Promise<PopulatedScheduleTrip | null>;
}

export async function recalculateTripSchedule(
  tripId: string,
  options: { force?: boolean } = {}
): Promise<PopulatedScheduleTrip> {
  const trip = await loadScheduleTrip(tripId);
  if (!trip) throw new Error('Trip not found');
  if (trip.scheduleMode === 'manual' && !options.force) return trip;

  const deadline = scheduleDeadline(trip.date, trip.shiftTime);
  if (!deadline) throw new Error('Trip date and shift time are required for automatic scheduling');
  const company = await CompanyConfig.findOne().lean();
  if (!company || !Number.isFinite(company.lat) || !Number.isFinite(company.lng) || (!company.lat && !company.lng)) {
    throw new Error('Set valid company latitude and longitude before calculating a schedule');
  }
  const office = { lat: company.lat, lng: company.lng };
  const ordered = orderedEmployees(trip.employeeIds, trip.type);
  const missing = ordered.filter((employee) => !parseLatLng(employee.latLong));
  if (missing.length) {
    throw new Error(`Missing coordinates for ${missing.map((employee) => employee.empId).join(', ')}`);
  }
  const vehiclePoint = trip.vehicleId && trip.vehicleId.lat && trip.vehicleId.lng
    ? { lat: trip.vehicleId.lat, lng: trip.vehicleId.lng }
    : office;
  const calculated = await calculateTrafficAwareSchedule({
    type: trip.type,
    deadline,
    origin: trip.type === 'Drop' ? office : vehiclePoint,
    office,
    employees: ordered.map((employee) => ({
      employeeId: employee._id,
      point: parseLatLng(employee.latLong)!,
    })),
  });

  await Trip.updateOne(
    { _id: trip._id },
    {
      ...calculated,
      scheduleMode: 'auto',
      scheduleCalculatedAt: new Date(),
      etaUpdatedAt: new Date(),
    }
  );
  return (await loadScheduleTrip(tripId))!;
}

export interface LiveEtaRefreshResult {
  tripId: string;
  driverId: string;
  employeeIds: string[];
  changed: boolean;
}

export async function refreshDriverLiveEta(
  driverId: string,
  currentPoint: LatLng
): Promise<LiveEtaRefreshResult | null> {
  const now = Date.now();
  if (now - (lastLiveCalculation.get(driverId) ?? 0) < LIVE_ETA_THROTTLE_MS) return null;
  lastLiveCalculation.set(driverId, now);

  const candidates = (await Trip.find({
    driverId,
    frozen: true,
    completedAt: null,
    date: { $gte: localToday() },
  })
    .sort({ date: 1, scheduledStartAt: 1 })
    .limit(5)
    .populate('vehicleId driverId employeeIds')) as unknown as PopulatedScheduleTrip[];
  const ongoing = ['Trip Started', 'Pickup Started', 'Drop Started'];
  const trip = candidates.find((candidate) => ongoing.includes(candidate.status)) ?? candidates[0];
  if (!trip?.scheduleStops?.length) return null;

  const verified = new Set(trip.verifiedEmployees.map((employeeId) => employeeId.toString()));
  const employeeById = new Map(trip.employeeIds.map((employee) => [employee._id.toString(), employee]));
  const remainingStops = [...trip.scheduleStops]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((stop) => !verified.has(stop.employeeId.toString()));
  if (!remainingStops.length) return null;

  let cursor = new Date();
  let point = currentPoint;
  let changed = false;
  const updatedStops = trip.scheduleStops.map((stop) => ({
    employeeId: stop.employeeId,
    sequence: stop.sequence,
    plannedAt: stop.plannedAt,
    liveEtaAt: stop.liveEtaAt ?? stop.plannedAt,
    distanceMeters: stop.distanceMeters,
    durationSeconds: stop.durationSeconds,
  }));

  for (const stop of remainingStops) {
    const employee = employeeById.get(stop.employeeId.toString());
    const destination = employee ? parseLatLng(employee.latLong) : null;
    if (!destination) continue;
    const estimate = await trafficAwareSegmentEstimate(point, destination, cursor);
    cursor = new Date(cursor.getTime() + estimate.durationSeconds * 1000);
    const target = updatedStops.find((candidate) => candidate.employeeId.equals(stop.employeeId));
    if (target) {
      const previous = target.liveEtaAt?.getTime() ?? target.plannedAt.getTime();
      if (Math.abs(previous - cursor.getTime()) >= LIVE_ETA_NOTIFY_SECONDS * 1000) changed = true;
      target.liveEtaAt = new Date(cursor);
      target.distanceMeters = estimate.distanceMeters;
      target.durationSeconds = estimate.durationSeconds;
    }
    cursor = new Date(cursor.getTime() + STOP_DWELL_MINUTES * 60_000);
    point = destination;
  }

  await Trip.updateOne(
    { _id: trip._id },
    { scheduleStops: updatedStops, etaUpdatedAt: new Date() }
  );
  return {
    tripId: trip.tripId,
    driverId,
    employeeIds: trip.employeeIds.map((employee) => employee._id.toString()),
    changed,
  };
}
