-- Gmail Push Notifications: track watch expiration for Pub/Sub push
ALTER TABLE email_accounts
  ADD COLUMN watch_expiration TIMESTAMPTZ;

COMMENT ON COLUMN email_accounts.watch_expiration IS 'When the Gmail push notification watch expires (must be renewed before expiry, max 7 days)';
