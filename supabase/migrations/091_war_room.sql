-- 091: War Room (Jeff, 2026-11-07). A page to set and track the year's big
-- goals, keep a short to-do list, and watch contracts, revenue and ad spend.
--
-- Goals are set by hand from the page. The numbers they are measured
-- against (closings, pre-split and post-split revenue, profit, contracts,
-- ad spend) will arrive from Salesforce and ad reports through Zaps; until
-- those exist the page shows sample numbers from code
-- (src/lib/war-room/sample-metrics.ts), and nothing here stores them.
--
-- Tasks are Jeff's own: no owner, no assignment.

-- ============================================================
-- GOALS: one target per metric per year
-- ============================================================
CREATE TABLE IF NOT EXISTS wr_goals (
  year INTEGER NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('transactions', 'pre_split', 'post_split', 'profit')),
  target NUMERIC NOT NULL CHECK (target > 0),
  stretch_target NUMERIC CHECK (stretch_target IS NULL OR stretch_target > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (year, metric)
);

INSERT INTO wr_goals (year, metric, target, stretch_target) VALUES
  (2026, 'transactions', 175, NULL),
  (2026, 'pre_split', 2800000, NULL),
  (2026, 'post_split', 1400000, NULL),
  (2026, 'profit', 750000, 1000000)
ON CONFLICT (year, metric) DO NOTHING;

-- ============================================================
-- TASKS: a plain to-do list. done_at set = done.
-- ============================================================
CREATE TABLE IF NOT EXISTS wr_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wr_tasks_open ON wr_tasks (due_date) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wr_tasks_done ON wr_tasks (done_at DESC) WHERE done_at IS NOT NULL;

ALTER TABLE wr_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE wr_tasks ENABLE ROW LEVEL SECURITY;
