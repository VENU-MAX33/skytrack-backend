import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Employee } from '../models/Employee.js';
import { Driver } from '../models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { Route } from '../models/Route.js';
import { Trip } from '../models/Trip.js';
import { Roster } from '../models/Roster.js';
import { Approval } from '../models/Approval.js';
import { OTP } from '../models/OTP.js';
import { SOSAlert } from '../models/SOSAlert.js';
import { localToday, addDays, type TripStatus } from '../lib/statusBuckets.js';
import { env } from '../config/env.js';

const TODAY = localToday();

const VENDORS = ['Shree Travels', 'Orange Cabs', 'SLN Transports', 'Royal Fleet'];

const ROUTES = [
  { routeId: 1, name: 'Whitefield', type: 'Both' },
  { routeId: 2, name: 'Electronic City', type: 'Both' },
  { routeId: 3, name: 'Koramangala', type: 'PickUp' },
  { routeId: 4, name: 'HSR Layout', type: 'Both' },
  { routeId: 5, name: 'Marathahalli', type: 'Both' },
  { routeId: 6, name: 'Indiranagar', type: 'Drop' },
  { routeId: 7, name: 'Bellandur', type: 'Both' },
  { routeId: 8, name: 'Sarjapur', type: 'PickUp' },
];

// Rough area centroids for employee latLong + vehicle positions.
const AREA_COORDS: Record<string, [number, number]> = {
  Whitefield: [12.9698, 77.7499],
  'Electronic City': [12.8452, 77.6602],
  Koramangala: [12.9352, 77.6245],
  'HSR Layout': [12.9116, 77.6446],
  Marathahalli: [12.9591, 77.6974],
  Indiranagar: [12.9719, 77.6412],
  Bellandur: [12.9304, 77.6784],
  Sarjapur: [12.8606, 77.7869],
};

const DRIVERS = [
  { name: 'Ramesh Kumar', gender: 'Male', contact: '9845012001' },
  { name: 'Suresh Babu', gender: 'Male', contact: '9845012002' },
  { name: 'Mohammed Irfan', gender: 'Male', contact: '9845012003' },
  { name: 'Venkatesh Rao', gender: 'Male', contact: '9845012004' },
  { name: 'Manjunath Gowda', gender: 'Male', contact: '9845012005' },
  { name: 'Prakash Shetty', gender: 'Male', contact: '9845012006' },
  { name: 'Anil Yadav', gender: 'Male', contact: '9845012007' },
  { name: 'Lakshmamma D', gender: 'Female', contact: '9845012008' },
  { name: 'Ravi Chandra', gender: 'Male', contact: '9845012009' },
  { name: 'Shankar Naik', gender: 'Male', contact: '9845012010' },
  { name: 'Basavaraj H', gender: 'Male', contact: '9845012011' },
  { name: 'Syed Aslam', gender: 'Male', contact: '9845012012' },
];

const VEHICLE_MODELS = [
  ['Toyota Innova Crysta', '7'],
  ['Maruti Ertiga', '7'],
  ['Tata Winger', '12'],
  ['Force Traveller', '12'],
  ['Maruti Dzire', '4'],
  ['Hyundai Aura', '4'],
] as const;

const TRACK_STATUSES = [
  'running', 'running', 'running', 'running', 'running',
  'idle', 'idle', 'idle',
  'stopped', 'stopped',
  'no-gps',
  'offline',
];

const FIRST_NAMES_M = ['Arjun', 'Rahul', 'Vikram', 'Karthik', 'Sandeep', 'Nikhil', 'Praveen', 'Aditya', 'Rohan', 'Varun', 'Kiran', 'Manoj'];
const FIRST_NAMES_F = ['Priya', 'Sneha', 'Divya', 'Ananya', 'Kavya', 'Meera', 'Pooja', 'Shruthi', 'Nisha', 'Lakshmi'];
const LAST_NAMES = ['Sharma', 'Reddy', 'Nair', 'Iyer', 'Patil', 'Hegde', 'Menon', 'Rao', 'Gupta', 'Joshi', 'Kulkarni', 'Das'];
const TEAMS = ['Engineering', 'Finance', 'Support', 'HR', 'Ops'];
const SHIFTS: [string, string][] = [
  ['02:30', '11:30'],
  ['05:00', '14:00'],
  ['09:00', '18:00'],
  ['14:30', '23:30'],
  ['17:30', '02:30'],
];

function jitter(base: number, i: number, scale = 0.01): number {
  return Number((base + Math.sin(i * 7.3) * scale).toFixed(6));
}

function seedPassword(configured: string, label: string): string {
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${label} must be set explicitly; refusing to seed a predictable production credential`);
  }
  return crypto.randomBytes(24).toString('base64url');
}

export async function seed(shouldDisconnect = true) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the destructive demo seed in production');
  }
  if (mongoose.connection.readyState !== 1) {
    await connectDb();
  }

  console.log('Dropping existing collections...');
  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    Driver.deleteMany({}),
    Vehicle.deleteMany({}),
    Route.deleteMany({}),
    Trip.deleteMany({}),
    Roster.deleteMany({}),
    Approval.deleteMany({}),
    OTP.deleteMany({}),
    SOSAlert.deleteMany({}),
  ]);

  // 1. Admin user
  const adminPassword = seedPassword(env.seedAdminPassword, 'SEED_ADMIN_PASSWORD');
  const staffPassword = seedPassword(env.seedStaffPassword, 'SEED_STAFF_PASSWORD');
  const employeePassword = seedPassword(env.defaultEmployeePassword, 'DEFAULT_EMPLOYEE_PASSWORD');
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await User.create({ email: 'admin@skytrack.com', passwordHash, name: 'Admin', role: 'admin' });

  // 1b. Sample staff (limited-access) login for local testing
  const staffPasswordHash = await bcrypt.hash(staffPassword, 10);
  await User.create({ email: 'staff@skytrack.com', passwordHash: staffPasswordHash, name: 'Staff', role: 'staff' });

  // 2. Routes
  const routes = await Route.insertMany(ROUTES);

  // 3. Drivers (vendor assigned round-robin so each vendor has 3 drivers)
  const drivers = await Driver.insertMany(
    DRIVERS.map((d, i) => ({
      ...d,
      dlNumber: `KA05202300012${String(i + 10)}`,
      badgeNumber: `BDG${String(i + 101)}`,
      email: `${d.name.toLowerCase().replace(/[^a-z]/g, '.')}@fleet.in`,
      vendor: VENDORS[i % 4],
      dlEffectiveFrom: '2021-03-15',
      dlExpiry: i === 2 ? addDays(TODAY, 20) : '2028-06-30', // one expiring soon
      address: `${ROUTES[i % 8].name}, Bengaluru`,
      inductionDate: '2024-01-10',
      firstVaccination: '2021-05-12',
      secondVaccination: '2021-08-20',
      pvcExpiry: '2027-02-28',
      medicalExpiry: i === 5 ? addDays(TODAY, 45) : '2027-09-15',
      active: 'Yes',
    }))
  );

  // 4. Vehicles — driver's vendor must match vehicle vendor
  const routeNames = ROUTES.map((r) => r.name);
  const vehicles = await Vehicle.insertMany(
    drivers.map((driver, i) => {
      const [model, seatCount] = VEHICLE_MODELS[i % VEHICLE_MODELS.length];
      const area = routeNames[i % 8];
      const [lat, lng] = AREA_COORDS[area];
      const isLast = i === drivers.length - 1;
      return {
        rtoNo: `KA0${(i % 5) + 1}AB${1200 + i * 37}`,
        seatCount,
        model,
        taxExpiry: '2027-03-31',
        insuranceEnd: i === 4 ? addDays(TODAY, 15) : '2027-01-31',
        permitEnd: '2027-08-31',
        fcExpiry: '2026-12-31',
        emissionExpiry: addDays(TODAY, 90 + i * 10),
        maintenanceDue: addDays(TODAY, 14 + i * 3),
        vehicleType: Number(seatCount) > 7 ? 'Bus' : 'Cab',
        vendor: driver.vendor,
        imei: `86012345678${String(i + 10)}`,
        driverId: driver._id,
        billingType: i % 2 === 0 ? 'Per KM' : 'Fixed',
        fuelType: i % 3 === 0 ? 'CNG' : 'Diesel',
        inductionDate: '2024-02-01',
        expired: isLast ? 'Yes' : 'No',
        active: isLast ? 'No' : 'Yes',
        lat: jitter(lat, i),
        lng: jitter(lng, i + 3),
        trackStatus: TRACK_STATUSES[i],
        speed: TRACK_STATUSES[i] === 'running' ? 25 + (i % 4) * 8 : 0,
      };
    })
  );

  // 5. Employees — ~5 per route, a few unrouted, 36 active / 4 inactive
  // Every employee shares the same default login password (admin can reset later).
  const employeePasswordHash = await bcrypt.hash(employeePassword, 10);
  const employeeData = Array.from({ length: 40 }, (_, i) => {
    const female = i % 5 === 1 || i % 5 === 3 ? i % 2 === 1 : false;
    const firstName = female
      ? FIRST_NAMES_F[i % FIRST_NAMES_F.length]
      : FIRST_NAMES_M[i % FIRST_NAMES_M.length];
    const name = `${firstName} ${LAST_NAMES[i % LAST_NAMES.length]}`;
    const routed = i < 36; // last 4 of the routed set handled below; unrouted = 36..39? keep 4 unrouted
    const route = routed ? routeNames[i % 8] : '';
    const area = route || 'Koramangala';
    const [lat, lng] = AREA_COORDS[area];
    const [login, logout] = SHIFTS[i % SHIFTS.length];
    return {
      empId: `EMP${String(i + 1).padStart(3, '0')}`,
      name,
      gender: female ? 'Female' : 'Male',
      contact: `98860${String(10000 + i * 13).slice(0, 5)}`,
      email: `${firstName.toLowerCase()}.${LAST_NAMES[i % LAST_NAMES.length].toLowerCase()}@company.in`,
      transportType: i % 7 === 0 ? 'Bus' : 'Cab',
      transportMode: i % 9 === 0 ? 'Own' : 'Company',
      distance: `${5 + (i % 20)} km`,
      address: `#${12 + i}, ${area} Main Road, Bengaluru`,
      location: 'Bengaluru',
      nodalPoint: area,
      manager: ['Rajesh Verma', 'Sunita Kapoor', 'Dinesh Pillai'][i % 3],
      pinCode: `5600${String(35 + (i % 60)).padStart(2, '0')}`,
      shiftLogin: login,
      shiftLogout: logout,
      fixedShift: i % 4 === 0 ? 'Yes' : 'No',
      latLong: `${jitter(lat, i, 0.02)}, ${jitter(lng, i + 5, 0.02)}`,
      team: TEAMS[i % TEAMS.length],
      specialNeed: i === 13 ? 'Wheelchair access' : '',
      route,
      active: i % 10 === 9 ? 'No' : 'Yes',
      passwordHash: employeePasswordHash,
    };
  });
  const employees = await Employee.insertMany(employeeData);

  // 6. Trips across yesterday-2 .. tomorrow, today covering every bucket
  const activeVehicles = vehicles.filter((v) => v.active === 'Yes');
  const empsByRoute = new Map<string, typeof employees>();
  for (const r of routeNames) {
    empsByRoute.set(r, employees.filter((e) => e.route === r && e.active === 'Yes'));
  }

  // [date offset, status, count]
  const tripPlan: [number, TripStatus, number][] = [
    [-2, 'Completed', 4],
    [-2, 'Completed Late', 1],
    [-2, 'Auto Cancelled', 1],
    [-1, 'Completed', 5],
    [-1, 'No Show Completed', 1],
    [-1, 'Driver Rejected', 1],
    // today: every bucket represented
    [0, 'Trip Started', 1],
    [0, 'Pickup Started', 1],
    [0, 'Drop Started', 1],
    [0, 'Not Started Yet', 2],
    [0, 'Driver Accepted', 1],
    [0, 'Completed', 2],
    [0, 'Completed Late', 1],
    [0, 'No Show Completed', 1],
    [0, 'Auto Cancelled', 2],
    [0, 'Driver Rejected', 1],
    [0, 'Trip Started', 1], // 14 today
    [1, 'Not Started Yet', 3],
  ];

  let tripIdx = 0;
  const tripDocs = [];
  const perDateCount: Record<string, number> = {};
  for (const [offset, status, count] of tripPlan) {
    for (let c = 0; c < count; c++) {
      const date = addDays(TODAY, offset);
      const vehicle = activeVehicles[tripIdx % activeVehicles.length];
      const routeName = routeNames[tripIdx % 8];
      const route = routes.find((r) => r.name === routeName)!;
      const routeEmps = empsByRoute.get(routeName)!;
      const empCount = 3 + (tripIdx % 3);
      const tripEmps = routeEmps.slice(0, empCount);
      if (tripEmps.length === 0) continue;
      const [shiftLogin] = SHIFTS[tripIdx % SHIFTS.length];
      const isNight = shiftLogin === '02:30' || shiftLogin === '17:30';
      const hasWoman = tripEmps.some((e) => e.gender === 'Female');
      perDateCount[date] = (perDateCount[date] ?? 0) + 1;
      tripDocs.push({
        tripId: `TRP-${date.replace(/-/g, '').slice(2)}-${String(perDateCount[date]).padStart(3, '0')}`,
        status,
        type: tripIdx % 2 === 0 ? 'PickUp' : 'Drop',
        date,
        escort: isNight && hasWoman ? 'Yes' : 'No',
        shiftTime: shiftLogin,
        vehicleId: vehicle._id,
        driverId: vehicle.driverId,
        routeId: route._id,
        employeeIds: tripEmps.map((e) => e._id),
        vendor: vehicle.vendor,
        location: routeName,
      });
      tripIdx++;
    }
  }
  const trips = await Trip.insertMany(tripDocs);

  // 7. Rosters — ~25 today (mixed status) + a few tomorrow
  const activeEmps = employees.filter((e) => e.active === 'Yes' && e.route);
  const rosterStatuses = ['pending', 'pending', 'approved', 'approved', 'approved', 'completed'];
  const rosterDocs = activeEmps.slice(0, 25).map((e, i) => ({
    employeeId: e._id,
    date: TODAY,
    tripType: i % 2 === 0 ? 'pickup' : 'drop',
    timing: e.shiftLogin,
    rosterType: i % 6 === 0 ? 'Ad-hoc' : 'Regular',
    status: rosterStatuses[i % rosterStatuses.length],
  }));
  const tomorrowRosters = activeEmps.slice(25, 31).map((e, i) => ({
    employeeId: e._id,
    date: addDays(TODAY, 1),
    tripType: i % 2 === 0 ? 'pickup' : 'drop',
    timing: e.shiftLogin,
    rosterType: 'Regular',
    status: 'pending',
  }));
  const rosters = await Roster.insertMany([...rosterDocs, ...tomorrowRosters]);

  // 8. Approvals
  const approvals = await Approval.insertMany([
    { category: 'employeeAddressChange', status: 'pending', employeeId: employees[3]._id, detail: 'Moved to HSR Layout', requestedAt: addDays(TODAY, -1) },
    { category: 'employeeAddressChange', status: 'pending', employeeId: employees[8]._id, detail: 'Moved to Whitefield', requestedAt: TODAY },
    { category: 'employeeAddressChange', status: 'approved', employeeId: employees[12]._id, detail: 'Moved to Bellandur', requestedAt: addDays(TODAY, -3) },
    { category: 'employeeAddressChange', status: 'approved', employeeId: employees[19]._id, detail: 'Moved to Sarjapur', requestedAt: addDays(TODAY, -2) },
    { category: 'workspaceBooking', status: 'pending', employeeId: employees[5]._id, detail: 'Desk 4F-12', requestedAt: TODAY },
    { category: 'workspaceBooking', status: 'pending', employeeId: employees[7]._id, detail: 'Desk 2B-03', requestedAt: TODAY },
    { category: 'workspaceBooking', status: 'pending', employeeId: employees[22]._id, detail: 'Meeting pod 3A', requestedAt: addDays(TODAY, -1) },
    { category: 'workspaceBooking', status: 'approved', employeeId: employees[10]._id, detail: 'Desk 1C-08', requestedAt: addDays(TODAY, -2) },
    { category: 'workspaceBooking', status: 'approved', employeeId: employees[15]._id, detail: 'Desk 5D-21', requestedAt: addDays(TODAY, -2) },
    { category: 'workspaceBooking', status: 'approved', employeeId: employees[28]._id, detail: 'Desk 4F-02', requestedAt: addDays(TODAY, -4) },
  ]);

  console.log('');
  console.log('Seed complete:');
  console.log(`  routes:    ${routes.length}`);
  console.log(`  drivers:   ${drivers.length}`);
  console.log(`  vehicles:  ${vehicles.length}`);
  console.log(`  employees: ${employees.length}`);
  console.log(`  trips:     ${trips.length} (${perDateCount[TODAY] ?? 0} today, ${TODAY})`);
  console.log(`  rosters:   ${rosters.length}`);
  console.log(`  approvals: ${approvals.length}`);
  console.log('');
  if (process.env.NODE_ENV !== 'production') {
    console.log('Logins (development seed credentials; store them securely):');
    console.log(`  Admin:    admin@skytrack.com / ${adminPassword}`);
    console.log(`  Staff:    staff@skytrack.com / ${staffPassword} (limited access)`);
    console.log(`  Employee: <empId e.g. EMP001> / ${employeePassword}`);
    console.log(`  Driver:   <phone e.g. ${drivers[0].contact}> -> set password on first login`);
  }

  if (shouldDisconnect) {
    await mongoose.disconnect();
  }
}

import { fileURLToPath } from 'url';
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('seed.ts') ||
  process.argv[1].endsWith('seed.js')
);

if (isMain) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
