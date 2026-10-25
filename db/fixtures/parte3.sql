-- Fixture mínimo para verificar consultas.sql contra el esquema de la Parte 3.
-- Ejecutar en una base vacía: psql -f db/fixtures/parte3.sql

CREATE TABLE rooms (
  id serial PRIMARY KEY,
  name text NOT NULL,
  size text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  hourly_rate numeric(14,2) NOT NULL
);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  company text
);

CREATE TABLE bookings (
  id serial PRIMARY KEY,
  customer_id int REFERENCES customers,
  room_id int REFERENCES rooms,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  total numeric(14,2) NOT NULL,
  status text CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled')),
  payment_status text CHECK (payment_status IN ('unpaid', 'partial', 'paid'))
);

CREATE TABLE booking_lines (
  id serial PRIMARY KEY,
  booking_id int REFERENCES bookings,
  concept text NOT NULL,
  amount numeric(14,2) NOT NULL
);

CREATE TABLE payments (
  id serial PRIMARY KEY,
  booking_id int REFERENCES bookings,
  amount numeric(14,2),
  external_event_id text,
  paid_at timestamptz
);

INSERT INTO rooms (id, name, size, hourly_rate) VALUES
  (1, 'Sala Norte', 'small', 100),
  (2, 'Sala Centro', 'medium', 200);

INSERT INTO customers (id, email, full_name, company) VALUES
  (1, 'ana@example.com', 'Ana Pérez', 'Acme'),
  (2, 'beto@example.com', 'Beto Ruiz', 'Globex'),
  (3, 'carla@example.com', 'Carla Díaz', NULL),
  (4, 'diego@example.com', 'Diego Mora', 'Initech');

INSERT INTO bookings
  (id, customer_id, room_id, starts_at, ends_at, created_at, total, status, payment_status)
VALUES
  (1, 1, 1, now() - interval '61 days', now() - interval '60 days', now() - interval '70 days', 300, 'completed', 'partial'),
  (2, 1, 1, now() - interval '41 days', now() - interval '40 days', now() - interval '50 days', 200, 'completed', 'unpaid'),
  (3, 2, 2, now() + interval '2 days', now() + interval '2 days 2 hours', now(), 400, 'confirmed', 'unpaid'),
  (4, 2, 2, now() + interval '2 days 1 hour', now() + interval '2 days 3 hours', now(), 400, 'confirmed', 'unpaid'),
  (5, 3, 1, now() - interval '11 days', now() - interval '10 days', now() - interval '20 days', 100, 'completed', 'unpaid'),
  (6, 3, 1, now() - interval '32 days', now() - interval '31 days', now() - interval '40 days', 100, 'completed', 'paid'),
  (7, 4, 1, now() - interval '36 days', now() - interval '35 days', now() - interval '45 days', 150, 'completed', 'paid'),
  (8, 4, 2, now() - interval '46 days', now() - interval '45 days', now() - interval '60 days', 500, 'completed', 'paid'),
  (9, 1, 2, now() + interval '5 days', now() + interval '5 days 1 hour', now(), 250, 'confirmed', 'paid'),
  (10, 2, 1, now() + interval '6 days', now() + interval '6 days 1 hour', now(), 120, 'confirmed', 'unpaid');

INSERT INTO booking_lines (booking_id, concept, amount) VALUES
  (1, 'base', 300),
  (2, 'base', 200),
  (3, 'base', 400),
  (4, 'base', 400),
  (5, 'base', 100),
  (6, 'base', 100),
  (7, 'base', 150),
  (8, 'base', 450),
  (9, 'base', 250),
  (10, 'base', 100);

INSERT INTO payments (booking_id, amount, external_event_id, paid_at) VALUES
  (1, 100, 'evt-1', now() - interval '55 days'),
  (6, 100, 'evt-6', now() - interval '20 days'),
  (7, 200, 'evt-7', now() - interval '30 days'),
  (8, 100, 'evt-8', now() - interval '40 days'),
  (9, 200, 'evt-9', now());
