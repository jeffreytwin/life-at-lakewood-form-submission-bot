-- ============================================================
-- 054: the Media Manager folder scan remembers where it got to
--
-- listMediaFiles pages by offset from zero on every call, so a listing cut
-- short -- by the deadline (migration 053's verification, and the nightly
-- sweep since PR #309) or by the page cap -- restarts in exactly the same
-- place next time and stops at exactly the same point. On a folder the size
-- of Parrish's (about 14,000 files, some 140 pages) the tail is therefore
-- never reached: a broken photo living there would never be found.
--
-- It is also O(folder size) per pass. The photo pass lists the folder
-- whenever something has been waiting on Wix for more than ten minutes,
-- which during a backfill is always true, so the cost grows with the folder
-- while competing for the same account-wide 200 requests/minute that the
-- imports need -- and the key covers every site, so a big backfill on one
-- site slows the others, one of which is live.
--
-- media_scan_offset is where the next listing starts. A pass reads what its
-- deadline allows, stores where it stopped, and the next one carries on;
-- reaching the end resets it to 0 and the cycle begins again. Cost per pass
-- becomes a function of the time available rather than of the folder, and
-- every file is reached within a cycle instead of only the first N pages
-- ever being seen.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_media_scan_cursor.
-- ============================================================

ALTER TABLE ls_sites ADD COLUMN media_scan_offset INTEGER NOT NULL DEFAULT 0
  CONSTRAINT ls_sites_media_scan_offset_nonneg CHECK (media_scan_offset >= 0);

COMMENT ON COLUMN ls_sites.media_scan_offset IS
  'Where the next Media Manager folder listing starts, so a scan cut short by a deadline resumes instead of restarting at the beginning and never reaching the end of a large folder. 0 = start from the top.';
