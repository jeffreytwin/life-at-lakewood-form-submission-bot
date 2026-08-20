-- Two agents ended up owning the same lead (Peter Matlosz, 2026-08-16): a
-- second form arrived 0.8s after the first was accepted, and the read-based
-- duplicate check saw the first lead had already left the pending/routing
-- window, so it auctioned the same Salesforce record a second time.
--
-- The ownership fix lives in the router (a lead this bot has already assigned
-- is never re-auctioned). This index closes the narrower race behind it: two
-- webhook deliveries arriving together can both read "no active lead" before
-- either inserts, so enforce at most one in-flight lead per Salesforce record
-- in the database. routeLead catches the unique violation and treats the
-- losing delivery as a duplicate.

-- Backfill: if any record currently has more than one in-flight lead, keep the
-- newest and mark the rest failed so they stay visible and retryable.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY salesforce_record_id ORDER BY created_at DESC
    ) AS rn
  FROM leads
  WHERE salesforce_record_id IS NOT NULL
    AND routing_status IN ('pending', 'routing')
)
UPDATE leads
SET routing_status = 'failed'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_one_active_per_sf_record
  ON leads (salesforce_record_id)
  WHERE salesforce_record_id IS NOT NULL
    AND routing_status IN ('pending', 'routing');

-- Supports the router's "has this bot already assigned this record?" lookup.
CREATE INDEX IF NOT EXISTS idx_leads_assigned_by_sf_record
  ON leads (salesforce_record_id, created_at DESC)
  WHERE salesforce_record_id IS NOT NULL
    AND final_agent_id IS NOT NULL
    AND routing_status IN ('accepted', 'owned_by_other');
