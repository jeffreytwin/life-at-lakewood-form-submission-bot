-- Allow phone to be NULL so agents auto-created from close rate data
-- can be added without a phone number (they won't receive leads until
-- a phone number is manually assigned).
ALTER TABLE agents ALTER COLUMN phone DROP NOT NULL;
