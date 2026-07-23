import { env } from '../config/env.js';
import { CompanyConfig } from '../models/CompanyConfig.js';
import { Route, type RouteDoc, type RoutePoint } from '../models/Route.js';

export interface RouteCandidate {
  routeId: number;
  routeName: string;
  distanceMeters: number;
  direction: 'pickup' | 'drop';
}

export interface RouteRecommendation {
  routeName: string | null;
  distanceMeters: number | null;
  confidence: 'high' | 'ambiguous' | 'none';
  reason: string;
  candidates: RouteCandidate[];
}

export function validPoint(point: RoutePoint | null | undefined): point is RoutePoint {
  return Boolean(point) && Number.isFinite(point!.lat) && Number.isFinite(point!.lng)
    && Math.abs(point!.lat) <= 90 && Math.abs(point!.lng) <= 180;
}

export function parseEmployeePoint(raw: string | undefined): RoutePoint | null {
  if (!raw?.trim()) return null;
  const values = raw.split(',').map((value) => Number(value.trim()));
  const point = values.length === 2 ? { lat: values[0], lng: values[1] } : null;
  return validPoint(point) ? point : null;
}

function pointToSegmentMeters(point: RoutePoint, start: RoutePoint, end: RoutePoint): number {
  const radius = 6_371_000;
  const latRadians = point.lat * Math.PI / 180;
  const toLocal = (candidate: RoutePoint) => ({
    x: (candidate.lng - point.lng) * Math.PI / 180 * radius * Math.cos(latRadians),
    y: (candidate.lat - point.lat) * Math.PI / 180 * radius,
  });
  const a = toLocal(start);
  const b = toLocal(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / denominator));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

export function distanceToPathMeters(point: RoutePoint, path: RoutePoint[]): number {
  if (!validPoint(point) || path.length < 2) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index++) {
    if (!validPoint(path[index - 1]) || !validPoint(path[index])) continue;
    minimum = Math.min(minimum, pointToSegmentMeters(point, path[index - 1], path[index]));
  }
  return minimum;
}

function eligiblePaths(route: Pick<RouteDoc, 'type' | 'dropPath' | 'pickupPath'>): { direction: 'pickup' | 'drop'; path: RoutePoint[] }[] {
  const type = route.type.toLowerCase();
  const paths: { direction: 'pickup' | 'drop'; path: RoutePoint[] }[] = [];
  if (!type.startsWith('pickup') && route.dropPath?.length >= 2) paths.push({ direction: 'drop', path: route.dropPath });
  if (!type.startsWith('drop') && route.pickupPath?.length >= 2) paths.push({ direction: 'pickup', path: route.pickupPath });
  return paths;
}

export function matchRouteCorridor(
  point: RoutePoint,
  routes: Pick<RouteDoc, 'routeId' | 'name' | 'type' | 'dropPath' | 'pickupPath' | 'geometryStatus'>[],
  options: { maxMeters?: number; ambiguityMeters?: number } = {},
): RouteRecommendation {
  const maxMeters = options.maxMeters ?? env.routeCorridorMaxMeters;
  const ambiguityMeters = options.ambiguityMeters ?? env.routeAmbiguityMeters;
  const candidates: RouteCandidate[] = [];
  for (const route of routes) {
    if (route.geometryStatus !== 'ready') continue;
    for (const candidate of eligiblePaths(route)) {
      const distanceMeters = distanceToPathMeters(point, candidate.path);
      if (Number.isFinite(distanceMeters)) {
        candidates.push({
          routeId: route.routeId,
          routeName: route.name,
          distanceMeters: Math.round(distanceMeters),
          direction: candidate.direction,
        });
      }
    }
  }
  candidates.sort((left, right) => left.distanceMeters - right.distanceMeters);
  const bestPerRoute = candidates.filter((candidate, index, all) =>
    all.findIndex((other) => other.routeId === candidate.routeId) === index
  );
  const best = bestPerRoute[0];
  if (!best || best.distanceMeters > maxMeters) {
    return {
      routeName: null,
      distanceMeters: best?.distanceMeters ?? null,
      confidence: 'none',
      reason: best
        ? `No route passes within ${Math.round(maxMeters)} metres of this employee`
        : 'No route has usable road geometry',
      candidates: bestPerRoute.slice(0, 3),
    };
  }
  const second = bestPerRoute[1];
  if (second && second.distanceMeters - best.distanceMeters <= ambiguityMeters) {
    return {
      routeName: null,
      distanceMeters: best.distanceMeters,
      confidence: 'ambiguous',
      reason: `${best.routeName} and ${second.routeName} both pass close to this employee`,
      candidates: bestPerRoute.slice(0, 3),
    };
  }
  return {
    routeName: best.routeName,
    distanceMeters: best.distanceMeters,
    confidence: 'high',
    reason: `${best.routeName} passes ${best.distanceMeters} metres from this employee`,
    candidates: bestPerRoute.slice(0, 3),
  };
}

function thinPath(points: RoutePoint[], maximumPoints = 1500): RoutePoint[] {
  if (points.length <= maximumPoints) return points;
  const step = Math.ceil(points.length / maximumPoints);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0);
}

async function fetchOsrmPath(from: RoutePoint, to: RoutePoint): Promise<RoutePoint[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const base = env.osrmBaseUrl.replace(/\/$/, '');
    const url = `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Routing provider returned HTTP ${response.status}`);
    const data = await response.json() as { routes?: { geometry?: { coordinates?: [number, number][] } }[] };
    const coordinates = data.routes?.[0]?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) throw new Error('Routing provider returned no road geometry');
    const points = coordinates.map(([lng, lat]) => ({ lat, lng })).filter(validPoint);
    if (points.length < 2) throw new Error('Routing provider returned invalid road geometry');
    return thinPath(points);
  } finally {
    clearTimeout(timeout);
  }
}

export async function rebuildRouteGeometry(routeId: number): Promise<void> {
  const [route, company] = await Promise.all([
    Route.findOne({ routeId }),
    CompanyConfig.findOne().lean(),
  ]);
  if (!route) return;
  route.geometryStatus = 'pending';
  route.geometryError = '';
  await route.save();
  const office = company ? { lat: company.lat, lng: company.lng } : null;
  const destination = route.destLat == null || route.destLng == null
    ? null
    : { lat: route.destLat, lng: route.destLng };
  if (!validPoint(office) || !validPoint(destination) || (office.lat === 0 && office.lng === 0)) {
    route.dropPath = [];
    route.pickupPath = [];
    route.geometryStatus = 'error';
    route.geometryError = 'Set valid company and destination coordinates';
    route.geometryUpdatedAt = new Date();
    await route.save();
    return;
  }
  try {
    const [dropPath, pickupPath] = await Promise.all([
      fetchOsrmPath(office, destination),
      fetchOsrmPath(destination, office),
    ]);
    route.dropPath = dropPath;
    route.pickupPath = pickupPath;
    route.geometryStatus = 'ready';
    route.geometryProvider = 'osrm';
    route.geometryError = '';
    route.geometryUpdatedAt = new Date();
  } catch (error) {
    route.dropPath = [];
    route.pickupPath = [];
    route.geometryStatus = 'error';
    route.geometryProvider = 'osrm';
    route.geometryError = (error as Error).message;
    route.geometryUpdatedAt = new Date();
  }
  await route.save();
}

export async function rebuildAllRouteGeometries(): Promise<void> {
  const routes = await Route.find().select('routeId').lean();
  for (const route of routes) await rebuildRouteGeometry(route.routeId);
}

export async function startRouteGeometryMaintenance(): Promise<void> {
  const stale = await Route.find({
    $or: [
      { geometryStatus: { $ne: 'ready' } },
      { dropPath: { $size: 0 } },
      { pickupPath: { $size: 0 } },
    ],
  }).select('routeId').lean();
  for (const route of stale) await rebuildRouteGeometry(route.routeId);
}

export async function recommendRoute(rawCoordinates: string | undefined): Promise<RouteRecommendation> {
  const point = parseEmployeePoint(rawCoordinates);
  if (!point) {
    return { routeName: null, distanceMeters: null, confidence: 'none', reason: 'Valid employee coordinates are required', candidates: [] };
  }
  const routes = await Route.find({ geometryStatus: 'ready' }).lean();
  return matchRouteCorridor(point, routes);
}
