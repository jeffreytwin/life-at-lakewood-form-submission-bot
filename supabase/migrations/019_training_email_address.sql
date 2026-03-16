-- Add email_address column to training_examples
-- Training examples are now organized by email address instead of location
ALTER TABLE training_examples ADD COLUMN email_address TEXT;

-- Create index for filtering by email_address
CREATE INDEX idx_training_examples_email ON training_examples (email_address, category)
  WHERE is_active = true;

-- Seed email accounts for the 4 known inboxes
INSERT INTO email_accounts (email_address, provider, display_name, is_active)
VALUES
  ('lynn@lifeatlakewood.com', 'gmail', 'Lynn Brown - Lakewood', true),
  ('lynn@lifeinwellenpark.com', 'gmail', 'Lynn Brown - Wellenpark', true),
  ('lynn@lifeatoarrish.com', 'gmail', 'Lynn Brown - Oarrish', true),
  ('lynn@lifeinlongboatkey.com', 'gmail', 'Lynn Brown - Longboat Key', true)
ON CONFLICT (email_address) DO NOTHING;
