import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceToPathMeters, matchRouteCorridor } from '../src/services/route-geometry.service.js';

const point = { lat: 13.0200, lng: 77.7000 };

test('distanceToPathMeters measures the route corridor, not its destination', () => {
  const path = [
    { lat: 12.9700, lng: 77.5900 },
    { lat: 13.0201, lng: 77.6900 },
    { lat: 13.1000, lng: 77.8500 },
  ];
  assert.ok(distanceToPathMeters(point, path) < 1200);
  // The destination is many kilometres away; it must not control the result.
  assert.ok(distanceToPathMeters(point, [path[2], path[2]]) > 10_000);
});

test('route matcher selects a path passing near the employee even when its destination is farther away', () => {
  const result = matchRouteCorridor(point, [
    {
      routeId: 1,
      name: 'Hoskote',
      type: 'Both',
      geometryStatus: 'ready' as const,
      dropPath: [{ lat: 12.97, lng: 77.59 }, { lat: 13.0201, lng: 77.7001 }, { lat: 13.15, lng: 77.90 }],
      pickupPath: [{ lat: 13.15, lng: 77.90 }, { lat: 13.0201, lng: 77.7001 }, { lat: 12.97, lng: 77.59 }],
    },
    {
      routeId: 2,
      name: 'Closer Destination Wrong Road',
      type: 'Both',
      geometryStatus: 'ready' as const,
      dropPath: [{ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.72 }, { lat: 13.03, lng: 77.75 }],
      pickupPath: [{ lat: 13.03, lng: 77.75 }, { lat: 12.98, lng: 77.72 }, { lat: 12.97, lng: 77.59 }],
    },
  ], { maxMeters: 3000, ambiguityMeters: 100 });

  assert.equal(result.confidence, 'high');
  assert.equal(result.routeName, 'Hoskote');
  assert.ok((result.distanceMeters ?? Infinity) < 100);
});

test('route matcher requires confirmation when two corridors are similarly close', () => {
  const result = matchRouteCorridor(point, [
    {
      routeId: 1, name: 'Route A', type: 'Both', geometryStatus: 'ready' as const,
      dropPath: [{ lat: 13.0199, lng: 77.69 }, { lat: 13.0199, lng: 77.71 }],
      pickupPath: [{ lat: 13.0199, lng: 77.71 }, { lat: 13.0199, lng: 77.69 }],
    },
    {
      routeId: 2, name: 'Route B', type: 'Both', geometryStatus: 'ready' as const,
      dropPath: [{ lat: 13.0202, lng: 77.69 }, { lat: 13.0202, lng: 77.71 }],
      pickupPath: [{ lat: 13.0202, lng: 77.71 }, { lat: 13.0202, lng: 77.69 }],
    },
  ], { maxMeters: 2000, ambiguityMeters: 100 });

  assert.equal(result.confidence, 'ambiguous');
  assert.equal(result.routeName, null);
});

test('route matcher does not force an assignment outside the corridor', () => {
  const result = matchRouteCorridor(point, [{
    routeId: 1, name: 'Far Route', type: 'Both', geometryStatus: 'ready' as const,
    dropPath: [{ lat: 12.80, lng: 77.40 }, { lat: 12.81, lng: 77.41 }],
    pickupPath: [{ lat: 12.81, lng: 77.41 }, { lat: 12.80, lng: 77.40 }],
  }], { maxMeters: 2000 });

  assert.equal(result.confidence, 'none');
  assert.equal(result.routeName, null);
});
