# Incidente: recordatorios de WhatsApp que vencen antes de poder enviarse

## 1. Hipótesis y verificación

La hipótesis principal es que el recordatorio nace con una vida útil de 2 horas, pero la ventana de
contacto (8:00–18:00) no forma parte de esa cuenta. Un borrador creado a las 17:30 queda `pending`;
el job corre a las 18:00, 18:30 o 19:00, no puede enviar por horario y, al superar las 2 horas desde
`created_at`, lo marca `expired` sin haber hecho un solo intento. A la mañana siguiente ya está
vencido. El 92 % de los `expired` creados después de las 17:00 es consistente con un problema de
diseño del ciclo de vida, no con fallas del proveedor.

Revisaría:

- Distribución de recordatorios por hora local de creación, estado, `attempts` y edad al expirar.
  Un patrón esperado: `expired` con `attempts = 0`, creados 17:00–23:59, expirados entre 19:00 y
  02:00, y ningún `sent` para ese grupo.
- Logs del job alrededor de las 18:00, 00:00 y 08:00: ejecuciones, cantidad de pendientes, cantidad
  enviada, cantidad expirada y errores. También la zona horaria efectiva del proceso y de la base.
- Historial de estados o auditoría del recordatorio (`created_at`, `first_attempt_at`, `expired_at`,
  `last_error`, `provider_message_id`). Si `first_attempt_at` es nulo en casi todos los casos, el
  envío nunca fue el problema.
- Cruce contra reservas: cuántos `expired` siguen en `draft`, cuántos ya se confirmaron o cancelaron
  y cuántos tienen otro recordatorio enviado. Esto también define el universo a corregir.
- Métricas del proveedor de WhatsApp: tasa de aceptación, errores de plantilla y latencia. Si el
  proveedor hubiera fallado, veríamos intentos y errores, no vencimientos sin intentos.

Una consulta útil para confirmar:

```sql
SELECT status,
       count(*) AS total,
       count(*) FILTER (WHERE attempts = 0) AS sin_intentos,
       min(created_at) AS primer_creado,
       max(created_at) AS ultimo_creado
FROM whatsapp_reminders
WHERE created_at >= now() - interval '30 days'
GROUP BY status;
```

La confirmación sería: mayoría de `expired` sin intentos, creados fuera de la ventana y expirados
antes de la siguiente apertura. Si, por el contrario, aparecen intentos y errores del proveedor,
priorizaría esa causa.

## 2. Corrección de los registros afectados

Primero pausaría el job y pondría un feature flag para impedir envíos mientras se prepara la
corrección. No reactivaría nada hasta tener el dry-run aprobado.

Plan:

1. **Clasificar sin enviar.** Un script en modo dry-run selecciona recordatorios `expired` (y
   `pending` atascados) creados fuera de la ventana y calcula: reserva todavía en `draft`, sin
   recordatorio `sent`, sin otro intento en curso, cliente con consentimiento vigente y sin opt-out.
   Genera un CSV con incluidos y excluidos, con motivo. Nada se modifica en esta fase.
2. **Reprogramar en una transacción.** Solo los incluidos pasan a `pending` con
   `next_attempt_at` = siguiente apertura (8:00 en `America/Bogota`) más un jitter de 0–20 minutos.
   Se conserva el `created_at` original y se registra `replayed_at`, `replay_reason` y el operador.
   No se borra el historial ni se reutiliza un identificador ya enviado.
3. **Garantizar una sola entrega.** Clave idempotente por reserva/campaña (por ejemplo
   `unique (booking_id, kind)`), registro de envío con `provider_message_id` y la misma clave como
   idempotency key hacia el proveedor. Antes de enviar se vuelve a leer la reserva: si ya está
   `confirmed` o `cancelled`, se cancela el recordatorio. También se revalida opt-out y ventana.
4. **Enviar por tandas.** Solo entre 8:00 y 18:00, con throttling y jitter; nunca a las 3 a. m. Un
   límite diario y un botón de pausa. Empezaría con una canaria interna y luego 1 % del universo.
5. **Verificar.** Conteos antes/después por estado y motivo, cero duplicados, cero envíos fuera de
   ventana, y conciliación con el proveedor. Monitoreo de entregas y fallos con criterio de aborto.

Pruebas antes de producción: dry-run sobre una copia anonimizada, pruebas con reloj simulado
(17:30, 23:59, 03:00, 08:00), simulación de doble ejecución del job, reserva confirmada entre la
selección y el envío, y proveedor devolviendo timeout después de aceptar el mensaje. La
aprobación debe ser del líder de ingeniería/on-call y del dueño comercial; si se toca la plantilla de
WhatsApp o datos personales, también la persona responsable de privacidad.

## 3. Cambio de fondo y detección temprana

Separaría “vencido” de “antigüedad”: el TTL debe contar desde el primer intento permitido, no desde
la creación. El recordatorio tendría `next_attempt_at` calculado dentro de la ventana y el emisor
volvería a validar horario, estado de la reserva, consentimiento e idempotencia. Así un lead de las
17:30 se programa para las 8:00 y no muere de madrugada.

Además:

- Estado explícito `scheduled → sending → sent | failed | expired`, con reintentos y trazabilidad
  de cada transición.
- Un solo worker con `FOR UPDATE SKIP LOCKED`, clave idempotente y control de horario en el emisor,
  no solo en el job.
- Expiración basada en intentos/errores, o en un TTL que empiece a contar en la ventana de contacto.
- Alertas: `expired` con `attempts = 0`, pendientes con más de 2 horas dentro de horario, envíos
  fuera de 8:00–18:00, duplicados por reserva y caída de la tasa de entrega.
- Un canario nocturno que cree un recordatorio a las 17:30 en staging y verifique que se envía al
  día siguiente dentro de la ventana. Pruebas de reloj en CI y dashboard diario de embudo
  creado → intentado → enviado → entregado.

## 4. Mensaje al equipo comercial

**Asunto:** Recordatorios de WhatsApp vencidos antes de poder enviarse

Equipo: detectamos que los recordatorios creados después de las 17:00 vencían antes de que abriera la ventana de WhatsApp de 8:00, por eso muchos clientes no los recibieron.
Ya pausamos el envío y estamos reprogramando los casos afectados solo en horario permitido, sin duplicar mensajes y excluyendo reservas ya confirmadas o canceladas.
Hoy antes de las 5:00 p. m. les compartiremos cuántos clientes recuperamos y el avance del envío.
Si tienen casos urgentes, envíenlos por este canal con el correo o teléfono del cliente para priorizarlos.
