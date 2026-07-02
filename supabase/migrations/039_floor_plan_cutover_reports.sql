-- Cutover reports: point-in-time comparison of pipeline data vs the legacy
-- freelancer-maintained FloorPlans collection, per site. The go/no-go signal
-- for re-binding each site's repeater to Floor Plans V2.
-- (Applied to production 2026-07-02 via MCP.)
CREATE TABLE fp_cutover_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fp_cutover_reports_site ON fp_cutover_reports (site_id, created_at DESC);
ALTER TABLE fp_cutover_reports ENABLE ROW LEVEL SECURITY;
