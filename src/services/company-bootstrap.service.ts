import { Company } from '../models/Company.js';
import { CompanyConfig } from '../models/CompanyConfig.js';
import { User } from '../models/User.js';
import { Approval } from '../models/Approval.js';
import { Counter } from '../models/Counter.js';
import { Driver } from '../models/Driver.js';
import { Employee } from '../models/Employee.js';
import { EmployeeDocument } from '../models/EmployeeDocument.js';
import { EscortReport } from '../models/EscortReport.js';
import { Feedback } from '../models/Feedback.js';
import { IdempotencyKey } from '../models/IdempotencyKey.js';
import { LocationRequest } from '../models/LocationRequest.js';
import { Notification } from '../models/Notification.js';
import { OTP } from '../models/OTP.js';
import { Roster } from '../models/Roster.js';
import { Route } from '../models/Route.js';
import { SOSAlert } from '../models/SOSAlert.js';
import { SosConfig } from '../models/SosConfig.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { SmsDelivery } from '../models/SmsDelivery.js';

const tenantModels = [
  Approval, CompanyConfig, Counter, Driver, Employee, EmployeeDocument,
  EscortReport, Feedback, IdempotencyKey, LocationRequest, Notification, OTP, Roster, Route,
  SOSAlert, SosConfig, SmsDelivery, Trip, Vehicle,
];

/** Creates Company A and safely labels records created by the old single-company release. */
export async function ensureLegacyCompany(ownerUserId: string) {
  let company = await Company.findOne().sort({ createdAt: 1 });
  if (!company) {
    const oldConfig = await CompanyConfig.collection.findOne({});
    company = await Company.create({
      code: 'COMPANY-A',
      name: String(oldConfig?.name || 'Company A'),
      logoBase64: String(oldConfig?.logoBase64 || ''),
      address: String(oldConfig?.address || ''),
      lat: Number(oldConfig?.lat || 0),
      lng: Number(oldConfig?.lng || 0),
      vendors: Array.isArray(oldConfig?.vendors) ? oldConfig.vendors : [],
      status: 'active',
      createdBy: ownerUserId,
    });
  }

  for (const tenantModel of tenantModels) {
    await tenantModel.collection.updateMany(
      { $or: [{ companyId: { $exists: false } }, { companyId: null }] },
      { $set: { companyId: company._id } },
    );
  }
  await User.updateMany(
    { role: { $in: ['admin', 'staff'] }, $or: [{ companyId: { $exists: false } }, { companyId: null }] },
    { $set: { companyId: company._id, active: true } },
  );

  // The single-company release created global unique indexes. Remove only
  // those known legacy indexes; the schemas now define company-scoped unique
  // replacements such as { companyId, empId }.
  const legacyIndexes = [
    [Employee, ['empId_1']], [Driver, ['dlNumber_1']], [Vehicle, ['rtoNo_1']],
    [Route, ['routeId_1', 'name_1']], [Trip, ['tripId_1']],
  ] as const;
  for (const [tenantModel, names] of legacyIndexes) {
    const indexes = await tenantModel.collection.listIndexes().toArray().catch(() => []);
    const existingNames = new Set(indexes.map((index) => index.name));
    for (const name of names) if (existingNames.has(name)) await tenantModel.collection.dropIndex(name);
    await tenantModel.createIndexes();
  }
  return company;
}
