import { pool } from '../../db/pool.js';
import { smtpEmailSender, type EmailSender } from './transport.js';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;

type OutboxRow = {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
  body_html: string;
  message_id: string;
  attempts: number;
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

export async function processEmailOutboxOnce(
  sender: EmailSender = smtpEmailSender
): Promise<number> {
  const claimed = await pool.query<OutboxRow>(
    `WITH due AS (
       SELECT id
       FROM email_outbox
       WHERE status = 'pending'
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox outbox
     SET status = 'sending',
         attempts = outbox.attempts + 1,
         updated_at = now()
     FROM due
     WHERE outbox.id = due.id
     RETURNING outbox.id,
               outbox.recipient,
               outbox.subject,
               outbox.body_text,
               outbox.body_html,
               outbox.message_id,
               outbox.attempts`,
    [BATCH_SIZE]
  );

  for (const row of claimed.rows) {
    try {
      await sender({
        to: row.recipient,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
        messageId: row.message_id
      });

      await pool.query(
        `UPDATE email_outbox
         SET status = 'sent',
             last_error = NULL,
             sent_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [row.id]
      );
    } catch (error) {
      const failed = row.attempts >= MAX_ATTEMPTS;
      const backoffSeconds = Math.min(30 * 2 ** (row.attempts - 1), 3600);

      await pool.query(
        `UPDATE email_outbox
         SET status = $2,
             last_error = $3,
             next_attempt_at = now() + make_interval(secs => $4),
             updated_at = now()
         WHERE id = $1`,
        [row.id, failed ? 'failed' : 'pending', errorMessage(error), backoffSeconds]
      );
    }
  }

  return claimed.rowCount ?? 0;
}

export function startEmailWorker(intervalMs = 10_000): () => void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await processEmailOutboxOnce();
    } catch (error) {
      console.error('Email worker failed', error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
