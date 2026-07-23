import { Router } from 'express';
import { Route } from '../models/Route.js';
import { Employee } from '../models/Employee.js';
import { toRouteDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requirePermission } from '../middleware/auth.js';
import type { Route as RouteDTO } from '../types/dto.js';
import { recommendRoute, rebuildRouteGeometry } from '../services/route-geometry.service.js';

export const routesRouter = Router();

// Reads (route list/detail) stay open to staff — Master Routing's map needs them.
// Only creating/editing/deleting routes is admin-only.
const adminOnly = requirePermission((role) => role === 'admin' || role === 'platform-owner');

const MAX_ROUTES = 7;

async function employeeCount(routeName: string): Promise<number> {
  return Employee.countDocuments({ route: routeName, active: 'Yes' });
}

routesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const docs = await Route.find().sort({ routeId: 1 });
    const counts = await Promise.all(docs.map((d) => employeeCount(d.name)));
    res.json(docs.map((d, i) => toRouteDTO(d, counts[i])));
  })
);

routesRouter.post(
  '/recommend',
  asyncHandler(async (req, res) => {
    const { latLong } = req.body as { latLong?: string };
    res.json(await recommendRoute(latLong));
  })
);

routesRouter.post(
  '/:id/rebuild-geometry',
  adminOnly,
  asyncHandler(async (req, res) => {
    const routeId = Number(req.params.id);
    const exists = await Route.exists({ routeId });
    if (!exists) throw new HttpError(404, 'Route not found');
    await rebuildRouteGeometry(routeId);
    const doc = await Route.findOne({ routeId });
    res.json(toRouteDTO(doc!, await employeeCount(doc!.name)));
  })
);

routesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Route.findOne({ routeId: Number(req.params.id) });
    if (!doc) throw new HttpError(404, 'Route not found');
    res.json(toRouteDTO(doc, await employeeCount(doc.name)));
  })
);

routesRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<RouteDTO> & { destinationAddress?: string; destLat?: number; destLng?: number };
    if (!body.name) throw new HttpError(400, 'name is required');
    if (!Number.isFinite(body.destLat) || !Number.isFinite(body.destLng)
      || Math.abs(body.destLat!) > 90 || Math.abs(body.destLng!) > 180) {
      throw new HttpError(400, 'valid destination latitude and longitude are required');
    }
    const total = await Route.countDocuments();
    if (total >= MAX_ROUTES) throw new HttpError(409, `Maximum ${MAX_ROUTES} routes allowed`);
    const last = await Route.findOne().sort({ routeId: -1 });
    const routeId = body.id ?? (last ? last.routeId + 1 : 1);
    const exists = await Route.findOne({ $or: [{ routeId }, { name: body.name }] });
    if (exists) throw new HttpError(409, 'Route with same id or name already exists');
    const doc = await Route.create({
      routeId,
      name: body.name,
      type: body.type ?? 'Both',
      destinationAddress: body.destinationAddress ?? '',
      destLat: body.destLat ?? null,
      destLng: body.destLng ?? null,
      geometryStatus: 'pending',
    });
    await rebuildRouteGeometry(routeId);
    const fresh = await Route.findOne({ routeId });
    res.status(201).json(toRouteDTO(fresh!, 0));
  })
);

routesRouter.put(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<RouteDTO> & { destinationAddress?: string; destLat?: number | null; destLng?: number | null };
    if (body.destLat !== undefined && (body.destLat === null || !Number.isFinite(body.destLat) || Math.abs(body.destLat) > 90)) {
      throw new HttpError(400, 'destination latitude must be between -90 and 90');
    }
    if (body.destLng !== undefined && (body.destLng === null || !Number.isFinite(body.destLng) || Math.abs(body.destLng) > 180)) {
      throw new HttpError(400, 'destination longitude must be between -180 and 180');
    }
    const before = await Route.findOne({ routeId: Number(req.params.id) });
    if (!before) throw new HttpError(404, 'Route not found');
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.type !== undefined) update.type = body.type;
    if (body.destinationAddress !== undefined) update.destinationAddress = body.destinationAddress;
    if (body.destLat !== undefined) update.destLat = body.destLat;
    if (body.destLng !== undefined) update.destLng = body.destLng;
    const geometryChanged = body.destLat !== undefined || body.destLng !== undefined;
    if (geometryChanged) update.geometryStatus = 'pending';
    const doc = await Route.findOneAndUpdate({ routeId: Number(req.params.id) }, update, { new: true });
    if (body.name !== undefined && body.name !== before.name) {
      await Employee.updateMany({ route: before.name }, { route: body.name });
    }
    if (geometryChanged) {
      await rebuildRouteGeometry(doc!.routeId);
    }
    const fresh = await Route.findOne({ routeId: doc!.routeId });
    res.json(toRouteDTO(fresh!, await employeeCount(fresh!.name)));
  })
);

routesRouter.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const doc = await Route.findOne({ routeId: Number(req.params.id) });
    if (!doc) throw new HttpError(404, 'Route not found');
    const assigned = await employeeCount(doc.name);
    if (assigned > 0) throw new HttpError(409, `Reassign ${assigned} active employees before deleting this route`);
    await doc.deleteOne();
    res.status(204).end();
  })
);
