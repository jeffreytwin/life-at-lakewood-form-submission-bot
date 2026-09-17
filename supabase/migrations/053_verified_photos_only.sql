-- ============================================================
-- 053: a photo does not reach a gallery until Wix has shown us a picture
--
-- Jeff, 2026-09-17: "We must never show broken photos in a houses for sale
-- database. Period."
--
-- Today the engine can, and does. Wix's URL import is asynchronous: it takes
-- a URL, hands back a file id straight away, and fetches the picture
-- afterwards -- or fails to, leaving a file id with nothing behind it.
-- ls_site_media records the photo the moment that id comes back, so the
-- engine treats it as available from then on. The URI it builds is
-- well-formed (it carries #originWidth/#originHeight from the MLS record,
-- so isRenderableWixImage passes it) and goes into the gallery. Wix holds no
-- picture, and the site shows a broken image.
--
-- The only thing that ever caught this was reimportBrokenPhotos, a nightly
-- sweep that looks for the damage after it is already on the site -- and
-- which, as of today, had never once completed a run.
--
-- verified_at is the fix, and it works by making the bad state
-- unrepresentable rather than by cleaning up after it: a gallery is built
-- only from rows that carry one. NULL means Wix accepted the import and we
-- have not yet seen a picture; such a photo is simply not in the gallery,
-- and its listing carries gallery_ready = false.
--
-- That flag does not by itself hold a listing back, and it was described
-- here as though it did. What the write step actually does: a listing with
-- no confirmed photo at all is not written and stays 'staged'; one with
-- some is written with the photos that are confirmed, goes live with
-- gallery_ready = false, and is completed as the others are confirmed. So
-- what this buys is the rule itself -- nothing unconfirmed is ever shown --
-- rather than a guarantee that a gallery is whole the first time it
-- appears. Holding a whole listing off the site because one photo of
-- twenty-three is stuck would be the worse trade.
--
-- BACKFILL. Every existing row is stamped verified, including the imported
-- ones this cannot vouch for. Requiring verification retroactively would
-- empty the galleries of both live sites -- 10,468 photos on Longboat Key,
-- which is live -- until a sweep caught up, which is a far worse outcome
-- than the handful of broken pictures it would fix. The rule binds
-- everything imported from here on; what is already out there is a one-off
-- cleanup (the Hub's "Audit photos & rows").
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_verified_photos_only. Inert until the code that writes NULL for
-- new imports is deployed.
-- ============================================================

ALTER TABLE ls_site_media ADD COLUMN verified_at TIMESTAMPTZ;

COMMENT ON COLUMN ls_site_media.verified_at IS
  'When Wix was seen holding an actual picture for this file. NULL = imported but unconfirmed; the photo is kept out of the gallery until it is set, so a broken import can never reach a site.';

-- Everything that exists now keeps working; see BACKFILL above.
UPDATE ls_site_media SET verified_at = imported_at WHERE verified_at IS NULL;

-- The photo pass works through the unverified ones oldest first.
CREATE INDEX idx_ls_site_media_unverified
  ON ls_site_media (site_id, imported_at)
  WHERE verified_at IS NULL;
