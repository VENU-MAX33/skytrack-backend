import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface CompanyConfigDoc {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Company logo as a data-URL; shown in the header instead of initials. */
  logoBase64: string;
  /** Vendor (cab company) names managed by the admin. */
  vendors: string[];
}

const companyConfigSchema = new Schema<CompanyConfigDoc>({
  name: { type: String, default: '' },
  address: { type: String, default: '' },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  logoBase64: { type: String, default: '' },
  vendors: { type: [String], default: [] },
});

export const CompanyConfig = tenantModel<CompanyConfigDoc>('CompanyConfig', companyConfigSchema);
