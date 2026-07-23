import { Notification, type NotificationType } from '../models/Notification.js';
import { emitNotification } from '../websocket/index.js';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  refId: string;
  link: string;
  read: boolean;
  createdAt: string;
}

interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  refId?: string;
  link?: string;
}

/** Persist a notification and broadcast it to the admin room in real time. */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationDTO> {
  const doc = await Notification.create({
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    refId: input.refId ?? '',
    link: input.link ?? '',
  });
  const dto = toNotificationDTO(doc);
  emitNotification(dto);
  return dto;
}

export function toNotificationDTO(doc: {
  _id: { toString(): string };
  type: NotificationType;
  title: string;
  body: string;
  refId: string;
  link: string;
  read: boolean;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    refId: doc.refId,
    link: doc.link,
    read: doc.read,
    createdAt: doc.createdAt.toISOString(),
  };
}
