import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { DriverPushDevice } from '../models/DriverPushDevice.js';

interface DriverTripPushInput {
  driverId: Types.ObjectId | string;
  tripId: string;
  tripType: string;
  date: string;
  time?: string;
}

let firebaseApp: App | null | undefined;

function getDriverFirebaseApp(): App | null {
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
    console.error('[push] Invalid Firebase service account:', (error as Error).message);
    firebaseApp = null;
    return null;
  }
}

export async function sendDriverTripPush(input: DriverTripPushInput): Promise<void> {
  const app = getDriverFirebaseApp();
  if (!app) return;
  const devices = await DriverPushDevice.find({ driverId: input.driverId, active: true }).select('token').lean();
  if (!devices.length) return;

  const tokens = [...new Set(devices.map((device) => device.token))];
  const schedule = `${input.date}${input.time ? ` at ${input.time}` : ''}`;
  for (let start = 0; start < tokens.length; start += 500) {
    const batch = tokens.slice(start, start + 500);
    const result = await getMessaging(app).sendEachForMulticast({
      tokens: batch,
      notification: {
        title: 'New trip assigned',
        body: `${input.tripType} trip ${input.tripId} is scheduled for ${schedule}`,
      },
      data: {
        type: 'trip-assigned',
        tripId: input.tripId,
        link: `/trip/${encodeURIComponent(input.tripId)}`,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'skytrack_driver_updates', sound: 'default' },
      },
    });
    const invalid = result.responses.flatMap((response, index) => {
      const code = response.error?.code ?? '';
      return !response.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)
        ? [batch[index]] : [];
    });
    if (invalid.length) await DriverPushDevice.updateMany({ token: { $in: invalid } }, { $set: { active: false } });
  }
}
