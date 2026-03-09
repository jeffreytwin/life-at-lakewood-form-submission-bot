-- Add salesforce_owner_id to leads table to store the current SF owner's User ID
-- when a lead is received from Zapier. This is sent back in the acceptance
-- webhook so the Zap can update the owner in Salesforce.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS salesforce_owner_id TEXT;
