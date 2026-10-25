import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';

const app = buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await closePool();
    })();
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  await closePool();
  process.exit(1);
}
