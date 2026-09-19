-- Fair queueing for the photo backlog.
--
-- WHAT WENT WRONG, 2026-09-19. Jeff noticed that Parrish, Longboat Key and
-- Wellen Park each had new listings that had been staged for more than
-- twenty hours without a single photo downloaded. Nothing was broken about
-- them: no failed attempts, no retry backoff, no missing source URLs. They
-- had simply never been reached.
--
-- `pending` took the sixty longest-waiting listings MLS-wide, with no regard
-- for which site was waiting. Life At Lakewood had been switched on the
-- previous afternoon and staged 417 listings inside one hour, every one of
-- them older than anything that arrived afterwards. For the next twenty-three
-- hours every sixty-listing pass was one hundred percent Lakewood, and the
-- eight listings that showed up behind it on three LIVE, public sites waited
-- their turn behind a shadow-mode site that nobody could even see yet.
--
--   Pass of ten, on the real backlog at 18:47 UTC:
--     before:  Lakewood 10, Longboat 0, Parrish 0, Wellen Park 0
--     after:   Lakewood  3, Longboat 3, Parrish 2, Wellen Park 2
--
-- THE RULE. Rank each listing within its own site, oldest first, then take
-- the pass in rank order: every site's oldest, then every site's second
-- oldest, and so on. A site with nothing waiting takes no slots and the rest
-- absorb them, so this costs nothing in the common case where only one site
-- has work -- it degenerates exactly to the old behaviour. A site with a
-- thousand listings queued still gets the lion's share of every pass; what it
-- can no longer do is take ALL of it while another site's listing is missing
-- from a public website.
--
-- This is deliberately about sites rather than about live-versus-shadow.
-- Weighting live sites ahead of shadow ones would have fixed this particular
-- morning and made the next onboarding never finish. Round-robin fixes both.
--
-- The output is ordered by turn as well, not only the selection. A pass that
-- runs out of budget half way through has then still spread what it did
-- across the sites, instead of finishing one site's slice first.
--
-- A listing wanted by two sites is ranked by the better of its two positions,
-- which is what MIN(rank_in_site) does: it is one download either way, so it
-- should not be held back by the slower queue.

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
  -- Each site's own queue, oldest first. The window runs after the grouping,
  -- so MIN(staged_at) is the listing's wait as that site sees it.
  ranked AS (
    SELECT l.listing_id,
           l.site_id,
           MIN(l.staged_at) AS waiting_since,
           ROW_NUMBER() OVER (PARTITION BY l.site_id ORDER BY MIN(l.staged_at), l.listing_id) AS rank_in_site
    FROM lacking l
    GROUP BY l.listing_id, l.site_id
  ),
  pending AS (
    SELECT r.listing_id,
           MIN(r.waiting_since) AS waiting_since,
           MIN(r.rank_in_site) AS turn
    FROM ranked r
    GROUP BY r.listing_id
    ORDER BY MIN(r.rank_in_site), MIN(r.waiting_since), r.listing_id
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
  ORDER BY p.turn, p.waiting_since, m.listing_id, m."position";
$function$;
