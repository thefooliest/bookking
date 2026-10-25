import { closePool } from './pool.js';
import { seed } from './seed.js';

seed()
  .then(() => {
    console.log('Datos de ejemplo cargados.');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
