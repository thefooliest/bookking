CREATE TABLE email_outbox (
  id bigserial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking_confirmation')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (booking_id, kind)
);

CREATE INDEX email_outbox_due_idx
  ON email_outbox (next_attempt_at)
  WHERE status = 'pending';
