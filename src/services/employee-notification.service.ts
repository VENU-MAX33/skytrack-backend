import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { EmployeeNotification, type EmployeeNotificationType } from '../models/EmployeeNotification.js';
import { PushDevice } from '../models/PushDevice.js';
import { emitEmployeeNotification } from '../websocket/index.js';

export interface EmployeeNotificationDTO {
  id: string;
  type: EmployeeNotificationType;
  title: string;
  body: string;
  link: string;
  refId: string;
  read: boolean;
  createdAt: string;
}

interface CreateEmployeeNotificationInput {
  employeeId: Types.ObjectId | string;
  type: EmployeeNotificationType;
  title: string;
  body: string;
  link?: string;
  refId?: string;
}

let firebaseApp: App | null | undefined;

function getEmployeeFirebaseApp(): App | null {
  if (firebaseApp !== undefined) return firebaseApp;
  if (!env.firebaseEmployeeServiceAccountBase64 && !env.firebaseEmployeeServiceAccountFile) {
    firebaseApp = null;
    return null;
  }
  try {
    const json = env.firebaseEmployeeServiceAccountBase64
      ? Buffer.from(env.firebaseEmployeeServiceAccountBase64, 'base64').toString('utf8')
      : readFileSync(env.firebaseEmployeeServiceAccountFile, 'utf8');
    const credentials = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string };
    if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
      throw new Error('service account is missing required fields');
    }
    firebaseApp = getApps().find((app) => app.name === 'skytrack-employee') ?? initializeApp({
      credential: cert({
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key,
      }),
    }, 'skytrack-employee');
    return firebaseApp;
  } catch (error) {
    console.error('[push] Invalid FIREBASE_EMPLOYEE_SERVICE_ACCOUNT_BASE64:', (error as Error).message);
    firebaseApp = null;
    return null;
  }
}

export function toEmployeeNotificationDTO(doc: {
  _id: { toString(): string };
  type: EmployeeNotificationType;
  title: string;
  body: string;
  link: string;
  refId: string;
  read: boolean;
  createdAt: Date;
}): EmployeeNotificationDTO {
  return {
    id: doc._id.toString(), type: doc.type, title: doc.title, body: doc.body,
    link: doc.link, refId: doc.refId, read: doc.read, createdAt: doc.createdAt.toISOString(),
  };
}

async function sendEmployeePush(employeeId: Types.ObjectId | string, notification: EmployeeNotificationDTO): Promise<void> {
  const app = getEmployeeFirebaseApp();
  if (!app) return;
  const devices = await PushDevice.find({ employeeId, active: true }).select('token').lean();
  if (!devices.length) return;

  const tokens = [...new Set(devices.map((device) => device.token))];
  for (let start = 0; start < tokens.length; start += 500) {
    const batch = tokens.slice(start, start + 500);
    const result = await getMessaging(app).sendEachForMulticast({
      tokens: batch,
      notification: { title: notification.title, body: notification.body },
      data: {
        notificationId: notification.id,
        type: notification.type,
        link: notification.link || '/',
        refId: notification.refId || '',
      },
      android: {
        priority: 'high',
        notification: { channelId: 'skytrack_updates', sound: 'default' },
      },
    });
    const invalid = result.responses.flatMap((response, index) => {
      const code = response.error?.code ?? '';
      return !response.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)
        ? [batch[index]] : [];
    });
    if (invalid.length) await PushDevice.updateMany({ token: { $in: invalid } }, { $set: { active: false } });
  }
}

export async function createEmployeeNotification(input: CreateEmployeeNotificationInput): Promise<EmployeeNotificationDTO> {
  const doc = await EmployeeNotification.create({
    employeeId: input.employeeId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? '/',
    refId: input.refId ?? '',
  });
  const dto = toEmployeeNotificationDTO(doc);
  try {
    emitEmployeeNotification(String(input.employeeId), dto);
  } catch (error) {
    console.error(`[push] Realtime notification ${dto.id} failed:`, (error as Error).message);
  }
  await sendEmployeePush(input.employeeId, dto).catch((error) => {
    console.error(`[push] Employee notification ${dto.id} failed:`, (error as Error).message);
  });
  return dto;
}
