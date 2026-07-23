import { Router } from 'express';
import { Employee } from '../models/Employee.js';
import { Route } from '../models/Route.js';
import { toEmployeeDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import type { Employee as EmployeeDTO } from '../types/dto.js';
import { parseEmployeePoint, recommendRoute } from '../services/route-geometry.service.js';
import { assertPhoneAvailable, normalizePhone } from '../services/phone-login.service.js';

export const employeesRouter = Router();
const MAX_BULK_EMPLOYEES = 5_000;

// Only these fields may be set through the API. Anything else the client sends
// (notably passwordHash, managed by the employee's own login flow) is dropped,
// so create/update cannot be used to inject it.
const EMPLOYEE_FIELDS = [
  'name', 'gender', 'contact', 'email', 'transportType', 'transportMode', 'distance',
  'address', 'location', 'nodalPoint', 'manager', 'pinCode', 'shiftLogin', 'shiftLogout',
  'fixedShift', 'latLong', 'team', 'specialNeed', 'route', 'active',
] as const;

function fromDTO(body: Partial<EmployeeDTO>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EMPLOYEE_FIELDS) {
    if (body[key] !== undefined) out[key] = key === 'contact' && body[key] ? normalizePhone(String(body[key])) : body[key];
  }
  if (body.id !== undefined) out.empId = body.id;
  return out;
}

// A mobile number can belong to only one employee (excludeEmpId skips the record being edited).
async function assertContactUnique(contact: string | undefined, excludeEmpId?: string): Promise<void> {
  const c = contact?.trim();
  if (!c) return;
  const current = excludeEmpId ? await Employee.findOne({ empId: excludeEmpId }).select('_id') : null;
  await assertPhoneAvailable('employee', c, current?._id);
}

async function validateAndAutoAssignRoute(latLong: string | undefined): Promise<string | null> {
  if (!latLong?.trim()) return null;
  if (!parseEmployeePoint(latLong)) throw new HttpError(422, 'Enter valid latitude,longitude values');
  const recommendation = await recommendRoute(latLong);
  if (recommendation.confidence === 'high') return recommendation.routeName;
  const alternatives = recommendation.candidates.map((candidate) =>
    `${candidate.routeName} (${candidate.distanceMeters} m)`
  ).join(', ');
  throw new HttpError(422, alternatives ? `${recommendation.reason}. Candidates: ${alternatives}` : recommendation.reason);
}

async function assertRouteExists(routeName: string | undefined): Promise<void> {
  if (!routeName?.trim()) return;
  if (!await Route.exists({ name: routeName.trim() })) throw new HttpError(422, `Route ${routeName.trim()} does not exist`);
}

interface EmployeeBulkError {
  row: number;
  reasons: string[];
}

async function prepareEmployeeBulk(rows: Partial<EmployeeDTO>[]): Promise<{
  prepared: Record<string, unknown>[];
  errors: EmployeeBulkError[];
}> {
  const prepared: Record<string, unknown>[] = [];
  const errors: EmployeeBulkError[] = [];
  const seenIds = new Set<string>();
  const seenContacts = new Set<string>();
  const ids = rows.map((row) => row.id?.trim()).filter((value): value is string => Boolean(value));
  const contacts = rows.map((row) => row.contact?.trim()).filter((value): value is string => Boolean(value));
  const [existingEmployees, routes] = await Promise.all([
    Employee.find({ $or: [{ empId: { $in: ids } }, { contact: { $in: contacts } }] })
      .select('empId name contact')
      .lean(),
    Route.find().select('name').lean(),
  ]);
  const existingIds = new Set(existingEmployees.map((employee) => employee.empId.toLowerCase()));
  const existingContacts = new Map(existingEmployees.map((employee) => [employee.contact, employee]));
  const routeNames = new Set(routes.map((route) => route.name));
  const globalContactErrors = new Map<string, string>();
  await Promise.all(contacts.map(async (contact) => {
    try { await assertPhoneAvailable('employee', contact); }
    catch (error) { globalContactErrors.set(contact, (error as Error).message); }
  }));

  for (let index = 0; index < rows.length; index++) {
    const body = rows[index];
    const reasons: string[] = [];
    const id = body.id?.trim() ?? '';
    const name = body.name?.trim() ?? '';
    const contact = body.contact?.trim() ?? '';
    const idKey = id.toLowerCase();

    if (!id) reasons.push('Employee ID is required');
    if (!name) reasons.push('Name is required');
    if (!contact) reasons.push('Contact is required');
    if ((body.transportType ?? 'Office Transport') !== 'Self Transport' && !body.latLong?.trim()) {
      reasons.push('Lat/Long is required for office transport');
    }
    if (id && seenIds.has(idKey)) reasons.push('Duplicate employee ID in this file');
    if (contact && seenContacts.has(contact)) reasons.push('Duplicate contact in this file');
    if (id && existingIds.has(idKey)) reasons.push(`Employee ${id} already exists`);
    const contactOwner = contact ? existingContacts.get(contact) : undefined;
    if (contactOwner) reasons.push(`Contact is already registered to ${contactOwner.name} (${contactOwner.empId})`);
    else if (contact && globalContactErrors.has(contact)) reasons.push(globalContactErrors.get(contact)!);
    if (body.route?.trim() && !routeNames.has(body.route.trim())) reasons.push(`Route ${body.route.trim()} does not exist`);

    if (body.latLong?.trim()) {
      const coordinates = body.latLong.split(',').map((value) => Number(value.trim()));
      if (coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(value))) {
        reasons.push('Lat/Long must contain valid latitude,longitude values');
      } else if (Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) {
        reasons.push('Lat/Long is outside the valid coordinate range');
      }
    }

    if (id) seenIds.add(idKey);
    if (contact) seenContacts.add(contact);

    let autoRoute: string | null = null;
    if (reasons.length === 0 && !body.route?.trim()) {
      try {
        autoRoute = await validateAndAutoAssignRoute(body.latLong);
      } catch (error) {
        reasons.push((error as Error).message);
      }
    }

    if (reasons.length > 0) {
      errors.push({ row: index + 2, reasons });
      continue;
    }
    const data = fromDTO({ ...body, id, name, contact });
    if (autoRoute && !body.route) data.route = autoRoute;
    prepared.push(data);
  }
  return { prepared, errors };
}

employeesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const docs = await Employee.find().sort({ empId: 1 });
    res.json(docs.map(toEmployeeDTO));
  })
);

employeesRouter.post(
  '/bulk/validate',
  asyncHandler(async (req, res) => {
    const { employees } = req.body as { employees?: Partial<EmployeeDTO>[] };
    if (!Array.isArray(employees) || employees.length === 0) {
      throw new HttpError(400, 'employees array is required');
    }
    if (employees.length > MAX_BULK_EMPLOYEES) {
      throw new HttpError(413, `A single import may contain at most ${MAX_BULK_EMPLOYEES} employees`);
    }
    const result = await prepareEmployeeBulk(employees);
    res.json({ valid: result.errors.length === 0, total: employees.length, errors: result.errors });
  })
);

employeesRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { employees } = req.body as { employees?: Partial<EmployeeDTO>[] };
    if (!Array.isArray(employees) || employees.length === 0) {
      throw new HttpError(400, 'employees array is required');
    }
    if (employees.length > MAX_BULK_EMPLOYEES) {
      throw new HttpError(413, `A single import may contain at most ${MAX_BULK_EMPLOYEES} employees`);
    }
    const result = await prepareEmployeeBulk(employees);
    if (result.errors.length > 0) {
      res.status(422).json({ error: 'Import contains invalid employees', created: 0, failed: result.errors.length, errors: result.errors });
      return;
    }
    await Employee.insertMany(result.prepared);
    res.status(201).json({ created: result.prepared.length, failed: 0, errors: [] });
  })
);

employeesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Employee.findOne({ empId: req.params.id });
    if (!doc) throw new HttpError(404, 'Employee not found');
    res.json(toEmployeeDTO(doc));
  })
);

employeesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as EmployeeDTO;
    if (!body.id || !body.name) throw new HttpError(400, 'id and name are required');
    const exists = await Employee.findOne({ empId: body.id });
    if (exists) throw new HttpError(409, `Employee ${body.id} already exists`);
    await assertContactUnique(body.contact);
    await assertRouteExists(body.route);
    if (body.transportType === 'Office Transport' && !body.latLong?.trim()) {
      throw new HttpError(422, 'Fetch or enter the employee location before saving office transport');
    }

    const autoRoute = body.route ? null : await validateAndAutoAssignRoute(body.latLong);
    const data = fromDTO(body);
    if (autoRoute && !body.route) data.route = autoRoute;

    const doc = await Employee.create(data);
    res.status(201).json(toEmployeeDTO(doc));
  })
);

employeesRouter.put(
  '/:id/active',
  asyncHandler(async (req, res) => {
    const { active } = req.body as { active: boolean };
    const doc = await Employee.findOneAndUpdate(
      { empId: req.params.id },
      { active: active ? 'Yes' : 'No' },
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Employee not found');
    res.json(toEmployeeDTO(doc));
  })
);

employeesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<EmployeeDTO>;
    await assertContactUnique(body.contact, req.params.id);
    await assertRouteExists(body.route);
    const shouldRecalculateRoute = body.latLong !== undefined && !body.route;
    const autoRoute = shouldRecalculateRoute ? await validateAndAutoAssignRoute(body.latLong) : null;
    const data = fromDTO(body);
    if (autoRoute && !body.route) data.route = autoRoute;

    const doc = await Employee.findOneAndUpdate(
      { empId: req.params.id },
      data,
      { new: true }
    );
    if (!doc) throw new HttpError(404, 'Employee not found');
    res.json(toEmployeeDTO(doc));
  })
);

employeesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Employee.findOneAndDelete({ empId: req.params.id });
    if (!doc) throw new HttpError(404, 'Employee not found');
    res.status(204).end();
  })
);
