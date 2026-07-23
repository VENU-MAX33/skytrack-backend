import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Driver } from '../models/Driver.js';
import { Employee } from '../models/Employee.js';
import { Company } from '../models/Company.js';
import { tenantContext } from '../tenancy/context.js';

export type Role = 'platform-owner' | 'admin' | 'driver' | 'employee' | 'staff';

export interface AuthPayload {
  sub: string; // document id (User / Driver / Employee)
  role: Role;
  companyId?: string;
}

// Augment Express Request so handlers can read req.auth in a typed way.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function verifyToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  // Every login path signs an explicit role — a token missing one is malformed, not an admin by default.
  if (!decoded.role) throw new Error('Token missing role claim');
  return {
    sub: String(decoded.sub),
    role: decoded.role as Role,
    companyId: decoded.companyId ? String(decoded.companyId) : undefined,
  };
}

export function signToken(
  payload: AuthPayload,
  expiresIn: jwt.SignOptions['expiresIn'] = '12h'
): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn });
}

// Re-validates the token's subject against the database so a 30-day token stops
// working the moment the account is deleted, deactivated, or (for admins/staff)
// has its role changed. Without this, deactivating a user only blocks new logins.
export async function principalIsValid(payload: AuthPayload): Promise<boolean> {
  switch (payload.role) {
    case 'platform-owner': {
      const user = await User.findById(payload.sub).select('role active companyId').lean();
      if (!user || !user.active || user.role !== payload.role) return false;
      if (payload.companyId) {
        const company = await Company.findOne({ _id: payload.companyId, status: 'active' }).select('_id').lean();
        return !!company;
      }
      return true;
    }
    case 'admin':
    case 'staff': {
      const user = await User.findById(payload.sub).select('role active companyId').lean();
      return !!user && user.active && user.role === payload.role && String(user.companyId ?? '') === String(payload.companyId ?? '');
    }
    case 'driver': {
      const driver = await Driver.findById(payload.sub).select('active companyId').lean();
      return !!driver && driver.active === 'Yes' && String(driver.companyId ?? '') === String(payload.companyId ?? '');
    }
    case 'employee': {
      const employee = await Employee.findById(payload.sub).select('active companyId').lean();
      return !!employee && employee.active === 'Yes' && String(employee.companyId ?? '') === String(payload.companyId ?? '');
    }
    default:
      return false;
  }
}

export function requireBackOfficeWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role === 'staff' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'Forbidden: staff access is read-only' });
    return;
  }
  next();
}

// Verifies the JWT, confirms the account is still valid, and attaches the
// decoded payload to req.auth.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (!(await principalIsValid(payload))) {
      res.status(401).json({ error: 'Account is no longer active' });
      return;
    }
    req.auth = payload;
    if (payload.companyId) tenantContext.run({ companyId: payload.companyId }, next);
    else next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Verifies the JWT, confirms the account is still valid, AND enforces that the
// caller has one of the allowed roles.
export function requireRole(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    try {
      const payload = verifyToken(token);
      if (!roles.includes(payload.role)) {
        res.status(403).json({ error: 'Forbidden: insufficient role' });
        return;
      }
      if (!(await principalIsValid(payload))) {
        res.status(401).json({ error: 'Account is no longer active' });
        return;
      }
      req.auth = payload;
      if (payload.companyId) tenantContext.run({ companyId: payload.companyId }, next);
      else next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// Per-verb permission gate for routers where some methods (e.g. GET) stay open
// to every authenticated role but others (e.g. POST/PUT/DELETE) are admin-only.
// Assumes requireAuth already ran on this router and populated req.auth.
export function requirePermission(check: (role: Role) => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !check(req.auth.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    next();
  };
}

export function requireCompanyContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.companyId) {
    res.status(403).json({ error: 'Select a company before opening its workspace' });
    return;
  }
  next();
}
