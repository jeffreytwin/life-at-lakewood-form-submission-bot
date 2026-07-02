-- Floor Plan Sync Pipeline: schema foundation
-- See docs/FLOOR_PLAN_SYNC_PLAN.md for the full design.
-- Builders build in communities; communities belong to sites. The nightly
-- pipeline scrapes builder sites, diffs against our canonical floor plans,
-- and queues changes for human approval before anything is written to Wix.

-- ============================================================
-- SITES
-- One row per community website (lifeatlakewood.com, etc.)
-- ============================================================
CREATE TABLE fp_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  wix_site_id TEXT,
  wix_collection_id TEXT,          -- the NEW pipeline-operated collection
  legacy_collection_id TEXT,       -- read-only; used by the cutover report
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_sites_domain ON fp_sites (domain);

-- ============================================================
-- COMMUNITIES
-- Villages/communities within a site (e.g. Star Farms, Wild Blue)
-- ============================================================
CREATE TABLE fp_communities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  name TEXT NOT NULL,
  wix_village_slug TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_communities_site_name ON fp_communities (site_id, name);

-- ============================================================
-- BUILDERS
-- One row per builder; the extraction engine + config live here.
-- Pausing a builder (active=false) skips it entirely on nightly runs:
-- no scrape, no diff, no removals.
-- ============================================================
CREATE TABLE fp_builders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  base_url TEXT,
  extraction_method TEXT CHECK (extraction_method IN ('json_api', 'fetch_claude', 'render_claude')),
  engine_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_builders_name ON fp_builders (name);

-- ============================================================
-- BUILDER x COMMUNITY (the nightly work list)
-- Each active row = run this builder's engine with these params and
-- diff against this community's canonical plans.
-- ============================================================
CREATE TABLE fp_builder_communities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  builder_id UUID NOT NULL REFERENCES fp_builders(id),
  community_id UUID NOT NULL REFERENCES fp_communities(id),
  extractor_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_plan_count INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_builder_communities_pair ON fp_builder_communities (builder_id, community_id);
CREATE INDEX idx_fp_builder_communities_active ON fp_builder_communities (active) WHERE active;

-- ============================================================
-- FLOOR PLANS (canonical record, Parrish-standard shape)
-- Supabase is the system of record; Wix collections are render targets.
-- Canonical display fields live in `record` (finalized from the Parrish
-- schema in Phase 0); hot fields used for diffing/filtering are columns.
-- ============================================================
CREATE TABLE fp_floor_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  community_id UUID NOT NULL REFERENCES fp_communities(id),
  builder_id UUID NOT NULL REFERENCES fp_builders(id),
  plan_key TEXT NOT NULL,          -- builder + community + normalized plan name
  wix_record_id TEXT,              -- null until first synced to Wix
  name TEXT NOT NULL,
  price NUMERIC,
  beds NUMERIC,
  baths NUMERIC,
  sqft INTEGER,
  quick_move_in BOOLEAN NOT NULL DEFAULT false,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full canonical record
  starred BOOLEAN NOT NULL DEFAULT false,     -- used in brand emails
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_floor_plans_key ON fp_floor_plans (site_id, plan_key);
CREATE INDEX idx_fp_floor_plans_starred ON fp_floor_plans (starred) WHERE starred;

-- ============================================================
-- PLAN LINKS
-- Maps a builder-site identity (their id/slug/name-as-scraped) to our
-- canonical plan. Fuzzy-match once at first sight, then always resolve
-- through this table — never re-fuzzy-match a linked plan.
-- ============================================================
CREATE TABLE fp_plan_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_plan_id UUID NOT NULL REFERENCES fp_floor_plans(id),
  scraped_identity TEXT NOT NULL,
  matched_by TEXT NOT NULL CHECK (matched_by IN ('exact', 'fuzzy', 'manual')),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_plan_links_identity ON fp_plan_links (floor_plan_id, scraped_identity);

-- ============================================================
-- MEDIA MAP (image dedupe)
-- source_url + content hash -> Wix media ID, per site. An image is only
-- uploaded to the Wix Media Manager when genuinely new or changed.
-- ============================================================
CREATE TABLE fp_media_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  source_url TEXT NOT NULL,
  content_hash TEXT,
  wix_media_id TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_media_map_source ON fp_media_map (site_id, source_url);

-- ============================================================
-- PENDING CHANGES (the review queue)
-- status machine: pending -> approved/rejected;
-- approved -> synced_draft (inserts landing as Wix drafts) or synced;
-- synced_draft -> synced once the item is published in Wix;
-- any write failure -> failed (+error_detail).
-- ============================================================
CREATE TABLE fp_pending_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  community_id UUID NOT NULL REFERENCES fp_communities(id),
  builder_id UUID NOT NULL REFERENCES fp_builders(id),
  floor_plan_id UUID REFERENCES fp_floor_plans(id),
  plan_key TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'update', 'remove')),
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  proposed_record JSONB,
  wix_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'synced_draft', 'synced', 'failed')),
  error_detail TEXT,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nightly re-runs must update the existing pending row, never duplicate it.
CREATE UNIQUE INDEX idx_fp_pending_changes_dedupe
  ON fp_pending_changes (site_id, community_id, builder_id, plan_key, COALESCE(field_changed, ''))
  WHERE status = 'pending';
CREATE INDEX idx_fp_pending_changes_status ON fp_pending_changes (status, created_at DESC);

-- ============================================================
-- FOLLOW-UP TASKS (starred-plan queue)
-- Created when a synced change touches a starred plan; the brand email
-- lives outside Wix, so these persist until a human marks them done.
-- ============================================================
CREATE TABLE fp_follow_up_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_plan_id UUID NOT NULL REFERENCES fp_floor_plans(id),
  pending_change_id UUID REFERENCES fp_pending_changes(id),
  task_type TEXT NOT NULL CHECK (task_type IN ('price_changed', 'plan_removed', 'other_change')),
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_fp_follow_up_tasks_open ON fp_follow_up_tasks (status) WHERE status = 'open';

-- ============================================================
-- FIELD MAPS (per-site legacy -> standard schema mapping)
-- Powers the cutover report and the one-time editorial port.
-- ============================================================
CREATE TABLE fp_field_maps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES fp_sites(id),
  legacy_field_key TEXT NOT NULL,
  standard_field_key TEXT NOT NULL,
  transform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fp_field_maps_key ON fp_field_maps (site_id, legacy_field_key);

-- ============================================================
-- SETTINGS
-- insert_publish_mode: 'draft' (approved adds land in Wix as drafts,
-- requiring manual publish) | 'published' (adds go live on sync).
-- Stored per site so sites can graduate independently.
-- ============================================================
ALTER TABLE fp_sites ADD COLUMN insert_publish_mode TEXT NOT NULL DEFAULT 'draft'
  CHECK (insert_publish_mode IN ('draft', 'published'));

-- ============================================================
-- RLS: service-role key (GitHub Action inserts, write-back status
-- updates) bypasses RLS; the Hub UI reads via its authenticated server
-- routes using the service key, matching the existing Hub pattern.
-- Lock the tables down for anon/authenticated direct access.
-- ============================================================
ALTER TABLE fp_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_builders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_builder_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_plan_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_media_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_follow_up_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_field_maps ENABLE ROW LEVEL SECURITY;
