-- 089: HOA/CDD Info (Jeff, 2026-11-02). The pages on each site that state
-- HOA dues or CDD fees (Life At Lakewood's blog articles and village
-- pages, Wellen Park's master blog article), and a to-do twice a year to
-- check them: CDD fees in mid-October, once the districts' new fiscal year
-- (October 1) has set the year's assessments, and HOA dues in mid-January,
-- once the associations' new budgets have taken effect. One hoa_cdd alert
-- per site, one item per page and fee; the frontlines person asks Claude
-- for the current figures by hand (src/lib/community-alerts/hoa-cdd.ts).

ALTER TABLE ca_alerts DROP CONSTRAINT IF EXISTS ca_alerts_kind_check;
ALTER TABLE ca_alerts ADD CONSTRAINT ca_alerts_kind_check
  CHECK (kind IN ('sold_out', 'new_neighborhood', 'announcement', 'school_zones', 'hoa_cdd'));

-- ============================================================
-- PAGES TO CHECK
-- Each page once per site, and about HOA dues, CDD fees or both. An
-- alert copies the pages it was raised with into its detail, so a page
-- added or removed later leaves an open alert's list as it was.
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_fee_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  hoa BOOLEAN NOT NULL DEFAULT true,
  cdd BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, url),
  CHECK (hoa OR cdd)
);

ALTER TABLE ca_fee_pages ENABLE ROW LEVEL SECURITY;
