import { Router } from 'express';
import { Trip } from '../models/Trip.js';
import { Roster } from '../models/Roster.js';
import { Approval } from '../models/Approval.js';
import { toTripDTO } from '../mappers.js';
import { asyncHandler } from '../middleware/errors.js';
import { STATUS_BUCKETS, localToday, addDays } from '../lib/statusBuckets.js';
import type { DashboardStats, TripTableRow, VendorPerformanceRow } from '../types/dto.js';

export const dashboardRouter = Router();

const TRIP_POPULATE = 'vehicleId driverId routeId';
type PopulatedTrip = Parameters<typeof toTripDTO>[0];

function toTableRow(doc: PopulatedTrip): TripTableRow {
  const dto = toTripDTO(doc);
  return {
    type: dto.type,
    count: dto.empCount,
    vehicle: dto.vehicleNo,
    vendor: dto.vendor,
    driver: (doc.driverId as { name?: string } | null)?.name ?? '',
  };
}

dashboardRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const today = localToday();

    const [rosterCounts, tripTypeAgg, statusAgg, vendorAgg, approvalAgg] = await Promise.all([
      Roster.aggregate<{ _id: string; n: number }>([
        { $match: { date: today } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Trip.aggregate<{ _id: string; emps: number; trips: number }>([
        { $match: { date: today } },
        { $group: { _id: '$type', emps: { $sum: { $size: '$employeeIds' } }, trips: { $sum: 1 } } },
      ]),
      Trip.aggregate<{ _id: string; n: number }>([
        { $match: { date: today } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Trip.aggregate<{ _id: string; tripCount: number; completed: number }>([
        { $match: { date: { $gte: addDays(today, -7), $lte: today } } },
        {
          $group: {
            _id: '$vendor',
            tripCount: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $in: ['$status', STATUS_BUCKETS.completed] }, 1, 0] },
            },
          },
        },
        { $sort: { tripCount: -1 } },
      ]),
      Approval.aggregate<{ _id: { category: string; status: string }; n: number }>([
        { $group: { _id: { category: '$category', status: '$status' }, n: { $sum: 1 } } },
      ]),
    ]);

    const rosterByStatus = Object.fromEntries(rosterCounts.map((r) => [r._id, r.n]));
    const rosterTotal = rosterCounts.reduce((sum, r) => sum + r.n, 0);

    const byType = Object.fromEntries(tripTypeAgg.map((t) => [t._id, t]));
    const statusByName = Object.fromEntries(statusAgg.map((s) => [s._id, s.n]));
    const bucketCount = (bucket: string) =>
      STATUS_BUCKETS[bucket].reduce((sum, s) => sum + (statusByName[s] ?? 0), 0);

    const tableFor = async (bucket: string): Promise<TripTableRow[]> => {
      const docs = await Trip.find({ date: today, status: { $in: STATUS_BUCKETS[bucket] } })
        .limit(6)
        .populate(TRIP_POPULATE);
      return docs.map((d) => toTableRow(d as unknown as PopulatedTrip));
    };

    const [tripsInProgress, upcomingTrips, completedTrips, autoCancel] = await Promise.all([
      tableFor('in-progress'),
      tableFor('not-started'),
      tableFor('completed'),
      tableFor('cancelled'),
    ]);

    const vendorPerformance: VendorPerformanceRow[] = vendorAgg
      .filter((v) => v._id)
      .map((v) => ({
        vendor: v._id,
        percentage: v.tripCount ? Math.round((v.completed / v.tripCount) * 100) : 0,
        tripCount: v.tripCount,
        completed: v.completed,
      }));

    const approvalCount = (category: string, status: string) =>
      approvalAgg.find((a) => a._id.category === category && a._id.status === status)?.n ?? 0;

    const stats: DashboardStats = {
      rostering: [
        { label: 'Total Rostered', value: rosterTotal, subLabel: today },
        { label: 'Pending', value: rosterByStatus.pending ?? 0, subLabel: 'Awaiting approval' },
        { label: 'Approved', value: rosterByStatus.approved ?? 0, subLabel: 'Ready for trips' },
        { label: 'Completed', value: rosterByStatus.completed ?? 0, subLabel: 'Trips done' },
      ],
      employeeTrips: [
        {
          label: 'Login (Pick)',
          value: byType.PickUp?.emps ?? 0,
          subLabel: `${byType.PickUp?.trips ?? 0} trips`,
        },
        {
          label: 'Logout (Drop)',
          value: byType.Drop?.emps ?? 0,
          subLabel: `${byType.Drop?.trips ?? 0} trips`,
        },
      ],
      liveTrips: [
        { label: 'In Progress', value: bucketCount('in-progress'), subLabel: 'On the road' },
        { label: 'Yet To Start', value: bucketCount('not-started'), subLabel: 'Scheduled' },
        { label: 'Completed', value: bucketCount('completed'), subLabel: 'Incl. late & no-show' },
        { label: 'Delayed', value: bucketCount('delayed'), subLabel: 'Completed late' },
        { label: 'Cancelled', value: bucketCount('cancelled'), subLabel: 'Auto / rejected' },
      ],
      tripsInProgress,
      upcomingTrips,
      completedTrips,
      autoCancel,
      vendorPerformance,
      approval: {
        rostering: {
          pending: rosterByStatus.pending ?? 0,
          approved: rosterByStatus.approved ?? 0,
        },
        employeeAddressChange: {
          pending: approvalCount('employeeAddressChange', 'pending'),
          approved: approvalCount('employeeAddressChange', 'approved'),
        },
        workspaceBooking: {
          pending: approvalCount('workspaceBooking', 'pending'),
          approved: approvalCount('workspaceBooking', 'approved'),
        },
      },
    };

    res.json(stats);
  })
);
