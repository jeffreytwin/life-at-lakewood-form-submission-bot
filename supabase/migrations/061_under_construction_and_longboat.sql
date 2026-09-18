-- ============================================================
-- 061: two corrections to what counts as builder inventory, and for whom
--
-- Both came out of Jeff reading Life in Wellen Park's shadow collection on
-- 2026-09-18 and asking why an obvious builder listing was on it. The answer
-- was in two halves, and only one of them was ours.
--
-- FIRST HALF: the MLS flag is sometimes wrong. Two Boca Royale East homes
-- carry PropertyCondition "Under Construction", YearBuilt 2026, BuilderName
-- "Neal Communities of SWFL", and are listed by Neal Communities' own
-- brokerage -- with NewConstructionYN false. Redfin's export of the same
-- feed drops both, so Redfin is not reading that flag either.
--
-- normalize.ts now takes "Under Construction" as decisive (see
-- isNewConstruction there for why that field and not the other two). This
-- migration backfills the rows already held, because new_construction is
-- only recomputed when a run pulls a listing again, and a full cycle takes
-- five passes. Without the backfill the four affected listings would sit on
-- their sites until the next nightly.
--
-- SECOND HALF: excluding builder listings was never a fact about listings,
-- it was a fact about the sites. Jeff, 2026-09-18:
--
--   "Life in Longboat Key is okay to have new construction in its listings.
--    That's because it doesn't have a new build section on its website.
--    However, since all other sites we have new build sections (Life in
--    Wellen Park, Life At Lakewood and Life At Parrish), new construction
--    should be excluded from their collections."
--
-- So the rule has a reason, and the reason is per site: a site with its own
-- new-build section would show the same home twice, and a site without one
-- simply loses it. Longboat Key has no such section, and the eleven listings
-- it has been hiding are the most expensive inventory on the island --
-- $13,995,000 in Sleepy Lagoon, two St. Regis residences at $12,850,000 and
-- $4,439,000, $11,900,000 in Bay Isles, $6,495,000 in Emerald Harbor.
-- Hiding those was a straight loss with nothing bought by it.
--
-- ls_sites.show_new_construction already exists and classify.ts already
-- honours it; it has just been false everywhere since 2026-09-16. This flips
-- the one site the reason does not apply to. It is one boolean, reversible
-- in one statement, and it changes a live site: Longboat Key goes 199 -> 210.
--
-- NET EFFECT on the next run of each site:
--
--     lifeatparrish.com      277 -> 275   (2 Meritage, Oakfield Trails, live)
--     lifeinwellenpark.com   159 -> 157   (2 Neal Communities, Boca Royale, shadow)
--     lifeinlongboatkey.com  199 -> 210   (+11 builder listings, live)
--     lifeatlakewood.com       0 ->   0   (not switched on)
--
-- Applied to production via the Supabase MCP on 2026-09-18 as migration
-- listings_under_construction_and_longboat.
-- ============================================================

-- The four listings the flag got wrong, and any other row already held whose
-- PropertyCondition says the house is still being built. Matching
-- normalize.ts exactly: "Under Construction" only, case-insensitive.
UPDATE ls_listings
   SET new_construction = true
 WHERE coalesce(new_construction, false) = false
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(raw->'PropertyCondition') = 'array'
                   THEN raw->'PropertyCondition' ELSE '[]'::jsonb END
            ) AS c(value)
      WHERE lower(btrim(c.value)) = 'under construction'
   );

-- Longboat Key shows builder listings; it has no new-build section to send
-- them to. Every other site keeps excluding them.
UPDATE ls_sites
   SET show_new_construction = true
 WHERE domain = 'lifeinlongboatkey.com';

-- WHEN IT TAKES EFFECT. Nothing here touches ls_site_listings, on purpose.
-- A listing's place on a site is decided by classifyListing during a run,
-- and a run only judges the listings it pulled -- an incremental sees its
-- modification window, discover skips anything already held. So the four
-- removals and Longboat's eleven additions arrive on the next FULL run,
-- which verifies every held id. The 03:00 nightly does it; the Hub's Run
-- Full does it sooner, over five cursor-paged passes.
--
-- Backfill verified before applying: exactly 6 rows flip to true, all six
-- Active, four of them currently on a site.
