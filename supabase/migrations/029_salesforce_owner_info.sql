-- 029: Add Salesforce owner info to salesforce_contacts and email_threads
-- Tracks lead ownership from Salesforce so the Email Hub can show whether
-- a lead is already owned by a non-frontlines agent.

-- salesforce_contacts: store owner info from Zapier
ALTER TABLE salesforce_contacts
  ADD COLUMN IF NOT EXISTS salesforce_owner_id text,
  ADD COLUMN IF NOT EXISTS salesforce_owner_name text,
  ADD COLUMN IF NOT EXISTS is_master_agent_owned boolean;

-- email_threads: snapshot of owner info at time of email arrival
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS salesforce_owner_id text,
  ADD COLUMN IF NOT EXISTS salesforce_owner_name text,
  ADD COLUMN IF NOT EXISTS is_master_agent_owned boolean;
