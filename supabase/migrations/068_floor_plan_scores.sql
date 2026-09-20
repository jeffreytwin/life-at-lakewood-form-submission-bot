-- A plan's score, set by a person in the Hub, remembered apart from the
-- plan itself: Reset removes a connection's plans and queue (and lost the
-- seven scores on The Isles to an accidental click, 2026-09-20), and a
-- score should come back on the next Run. Written by the queue's PATCH
-- route, read by the sync core when it queues a plan.
-- (Applied to production 2026-09-20 via MCP.)
CREATE TABLE IF NOT EXISTS fp_plan_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  community_id UUID NOT NULL REFERENCES fp_communities(id),
  builder_id UUID NOT NULL REFERENCES fp_builders(id),
  plan_key TEXT NOT NULL,
  score NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_plan_scores_identity ON fp_plan_scores (site_id, community_id, builder_id, plan_key);
ALTER TABLE fp_plan_scores ENABLE ROW LEVEL SECURITY;
