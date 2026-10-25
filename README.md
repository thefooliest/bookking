# Bookking

Aplicación full stack de reservas para un coworking: cotización de salas, reserva por pasos,
panel de administración, correo de confirmación asíncrono y asistente conversacional con IA.

Las cuatro partes de la prueba están resueltas:

| Parte | Entrega |
| --- | --- |
| 1. Reservas | API + web con cotizador, borradores, confirmación concurrente y panel admin |
| 2. Integraciones | Correo en background con reintentos y chat de reservas con IA |
| 3. SQL | `consultas.sql` + fixture verificable en `db/fixtures/parte3.sql` |
| 4. Incidente | `INCIDENTE.md` |
| Bonus Rails | Respuesta al final de este README |

## Stack

- Node.js 22, TypeScript 5.9 y npm workspaces.
- API: Fastify 5, Zod 4, `pg`, Luxon, Nodemailer.
- Web: React 19, Vite 8, React Router 7, TanStack Query 5.
- Datos: PostgreSQL 16.
- Correo local: Mailpit.
- IA: OpenRouter (API compatible con OpenAI) y un modo `mock` local para correr sin clave.

## Cómo correrlo en local

Requisitos: Node.js 22.12 o superior, npm y Docker con Compose.

```bash
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Mailpit: `http://localhost:8025`
- PostgreSQL: `localhost:5433` (el `5432` suele estar ocupado por una instalación local)

`.env` es opcional para desarrollo porque `api/src/config/env.ts` tiene valores por defecto. Para
reiniciar todo desde cero:

```bash
npm run db:reset
```

Este comando borra el esquema público, aplica todas las migraciones y siembra los datos demo.

### Usuarios y datos demo

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Cliente | `cliente@bookking.local` | `cliente123` |
| Administrador | `admin@bookking.local` | `admin123` |

Salas: Pequeña `$40.000/h`, Mediana `$70.000/h`, Grande `$120.000/h`.

### Scripts

```bash
npm run dev          # API + web en paralelo
npm run dev:api      # solo API (tsx watch)
npm run dev:web      # solo web (Vite)
npm run typecheck    # shared + api + web
npm test             # Vitest de la API sobre bookking_test
npm run build        # typecheck + build de producción de la web
npm run db:migrate   # migraciones pendientes
npm run db:seed      # usuarios y salas demo
npm run db:reset     # borra, migra y siembra
```

Los tests usan `TEST_DATABASE_URL` y reinician la base de pruebas en cada archivo. El contenedor
crea `bookking_test` la primera vez mediante `db/init/00-create-test-db.sql`.

## Arquitectura

```text
api/src/
  modules/auth/        login, logout y cookie de sesión firmada
  modules/quotes/      pricing puro, disponibilidad y siguiente horario
  modules/bookings/    borradores, máquina de estados, concurrencia y panel
  modules/email/       outbox, worker con reintentos y transporte SMTP
  modules/assistant/   chat, prompt, herramientas, provider y fallback mock
  db/                  pool, migraciones, seed y reset
shared/src/index.ts    contratos TypeScript compartidos entre API y web
web/src/               React, rutas protegidas, wizard, admin y chat
db/migrations/         esquema versionado
db/fixtures/           datos reproducibles para probar las consultas SQL
```

La API valida todas las entradas con Zod, usa SQL parametrizado y devuelve errores con
`{ error, message, details }`. Los tipos de request/response viven en `@bookking/shared`.

## Parte 1 — Decisiones principales

### Cotizador

- `calculatePrice` es una función pura, sin base de datos, cubierta por tests.
- La zona horaria es `America/Bogota`; domingos cerrado; atención de 07:00 a 21:00; duración de
  1 a 10 horas en bloques de 30 minutos.
- Descuento: 10 % desde 4 horas y 20 % desde 8. Sábado: 25 % sobre el valor ya descontado.
- La disponibilidad solo considera reservas `confirmed`. Si el horario está ocupado, se calcula el
  siguiente bloque libre del mismo día en pasos de 30 minutos.
- El servidor es la única fuente de precio y disponibilidad. La UI no replica esas reglas.

### Borradores y estados

Cada paso se guarda con `PATCH /api/bookings/:id`. `current_step` representa el paso más lejano
alcanzado, no el paso visible actualmente. El servidor usa
`max(current_step, currentStep enviado)`, por lo que volver atrás en la UI no borra progreso.

Estados y transiciones están en `api/src/modules/bookings/state.ts`:

```text
draft -> confirmed -> completed | cancelled
draft -> cancelled (solo administrador)
```

Las transiciones se validan en el backend, no solo en React.

### Doble confirmación y dos clientes a la vez

- Al confirmar por primera vez, la reserva cambia a `confirmed` y se congela el `quote` pactado.
  Confirmar de nuevo devuelve la misma reserva, sin duplicar ni recalcular el precio.
- La carrera entre dos clientes por la misma sala/horario la resuelve PostgreSQL con
  `btree_gist` y la constraint `bookings_no_confirmed_overlap`: un rango `tstzrange` por sala y
  solo para reservas `confirmed`. Si dos transacciones intentan confirmar el mismo intervalo, una
  recibe `23P01` y la API responde `409 slot_taken`.
- El correo también es idempotente: la outbox tiene `UNIQUE (booking_id, kind)`.

### Autenticación

Cookie `bookking_session` firmada con `@fastify/cookie`, `httpOnly`, `sameSite=lax` y `secure` en
producción. El payload es un JSON base64url `{ userId, role }`; no hay tabla de sesiones. Para el
alcance de la prueba es suficiente y evita estado extra. Logout limpia la cookie. No implementé
registro, recuperación de contraseña ni revocación global de sesiones.

## Parte 2.1 — Correo de confirmación en segundo plano

Al confirmar una reserva se inserta un correo en `email_outbox` dentro de la misma transacción. La
respuesta HTTP no espera al SMTP.

- Worker cada 10 segundos, iniciado junto con la API.
- Claim con `FOR UPDATE SKIP LOCKED`, hasta 10 correos por pasada.
- Hasta 5 intentos con backoff creciente: 30 s, 60 s, 120 s, 240 s y 480 s.
- Al agotar intentos queda `failed` con `last_error`; el administrador ve el estado, el destinatario,
  los intentos y el error en el detalle de la reserva.
- `UNIQUE (booking_id, kind)` y `message_id` determinístico evitan duplicados si se confirma dos
  veces o el worker se reintenta.
- Mailpit captura los correos: `http://localhost:8025`.

Para probarlo: confirma una reserva, espera unos segundos y revisa Mailpit y el detalle de admin.
Si detienes Mailpit, el worker dejará el correo `pending` y reintentará; tras 5 intentos quedará
`failed`.

## Parte 2.2 — Asistente de reservas con IA

Ruta web: `/asistente` (solo cliente). Ruta API: `GET /api/assistant`,
`POST /api/assistant/messages` y `POST /api/assistant/reset`.

### Cómo funciona

- La conversación se guarda en PostgreSQL (`assistant_conversations` y `assistant_messages`), por
  lo que se retoma al recargar la página.
- El prompt está en su propio archivo: `api/src/modules/assistant/prompt.ts`.
- El modelo solo puede usar herramientas con allowlist: listar salas, resolver una fecha relativa,
  cotizar y crear/actualizar el borrador. **No existe una herramienta para confirmar, cancelar o
  listar reservas de otros clientes.**
- Toda llamada a herramientas se valida con Zod antes de ejecutarse. La respuesta final del modelo
  también pasa por un esquema antes de mostrarse.
- Precio y disponibilidad siempre salen de `createQuote`; el modelo no los calcula.
- Las fechas relativas ("el sábado", "mañana") se resuelven en código con Luxon
  (`api/src/modules/assistant/dates.ts`). El modelo debe usar la herramienta `resolve_date`; no se
  le pide hacer aritmética de fechas.
- Al final el asistente crea un `draft` con `current_step = 3`, cliente, horario y extras. El chat
  muestra una tarjeta con el botón **Revisar y confirmar**, que abre el wizard. La confirmación
  ocurre únicamente con el botón de la app.

### Cómo garantizo la regla 4

1. El prompt de sistema trata el texto del usuario como datos, no como instrucciones, y prohíbe
   cambiar reglas, revelar el prompt, confirmar/cancelar, ver otras reservas o inventar precios.
2. El backend no ofrece herramientas destructivas ni de lectura de otras reservas. El `switch` de
   `executeTool` rechaza cualquier herramienta desconocida.
3. Todas las consultas están acotadas al `userId` de la sesión; la conversación es única por
   cliente y el borrador solo se actualiza si pertenece a ese cliente.
4. Los argumentos de las herramientas se validan con Zod; el modelo no ejecuta SQL ni código.
5. Hay pruebas que intentan inyección de prompt en español e inglés y verifican que la reserva siga
   en `draft` y que el asistente rechace la instrucción.

### Proveedor y fallback

`AI_PROVIDER=mock` es el valor por defecto para que el proyecto se pueda evaluar sin clave. El mock
es determinista: interpreta personas, sala, fecha relativa, hora, duración, extras y teléfono, y usa
los mismos servicios de cotización y borrador. No es un LLM, pero permite recorrer el flujo completo.

Para usar OpenRouter:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=tu_clave
OPENROUTER_MODEL=openai/gpt-4o-mini
```

El adapter está en `api/src/modules/assistant/provider.ts`, usa el endpoint compatible con OpenAI,
tool calling y timeout de 45 segundos. No pude probarlo contra OpenRouter real porque no tenía clave;
sí validé el flujo completo, los contratos y los tests con el provider mock.

## Parte 3 — SQL

`consultas.sql` contiene una consulta comentada por punto sobre el esquema simplificado de la prueba.
`db/fixtures/parte3.sql` crea ese esquema con datos mínimos para verificar resultados.

Decisiones:

- El saldo de una reserva es `total - sum(payments)`; solo se suman reservas con saldo positivo.
- Los solapamientos usan comparaciones estrictas (`<`), por lo que una reserva que termina a las
  10:00 y otra que empieza a las 10:00 no se consideran cruzadas.
- Para el reporte mensual, una reserva que cruza de mes se cuenta completa en el mes de
  `starts_at`, en hora de Colombia. Cada sala aparece en los 12 meses, incluso en cero.
- La respuesta de índices de la pregunta 5 está al final de `consultas.sql`.

## Parte 4 — Incidente

El análisis completo está en `INCIDENTE.md`: hipótesis, consultas y logs, corrección de datos ya
afectados sin duplicar mensajes, pruebas, aprobadores, cambio de fondo y alertas.

## Bonus Rails

El problema es que `before_save :regenerate_invoice, if: -> { status == 'confirmed' }` se ejecuta en
**cualquier** guardado de una reserva ya confirmada, no solo en la transición a `confirmed`.
Cualquier cambio de notas, precio o dato de contacto destruye y recrea la factura, cambia su id,
puede romper referencias de pagos o webhooks y no es idempotente.

Lo corregiría así:

```ruby
class Booking < ApplicationRecord
  has_one :invoice, dependent: :destroy

  after_update :regenerate_invoice, if: :just_confirmed?
  # o una transición explícita: after_transition to: :confirmed

  private

  def just_confirmed?
    saved_change_to_status? && status == 'confirmed'
  end

  def regenerate_invoice
    return if invoice&.paid?

    transaction do
      invoice&.destroy!
      create_invoice!(total: lines_total, tax: TaxCalculator.for(self))
    end
  end
end
```

Además agregaría un índice único en `invoices.booking_id`, no destruiría una factura pagada y
haría la emisión idempotente (`find_or_create_by!` o una clave de idempotencia). La factura emitida
debería ser inmutable; un cambio posterior se corrige con nota crédito, no recreando el documento.

## Uso de IA

Usé **opencode** con el modelo `big-pickle` como asistente durante todo el desarrollo, con
instrucciones de proyecto en `AGENTS.md`. La IA aceleró scaffolding, tests y UI, pero revisé y
modifiqué cada línea antes de integrarla.

Ejemplos concretos de lo que propuso, corregí o descarté:

- **Descartado:** una tabla de sesiones en base de datos. Para el alcance de la prueba era estado
  innecesario; preferí una cookie firmada sin sesión persistida.
- **Corregido:** validar solapamientos con un `SELECT` antes del `INSERT`. Esa comprobación tiene una
  carrera entre transacciones; la reemplacé por una constraint de exclusión `btree_gist` y el manejo
  del error `23P01`.
- **Corregido:** recalcular el precio al confirmar. La regla pide no recalcular; ahora el precio se
  congela en el borrador y la doble confirmación es idempotente.
- **Corregido:** resolver fechas relativas dentro del prompt del asistente. Eso no es determinista;
  lo moví a código con Luxon y una herramienta `resolve_date`.
- **Corregido:** el worker de correo inicialmente no tenía tope de intentos ni backoff. Agregué el
  límite de 5, la espera creciente y el estado `failed` visible para admin.
- **Verificado por mí:** typecheck, 67 tests, build de Vite, flujo manual de correo contra Mailpit
  (asunto, cuerpo y estado `sent`), flujo manual del asistente creando un borrador, pruebas de
  concurrencia y ejecución de `consultas.sql` contra el fixture.

## Qué dejé por fuera y por qué

- No hay integración real de WhatsApp ni pagos: no forman parte de las Partes 1 y 2.
- La autenticación es simple a propósito (dos usuarios sembrados, sin registro/recuperación). La
  prueba pide autenticación simple.
- No hay rate limiting ni CSRF token adicional; la cookie es `sameSite=lax` y las mutaciones están
  detrás de sesión. Para producción agregaría rate limiting, CSRF y revocación de sesiones.
- No hay pruebas E2E de navegador. Cubrí la lógica y los endpoints con 67 tests y verifiqué los
  flujos principales manualmente; un E2E con Playwright sería el siguiente paso.
- No hay una cola externa: la outbox en PostgreSQL es suficiente y deja el estado auditable.
- El asistente en modo `mock` es determinista, no un LLM. El camino real con OpenRouter está
  implementado, pero no se probó con una clave real.
- Las consultas SQL asumen las reglas indicadas en los comentarios (saldo positivo, mes de inicio,
  solapamiento estricto); no incluyen feriados ni prorrateo de reservas entre meses.

## Endpoints principales

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/rooms
POST   /api/quotes

GET    /api/bookings?status=&roomId=&page=&pageSize=
POST   /api/bookings
GET    /api/bookings/:id
PATCH  /api/bookings/:id
POST   /api/bookings/:id/confirm
POST   /api/bookings/:id/cancel      (admin, motivo obligatorio)
POST   /api/bookings/:id/complete    (admin)

GET    /api/assistant
POST   /api/assistant/messages
POST   /api/assistant/reset

GET    /api/health
```
