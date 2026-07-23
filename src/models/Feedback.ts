import { Schema, Types } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export interface FeedbackDoc {
  employeeId: Types.ObjectId;
  message: string;
  read: boolean;
  submittedAt: Date;
}

const feedbackSchema = new Schema<FeedbackDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    message: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false },
    submittedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

feedbackSchema.index({ read: 1, submittedAt: -1 });

export const Feedback = tenantModel<FeedbackDoc>('Feedback', feedbackSchema);
