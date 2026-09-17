-- ============================================================
-- 055: retention for the listings no site ever showed
--
-- Jeff, 2026-09-17: "I don't want to have any data get out of hand over time
-- without us noticing." A record is kept when it is in *some* site's market
-- (isRelevant), so a market city puts every Active listing in it into
-- ls_listings whether or not any neighborhood term matches. Nothing has ever
-- deleted one: the retention purge covers ls_sync_runs and ls_sync_events
-- only, so the unshown set has been monotonic since the engine started.
--
-- WHAT IS SWEPT, AND WHY IT IS NOT SIMPLY AGE. The obvious rule -- delete an
-- unmatched listing after 60 days -- would throw away the thing the wide
-- market city list exists to hold. Measured the day this was written: of the
-- 379 listings on no site, **349 are Active**. Those are real for-sale
-- inventory in Venice, North Port, Englewood and the rest, sitting ready for
-- the day a neighborhood term matches them; they are also what the Hub's
-- unmatched view lists, which is how a missing term gets found in the first
-- place. Deleting them would empty that view and, worse, they would not come
-- back: the incremental pulls by modification window and the full run only
-- re-verifies ids the engine already holds, so nothing short of a discover
-- scan would find a quiet Active listing again.
--
-- THE INVARIANT THIS SWEEP HOLDS TO. Jeff's reason for wanting the unshown
-- set bounded is not disk: it is that he reads it. The unmatched view is how
-- he checks whether a subdivision or street should have matched a village he
-- already has, and whether a village is missing entirely. That view selects
-- `in_feed = true AND standard_status = 'Active'` (unmatched.ts), so this
-- sweep's second condition -- out of the feed, or a status that can no
-- longer reach a site -- is its exact complement on the never-shown set.
-- **Nothing this deletes has ever appeared in that view, and nothing that
-- appears in it can be deleted here.** The sweep removes the rows behind the
-- picture, never the picture. Anyone widening the predicate later should
-- re-check it against unmatched.ts's filter and keep that true.
--
-- So the rule is status first, age only as a margin. A listing is swept when
-- all three hold:
--
--   1. no ls_site_listings row at all -- never staged, live or removed on
--      any site. A listing that was on a site keeps its rows: those are the
--      record of what the engine put up and took down, and the FK cascades,
--      so deleting the listing would delete that history too.
--   2. it can no longer become a live listing: out of the feed, or a status
--      outside the set that could still reach a site. classify shows only
--      'Active', but 'Coming Soon' becomes Active, and 'Pending' and 'Active
--      Under Contract' fall back to it, so those are kept. Closed, Expired,
--      Withdrawn, Canceled and an unknown status are terminal.
--   3. nothing has happened to it in older_than_days.
--
-- THE CLOCK IS modification_timestamp, NOT last_seen_at. last_seen_at is
-- when the engine last checked, and the nightly full re-verifies every id it
-- holds -- so it reads as today for a listing that closed weeks ago (all
-- eight status cohorts showed last_seen_at = the current date on the day
-- this was written). An age test against it would never fire even once, and
-- a retention sweep that silently never runs is the failure this is meant to
-- prevent. modification_timestamp is the MLS's own stamp and does age;
-- first_seen_at covers the rows that somehow lack one.
--
-- The cascade does the real work: ls_listing_media and ls_site_listings both
-- reference ls_listings ON DELETE CASCADE, so one delete takes the metadata
-- with it. That metadata is the bulk of it -- about 31 rows per unshown
-- listing -- and none of it has bytes behind it, because a listing on no
-- site never reaches ls_photo_backlog and so is never downloaded.
--
-- max_rows bounds one sweep, so a predicate that is wrong cannot empty the
-- table in one night. Hitting the cap is itself worth seeing, which is why
-- the caller reports it.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_unmatched_listing_retention. Inert for about two months: the
-- oldest listing the engine holds was first seen 2026-09-14.
-- ============================================================

-- Statuses a listing can hold and still reach a site later. Everything else,
-- NULL included, is terminal for sweeping purposes.
CREATE OR REPLACE FUNCTION ls_listing_status_is_terminal(status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(status, '')) NOT IN ('active', 'active under contract', 'pending', 'coming soon');
$$;

COMMENT ON FUNCTION ls_listing_status_is_terminal(TEXT) IS
  'True when a listing can no longer become live on a site. classify shows only Active; Coming Soon becomes Active and Pending / Active Under Contract fall back to it, so those are not terminal. An unknown status is.';

DROP FUNCTION IF EXISTS ls_purge_unmatched_listings(integer, integer);

CREATE OR REPLACE FUNCTION ls_purge_unmatched_listings(older_than_days integer DEFAULT 60, max_rows integer DEFAULT 500)
RETURNS TABLE (
  listing_id TEXT,
  standard_status TEXT,
  city TEXT,
  in_feed BOOLEAN,
  last_change TIMESTAMPTZ,
  media_rows BIGINT
)
LANGUAGE sql
AS $$
  WITH doomed AS (
    SELECT l.listing_id,
           l.standard_status,
           l.city,
           l.in_feed,
           COALESCE(l.modification_timestamp, l.first_seen_at) AS last_change,
           (SELECT count(*) FROM ls_listing_media m WHERE m.listing_id = l.listing_id) AS media_rows
    FROM ls_listings l
    WHERE NOT EXISTS (SELECT 1 FROM ls_site_listings sl WHERE sl.listing_id = l.listing_id)
      AND (l.in_feed = false OR ls_listing_status_is_terminal(l.standard_status))
      AND COALESCE(l.modification_timestamp, l.first_seen_at) < now() - make_interval(days => GREATEST(older_than_days, 0))
    ORDER BY COALESCE(l.modification_timestamp, l.first_seen_at)
    LIMIT GREATEST(max_rows, 0)
  ),
  gone AS (
    DELETE FROM ls_listings l USING doomed d WHERE l.listing_id = d.listing_id
    RETURNING l.listing_id
  )
  SELECT d.listing_id, d.standard_status, d.city, d.in_feed, d.last_change, d.media_rows
  FROM doomed d JOIN gone g ON g.listing_id = d.listing_id
  ORDER BY d.last_change;
$$;

COMMENT ON FUNCTION ls_purge_unmatched_listings(integer, integer) IS
  'Deletes listings no site has ever shown, that can no longer become live, and that nothing has changed in older_than_days -- oldest first, at most max_rows. Returns what it deleted so the caller can report it. ls_listing_media and ls_site_listings cascade.';

-- The sweep''s own predicate: never-shown listings by when they last changed.
CREATE INDEX IF NOT EXISTS idx_ls_listings_retention
  ON ls_listings (COALESCE(modification_timestamp, first_seen_at))
  WHERE in_feed = false OR lower(coalesce(standard_status, '')) NOT IN ('active', 'active under contract', 'pending', 'coming soon');
