-- Prevent duplicate email messages from concurrent sync (push + cron race)
-- by adding a unique constraint on provider_message_id.

-- First remove any existing duplicates (keep the earliest)
DELETE FROM email_messages a
USING email_messages b
WHERE a.provider_message_id = b.provider_message_id
  AND a.provider_message_id IS NOT NULL
  AND a.created_at > b.created_at;

-- Now add the unique index (partial — only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_message_id_unique
  ON email_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
