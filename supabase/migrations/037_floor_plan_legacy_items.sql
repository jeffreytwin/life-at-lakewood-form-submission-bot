-- Staging table holding raw legacy Wix collection items (FloorPlans and
-- Builders per site), imported by scripts/floorplan-legacy-import.mjs.
-- Source data for roster derivation and the cutover report baseline.
-- (Applied to production 2026-07-02 via MCP.)
CREATE TABLE fp_legacy_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  collection_id TEXT NOT NULL,
  wix_record_id TEXT NOT NULL,
  data JSONB NOT NULL,
  publish_status TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_legacy_items_record ON fp_legacy_items (site_id, collection_id, wix_record_id);
ALTER TABLE fp_legacy_items ENABLE ROW LEVEL SECURITY;
