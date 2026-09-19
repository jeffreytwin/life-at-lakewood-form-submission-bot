-- ============================================================
-- 065: a plan's identity is builder + community + name, not name alone
--      (Jeff, 2026-09-19)
--
-- fp_floor_plans was unique on (site_id, plan_key), and plan_key is the
-- normalized plan name. Two builders with an "Aria" on the same site, or
-- one builder selling the same plan in two communities, would have shared
-- a row and overwritten each other on write-back. The plan doc always
-- said the natural key was builder + community + name; this makes the
-- table say so, and the write-back's upsert and filters follow.
-- (Applied to production 2026-09-19 via the Supabase MCP as
-- floor_plan_identity.)
-- ============================================================
DROP INDEX IF EXISTS idx_fp_floor_plans_key;
CREATE UNIQUE INDEX idx_fp_floor_plans_identity
  ON fp_floor_plans (site_id, community_id, builder_id, plan_key);
