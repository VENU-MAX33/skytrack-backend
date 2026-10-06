import { Router } from 'express';
import { Types } from 'mongoose';
import { Trip } from '../models/Trip.js';
import { toEmployeeTripDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { localToday, STATUS_BUCKETS } from '../lib/statusBuckets.js';

export const employeeTripsRouter = Router();

const TRIP_POPULATE = 'vehicleId driverId routeId employeeIds';
type PopulatedTrip = Parameters<typeof toEmployeeTripDTO>[0];
const REPORT_STATUSES = [...STATUS_BUCKETS.completed, ...STATUS_BUCKETS.cancelled];

function reportDate(value: unknown): string {
  const date = String(value ?? localToday());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new HttpError(400, 'date must use YYYY-MM-DD');
  }
  return date;
}

// GET /api/employee/trips — frozen/active trips that include this employee
employeeTripsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const selfId = new Types.ObjectId(req.auth!.sub);
    const docs = await Trip.find({
      employeeIds: selfId,
      frozen: true,
      completedAt: null,
      date: { $gte: localToday() },
    })
      .sort({ date: 1, shiftTime: 1 })
      .populate(TRIP_POPULATE);
    res.json(docs.map((d) => toEmployeeTripDTO(d as unknown as PopulatedTrip, selfId)));
  })
);

// GET /api/employee/trips/report?date=YYYY-MM-DD — completed and missed trips
employeeTripsRouter.get(
  '/report',
  asyncHandler(async (req, res) => {
    const selfId = new Types.ObjectId(req.auth!.sub);
    const date = reportDate(req.query.date);
    const docs = await Trip.find({
      employeeIds: selfId,
      frozen: true,
      completedAt: { $ne: null },
      status: { $in: REPORT_STATUSES },
      date,
    })
      .sort({ completedAt: -1, shiftTime: 1 })
      .populate(TRIP_POPULATE);
    res.json(docs.map((doc) => toEmployeeTripDTO(doc as unknown as PopulatedTrip, selfId)));
  }),
);

// GET /api/employee/trips/:tripId — trip detail with driver + vehicle info
employeeTripsRouter.get(
  '/:tripId',
  asyncHandler(async (req, res) => {
    const selfId = new Types.ObjectId(req.auth!.sub);
    const doc = await Trip.findOne({ tripId: req.params.tripId, employeeIds: selfId }).populate(
      TRIP_POPULATE
    );
    if (!doc) throw new HttpError(404, 'Trip not found');
    res.json(toEmployeeTripDTO(doc as unknown as PopulatedTrip, selfId));
  })
);
