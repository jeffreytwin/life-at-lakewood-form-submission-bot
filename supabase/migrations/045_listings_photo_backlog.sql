-- Listings engine: the photo backlog (plan step 3).
-- (Applied to production 2026-09-15 via the Supabase MCP, in three steps
-- that this file folds into one.)
--
-- One query for the photo job: the photos of listings a site shows or is
-- about to show that the site does not have yet. A photo the site already
-- serves (seeded from its live gallery) is not pending even though the
-- engine never downloaded it: the engine fetches a photo from MLSGrid only
-- when some site lacks it ("only new photos"). While a site is in shadow
-- mode the Velo pipeline still fetches each new listing's photos, and
-- MLSGrid allows one download per photo per hour, so for such a site a
-- photo counts as lacking only once it has been known for
-- shadow_grace_minutes (the seed step copies whatever the live gallery got
-- in the meantime); a live-mode site has no other pipeline and no grace.
-- Rows in a cooldown (retry_after in the future) do not count as pending,
-- so a listing whose only open photos are cooling down does not come back
-- every tick. Listings are ordered by how long they have waited, oldest
-- first, and limited to max_listings; every photo of a selected listing is
-- returned (site_ids empty where nothing is missing) so the job can report
-- "n of m".

DROP FUNCTION IF EXISTS ls_photo_backlog(integer);

CREATE OR REPLACE FUNCTION ls_photo_backlog(max_listings integer DEFAULT 60, shadow_grace_minutes integer DEFAULT 90)
RETURNS TABLE (
  listing_id text,
  media_id uuid,
  "position" integer,
  path_key text,
  title text,
  source_url text,
  source_url_received_at timestamptz,
  storage_path text,
  content_hash text,
  retry_after timestamptz,
  download_attempts integer,
  site_ids uuid[]
)
LANGUAGE sql
STABLE
AS $$
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
  )
  SELECT m.listing_id, m.id, m."position", m.path_key, m.title, m.source_url, m.source_url_received_at,
         m.storage_path, m.content_hash, m.retry_after, m.download_attempts,
         ARRAY(SELECT l.site_id FROM lacking l WHERE l.media_id = m.id ORDER BY l.site_id) AS site_ids
  FROM ls_listing_media m
  JOIN pending p ON p.listing_id = m.listing_id
  ORDER BY p.waiting_since, m.listing_id, m."position";
$$;
