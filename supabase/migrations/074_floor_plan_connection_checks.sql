-- 074: what the connection check found, where it can be read.
--
-- scripts/floorplan-connection-check.ts runs every builder connection from
-- a preview build, where the builders' sites are reachable, and reports
-- what a run would bring back for review beside what a visitor to the
-- builder's site sees. Its reports were only in the build log, which is
-- thousands of lines; each one is kept here instead, one row per
-- connection per build, so one builder's can be read on its own. Also
-- page anatomies (label 'anatomy: <url>'). Diagnostics only: nothing in
-- the Hub reads this table, and it can be emptied at any time.
CREATE TABLE IF NOT EXISTS fp_connection_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build text NOT NULL,
  label text NOT NULL,
  verdict text,
  report text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fp_connection_checks_build ON fp_connection_checks (build, label);

ALTER TABLE fp_connection_checks ENABLE ROW LEVEL SECURITY;
