-- 088: School zone scan (Jeff, 2026-10-28). Every October, and on demand
-- from Community Alerts → School Zones, each village is checked against
-- the districts' zones for homes in it; a village whose page names other
-- schools raises a school_zones alert (src/lib/school-zones/scan.ts).
-- (Applied to production 2026-10-28 via MCP.)

ALTER TABLE ca_alerts DROP CONSTRAINT IF EXISTS ca_alerts_kind_check;
ALTER TABLE ca_alerts ADD CONSTRAINT ca_alerts_kind_check
  CHECK (kind IN ('sold_out', 'new_neighborhood', 'announcement', 'school_zones'));

-- ============================================================
-- SCANS
-- One row per scan: when, who started it, and what it found (the
-- School Zones tab shows the latest). A row left unfinished for long is
-- taken to have died, so a new scan may start.
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_school_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'hub')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  summary JSONB
);
CREATE INDEX IF NOT EXISTS idx_ca_school_scans_started ON ca_school_scans (started_at DESC);

-- ============================================================
-- ADDRESSES GIVEN BY HAND
-- A village no listing places (a new or small one) is placed by an
-- address a person gives on the School Zones tab, geocoded once.
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_school_places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id) ON DELETE CASCADE,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name_key)
);

ALTER TABLE ca_school_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_school_places ENABLE ROW LEVEL SECURITY;
