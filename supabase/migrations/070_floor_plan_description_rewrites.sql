-- A builder's description reworded so it no longer speaks as the owner of
-- the plan ("we", "our": Jeff, 2026-09-20), remembered by the text it came
-- from so the same description is reworded once, not on every Run.
-- Written and read by description.ts.
-- (Applied to production 2026-09-20 via MCP.)
CREATE TABLE IF NOT EXISTS fp_description_rewrites (
  key TEXT PRIMARY KEY,            -- sha256 of builder + original text
  builder TEXT NOT NULL,
  original TEXT NOT NULL,
  rewritten TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fp_description_rewrites ENABLE ROW LEVEL SECURITY;
