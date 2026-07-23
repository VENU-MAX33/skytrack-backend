import type { Types, HydratedDocument } from 'mongoose';
import { EscortReport, type EscortReportDoc } from '../models/EscortReport.js';

interface CreateEscortReportInput {
  employeeId: Types.ObjectId;
  tripId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  present: string;
  escortName?: string;
  employeeName?: string;
  employeeContact?: string;
}

export async function createEscortReport(
  input: CreateEscortReportInput
): Promise<HydratedDocument<EscortReportDoc>> {
  return EscortReport.create({
    employeeId: input.employeeId,
    tripId: input.tripId ?? null,
    driverId: input.driverId ?? null,
    present: input.present === 'Yes' ? 'Yes' : 'No',
    escortName: input.present === 'Yes' ? (input.escortName ?? '').trim() : '',
    employeeName: input.employeeName ?? '',
    employeeContact: input.employeeContact ?? '',
    status: 'open',
  });
}

export async function acknowledgeEscortReport(
  id: string,
  acknowledgedBy: string
): Promise<HydratedDocument<EscortReportDoc> | null> {
  return EscortReport.findByIdAndUpdate(
    id,
    { status: 'acknowledged', acknowledgedBy, acknowledgedAt: new Date() },
    { new: true }
  );
}
