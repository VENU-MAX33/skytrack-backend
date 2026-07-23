import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  calculateSchedule,
  scheduleDeadline,
  trafficSpeedKmh,
} from '../src/services/trip-schedule.service.js';

const office = { lat: 12.9716, lng: 77.5946 };
const employees = [
  { employeeId: new Types.ObjectId(), point: { lat: 12.9352, lng: 77.6245 } },
  { employeeId: new Types.ObjectId(), point: { lat: 12.9279, lng: 77.6271 } },
];

test('scheduleDeadline interprets roster times in Asia/Kolkata', () => {
  assert.equal(scheduleDeadline('2026-07-16', '09:00')?.toISOString(), '2026-07-16T03:30:00.000Z');
  assert.equal(scheduleDeadline('bad', '09:00'), null);
});

test('pickup schedule works backward and reaches office five minutes early', () => {
  const deadline = scheduleDeadline('2026-07-16', '09:00')!;
  const schedule = calculateSchedule({ type: 'PickUp', deadline, origin: office, office, employees });

  assert.equal(schedule.scheduleStops.length, 2);
  assert.equal(schedule.scheduledEndAt.toISOString(), '2026-07-16T03:25:00.000Z');
  assert.equal(
    schedule.scheduledStartAt.getTime() - schedule.driverReportAt.getTime(),
    5 * 60_000
  );
  assert.ok(schedule.driverReportAt < schedule.scheduledStartAt);
  assert.ok(schedule.scheduleStops[0].plannedAt < schedule.scheduleStops[1].plannedAt);
  assert.ok(schedule.scheduleStops[1].plannedAt < schedule.scheduledEndAt);
});

test('drop schedule starts at logout and calculates each drop forward', () => {
  const deadline = scheduleDeadline('2026-07-16', '18:00')!;
  const schedule = calculateSchedule({ type: 'Drop', deadline, origin: office, office, employees });

  assert.equal(schedule.scheduledStartAt.getTime(), deadline.getTime());
  assert.ok(schedule.scheduleStops[0].plannedAt > schedule.scheduledStartAt);
  assert.ok(schedule.scheduledEndAt >= schedule.scheduleStops[1].plannedAt);
});

test('time-of-day traffic model is slower at evening peak than overnight', () => {
  assert.ok(
    trafficSpeedKmh(new Date('2026-07-16T12:30:00.000Z')) <
      trafficSpeedKmh(new Date('2026-07-16T20:30:00.000Z'))
  );
});
