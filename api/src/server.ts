import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { startEmailWorker } from './modules/email/worker.js';

const app = buildApp();
const stopEmailWorker = startEmailWorker();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      stopEmailWorker();
      await app.close();
      await closePool();
    })();
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  stopEmailWorker();
  app.log.error(error);
  await closePool();
  process.exit(1);
}
