# AGENTS.md

## Proyecto

Bookking: monorepo npm con `shared`, `api` y `web`. Node 22, TypeScript estricto, Fastify 5,
React 19, PostgreSQL 16, Vite 8 y Vitest 5.

## Comandos

```bash
npm run dev          # API + web
npm run dev:api
npm run dev:web
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run db:seed
npm run db:reset
```

La base de desarrollo está en `localhost:5433` y la de tests en `bookking_test`. Mailpit usa
`localhost:1025` (SMTP) y `http://localhost:8025` (UI). `.env` es opcional en desarrollo.

## Convenciones

- No agregar comentarios salvo que aclaren una decisión no obvia.
- Validar entradas de API con Zod y devolver errores con `AppError`.
- Usar SQL parametrizado; nunca interpolar valores de usuario.
- Mantener los contratos de request/response en `shared/src/index.ts`.
- La lógica de precios y disponibilidad vive en la API; la UI no la replica.
- Las mutaciones de reservas deben respetar las transiciones de `bookings/state.ts`.
- Los tests de API reinician `bookking_test` y aplican migraciones; no asumir datos previos.
- Ejecutar `npm run typecheck` y `npm test` antes de cerrar un cambio; para UI, `npm run build`.
- No confirmar ni cancelar reservas desde el asistente: solo crear/actualizar borradores.
- No commitear secretos. Las claves de IA y SMTP van en `.env`.
