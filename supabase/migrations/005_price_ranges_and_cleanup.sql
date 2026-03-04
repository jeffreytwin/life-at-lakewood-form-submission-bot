-- Add price_ranges column to agents (hard filter for lead price eligibility)
ALTER TABLE agents
  ADD COLUMN price_ranges JSONB DEFAULT NULL;

-- Update scoring_priority to only include the 3 remaining ranked factors
-- (location and price are now hard filters; optimal_load and lead_value removed)
UPDATE agents
  SET scoring_priority = '["close_rate","lead_load","availability"]'::jsonb;

-- Update the default for new agents
ALTER TABLE agents
  ALTER COLUMN scoring_priority SET DEFAULT '["close_rate","lead_load","availability"]'::jsonb;
