import http from 'http';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { initSocket } from './websocket/index.js';
import { createApp } from './app.js';
import { startTripAlertScheduler } from './services/trip-alert.service.js';
import { stopTripAlertScheduler } from './services/trip-alert.service.js';
import { startRouteGeometryMaintenance } from './services/route-geometry.service.js';
import { Company } from './models/Company.js';
import { tenantContext } from './tenancy/context.js';
import mongoose from 'mongoose';

const app = createApp();

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(env.port, () => {
  console.log(`API + WebSocket listening on port ${env.port}; waiting for database readiness`);
});

void connectDb().then(() => {
  startTripAlertScheduler();
  void Company.find({ status: 'active' }).select('_id').lean().then(async (companies) => {
    for (const company of companies) {
      await tenantContext.run({ companyId: company._id.toString() }, () => startRouteGeometryMaintenance());
    }
  }).catch((error) => console.error(`[route-geometry] startup rebuild failed: ${(error as Error).message}`));
  console.log('API is ready');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully`);
  stopTripAlertScheduler();
  httpServer.close(async () => {
    await mongoose.disconnect().catch((error) => console.error('MongoDB shutdown error:', error));
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
