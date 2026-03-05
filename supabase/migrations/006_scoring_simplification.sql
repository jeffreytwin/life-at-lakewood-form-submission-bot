-- Simplify scoring model:
-- 1. Rename availability_windows → unavailability_windows (inverted logic)
-- 2. Drop scoring_priority (replaced by global weights)
-- 3. Migrate old price range values to new 250K-increment buckets

-- Rename availability column (same JSONB structure, different semantics)
ALTER TABLE agents
  RENAME COLUMN availability_windows TO unavailability_windows;

-- Drop per-agent scoring priority (now using global weights)
ALTER TABLE agents
  DROP COLUMN scoring_priority;

-- Migrate existing price_ranges from old 3-bucket system to new 6-bucket system
-- Old: "under_500k" → New: "250k_to_500k" (conservative mapping)
-- Old: "500k_to_1m" → New: "500k_to_750k", "750k_to_1m"
-- Old: "1m_plus"    → New: "1m_to_1_5m", "1_5m_plus"
-- Agents with null price_ranges (accepts all) need no changes.
UPDATE agents
  SET price_ranges = (
    SELECT jsonb_agg(new_range)
    FROM (
      SELECT DISTINCT new_range
      FROM jsonb_array_elements_text(price_ranges) AS old_range,
      LATERAL (
        SELECT unnest(
          CASE old_range
            WHEN 'under_500k' THEN ARRAY['under_250k', '250k_to_500k']
            WHEN '500k_to_1m' THEN ARRAY['500k_to_750k', '750k_to_1m']
            WHEN '1m_plus'    THEN ARRAY['1m_to_1_5m', '1_5m_plus']
            ELSE ARRAY[old_range]  -- keep any already-migrated values
          END
        ) AS new_range
      ) expanded
    ) deduped
  )
  WHERE price_ranges IS NOT NULL;
