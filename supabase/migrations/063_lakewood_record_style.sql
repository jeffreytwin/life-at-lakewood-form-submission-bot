-- ============================================================
-- 063: Life At Lakewood's filters are a different shape, and 062's rename
--      alone would have broken them
--
-- Migration 062 mapped villageSortHelp -> villageSort for this site, on the
-- strength of the probe reporting the engine's name missing and Jeff naming
-- the site's. That was half right and would have shipped a quiet bug.
--
-- The site's own dashboard code, read on 2026-09-18, writes:
--
--     "villageSort":  [villageSortHelp, 'Show All']
--     "homeTypeSort": [PropertySubType,  'Show All']
--     "bedroomsSort": [BedroomsTotal,    'Show All']
--     "garagesSort":  [GarageSpaces]
--     "galleryImage": <a constant camera badge>
--
-- villageSort is a MULTI-VALUE field, and every row carries the literal
-- string "Show All" -- which is what makes each filter's "Show All" option
-- match everything. Writing a plain string there, which is exactly what 062's
-- rename would have done, leaves the field the wrong type and the filter
-- broken, with nothing to say so.
--
-- And three of those fields have no equivalent in the standard record at all.
-- The engine writes listingPriceSort and bathroomsSort; homeTypeSort,
-- bedroomsSort and garagesSort it has never written, so those filters would
-- have gone blank on every engine-written row after cutover.
--
-- Worth recording the asymmetry, because it looks like a mistake and is not:
-- the "Show All" sentinel is on villageSort, homeTypeSort and bedroomsSort
-- but NOT on listingPriceSort, bathroomsSort or garagesSort. That is what the
-- site's dashboard writes, so it is what the engine writes.
--
-- ls_sites.record_style carries this, the way price_sort_style already
-- carries a per-site difference in how one field is computed. It is named
-- after the site rather than abstracted into a scheme, because one site is
-- all the evidence there is; the fifth site gets looked at before this grows
-- a third value.
--
-- field_map keeps only the rename that is genuinely just a rename --
-- listingBrokerageContactInformation -> listingBrokerContactInfo, the MLS
-- attribution line. villageSortHelp comes out of it: under the lakewood
-- style the engine emits villageSort directly and never emits
-- villageSortHelp, so there is nothing left to rename.
--
-- HOW THIS WAS FOUND, since it is the reusable part: the probe compares the
-- engine's field names against the collection's and can say a field is
-- missing. It cannot say what the site's *page code* does with the fields
-- that are present, and nothing in the collection export shows it either --
-- an export gives display names and values, not the shape a filter expects.
-- Only the page code showed that villageSort is an array with a sentinel in
-- it. Ask for the page code before writing to a collection built by someone
-- else's pipeline.
--
-- Applied to production via the Supabase MCP on 2026-09-18 as migration
-- listings_lakewood_record_style.
-- ============================================================

ALTER TABLE ls_sites
  ADD COLUMN IF NOT EXISTS record_style text NOT NULL DEFAULT 'standard';

ALTER TABLE ls_sites
  DROP CONSTRAINT IF EXISTS ls_sites_record_style_check;
ALTER TABLE ls_sites
  ADD CONSTRAINT ls_sites_record_style_check CHECK (record_style IN ('standard', 'lakewood'));

COMMENT ON COLUMN ls_sites.record_style IS
  'Which record shape the site''s page code reads. "standard" is Longboat Key, Parrish and Wellen Park. "lakewood" adds homeTypeSort / bedroomsSort / garagesSort / galleryImage and writes villageSort as [label, "Show All"] instead of villageSortHelp as text. See transform.RecordStyle.';

UPDATE ls_sites
   SET record_style = 'lakewood',
       -- villageSortHelp is no longer emitted under this style, so the rename
       -- that 062 added has nothing left to rename. The attribution field is
       -- a genuine rename and stays.
       field_map = jsonb_build_object(
         'listingBrokerageContactInformation', 'listingBrokerContactInfo')
 WHERE domain = 'lifeatlakewood.com';
