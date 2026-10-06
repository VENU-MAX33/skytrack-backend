import type { Types } from 'mongoose';
import { Trip, type TripDoc } from '../models/Trip.js';
import { SosConfig } from '../models/SosConfig.js';
import { createNotification } from './notification.service.js';
import { dltTextVariable, sendCompanySms } from './sms.service.js';
import { Company } from '../models/Company.js';
import { tenantContext } from '../tenancy/context.js';
import { createEmployeeNotification } from './employee-notification.service.js';
import { sendDriverTripExpiredPush } from './driver-notification.service.js';
import { toTripDTO } from '../mappers.js';
import { emitTripStatus } from '../websocket/index.js';

const ONGOING_STATUSES = ['Trip Started', 'Pickup Started', 'Drop Started'];
const OVERDUE_ELIGIBLE_STATUSES = ['Not Started Yet', 'Driver Accepted', ...ONGOING_STATUSES];
const OTP_ESCALATION_MS = 30 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const ALERT_CHECK_INTERVAL_MS = 60 * 1000;
export const UNSTARTED_TRIP_GRACE_MS = 10 * 60 * 60 * 1000;

type AlertTrip = Omit<TripDoc, 'vehicleId' | 'driverId' | 'routeId' | 'employeeIds'> & {
  _id: Types.ObjectId;
  vehicleId: { rtoNo: string } | null;
  driverId: { _id: Types.ObjectId; name: string; contact: string } | null;
  routeId: { name: string } | null;
  employeeIds: { _id: Types.ObjectId; empId: string; name: string }[];
};

/**
 * Shift times are recorded with an Indian date and a 24-hour HH:mm time by the
 * rostering UI. Convert that local schedule to an absolute deadline, regardless
 * of the time zone where the API process runs.
 */
export function tripCompletionDeadline(trip: Pick<TripDoc, 'date' | 'shiftTime'>): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trip.date) || !/^\d{2}:\d{2}$/.test(trip.shiftTime)) {
    return null;
  }
  const [hours, minutes] = trip.shiftTime.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;

  const deadline = new Date(`${trip.date}T${trip.shiftTime}:00+05:30`);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

function pendingEmployees(trip: AlertTrip): AlertTrip['employeeIds'] {
  const verified = new Set(trip.verifiedEmployees.map((employeeId) => employeeId.toString()));
  return trip.employeeIds.filter((employee) => !verified.has(employee._id.toString()));
}

export function pendingEmployeeDltSummary(
  pending: Array<{ empId: string; name: string }>,
): string {
  if (pending.length === 0) return 'NONE';
  const first = dltTextVariable([pending[0].empId, pending[0].name], 'UNKNOWN');
  if (pending.length === 1) return first;
  const suffix = ` AND ${pending.length - 1} OTHERS`;
  return `${first.slice(0, Math.max(1, 40 - suffix.length)).trimEnd()}${suffix}`;
}

function tripLabel(trip: AlertTrip): string {
  return `${trip.type} trip ${trip.tripId} (${trip.routeId?.name || trip.location || 'Route not set'})`;
}

async function createOverdueNotification(trip: AlertTrip, now: Date): Promise<void> {
  // Claim the alert atomically before creating it, so the minute-by-minute job
  // and a second API instance cannot create duplicate admin notifications.
  const claimed = await Trip.findOneAndUpdate(
    { _id: trip._id, overdueNotifiedAt: null, completedAt: null },
    { $set: { overdueNotifiedAt: now } },
    { new: true }
  );
  if (!claimed) return;

  try {
    await createNotification({
      type: 'info',
      title: `Trip overdue: ${trip.tripId}`,
      body: `${tripLabel(trip)} was not ended by its allocated ${trip.shiftTime} time. Driver: ${trip.driverId?.name || 'Unassigned'}; vehicle: ${trip.vehicleId?.rtoNo || '—'}.`,
      refId: trip.tripId,
      link: '/live_trip_monitor',
    });
  } catch (err) {
    // Allow a later check to try again if persistence/broadcasting failed.
    await Trip.updateOne({ _id: trip._id, overdueNotifiedAt: now }, { $set: { overdueNotifiedAt: null } });
    console.error(`[trip-alert] Failed to create overdue notification for ${trip.tripId}:`, err);
  }
}

async function autoCancelUnstartedTrip(trip: AlertTrip, now: Date): Promise<void> {
  const updated = await Trip.findOneAndUpdate(
    {
      _id: trip._id,
      status: { $in: ['Not Started Yet', 'Driver Accepted'] },
      startedAt: null,
      completedAt: null,
    },
    { $set: { status: 'Auto Cancelled', completedAt: now } },
    { new: true },
  ).populate('vehicleId driverId routeId employeeIds');
  if (!updated) return;

  const populated = updated as unknown as AlertTrip;
  const body = `${populated.type} trip ${populated.tripId} for ${populated.date} at ${populated.shiftTime} was not started within 10 hours and was moved to reports.`;
  const notifications: Promise<unknown>[] = populated.employeeIds.map((employee) => createEmployeeNotification({
    employeeId: employee._id,
    type: 'info',
    title: 'Trip moved to reports',
    body,
    link: '/reports',
    refId: populated.tripId,
  }));
  if (populated.driverId?._id) {
    notifications.push(sendDriverTripExpiredPush({
      driverId: populated.driverId._id,
      tripId: populated.tripId,
      tripType: populated.type,
      date: populated.date,
      time: populated.shiftTime,
    }));
  }
  await Promise.allSettled(notifications);

  emitTripStatus({
    trip: toTripDTO(updated as unknown as Parameters<typeof toTripDTO>[0]),
    driverId: populated.driverId?._id.toString() ?? '',
    employeeIds: populated.employeeIds.map((employee) => employee._id.toString()),
  });
}

function incompleteOtpMessage(trip: AlertTrip, pending: AlertTrip['employeeIds']): string {
  const verifiedCount = trip.employeeIds.length - pending.length;
  const pendingList = pending.map((employee) => `${employee.name} (${employee.empId})`).join(', ');
  return [
    `Trip: ${trip.tripId} | ${trip.type} | ${trip.date} ${trip.shiftTime}`,
    `Route: ${trip.routeId?.name || trip.location || 'Not set'} | Vehicle: ${trip.vehicleId?.rtoNo || 'Not set'}`,
    `Driver: ${trip.driverId?.name || 'Unassigned'} (${trip.driverId?.contact || 'No phone'})`,
    `Employees: ${trip.employeeIds.length}; OTP verified: ${verifiedCount}; pending: ${pending.length}`,
    `Pending: ${pendingList}`,
  ].join(' | ');
}

async function sendIncompleteOtpSms(trip: AlertTrip, now: Date): Promise<void> {
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const claimed = await Trip.findOneAndUpdate(
    {
      _id: trip._id,
      incompleteOtpSmsSentAt: null,
      $or: [{ incompleteOtpSmsClaimedAt: null }, { incompleteOtpSmsClaimedAt: { $lte: staleClaim } }],
    },
    { $set: { incompleteOtpSmsClaimedAt: now } },
    { new: true }
  ).populate('vehicleId driverId routeId employeeIds');
  if (!claimed) return;

  const populated = claimed as unknown as AlertTrip;
  const pending = pendingEmployees(populated);
  if (pending.length === 0 || populated.completedAt) {
    await Trip.updateOne({ _id: populated._id }, { $set: { incompleteOtpSmsClaimedAt: null } });
    return;
  }

  const alertPhone = (await SosConfig.findOne())?.alertPhone.trim();
  if (!alertPhone) {
    // No recipient is configured yet. Leave this eligible so saving a number in
    // SOS Alerts lets the next check deliver the escalation.
    await Trip.updateOne({ _id: populated._id }, { $set: { incompleteOtpSmsClaimedAt: null } });
    return;
  }

  try {
    await sendCompanySms({
      phone: alertPhone,
      kind: 'otp-escalation',
      // Fast2SMS Message ID 224776: trip ID, then pending employee summary.
      variables: [
        dltTextVariable([populated.tripId]),
        pendingEmployeeDltSummary(pending),
      ],
      fallbackBody: incompleteOtpMessage(populated, pending),
      referenceId: populated._id.toString(),
      retryPolicy: { dedupeUncertain: true, maxAttempts: 3, baseDelayMs: 60_000 },
    });
    await Trip.updateOne(
      { _id: populated._id, incompleteOtpSmsSentAt: null },
      { $set: { incompleteOtpSmsSentAt: now, incompleteOtpSmsClaimedAt: null } }
    );
  } catch (err) {
    // Do not mark a failed delivery as sent. A later scheduler pass retries it.
    await Trip.updateOne({ _id: populated._id }, { $set: { incompleteOtpSmsClaimedAt: null } });
    console.error(`[trip-alert] Failed to send incomplete-OTP SMS for ${populated.tripId}:`, err);
  }
}

/** Run one pass of both operational trip-alert policies. Exported for tests. */
export async function processTripAlerts(now = new Date()): Promise<void> {
  const docs = await Trip.find({
    frozen: true,
    completedAt: null,
    // A driver who never starts a frozen trip has also missed the allocated
    // completion time, so overdue admin alerts cover both started and unstarted
    // trips. The OTP SMS below remains limited to trips that actually started.
    status: { $in: OVERDUE_ELIGIBLE_STATUSES },
  }).populate('vehicleId driverId routeId employeeIds');

  for (const doc of docs) {
    const trip = doc as unknown as AlertTrip;
    const deadline = tripCompletionDeadline(trip);
    if (deadline && deadline.getTime() <= now.getTime()) {
      await createOverdueNotification(trip, now);
      if (!trip.startedAt && deadline.getTime() + UNSTARTED_TRIP_GRACE_MS <= now.getTime()) {
        await autoCancelUnstartedTrip(trip, now);
        continue;
      }
    }

    if (trip.startedAt && trip.startedAt.getTime() + OTP_ESCALATION_MS <= now.getTime()) {
      const pending = pendingEmployees(trip);
      if (pending.length > 0) await sendIncompleteOtpSms(trip, now);
    }
  }
}

let scheduler: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

/** Start the production scheduler once after MongoDB and Socket.IO are ready. */
export function startTripAlertScheduler(): void {
  if (scheduler) return;
  const run = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const companies = await Company.find({ status: 'active' }).select('_id').lean();
      for (const company of companies) {
        await tenantContext.run({ companyId: company._id.toString() }, () => processTripAlerts());
      }
    } catch (err) {
      console.error('[trip-alert] Scheduled trip alert check failed:', err);
    } finally {
      schedulerRunning = false;
    }
  };

  void run();
  scheduler = setInterval(() => { void run(); }, ALERT_CHECK_INTERVAL_MS);
}

export function stopTripAlertScheduler(): void {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}
