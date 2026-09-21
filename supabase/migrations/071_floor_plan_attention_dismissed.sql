-- 071: the "Builder sites needing attention" banner can be dismissed
-- (Jeff, 2026-09-21). The banner on the Floor Plans page names every active
-- connection whose last run failed; dismissing one records when, and it
-- stays hidden until a newer run of it fails (last_run_at after the
-- dismissal). A Reset clears the mark.
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS attention_dismissed_at TIMESTAMPTZ;
