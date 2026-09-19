-- Cached Wix collection schemas per site (FloorPlansV2, the legacy
-- FloorPlans, Builders, the villages collection), captured by
-- scripts/floorplan-wix-schema-snapshot.mjs from a Vercel build, so the
-- three sites' Floor Plans V2 schemas can be compared and standardized
-- without Wix credentials at hand. One row per site and collection; the
-- schema is the collection object as the Data Collections API returns it
-- (fields with types, revision, plugins, permissions).
-- (Applied to production 2026-09-19 via MCP.)
CREATE TABLE IF NOT EXISTS fp_collection_schemas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  collection_id TEXT NOT NULL,
  schema JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_collection_schemas_key ON fp_collection_schemas (site_id, collection_id);
ALTER TABLE fp_collection_schemas ENABLE ROW LEVEL SECURITY;
