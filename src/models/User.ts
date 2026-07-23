import { Schema, model, Types } from 'mongoose';

export type AdminRole = 'platform-owner' | 'admin' | 'staff';

export interface UserDoc {
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRole;
  companyId?: Types.ObjectId;
  active: boolean;
}

const userSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['platform-owner', 'admin', 'staff'], default: 'admin' },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
  active: { type: Boolean, default: true },
});

export const User = model<UserDoc>('User', userSchema);
