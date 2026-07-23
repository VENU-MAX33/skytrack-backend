import { Schema, Types, model, type Model } from 'mongoose';
import { currentCompanyId } from './context.js';

export interface TenantOwned {
  companyId: Schema.Types.ObjectId;
}

// Compatibility owner used only by direct model scripts/tests that run outside
// an authenticated request. Production API writes always replace it with the
// verified request company's id in the save/insert middleware below.
export const LEGACY_COMPANY_ID = new Types.ObjectId('000000000000000000000001');

/**
 * Adds mandatory company ownership and automatic request-level isolation to a
 * Mongoose schema. Outside an authenticated request (seed/migration scripts),
 * queries remain unscoped and writes must supply companyId explicitly.
 */
export function tenantModel<T>(name: string, schema: Schema<T>): Model<T & TenantOwned> {
  schema.add({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true, default: LEGACY_COMPANY_ID },
  } as never);

  const queryOperations = [
    'countDocuments', 'deleteMany', 'deleteOne', 'find', 'findOne',
    'findOneAndDelete', 'findOneAndReplace', 'findOneAndUpdate',
    'replaceOne', 'updateMany', 'updateOne',
  ] as const;

  for (const operation of queryOperations) {
    schema.pre(operation, function tenantQueryScope(next) {
      const companyId = currentCompanyId();
      if (companyId) {
        this.where({ companyId });
        if (this.getOptions().upsert) {
          const update = (this.getUpdate() ?? {}) as Record<string, unknown>;
          const setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
          this.setUpdate({ ...update, $setOnInsert: { ...setOnInsert, companyId } });
        }
      }
      next();
    });
  }

  schema.pre('aggregate', function tenantAggregateScope(next) {
    const companyId = currentCompanyId();
    if (companyId) this.pipeline().unshift({ $match: { companyId } });
    next();
  });

  schema.pre('save', function assignTenant(next) {
    const companyId = currentCompanyId();
    if (companyId && (!this.get('companyId') || String(this.get('companyId')) === String(LEGACY_COMPANY_ID))) {
      this.set('companyId', companyId);
    }
    next();
  });

  schema.pre('insertMany', function assignManyTenant(next, docs: Array<Record<string, unknown>>) {
    const companyId = currentCompanyId();
    if (companyId) {
      for (const doc of docs) if (!doc.companyId) doc.companyId = companyId;
    }
    next();
  });

  return model<T & TenantOwned>(name, schema as Schema<T & TenantOwned>);
}
