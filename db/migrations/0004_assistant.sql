CREATE TABLE assistant_conversations (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  booking_id integer REFERENCES bookings(id) ON DELETE SET NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_messages_conversation_idx
  ON assistant_messages (conversation_id, id);
