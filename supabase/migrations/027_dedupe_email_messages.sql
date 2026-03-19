-- Prevent duplicate email messages from concurrent sync (push + cron race)
-- by adding a unique constraint on provider_message_id.

-- First remove any existing duplicates (keep the earliest)
DELETE FROM email_messages a
USING email_messages b
WHERE a.provider_message_id = b.provider_message_id
  AND a.provider_message_id IS NOT NULL
  AND a.created_at > b.created_at;

-- Add a proper unique constraint (not a partial index) so that
-- Supabase upsert's onConflict: "provider_message_id" works correctly.
-- A partial unique index is incompatible with ON CONFLICT (column) — PostgreSQL
-- cannot infer it without a matching WHERE clause, causing silent upsert failures.
ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_provider_message_id_key UNIQUE (provider_message_id);
