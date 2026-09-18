-- ============================================================
-- 059: the photo backlog stops re-scanning itself once per photo
--
-- The fourth bound the growing media tables have found, and the second one
-- to reach Jeff as "an update stopped early while saving to Wix". Two
-- separate failures inside twenty minutes on 2026-09-18:
--
--   01:36:51  Run failed at write:  load galleries: canceling statement
--             due to statement timeout (57014)
--   01:45:23  Run failed at photos: load photo backlog: canceling statement
--             due to statement timeout (57014)
--
-- The first is fixed in db.ts (an ORDER BY that did not match the index, the
-- same mistake as PR #327 and in the same file). This migration is the
-- second.
--
-- WHAT WAS SLOW. `lacking` is a CTE listing every (site, photo) pair some
-- site still needs. Because it is referenced twice, Postgres materialises it
-- rather than inlining it, and the final SELECT built each row's site_ids
-- with a correlated subquery over that materialised copy:
--
--     ARRAY(SELECT l.site_id FROM lacking l WHERE l.media_id = m.id ...)
--
-- A materialised CTE carries no index, so every output row scanned the whole
-- thing. Measured on production at 01:50, with Wellen Park mid-backfill:
--
--     SubPlan 2
--       ->  CTE Scan on lacking l_1  (actual rows=1 loops=4375)
--             Filter: (media_id = m.id)
--             Rows Removed by Filter: 6000
--
-- 4,375 loops over 6,001 rows: about 26 million comparisons to build 4,375
-- small arrays, and the whole call took 2.7 s against a table that was
-- 222,246 rows. It is quadratic in the backlog: both factors grow together,
-- so the cost grows as the square. It was 50,000 rows when this function was
-- written in migration 045 and nobody noticed.
--
-- THE FIX is to aggregate once instead of per row -- a hash aggregate over
-- `lacking` restricted to the listings actually being returned, joined in.
-- LEFT JOIN with a coalesce keeps the old meaning exactly: a photo of a
-- pending listing that every site already has still comes back, carrying an
-- empty site_ids, because the photo job uses those rows for download state
-- even when there is nothing to import.
--
-- Nothing else about the function changes: same arguments, same columns,
-- same row set, same order.
--
-- Applied to production via the Supabase MCP on 2026-09-18 as migration
-- listings_photo_backlog_site_ids.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ls_photo_backlog(max_listings integer DEFAULT 60, shadow_grace_minutes integer DEFAULT 90)
 RETURNS TABLE(listing_id text, media_id uuid, "position" integer, path_key text, title text, source_url text, source_url_received_at timestamp with time zone, storage_path text, content_hash text, retry_after timestamp with time zone, download_attempts integer, image_width integer, image_height integer, site_ids uuid[])
 LANGUAGE sql
 STABLE
AS $function$
  WITH wanted AS (
    SELECT sl.listing_id, sl.site_id, sl.staged_at, s.write_mode
    FROM ls_site_listings sl
    JOIN ls_sites s ON s.id = sl.site_id
    WHERE s.active
      AND s.wix_site_id IS NOT NULL
      AND s.write_mode <> 'paused'
      AND sl.state IN ('staged', 'live')
  ),
  lacking AS (
    SELECT w.listing_id, w.site_id, w.staged_at, m.id AS media_id
    FROM wanted w
    JOIN ls_listing_media m ON m.listing_id = w.listing_id
    WHERE (m.retry_after IS NULL OR m.retry_after <= now())
      AND (w.write_mode = 'live' OR m.created_at <= now() - make_interval(mins => shadow_grace_minutes))
      AND NOT EXISTS (SELECT 1 FROM ls_site_media sm WHERE sm.media_id = m.id AND sm.site_id = w.site_id)
  ),
  pending AS (
    SELECT l.listing_id, MIN(l.staged_at) AS waiting_since
    FROM lacking l
    GROUP BY l.listing_id
    ORDER BY MIN(l.staged_at), l.listing_id
    LIMIT max_listings
  ),
  -- One pass over `lacking`, for the returned listings only, instead of one
  -- scan of it per returned photo.
  wanted_by AS (
    SELECT l.media_id, array_agg(l.site_id ORDER BY l.site_id) AS site_ids
    FROM lacking l
    JOIN pending p ON p.listing_id = l.listing_id
    GROUP BY l.media_id
  )
  SELECT m.listing_id, m.id, m."position", m.path_key, m.title, m.source_url, m.source_url_received_at,
         m.storage_path, m.content_hash, m.retry_after, m.download_attempts,
         m.image_width, m.image_height,
         COALESCE(w.site_ids, ARRAY[]::uuid[]) AS site_ids
  FROM ls_listing_media m
  JOIN pending p ON p.listing_id = m.listing_id
  LEFT JOIN wanted_by w ON w.media_id = m.id
  ORDER BY p.waiting_since, m.listing_id, m."position";
$function$;

-- ------------------------------------------------------------
-- And the reason it bit tonight rather than next week.
--
-- Both media tables are insert-heavy during a backfill and are read with
-- index-only scans, which need a fresh visibility map to stay index-only.
-- Autovacuum's default trigger is 50 + 20% of the live rows, so
-- ls_site_media (28,121 rows) needed about 5,600 dead tuples before it would
-- run, and at 01:50 it had 4,262 and had not been touched since 14:37 the
-- previous afternoon -- eleven hours, through the whole Wellen Park import.
--
-- What that costs, from the same plan node before and after a manual
-- VACUUM (ANALYZE) of ls_site_media:
--
--     Index Only Scan using idx_ls_site_media_pair
--       before:  Heap Fetches: 9064   Buffers: shared hit=8691
--       after:   Heap Fetches:  107   Buffers: shared hit=384
--
-- Nine thousand heap fetches is an index-only scan that is not index-only.
--
-- Being straight about which change did what, since all three landed within
-- the hour. ls_photo_backlog(60, 90), same data, same box:
--
--     old function, before the vacuum   2.7 s
--     new function, before the vacuum   4.5 s   (inside the run-to-run noise)
--     new function, after the vacuum    0.83 s
--
-- So the vacuum is what made it fast tonight, not the rewrite. At today's
-- size the 26 million comparisons were not the dominant cost -- building
-- `lacking` was, at about 33,000 buffers. The rewrite is still worth having,
-- because it is the only term here that grows as the square of the backlog
-- while everything else grows linearly, and it is the one that would have
-- taken over as the tables grow. Fixing it now is cheap; fixing it when it
-- dominates means fixing it during an incident.
--
-- So both tables get a tenth of the default scale factor and a small
-- absolute threshold, which makes autovacuum run on the order of every few
-- thousand rows instead of every few tens of thousands. These are the two
-- tables that grow with every photo of every listing on every site, and
-- Life At Lakewood has not even been switched on yet.
-- ------------------------------------------------------------

ALTER TABLE ls_site_media SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 1000
);

ALTER TABLE ls_listing_media SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 1000
);
