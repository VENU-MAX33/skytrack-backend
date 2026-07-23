import { Router } from 'express';
import { Types } from 'mongoose';
import { Employee } from '../models/Employee.js';
import { Feedback } from '../models/Feedback.js';
import { toFeedbackDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { emitFeedbackNew } from '../websocket/index.js';
import { createNotification } from '../services/notification.service.js';

export const employeeFeedbackRouter = Router();

type PopulatedFeedback = Parameters<typeof toFeedbackDTO>[0];

// POST /api/employee/feedback — employee submits feedback. Write-only from the
// employee's side: only an ack id is returned, never the message back to them.
employeeFeedbackRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message?.trim()) throw new HttpError(400, 'message is required');

    const selfId = new Types.ObjectId(req.auth!.sub);
    const employee = await Employee.findById(selfId);
    if (!employee) throw new HttpError(404, 'Employee not found');

    const doc = await Feedback.create({ employeeId: selfId, message: message.trim() });
    await doc.populate('employeeId');
    const dto = toFeedbackDTO(doc as unknown as PopulatedFeedback);

    emitFeedbackNew(dto);
    await createNotification({
      type: 'feedback',
      title: `New feedback: ${dto.employee.name || 'Employee'}`,
      body: dto.message.slice(0, 140),
      refId: dto.id,
      link: '/feedback',
    });

    res.status(201).json({ id: dto.id });
  })
);
