CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  size text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  hourly_rate numeric(14,2) NOT NULL CHECK (hourly_rate > 0)
);

CREATE TABLE bookings (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES users(id),
  room_id integer REFERENCES rooms(id),
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled')),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 3),
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  quote jsonb,
  total numeric(14,2),
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT bookings_confirmed_requires_schedule CHECK (
    status <> 'confirmed'
    OR (room_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND total IS NOT NULL)
  ),
  CONSTRAINT bookings_time_order CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

CREATE INDEX bookings_customer_id_idx ON bookings (customer_id);
CREATE INDEX bookings_status_created_at_idx ON bookings (status, created_at DESC);
CREATE INDEX bookings_room_id_starts_at_idx ON bookings (room_id, starts_at);

CREATE TABLE booking_services (
  booking_id integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code IN ('projector', 'coffee')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (booking_id, code)
);
