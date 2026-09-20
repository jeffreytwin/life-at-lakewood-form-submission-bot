-- A quick move-in that stands in for its floor plan (Jeff, 2026-09-20):
-- when a builder no longer lists a plan but still has a home of it for
-- sale, the site has nowhere to show that home, since quick move-ins only
-- appear under their plan. A person creates the plan from the home in the
-- Hub's edit overlay; this row remembers that decision, and every Run
-- rebuilds the plan from the homes that name it (stand-ins.ts) until the
-- last of them sells, when the plan leaves through the removal queue like
-- any other. Written by the stand-in route, read by the sync core.
-- (Applied to production 2026-09-20 via MCP.)
CREATE TABLE IF NOT EXISTS fp_stand_in_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  community_id UUID NOT NULL REFERENCES fp_communities(id),
  builder_id UUID NOT NULL REFERENCES fp_builders(id),
  plan_key TEXT NOT NULL,          -- the floor plan's key, as a real plan of the same name would carry
  plan_name TEXT NOT NULL,         -- the name the site shows
  source_plan_key TEXT NOT NULL,   -- the quick move-in the person clicked on
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_stand_in_plans_identity ON fp_stand_in_plans (site_id, community_id, builder_id, plan_key);
ALTER TABLE fp_stand_in_plans ENABLE ROW LEVEL SECURITY;
