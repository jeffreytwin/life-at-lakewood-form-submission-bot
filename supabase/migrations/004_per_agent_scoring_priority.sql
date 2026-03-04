-- Per-agent scoring priority (drag-to-rank order)
-- Replaces global scoring_weights table.
-- Location match becomes a hard filter instead of a weighted factor.
-- The remaining 5 factors are ranked per-agent; weights are derived from rank position.

ALTER TABLE agents
  ADD COLUMN scoring_priority JSONB
    DEFAULT '["close_rate","lead_load","lead_value","availability","optimal_load"]'::jsonb;

-- Backfill existing agents with default priority order
UPDATE agents
  SET scoring_priority = '["close_rate","lead_load","lead_value","availability","optimal_load"]'::jsonb
  WHERE scoring_priority IS NULL;
