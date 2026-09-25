-- 076: what the quick move-in flag check did (Jeff, 2026-09-25).
--
-- A floor plan's "quick move-ins available" flag (with its banner, badge and
-- status dot) is kept true to the published quick move-ins filed under it in
-- Wix, without a review (qmi-flags.ts): right after every write-back, and on
-- a schedule over every row of every site. Each flag it set or cleared is a
-- row here, and so is each quick move-in it could not place ("no-plan": no
-- floor plan by the name it is filed under; "same-name": two floor plans of
-- that builder and community share it), which it reports rather than fixes.
-- "checked" rows record each full check. The Builder Connections page reads
-- this table.
CREATE TABLE IF NOT EXISTS fp_qmi_flag_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES fp_sites(id) ON DELETE CASCADE,
  wix_item_id text,
  plan_name text,
  village text,
  builder text,
  action text NOT NULL CHECK (action IN ('set', 'cleared', 'no-plan', 'same-name', 'checked')),
  detail text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fp_qmi_flag_log_recent ON fp_qmi_flag_log (action, created_at DESC);

ALTER TABLE fp_qmi_flag_log ENABLE ROW LEVEL SECURITY;
