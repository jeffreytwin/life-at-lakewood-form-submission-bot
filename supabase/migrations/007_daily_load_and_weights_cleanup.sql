-- 007: Add daily lead cap + simplify scoring_weights to 3 factors
--
-- Changes:
--   1. Add daily_lead_max column to agents (default 5)
--   2. Replace 6-column scoring_weights with 3 columns (close_rate, lead_load, daily_load)

-- Add daily lead cap per agent
ALTER TABLE agents
  ADD COLUMN daily_lead_max INTEGER NOT NULL DEFAULT 5;

-- Drop old scoring weight columns that are now hard filters or unused
ALTER TABLE scoring_weights
  DROP COLUMN IF EXISTS location_match,
  DROP COLUMN IF EXISTS lead_value,
  DROP COLUMN IF EXISTS availability,
  DROP COLUMN IF EXISTS optimal_load;

-- Add the new daily_load column
ALTER TABLE scoring_weights
  ADD COLUMN IF NOT EXISTS daily_load INTEGER NOT NULL DEFAULT 20;

-- Update the existing row to the new default weights (50/30/20)
UPDATE scoring_weights
  SET close_rate = 50,
      lead_load = 30,
      daily_load = 20;
