import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { Roster, type RosterDoc } from '../models/Roster.js';
import { Employee } from '../models/Employee.js';
import { toRosterDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { localToday } from '../lib/statusBuckets.js';

export const rostersRouter = Router();

type Populated = Parameters<typeof toRosterDTO>[0];

rostersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date, fromDate, toDate, status, tripType } = req.query as Record<string, string | undefined>;
    const query: FilterQuery<RosterDoc> = {};
    if (date) query.date = date;
    else if (fromDate || toDate) {
      query.date = {};
      if (fromDate) query.date.$gte = fromDate;
      if (toDate) query.date.$lte = toDate;
    }
    if (status) query.status = status;
    if (tripType) query.tripType = tripType;
    const docs = await Roster.find(query).populate('employeeId');
    res.json(docs.map((d) => toRosterDTO(d as unknown as Populated)));
  })
);

// Bulk upsert: one roster per employee per date per tripType.
rostersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const entries = req.body as {
      empId: string;
      date?: string;
      tripType?: string;
      timing?: string;
      rosterType?: string;
      status?: string;
    }[];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new HttpError(400, 'Body must be a non-empty array of roster entries');
    }

    const results = [];
    for (const entry of entries) {
      const employee = await Employee.findOne({ empId: entry.empId });
      if (!employee) throw new HttpError(422, `Employee ${entry.empId} does not exist`);
      const date = entry.date ?? localToday();
      const tripType = entry.tripType === 'drop' ? 'drop' : 'pickup';
      const doc = await Roster.findOneAndUpdate(
        { employeeId: employee._id, date, tripType },
        {
          employeeId: employee._id,
          date,
          tripType,
          timing: entry.timing ?? '',
          rosterType: entry.rosterType ?? 'Regular',
          status: entry.status ?? 'pending',
        },
        { new: true, upsert: true }
      );
      await doc.populate('employeeId');
      results.push(toRosterDTO(doc as unknown as Populated));
    }
    res.status(201).json(results);
  })
);

// Bulk workbook import. Unlike the legacy POST endpoint this returns all
// rejected rows instead of stopping at the first unknown employee.
rostersRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const entries = (req.body as { entries?: unknown }).entries;
    if (!Array.isArray(entries) || entries.length === 0) throw new HttpError(400, 'entries must be a non-empty array');
    if (entries.length > 5_000) throw new HttpError(413, 'A roster import may contain at most 5,000 entries');
    const normalized = entries.map((entry, index) => ({
      row: index + 2,
      empId: String((entry as Record<string, unknown>).empId ?? '').trim(),
      date: String((entry as Record<string, unknown>).date ?? '').trim(),
      tripType: String((entry as Record<string, unknown>).tripType ?? '').trim().toLowerCase(),
      timing: String((entry as Record<string, unknown>).timing ?? '').trim(),
      rosterType: String((entry as Record<string, unknown>).rosterType ?? 'Regular').trim() || 'Regular',
    }));
    const employees = await Employee.find({ empId: { $in: [...new Set(normalized.map((entry) => entry.empId).filter(Boolean))] } });
    const byId = new Map(employees.map((employee) => [employee.empId, employee]));
    const rejected: { row: number; reasons: string[] }[] = [];
    const valid: { employeeId: typeof employees[number]['_id']; date: string; tripType: 'pickup' | 'drop'; timing: string; rosterType: string }[] = [];
    const seen = new Set<string>();
    for (const entry of normalized) {
      const reasons: string[] = [];
      const employee = byId.get(entry.empId);
      if (!entry.empId) reasons.push('Employee ID is required');
      else if (!employee) reasons.push(`Employee ${entry.empId} is not registered in this company`);
      else if (employee.active !== 'Yes') reasons.push(`Employee ${entry.empId} is inactive`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(new Date(`${entry.date}T00:00:00Z`).getTime())) reasons.push('Date must use YYYY-MM-DD');
      if (entry.tripType !== 'pickup' && entry.tripType !== 'drop') reasons.push('Trip Type must be pickup or drop');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.timing)) reasons.push('Shift time must use HH:mm');
      const key = `${entry.empId}|${entry.date}|${entry.tripType}`;
      if (seen.has(key)) reasons.push('Duplicate employee/date/trip type in this import');
      seen.add(key);
      if (reasons.length || !employee) rejected.push({ row: entry.row, reasons });
      else valid.push({ employeeId: employee._id, date: entry.date, tripType: entry.tripType as 'pickup' | 'drop', timing: entry.timing, rosterType: entry.rosterType });
    }
    if (valid.length) {
      await Roster.bulkWrite(valid.map((entry) => ({
        updateOne: {
          filter: { employeeId: entry.employeeId, date: entry.date, tripType: entry.tripType },
          update: { $set: { ...entry, status: 'pending' } }, upsert: true,
        },
      })));
    }
    res.status(201).json({ saved: valid.length, rejected });
  })
);

// DELETE /api/rosters?empId=&date=&tripType=pickup|drop|both — remove saved shifts
// (drives the right-click "Remove Login / Logout / Both" menu in the Rostering grid)
rostersRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const { empId, date, tripType } = req.query as Record<string, string | undefined>;
    if (!empId || !date) throw new HttpError(400, 'empId and date are required');

    const employee = await Employee.findOne({ empId });
    if (!employee) throw new HttpError(404, `Employee ${empId} not found`);

    const query: FilterQuery<RosterDoc> = { employeeId: employee._id, date };
    if (tripType === 'pickup' || tripType === 'drop') query.tripType = tripType;
    // tripType 'both' (or missing) deletes login + logout for that day

    const result = await Roster.deleteMany(query);
    res.json({ deleted: result.deletedCount ?? 0 });
  })
);

rostersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body as { status?: string };
    if (!status || !['pending', 'approved', 'completed'].includes(status)) {
      throw new HttpError(400, 'status must be pending, approved or completed');
    }
    const doc = await Roster.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate(
      'employeeId'
    );
    if (!doc) throw new HttpError(404, 'Roster entry not found');
    res.json(toRosterDTO(doc as unknown as Populated));
  })
);
