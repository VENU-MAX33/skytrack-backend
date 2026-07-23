import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  companyId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function currentCompanyId(): string | undefined {
  return tenantContext.getStore()?.companyId;
}
