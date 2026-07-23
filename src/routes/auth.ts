import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { Company } from '../models/Company.js';
import { ensureLegacyCompany } from '../services/company-bootstrap.service.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new HttpError(400, 'Email and password are required');

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid email or password');
    }

    if (user.active === false) throw new HttpError(403, 'This account is inactive');

    let role = user.role;
    let companyId = user.companyId?.toString();
    if (!companyId && role !== 'platform-owner') {
      const company = await ensureLegacyCompany(user._id.toString());
      const ownerExists = await User.exists({ role: 'platform-owner' });
      if (!ownerExists && role === 'admin') {
        role = 'platform-owner';
        await User.updateOne({ _id: user._id }, { role, companyId: null, active: true });
        companyId = undefined;
      } else {
        companyId = company._id.toString();
      }
    }

    const company = companyId ? await Company.findById(companyId).lean() : null;
    if (company && company.status !== 'active') throw new HttpError(403, 'Company account is not active');
    const token = signToken({ sub: user._id.toString(), role, companyId });
    res.json({ token, user: { name: user.name, email: user.email, role,
      company: company ? { id: company._id.toString(), code: company.code, name: company.name, logoBase64: company.logoBase64 } : null } });
  })
);
