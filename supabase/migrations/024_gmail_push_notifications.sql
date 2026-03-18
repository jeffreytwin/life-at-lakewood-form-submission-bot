-- Add watch_expiration column to track when the Gmail Pub/Sub watch expires.
-- The watch must be renewed every 7 days per Google's API.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS watch_expiration TIMESTAMPTZ;
