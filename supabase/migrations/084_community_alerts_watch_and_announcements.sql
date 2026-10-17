-- 084: Community Alerts' watch list and announcements (Jeff, 2026-10-17).
--
-- An announcement is a new neighborhood in a place we cover that has been
-- announced but has no homes for sale yet, found once a week by Claude
-- searching the web. The person watches it, ignores it, or dismisses it.
--
-- The watch list holds the "coming soon" neighborhoods a person is waiting
-- on, from an announcement or added by hand. The daily scan looks for
-- homes in each; when it finds any, it raises a new-neighborhood alert
-- (whatever the count: a name being watched needs no more than one home)
-- and the entry is marked found.
-- (Applied to production 2026-10-17 via MCP.)

ALTER TABLE ca_alerts DROP CONSTRAINT IF EXISTS ca_alerts_kind_check;
ALTER TABLE ca_alerts ADD CONSTRAINT ca_alerts_kind_check
  CHECK (kind IN ('sold_out', 'new_neighborhood', 'announcement'));

CREATE TABLE IF NOT EXISTS ca_watch_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  note TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'found', 'stopped')),
  alert_id UUID REFERENCES ca_alerts(id) ON DELETE SET NULL, -- the alert raised when homes were found
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  found_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ
);

-- A name is watched once per site at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_watch_list_watching
  ON ca_watch_list (site_id, name_key) WHERE status = 'watching';

ALTER TABLE ca_watch_list ENABLE ROW LEVEL SECURITY;
