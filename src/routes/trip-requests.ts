import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { TripRequest, type TripRequestType } from '../models/TripRequest.js';
import { Employee } from '../models/Employee.js';
import { Vehicle } from '../models/Vehicle.js';
import { Trip } from '../models/Trip.js';
import { Route } from '../models/Route.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { localToday } from '../lib/statusBuckets.js';
import { nextTripId } from './trips.js';
import { emitTripFrozen, emitTripRequestRejected } from '../websocket/index.js';
import { toDriverTripDTO, toEmployeeTripDTO, toTripDTO } from '../mappers.js';
import { dltTextVariable, sendCompanySms } from '../services/sms.service.js';
import { createEmployeeNotification } from '../services/employee-notification.service.js';
import { recommendRoute } from '../services/route-geometry.service.js';

export const employeeTripRequestsRouter = Router();
export const adminTripRequestsRouter = Router();

function validTime(value: unknown): boolean {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}

function validPoint(lat: unknown, lng: unknown): boolean {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

function requestDto(doc: any) {
  return {
    id: doc._id.toString(), employeeId: doc.employeeId?.empId ?? doc.employeeId?.toString(),
    employeeName: doc.employeeId?.name ?? '', employeeContact: doc.employeeId?.contact ?? '',
    date: doc.date, type: doc.type, loginTime: doc.loginTime, logoutTime: doc.logoutTime,
    address: doc.address, formattedAddress: doc.formattedAddress, lat: doc.lat, lng: doc.lng,
    locationSource: doc.locationSource, routeName: doc.routeName, notes: doc.notes,
    escort: doc.escort, status: doc.status, rejectionReason: doc.rejectionReason,
    tripId: doc.tripId, createdAt: doc.createdAt?.toISOString?.() ?? null,
  };
}

employeeTripRequestsRouter.get('/', asyncHandler(async (req, res) => {
  const docs = await TripRequest.find({ employeeId: req.auth!.sub }).sort({ date: 1, createdAt: -1 });
  res.json(docs.map(requestDto));
}));

employeeTripRequestsRouter.put('/profile/location', asyncHandler(async (req, res) => {
  const body = req.body as { address?: string; formattedAddress?: string; lat?: number; lng?: number };
  if (!body.address?.trim() || !validPoint(body.lat, body.lng)) throw new HttpError(400, 'A valid address and map location are required');
  const employee = await Employee.findByIdAndUpdate(req.auth!.sub, {
    $set: { address: body.address.trim(), location: body.formattedAddress?.trim() || body.address.trim(), latLong: `${Number(body.lat)},${Number(body.lng)}` },
  }, { new: true });
  if (!employee) throw new HttpError(404, 'Employee not found');
  res.json({ address: employee.address, location: employee.location, latLong: employee.latLong });
}));

employeeTripRequestsRouter.post('/', asyncHandler(async (req, res) => {
  const body = req.body as {
    dates?: string[]; type?: TripRequestType; loginTime?: string; logoutTime?: string;
    address?: string; formattedAddress?: string; lat?: number; lng?: number;
    locationSource?: 'saved' | 'custom' | 'current'; notes?: string; escort?: string; routeName?: string;
  };
  if (!Array.isArray(body.dates) || body.dates.length === 0) throw new HttpError(400, 'At least one trip date is required');
  if (!body.type || !['pickup', 'drop', 'both'].includes(body.type)) throw new HttpError(400, 'Trip type must be pickup, drop or both');
  if (!body.address?.trim() || !validPoint(body.lat, body.lng)) throw new HttpError(400, 'A valid address and map location are required');
  if (!validTime(body.loginTime) || !validTime(body.logoutTime)) throw new HttpError(400, 'Times must use HH:mm');
  const uniqueDates = [...new Set(body.dates.map((date) => String(date).trim()))].sort();
  if (uniqueDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localToday())) {
    throw new HttpError(400, 'Trip dates must be today or later and use YYYY-MM-DD');
  }
  const employee = await Employee.findById(req.auth!.sub);
  if (!employee || employee.active !== 'Yes') throw new HttpError(403, 'Employee account is inactive');
  const existing = await TripRequest.find({ employeeId: employee._id, date: { $in: uniqueDates }, type: body.type }).select('date');
  if (existing.length) throw new HttpError(409, `A ${body.type} request already exists for ${existing.map((doc) => doc.date).join(', ')}`);
  const recommendation = await recommendRoute(`${Number(body.lat)},${Number(body.lng)}`);
  const docs = await Promise.all(uniqueDates.map((date) => TripRequest.create({
    employeeId: employee._id, date, type: body.type, loginTime: body.loginTime?.trim() ?? '',
    logoutTime: body.logoutTime?.trim() ?? '', address: body.address!.trim(),
    formattedAddress: body.formattedAddress?.trim() || body.address!.trim(), lat: Number(body.lat), lng: Number(body.lng),
    locationSource: body.locationSource ?? 'custom', notes: body.notes?.trim().slice(0, 500) ?? '',
    escort: body.escort === 'Yes' ? 'Yes' : 'No', routeName: body.routeName?.trim() || recommendation.routeName || '', status: 'submitted',
  })));
  res.status(201).json(docs.map(requestDto));
}));

employeeTripRequestsRouter.put('/:id', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Trip request not found');
  const request = await TripRequest.findOne({ _id: req.params.id, employeeId: req.auth!.sub });
  if (!request) throw new HttpError(404, 'Trip request not found');
  if (request.status !== 'rejected') throw new HttpError(409, 'Only rejected requests can be edited');
  const body = req.body as Record<string, unknown>;
  if (body.address !== undefined) request.address = String(body.address).trim();
  if (body.formattedAddress !== undefined) request.formattedAddress = String(body.formattedAddress).trim();
  if (body.lat !== undefined) request.lat = Number(body.lat);
  if (body.lng !== undefined) request.lng = Number(body.lng);
  if (!request.address || !validPoint(request.lat, request.lng)) throw new HttpError(400, 'A valid address and map location are required');
  if (body.loginTime !== undefined) request.loginTime = String(body.loginTime);
  if (body.logoutTime !== undefined) request.logoutTime = String(body.logoutTime);
  if (body.notes !== undefined) request.notes = String(body.notes).slice(0, 500);
  request.status = 'submitted'; request.rejectionReason = ''; await request.save();
  res.json(requestDto(request));
}));

adminTripRequestsRouter.get('/', asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const query = status ? { status } : {};
  const docs = await TripRequest.find(query).sort({ date: 1, createdAt: 1 }).populate('employeeId');
  res.json(docs.map(requestDto));
}));

adminTripRequestsRouter.put('/:id/reject', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Trip request not found');
  const reason = String((req.body as { reason?: string }).reason ?? '').trim();
  if (!reason) throw new HttpError(400, 'A rejection reason is required');
  const request = await TripRequest.findById(req.params.id).populate('employeeId');
  if (!request) throw new HttpError(404, 'Trip request not found');
  if (request.status !== 'submitted') throw new HttpError(409, 'Only submitted requests can be rejected');
  request.status = 'rejected';
  request.rejectionReason = reason.slice(0, 500);
  request.reviewedAt = new Date();
  request.reviewedBy = new Types.ObjectId(req.auth!.sub);
  await request.save();
  const rejectedEmployeeId = (request.employeeId as any)?._id ?? request.employeeId;
  emitTripRequestRejected(rejectedEmployeeId.toString(), { date: request.date, reason });
  const employee = request.employeeId as any;
  await Promise.allSettled([
    createEmployeeNotification({
      employeeId: rejectedEmployeeId,
      type: 'trip-rejected',
      title: 'Trip request rejected',
      body: `${request.type} trip for ${request.date} was rejected: ${reason}`,
      link: `/create-trip?edit=${request._id}`,
      refId: request._id.toString(),
    }),
    employee?.contact ? sendCompanySms({
      phone: employee.contact,
      kind: 'trip-employee-rejected',
      variables: [
        dltTextVariable([request.type]),
        dltTextVariable([request.date]),
        dltTextVariable([reason]),
      ],
      fallbackBody: `${request.type} trip for ${request.date} rejected: ${reason}`,
      referenceId: `${request._id}:employee:rejected`,
    }) : Promise.resolve(),
  ]);
  res.json(requestDto(request));
}));

adminTripRequestsRouter.put('/:id/approve', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Trip request not found');
  const body = req.body as { vehicleNo?: string; escort?: string };
  const request = await TripRequest.findById(req.params.id).populate('employeeId');
  if (!request) throw new HttpError(404, 'Trip request not found');
  if (request.status !== 'submitted') throw new HttpError(409, 'Only submitted requests can be approved');
  const vehicle = await Vehicle.findOne({ rtoNo: body.vehicleNo, active: 'Yes' });
  if (!vehicle?.driverId) throw new HttpError(422, 'Select an active vehicle with an assigned driver');
  const route = request.routeName ? await Route.findOne({ name: request.routeName }) : await Route.findOne();
  if (!route) throw new HttpError(422, 'No route is available for this trip');
  const employee = request.employeeId as any;
  const legs = request.type === 'both' ? ['PickUp', 'Drop'] : [request.type === 'drop' ? 'Drop' : 'PickUp'];
  const tripIds: string[] = [];
  for (const tripType of legs) {
    const tripId = await nextTripId(request.date);
    tripIds.push(tripId);
    await Trip.create({
      tripId, status: 'Not Started Yet', type: tripType, date: request.date,
      escort: body.escort === 'Yes' || request.escort === 'Yes' ? 'Yes' : 'No',
      shiftTime: tripType === 'Drop' ? request.logoutTime : request.loginTime,
      vehicleId: vehicle._id, driverId: vehicle.driverId, routeId: route._id, employeeIds: [employee._id],
      vendor: vehicle.vendor, location: request.formattedAddress || request.address, frozen: true,
    });
    const populated = await Trip.findOne({ tripId }).populate('vehicleId driverId routeId employeeIds') as any;
    if (populated) {
      emitTripFrozen({
        adminTrip: toTripDTO(populated),
        driverTrip: toDriverTripDTO(populated),
        driverId: populated.driverId?._id.toString() ?? '',
        employeeTrips: populated.employeeIds.map((item: any) => ({ employeeId: item._id.toString(), trip: toEmployeeTripDTO(populated, item._id) })),
      });
      const driver = populated.driverId;
      const time = tripType === 'Drop' ? request.logoutTime : request.loginTime;
      if (driver?.contact) await Promise.allSettled([
        sendCompanySms({
          phone: driver.contact,
          kind: 'trip-driver',
          variables: [tripId, dltTextVariable([request.date, time])],
          fallbackBody: `Trip ${tripId} assigned for ${request.date}.`,
          referenceId: `${request._id}:driver:${tripId}`,
        }),
      ]);
    }
  }
  request.status = 'confirmed'; request.tripId = tripIds.join(','); request.reviewedAt = new Date(); request.reviewedBy = new Types.ObjectId(req.auth!.sub); await request.save();
  await Promise.allSettled([
    createEmployeeNotification({
      employeeId: employee._id,
      type: 'trip-approved',
      title: 'Trip request approved',
      body: `${request.type} trip for ${request.date} was approved`,
      link: tripIds[0] ? `/trip/${encodeURIComponent(tripIds[0])}` : '/',
      refId: request._id.toString(),
    }),
    sendCompanySms({
      phone: employee.contact,
      kind: 'trip-employee',
      variables: [dltTextVariable([request.type]), dltTextVariable([request.date])],
      fallbackBody: `${request.type} trip for ${request.date} approved.`,
      referenceId: `${request._id}:employee:approved`,
    }),
  ]);
  res.json({ ...requestDto(request), tripId: request.tripId });
}));
