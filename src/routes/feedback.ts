import { Router } from 'express';
import { Feedback } from '../models/Feedback.js';
import { toFeedbackDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';

// Admin-only: read employee feedback. Never mounted for staff — this is
// stricter than Location Requests, which staff can see.
export const feedbackRouter = Router();

type PopulatedFeedback = Parameters<typeof toFeedbackDTO>[0];
const POPULATE = 'employeeId';

// GET /api/feedback — admin lists feedback, optional ?read=true|false filter
feedbackRouter.get(
  '/',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { read } = req.query as { read?: string };
    const query = read === undefined ? {} : { read: read === 'true' };
    const docs = await Feedback.find(query).sort({ submittedAt: -1 }).limit(200).populate(POPULATE);
    res.json(docs.map((d) => toFeedbackDTO(d as unknown as PopulatedFeedback)));
  })
);

// PUT /api/feedback/:id/read — admin marks a feedback entry as read
feedbackRouter.put(
  '/:id/read',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const doc = await Feedback.findById(req.params.id).populate(POPULATE);
    if (!doc) throw new HttpError(404, 'Feedback not found');
    doc.read = true;
    await doc.save();
    res.json(toFeedbackDTO(doc as unknown as PopulatedFeedback));
  })
);
