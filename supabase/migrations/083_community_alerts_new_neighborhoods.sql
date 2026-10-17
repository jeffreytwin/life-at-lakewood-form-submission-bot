-- 083: Community Alerts for new neighborhoods (Jeff, 2026-10-17). A
-- neighborhood with homes for sale in a place we cover, that is in neither
-- the new-build engine nor the listings engine, raises an alert whose
-- to-do list is the work of adding it: the pages, the listings engine, the
-- new-build engine (with Claude), the advertising.
--
-- Such an alert is about a name, not a community row, so it carries the
-- name's key (subject_key) and one open alert per site and key is allowed.
-- A name a person never wants to hear about again is ignored: it is kept
-- here, per site, and the scan passes over it.
-- (Applied to production 2026-10-17 via MCP.)

ALTER TABLE ca_alerts DROP CONSTRAINT IF EXISTS ca_alerts_kind_check;
ALTER TABLE ca_alerts ADD CONSTRAINT ca_alerts_kind_check CHECK (kind IN ('sold_out', 'new_neighborhood'));
ALTER TABLE ca_alerts ADD COLUMN IF NOT EXISTS subject_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_alerts_open_subject
  ON ca_alerts (kind, site_id, subject_key) WHERE status = 'open' AND subject_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_alerts_subject ON ca_alerts (kind, site_id, subject_key);

-- ============================================================
-- IGNORED NEIGHBORHOODS
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_ignored_neighborhoods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,                     -- as the source spelled it
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name_key)
);

ALTER TABLE ca_ignored_neighborhoods ENABLE ROW LEVEL SECURITY;
