import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface SosConfigDoc {
  alertPhone: string; // SMS this number on every new SOS alert
}

const sosConfigSchema = new Schema<SosConfigDoc>(
  {
    alertPhone: { type: String, default: '' },
  },
  { timestamps: true }
);

export const SosConfig = tenantModel<SosConfigDoc>('SosConfig', sosConfigSchema);
