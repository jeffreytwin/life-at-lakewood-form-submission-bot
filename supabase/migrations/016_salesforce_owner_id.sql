-- Add salesforce_owner_id to store the current SF owner's User ID when a lead
-- is received. This is sent back in the acceptance webhook so the Zap can
-- update the owner in Salesforce.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS salesforce_owner_id TEXT;

-- Replace owner_name with is_master_agent_owned boolean. When true, the lead
-- is owned by the frontlines master agent and should be routed. When false,
-- it's owned by a specific agent and gets flagged as "owned_by_other".
ALTER TABLE leads DROP COLUMN IF EXISTS owner_name;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_master_agent_owned BOOLEAN NOT NULL DEFAULT false;
