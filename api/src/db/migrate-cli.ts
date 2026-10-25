import { migrate } from './migrate.js';
import { closePool } from './pool.js';

migrate()
  .then((applied) => {
    if (applied.length === 0) {
      console.log('Sin migraciones pendientes.');
      return;
    }
    console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
