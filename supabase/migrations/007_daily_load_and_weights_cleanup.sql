-- 007: Add daily lead cap + simplify scoring_weights to 2 factors
--
-- Changes:
--   1. Add daily_lead_max column to agents (default 5, hard cap with overflow)
--   2. Simplify scoring_weights to just close_rate + lead_load (sum to 100)

-- Add daily lead cap per agent
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS daily_lead_max INTEGER NOT NULL DEFAULT 5;

-- Drop old scoring weight columns that are now hard filters or unused
ALTER TABLE scoring_weights
  DROP COLUMN IF EXISTS location_match,
  DROP COLUMN IF EXISTS lead_value,
  DROP COLUMN IF EXISTS availability,
  DROP COLUMN IF EXISTS optimal_load,
  DROP COLUMN IF EXISTS daily_load;

-- Update the existing row to the new default weights (60/40)
UPDATE scoring_weights
  SET close_rate = 60,
      lead_load = 40;
