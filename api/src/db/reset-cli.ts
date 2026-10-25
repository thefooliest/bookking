import { migrate } from './migrate.js';
import { closePool } from './pool.js';
import { resetDatabase } from './reset.js';
import { seed } from './seed.js';

async function reset(): Promise<void> {
  await resetDatabase();
  await migrate();
  await seed();
  console.log('Base de datos reiniciada y sembrada.');
}

reset()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
