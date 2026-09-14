-- Listings engine: schema foundation (phase 1 draft).
-- See docs/LISTINGS_ENGINE_PLAN.md. The plan numbered this 040; 040-042
-- landed for lead routing in the meantime, so it is 043.
--
-- Postgres is the system of record. Each site keeps rendering from its own
-- Wix collections (HousesforSale, the village pages, the dynamic pages); the
-- engine decides what a listing is, whether a site shows it, and what
-- changed, and writes the result to the site's target collection. Until a
-- site is cut over that target is a shadow collection with the live
-- collection's fields (HousesforSale2 on Longboat Key, created 2026-09-14).
-- Nothing reads these tables yet; the engine core (phase 2) does.

-- Shared updated_at trigger from 001, redeclared so this file stands alone.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SITES
-- One row per Wix site. The account-level WIX_API_KEY covers every site;
-- wix_site_id selects one. write_mode + target_collection_id are the
-- cutover switch (plan decision 2): shadow writes to the shadow collection,
-- live writes to the collection the site renders, paused writes nothing.
-- Rollback is the same edit the other way.
-- ============================================================
CREATE TABLE ls_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  wix_site_id TEXT,                              -- meta site id (the UUID in the dashboard URL); must be in the account the API key belongs to
  target_collection_id TEXT NOT NULL DEFAULT 'HousesforSale2',              -- where the engine writes listings
  live_collection_id TEXT NOT NULL DEFAULT 'HousesforSale',                 -- what the site renders today; read-only until cutover
  villages_collection_id TEXT NOT NULL DEFAULT 'HousesforSale-DynamicPages', -- village pages; receives active counts
  write_mode TEXT NOT NULL DEFAULT 'shadow'
    CHECK (write_mode IN ('shadow', 'live', 'paused')),
  market_cities TEXT[] NOT NULL DEFAULT '{}',    -- MLS City / PostalCity values that are this site's market (classify: city_change)
  active BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Shadow mode can never point at the live collection, and live mode can
  -- only point at it, so cutover is one row edit that cannot half-apply.
  CONSTRAINT ls_sites_target_matches_mode CHECK (
    write_mode = 'paused'
    OR ((write_mode = 'live') = (target_collection_id = live_collection_id))
  )
);

CREATE UNIQUE INDEX idx_ls_sites_domain ON ls_sites (domain);
CREATE UNIQUE INDEX idx_ls_sites_wix_site_id ON ls_sites (wix_site_id) WHERE wix_site_id IS NOT NULL;

CREATE TRIGGER ls_sites_updated_at
  BEFORE UPDATE ON ls_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VILLAGES
-- One row per village per site. Page content stays in Wix; the engine
-- holds the identity (name, slug, the Wix item id that today's listings
-- carry as village1) and writes the active-listing count back to the
-- site's villages collection after each run.
-- ============================================================
CREATE TABLE ls_villages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES ls_sites(id),
  name TEXT NOT NULL,                            -- display name, written to HousesforSale.village
  wix_slug TEXT,                                 -- village page slug on the site
  wix_item_id TEXT,                              -- _id of the village row in villages_collection_id (today's village1)
  page_url TEXT,                                 -- full village page URL, written to villageLink
  display JSONB NOT NULL DEFAULT '{}'::jsonb,    -- site-specific extras copied onto each listing (Longboat Key: tag icon URLs)
  active BOOLEAN NOT NULL DEFAULT true,
  active_listing_count INTEGER NOT NULL DEFAULT 0,
  zero_since TIMESTAMPTZ,                        -- stamped when the count hits 0, cleared on recovery
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)                           -- lets ls_village_terms pin a term to its village's site
);

CREATE UNIQUE INDEX idx_ls_villages_site_name ON ls_villages (site_id, name);
CREATE UNIQUE INDEX idx_ls_villages_site_item ON ls_villages (site_id, wix_item_id) WHERE wix_item_id IS NOT NULL;

CREATE TRIGGER ls_villages_updated_at
  BEFORE UPDATE ON ls_villages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VILLAGE TERMS
-- Subdivision terms edited in the Hub. A listing belongs to a village when
-- lower(SubdivisionName) contains the term; the longer term wins when two
-- villages' terms both match (plan decision 5). street_term is the optional
-- street qualifier Longboat Key already needs (subdivision "BAY ISLES" on
-- Bayou Road is The Bayou, not the Harbor Section). Terms are stored
-- lowercased and trimmed so matching is a plain contains.
-- ============================================================
CREATE TABLE ls_village_terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES ls_sites(id),
  village_id UUID NOT NULL,
  term TEXT NOT NULL CHECK (term = lower(btrim(term)) AND length(term) > 0),
  street_term TEXT CHECK (street_term IS NULL OR (street_term = lower(btrim(street_term)) AND length(street_term) > 0)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (village_id, site_id) REFERENCES ls_villages (id, site_id) ON DELETE CASCADE
);

-- One term means one village per site.
CREATE UNIQUE INDEX idx_ls_village_terms_site_term
  ON ls_village_terms (site_id, term, COALESCE(street_term, ''));
CREATE INDEX idx_ls_village_terms_village ON ls_village_terms (village_id);

-- ============================================================
-- LISTINGS
-- One row per MLS listing, shared by every site: the normalised MLSGrid
-- record plus the raw one. Keyed by the MLS ListingId, which is also the
-- Wix _id on every site (plan decision 6).
-- ============================================================
CREATE TABLE ls_listings (
  listing_id TEXT PRIMARY KEY,                   -- MLS ListingId, e.g. MFRA4670555
  listing_key TEXT,                              -- MLSGrid ListingKey
  originating_system TEXT NOT NULL DEFAULT 'mfrmls',
  standard_status TEXT,
  property_type TEXT,
  property_sub_type TEXT,
  city TEXT,
  postal_city TEXT,
  postal_code TEXT,
  subdivision TEXT,
  street_text TEXT,                              -- "<number> <name> <suffix>", lowercased, for street-qualified terms
  list_price NUMERIC,
  bedrooms NUMERIC,
  bathrooms NUMERIC,
  living_area NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC,
  photo_count INTEGER NOT NULL DEFAULT 0,
  mlg_can_view BOOLEAN,                          -- false = MLSGrid revoked display rights (classify: mls_revoked)
  modification_timestamp TIMESTAMPTZ,            -- MLSGrid ModificationTimestamp (Grid conversion time, UTC); the incremental watermark
  originating_system_modification_timestamp TIMESTAMPTZ, -- the MLS's own modification time, for display
  raw JSONB NOT NULL,                            -- the MLSGrid record as received, Media included
  in_feed BOOLEAN NOT NULL DEFAULT true,         -- false once a full run finds MLSGrid no longer returns it (classify: not_in_feed)
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- written to Wix as dateOfMlsPull (MLSGrid compliance)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ls_listings_status ON ls_listings (standard_status);
CREATE INDEX idx_ls_listings_modified ON ls_listings (modification_timestamp DESC);
CREATE INDEX idx_ls_listings_subdivision ON ls_listings (lower(subdivision));

CREATE TRIGGER ls_listings_updated_at
  BEFORE UPDATE ON ls_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- LISTING MEDIA
-- One row per MLS photo. Downloaded from MLSGrid once, stored once in
-- Supabase Storage, imported per site (plan decision 4). Since 2026-09-08
-- an MLSGrid MediaURL is signed, expires an hour after the record was
-- retrieved, and allows one download (a repeat inside the hour answers
-- 429); consumers must keep their own copy and never store or serve the
-- URL. So path_key, the stable tail images/<ListingId>/<uuid>.<ext>, is the
-- photo's identity, and source_url is held only until the download
-- succeeds.
-- ============================================================
CREATE TABLE ls_listing_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id TEXT NOT NULL REFERENCES ls_listings(listing_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                     -- MLSGrid Media.Order
  media_key TEXT,                                -- MLSGrid MediaKey when present
  path_key TEXT NOT NULL,                        -- images/<ListingId>/<uuid>.<ext>, the part of MediaURL after the signature
  source_url TEXT,                               -- signed MediaURL as last received; cleared once downloaded, useless after an hour
  source_url_received_at TIMESTAMPTZ,            -- when that URL was retrieved; the download must happen within the hour
  title TEXT,
  media_modification_timestamp TIMESTAMPTZ,      -- a new stamp on the same path_key means the photo was retouched
  content_hash TEXT,                             -- sha256 of the bytes, set when downloaded
  byte_size INTEGER,
  storage_path TEXT,                             -- Supabase Storage object path once stored; NULL = not yet downloaded
  download_attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  retry_after TIMESTAMPTZ,                       -- MLSGrid allows one download per media per hour; no attempt before this
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ls_listing_media_key ON ls_listing_media (listing_id, path_key);
CREATE INDEX idx_ls_listing_media_pending ON ls_listing_media (COALESCE(retry_after, 'epoch'::timestamptz)) WHERE storage_path IS NULL;
CREATE INDEX idx_ls_listing_media_hash ON ls_listing_media (content_hash) WHERE content_hash IS NOT NULL;

CREATE TRIGGER ls_listing_media_updated_at
  BEFORE UPDATE ON ls_listing_media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SITE x LISTING
-- What each site does with each listing. Staged state lives here, not in a
-- Wix Stagging collection (plan decision 3): a record is written to the
-- site's target collection only once gallery_ready is true.
--   staged  - classified for this site, not yet written (photos pending)
--   live    - written to the site's target collection
--   removed - was live, taken down; reason_code says why
-- ============================================================
CREATE TABLE ls_site_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES ls_sites(id),
  listing_id TEXT NOT NULL REFERENCES ls_listings(listing_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'live', 'removed')),
  village_id UUID REFERENCES ls_villages(id) ON DELETE SET NULL,
  wix_item_id TEXT,                              -- _id in the site's target collection once written (= listing_id by design)
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN (
    'status_change', 'property_type', 'no_village', 'city_change',
    'mls_revoked', 'not_in_feed', 'manual_refresh'
  )),
  reason_detail TEXT,
  gallery_ready BOOLEAN NOT NULL DEFAULT false,  -- every photo imported into this site's Media Manager
  needs_write BOOLEAN NOT NULL DEFAULT true,     -- classification or content changed since the last write
  written_at TIMESTAMPTZ,
  written_fingerprint TEXT,                      -- hash of the record last written, so unchanged rows are skipped
  staged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  live_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ls_site_listings_pair ON ls_site_listings (site_id, listing_id);
CREATE INDEX idx_ls_site_listings_state ON ls_site_listings (site_id, state);
CREATE INDEX idx_ls_site_listings_needs_write ON ls_site_listings (site_id) WHERE needs_write;
CREATE INDEX idx_ls_site_listings_village ON ls_site_listings (village_id) WHERE village_id IS NOT NULL;

CREATE TRIGGER ls_site_listings_updated_at
  BEFORE UPDATE ON ls_site_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SITE x MEDIA
-- A photo imported into one site's Media Manager. Seeded from the live
-- galleries first (each gallery item carries mlsSourceUrl) so cutover
-- moves no media; the engine imports only what is missing.
-- ============================================================
CREATE TABLE ls_site_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES ls_sites(id),
  media_id UUID NOT NULL REFERENCES ls_listing_media(id) ON DELETE CASCADE,
  wix_file_id TEXT,                              -- Media Manager file id (d0be81_...~mv2.jpg)
  wix_image_uri TEXT NOT NULL,                   -- wix:image://v1/<fileId>/<name>, what gallery items carry as src
  origin TEXT NOT NULL DEFAULT 'imported' CHECK (origin IN ('seeded', 'imported')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ls_site_media_pair ON ls_site_media (site_id, media_id);

-- ============================================================
-- SYNC RUNS
-- One row per run: today's SyncRuns columns plus site scope. site_id is
-- NULL for the shared MLSGrid pull; per-site work gets its own row. A row
-- is inserted at run start (status running) and finalised at the end, so a
-- tick killed by the function limit still leaves its stage and partial
-- counts. Retention (90 days, never below the newest 50 rows) is the
-- engine's job.
-- ============================================================
CREATE TABLE ls_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES ls_sites(id),
  run_key TEXT NOT NULL,                         -- '<mode>:<startedAt ISO>[:<domain>]'; joins to ls_sync_events.run_key
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full', 'photos', 'manual')),
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'hub', 'http', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  stage TEXT,                                    -- last persisted phase: fetch, classify, plan, photos, write, stats, done
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  unstaged INTEGER NOT NULL DEFAULT 0,           -- staged, never live, dropped because the listing left the market
  restaged INTEGER NOT NULL DEFAULT 0,           -- staged rows refreshed from MLSGrid (not counted as inserts)
  promoted INTEGER NOT NULL DEFAULT 0,           -- staged -> live
  deletes_skipped INTEGER NOT NULL DEFAULT 0,    -- deletes the mass-delete guard refused to apply
  images_downloaded INTEGER NOT NULL DEFAULT 0,
  images_imported INTEGER NOT NULL DEFAULT 0,
  images_failed INTEGER NOT NULL DEFAULT 0,
  mlsgrid_request_count INTEGER NOT NULL DEFAULT 0,
  mlsgrid_listing_count INTEGER NOT NULL DEFAULT 0,  -- records MLSGrid said it had (MLS-wide for incremental runs)
  mlsgrid_items_fetched INTEGER NOT NULL DEFAULT 0,  -- records actually received
  mlsgrid_bytes BIGINT NOT NULL DEFAULT 0,           -- response bytes, to set against MLSGrid's usage dashboard
  fetch_window_minutes INTEGER,
  wix_requests INTEGER NOT NULL DEFAULT 0,
  wix_rate_limited INTEGER NOT NULL DEFAULT 0,   -- 429 responses seen
  gap_minutes INTEGER,                           -- minutes since the previous recorded run of any kind
  warnings INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  writes_failed INTEGER NOT NULL DEFAULT 0,
  stats_refreshed BOOLEAN NOT NULL DEFAULT false,
  error_stage TEXT,
  error_message TEXT,
  error_stack TEXT
);

CREATE UNIQUE INDEX idx_ls_sync_runs_key ON ls_sync_runs (run_key);
CREATE INDEX idx_ls_sync_runs_site_started ON ls_sync_runs (site_id, started_at DESC);
CREATE INDEX idx_ls_sync_runs_started ON ls_sync_runs (started_at DESC);
CREATE INDEX idx_ls_sync_runs_running ON ls_sync_runs (started_at) WHERE status = 'running';

-- ============================================================
-- SYNC EVENTS
-- One row per notable listing-level thing: the detail behind the run
-- counts. listing_id is not a foreign key so a listing's history outlives
-- its row. Retention (30 days) is the engine's job.
-- ============================================================
CREATE TABLE ls_sync_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES ls_sync_runs(id) ON DELETE SET NULL,
  run_key TEXT,
  site_id UUID REFERENCES ls_sites(id),
  listing_id TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  address TEXT,
  village TEXT,
  details JSONB
);

COMMENT ON COLUMN ls_sync_events.kind IS
  'insert, update, delete, unstage, restage, promote, photos_failed, photos_recovered, rehydrate, promote_failed, write_failed, mass_delete_guard, stats_failed, sweep_failed, budget, gap, run_error, events_dropped, purge (docs/LISTINGS_ENGINE_PLAN.md). Unconstrained so a new kind is a code change, not a migration.';

CREATE INDEX idx_ls_sync_events_site_at ON ls_sync_events (site_id, at DESC);
CREATE INDEX idx_ls_sync_events_listing ON ls_sync_events (listing_id, at DESC) WHERE listing_id IS NOT NULL;
CREATE INDEX idx_ls_sync_events_run ON ls_sync_events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX idx_ls_sync_events_level_at ON ls_sync_events (level, at DESC) WHERE level <> 'info';

-- ============================================================
-- SETTINGS
-- Same shape as the floor plan nightly (038): a master switch and the
-- cycle state the cron tick resumes from across invocations.
-- ============================================================
ALTER TABLE system_settings ADD COLUMN ls_engine_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE system_settings ADD COLUMN ls_engine_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- RLS: the engine and the Hub use the service-role key (matching the fp_
-- tables); lock the tables down for anon/authenticated direct access.
-- ============================================================
ALTER TABLE ls_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_villages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_village_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_site_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_site_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_sync_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SEED: Longboat Key, in shadow mode. The site id is the UUID in the site's
-- manage.wix.com dashboard URL (2026-09-14); scripts/listings-wix-phase1.mjs
-- verifies the account key reaches it.
-- ============================================================
INSERT INTO ls_sites (name, domain, wix_site_id, market_cities, write_mode)
VALUES ('Life in Longboat Key', 'lifeinlongboatkey.com', '8b20e921-5b70-4428-8fcd-8c8ef3bad3ab', ARRAY['Longboat Key'], 'shadow');
