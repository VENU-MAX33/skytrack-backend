import { Schema } from 'mongoose';
import { tenantModel } from '../tenancy/model.js';

export type NotificationType = 'sos' | 'location-request' | 'employee-location' | 'feedback' | 'escort' | 'info';

export interface NotificationDoc {
  type: NotificationType;
  title: string;
  body: string;
  refId: string; // id of the related entity (SOS alert, location request, …)
  link: string; // admin route to open when the notification is clicked
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>({
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  refId: { type: String, default: '' },
  link: { type: String, default: '' },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const Notification = tenantModel<NotificationDoc>('Notification', notificationSchema);
