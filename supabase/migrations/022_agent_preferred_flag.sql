-- Add is_preferred flag to agents table.
-- When set to true, the agent is prioritized for the next form submission.
-- The flag is automatically cleared after the agent receives a form SMS.
ALTER TABLE agents ADD COLUMN is_preferred BOOLEAN NOT NULL DEFAULT FALSE;
