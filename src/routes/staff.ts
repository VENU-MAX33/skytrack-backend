import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

// Admin-only CRUD for limited-access staff logins. Mounted behind
// requireRole('admin') in server.ts — every handler here assumes the caller
// is already the main admin.
export const staffRouter = Router();

function toStaffDTO(doc: { _id: { toString(): string }; email: string; name: string; role: string }) {
  return { id: doc._id.toString(), email: doc.email, name: doc.name, role: doc.role };
}

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const docs = await User.find({ role: 'staff', companyId: req.auth!.companyId }).sort({ name: 1 });
    res.json(docs.map(toStaffDTO));
  })
);

staffRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
    if (!email?.trim() || !password?.trim() || !name?.trim()) {
      throw new HttpError(400, 'name, email and password are required');
    }
    const normalizedEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) throw new HttpError(409, `An account with email ${normalizedEmail} already exists`);

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await User.create({ email: normalizedEmail, passwordHash, name: name.trim(), role: 'staff', companyId: req.auth!.companyId, active: true });
    res.status(201).json(toStaffDTO(doc));
  })
);

staffRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await User.findOne({ _id: req.params.id, companyId: req.auth!.companyId });
    // Scoped to role: 'staff' so this endpoint can never be used to delete the main admin.
    if (!doc || doc.role !== 'staff') throw new HttpError(404, 'Staff account not found');
    await doc.deleteOne();
    res.status(204).end();
  })
);
