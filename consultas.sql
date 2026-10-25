-- Parte 3 — Consultas sobre el esquema simplificado de reservas.
-- Las fechas de negocio se agrupan en la zona horaria America/Bogota.

-- 1. Clientes con saldo pendiente en reservas completed terminadas hace más de 30 días.
WITH saldos AS (
  SELECT
    b.customer_id,
    b.id,
    b.total - COALESCE(SUM(p.amount), 0) AS saldo,
    b.ends_at
  FROM bookings b
  LEFT JOIN payments p ON p.booking_id = b.id
  WHERE b.status = 'completed'
    AND b.ends_at < now() - interval '30 days'
  GROUP BY b.id, b.customer_id, b.total, b.ends_at
  HAVING b.total - COALESCE(SUM(p.amount), 0) > 0
)
SELECT
  c.email,
  c.full_name,
  c.company,
  SUM(s.saldo) AS saldo_pendiente,
  (now() AT TIME ZONE 'America/Bogota')::date
    - (MIN(s.ends_at) AT TIME ZONE 'America/Bogota')::date AS dias_desde_la_mas_antigua
FROM saldos s
JOIN customers c ON c.id = s.customer_id
GROUP BY c.id, c.email, c.full_name, c.company
ORDER BY saldo_pendiente DESC;

-- 2. Pares de reservas confirmed/completed de la misma sala cuyos horarios se solapan.
-- El solapamiento es estricto: una reserva que termina justo cuando empieza otra no se cruza.
SELECT
  a.id AS reserva_a,
  b.id AS reserva_b,
  a.room_id,
  a.starts_at AS inicio_a,
  a.ends_at AS fin_a,
  b.starts_at AS inicio_b,
  b.ends_at AS fin_b
FROM bookings a
JOIN bookings b
  ON b.room_id = a.room_id
 AND b.id > a.id
 AND a.starts_at < b.ends_at
 AND b.starts_at < a.ends_at
WHERE a.status IN ('confirmed', 'completed')
  AND b.status IN ('confirmed', 'completed')
ORDER BY a.room_id, a.id, b.id;

-- 3. Horas reservadas e ingresos por sala y mes durante los últimos 12 meses.
-- Una reserva que cruza de mes se cuenta completa en el mes de starts_at.
WITH meses AS (
  SELECT generate_series(
    date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date - interval '11 months',
    date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date,
    interval '1 month'
  )::date AS mes
),
reservas_por_mes AS (
  SELECT
    room_id,
    date_trunc('month', starts_at AT TIME ZONE 'America/Bogota')::date AS mes,
    ROUND(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600), 2) AS horas,
    SUM(total) AS ingresos
  FROM bookings
  WHERE status IN ('confirmed', 'completed')
  GROUP BY room_id, 2
)
SELECT
  r.id,
  r.name,
  m.mes,
  COALESCE(rpm.horas, 0) AS horas_reservadas,
  COALESCE(rpm.ingresos, 0) AS ingresos
FROM rooms r
CROSS JOIN meses m
LEFT JOIN reservas_por_mes rpm
  ON rpm.room_id = r.id
 AND rpm.mes = m.mes
ORDER BY r.name, m.mes;

-- 4. Reservas con total inconsistente o marcadas paid sin pagos suficientes.
WITH total_lineas AS (
  SELECT booking_id, SUM(amount) AS total
  FROM booking_lines
  GROUP BY booking_id
),
total_pagos AS (
  SELECT booking_id, SUM(amount) AS total
  FROM payments
  GROUP BY booking_id
)
SELECT
  b.id,
  b.total,
  COALESCE(tl.total, 0) AS total_lineas,
  COALESCE(tp.total, 0) AS total_pagos,
  CONCAT_WS(
    ', ',
    CASE WHEN b.total <> COALESCE(tl.total, 0) THEN 'total distinto a booking_lines' END,
    CASE
      WHEN b.payment_status = 'paid' AND COALESCE(tp.total, 0) < b.total
      THEN 'paid con pagos insuficientes'
    END
  ) AS inconsistencia
FROM bookings b
LEFT JOIN total_lineas tl ON tl.booking_id = b.id
LEFT JOIN total_pagos tp ON tp.booking_id = b.id
WHERE b.total <> COALESCE(tl.total, 0)
   OR (b.payment_status = 'paid' AND COALESCE(tp.total, 0) < b.total)
ORDER BY b.id;

-- 5. Crearía payments(booking_id) INCLUDE (amount) y booking_lines(booking_id) INCLUDE (amount)
-- para index-only scans al agregar por reserva, sin leer las tablas completas.
-- Validaría con EXPLAIN (ANALYZE, BUFFERS) antes/después sobre una copia de 5M de filas,
-- comparando tiempo y buffers; los crearía con CONCURRENTLY y revisaría un índice parcial
-- para bookings con payment_status = 'paid' si el plan no usa los anteriores.
