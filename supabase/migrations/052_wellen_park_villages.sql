-- ============================================================
-- 052: Life in Wellen Park's neighborhoods, from the site's own dashboard
--      page code -- plus the one thing the engine could not yet express.
--
-- Migration 051 added the site row; this fills it in. Jeff supplied the
-- site's manual dashboard page (the `subDivisionName.search(...)` chain
-- that assigns Village / VillageURL / village1, and the three tag
-- ternaries in setDataObject) and backend/Fetch.jsw, so the terms here are
-- transcribed from the process the engine is replacing rather than derived
-- from what the site happens to be showing. scripts/listings-wellen-villages.mjs
-- holds the transcription; this is its output.
--
-- The derivation added in 051's PR (src/lib/listings/seed-villages.ts) was
-- run over the same site first, and agreed: the 14 neighborhoods it could
-- see carried the same Wix item ids and, bar one, the same terms. It stays
-- the path for a site with no dashboard page to transcribe. Where the two
-- differ the dashboard wins, because it is what the site does today:
--   - Sarasota National: "sarasota national" + "sarasota n", not "sarasota".
--   - Wellen Park Country Club: "wellen pk golf" as well as the long form.
--   - Seven more neighborhoods with nothing for sale on the day the site
--     was crawled (Antigua, Ashcombe, Avelina, Brightmore, Gran Place,
--     Palmera, The Preserve), which no derivation could have found.
--
-- EXCLUSIONS. The dashboard assigns The Preserve on
-- `isThePreserve !== -1 && isKensington === -1`: "preserve", unless the
-- subdivision is Kensington's. Longest-term-wins settles a contest between
-- two of a site's own neighborhoods, and Kensington is not one, so nothing
-- longer exists to beat "preserve". Hence exclude_term: a term that does
-- not match when the subdivision also contains its exclusion. Nullable, one
-- user today, and the Hub shows it on the term chip ("preserve · not
-- kensington").
--
-- A NOTE ON "preserve", for whoever reads the first shadow run. The old
-- pipeline pulled a hand-curated MLS_id_list and used these terms only to
-- decide which neighborhood an already-chosen listing belonged to. The
-- engine has no such list: it takes every Active listing in the market, so
-- the same terms are now a filter, and a loose one reaches further than it
-- used to. "preserve" across Venice, North Port and Englewood will match
-- more than Wellen Park's Preserve. That is what shadow mode is for --
-- check The Preserve's staged listings before the site is cut over, and
-- tighten the term in the Hub if it has caught someone else's.
--
-- Applied to production via the Supabase MCP on 2026-09-17 as migration
-- listings_wellen_park_villages. The site row stays inactive.
-- ============================================================

ALTER TABLE ls_village_terms
  ADD COLUMN exclude_term TEXT
  CHECK (exclude_term IS NULL OR (exclude_term = lower(btrim(exclude_term)) AND length(exclude_term) > 0));

COMMENT ON COLUMN ls_village_terms.exclude_term IS
  'The term does not match when the subdivision also contains this. For a rule longest-term-wins cannot express, because the thing being excluded is not one of the site''s own neighborhoods (Wellen Park: "preserve" is The Preserve, unless it is Kensington''s).';

-- 21 neighborhoods, 24 subdivision terms (scripts/listings-wellen-villages.mjs).
WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com'),
village_rows(name, wix_slug, wix_item_id, page_url, display) AS (VALUES
    ('Antigua', 'antigua', '3da0b109-4054-4e80-aa64-1e9fd11ea07e', 'https://www.lifeinwellenpark.com/neighborhood/antigua', '{"villageSortHelp":"Antigua","blueTag1":"https://static.wixstatic.com/media/d0be81_876ff79d020e487784e082a441bd4d84~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_1e052bbc84164a3ebb11411e9b93d840~mv2.png"}'::jsonb),
    ('Ashcombe', 'ashcombe', '38b44315-bb96-4c47-88d7-b89b65480cf3', 'https://www.lifeinwellenpark.com/neighborhood/ashcombe', '{"villageSortHelp":"Ashcombe","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png"}'::jsonb),
    ('Avelina', 'avelina', '034d43aa-b316-4199-b4c1-be082fa423d1', 'https://www.lifeinwellenpark.com/neighborhood/avelina', '{"villageSortHelp":"Avelina","blueTag1":"https://static.wixstatic.com/media/d0be81_876ff79d020e487784e082a441bd4d84~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_1e052bbc84164a3ebb11411e9b93d840~mv2.png"}'::jsonb),
    ('Boca Royale', 'boca-royale', '21190230-c3b5-4735-b1f9-5a20f8b6fe1b', 'https://www.lifeinwellenpark.com/neighborhood/boca-royale', '{"villageSortHelp":"Boca Royale","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_a475422c6d434323bc793f973c6614ae~mv2.png"}'::jsonb),
    ('Brightmore', 'brightmore', '89fdb57a-e457-4988-a402-fbe1960978d9', 'https://www.lifeinwellenpark.com/neighborhood/brightmore', '{"villageSortHelp":"Brightmore","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_eb20d7968b4f44d1a6a2b12829e363d6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Everly', 'everly', '723118e6-1936-4a34-8c3a-03162b135544', 'https://www.lifeinwellenpark.com/neighborhood/everly', '{"villageSortHelp":"Everly","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Gran Paradiso', 'gran-paradiso', '2471b0cc-a6e7-47be-a7ba-22ab1619230a', 'https://www.lifeinwellenpark.com/neighborhood/gran-paradiso', '{"villageSortHelp":"Gran Paradiso","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Gran Place', 'gran-place', '601c8467-717f-4a21-83de-7f84816f67ff', 'https://www.lifeinwellenpark.com/neighborhood/gran-place', '{"villageSortHelp":"Gran Place","blueTag1":"https://static.wixstatic.com/media/d0be81_876ff79d020e487784e082a441bd4d84~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_1e052bbc84164a3ebb11411e9b93d840~mv2.png"}'::jsonb),
    ('Grand Palm', 'grand-palm', '63ec8952-9a69-4644-afab-4cc113bf9c37', 'https://www.lifeinwellenpark.com/neighborhood/grand-palm', '{"villageSortHelp":"Grand Palm","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('IslandWalk', 'islandwalk', '20581e1d-4aca-4197-8a64-ffb5db681e34', 'https://www.lifeinwellenpark.com/neighborhood/islandwalk', '{"villageSortHelp":"IslandWalk","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Lakespur', 'lakespur', '39d1e0ea-844c-4d7e-a1d4-a1c1a477c515', 'https://www.lifeinwellenpark.com/neighborhood/lakespur', '{"villageSortHelp":"Lakespur","blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_9e082d4621b1411dad4efef57b55a033~mv2.png"}'::jsonb),
    ('Oasis', 'oasis', 'f296ced6-c6bb-456f-93f8-f1fab44ade3a', 'https://www.lifeinwellenpark.com/neighborhood/oasis', '{"villageSortHelp":"Oasis","blueTag1":"https://static.wixstatic.com/media/d0be81_8443577a57464e3bb5d27fe1a80f3c0f~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Palmera', 'palmera', '50964b35-341c-4609-af82-78157f20a6fb', 'https://www.lifeinwellenpark.com/neighborhood/palmera', '{"villageSortHelp":"Palmera","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Renaissance', 'renaissance', 'ebc8d3bc-11c9-4a83-a463-887afa38acc7', 'https://www.lifeinwellenpark.com/neighborhood/renaissance', '{"villageSortHelp":"Renaissance","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Sarasota National', 'sarasota-national', '3bd7e70f-0408-40f6-9e24-096109b26472', 'https://www.lifeinwellenpark.com/neighborhood/sarasota-national', '{"villageSortHelp":"Sarasota National","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_a475422c6d434323bc793f973c6614ae~mv2.png"}'::jsonb),
    ('Solstice', 'solstice', '957506cf-de3a-4d97-83c7-e6131b2da1a7', 'https://www.lifeinwellenpark.com/neighborhood/solstice', '{"villageSortHelp":"Solstice","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_9e082d4621b1411dad4efef57b55a033~mv2.png"}'::jsonb),
    ('Sunstone', 'sunstone', '6df4a9cf-b9cc-46a2-9ea0-2b3669f69dcb', 'https://www.lifeinwellenpark.com/neighborhood/sunstone', '{"villageSortHelp":"Sunstone","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('The Preserve', 'the-preserve', '17e150c4-05db-4e86-b70d-0c3f49a17945', 'https://www.lifeinwellenpark.com/neighborhood/the-preserve', '{"villageSortHelp":"The Preserve","blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb),
    ('Tortuga', 'tortuga', '47fc45eb-81bc-49f6-bae9-ac3b6e3369b4', 'https://www.lifeinwellenpark.com/neighborhood/tortuga', '{"villageSortHelp":"Tortuga","blueTag1":"https://static.wixstatic.com/media/d0be81_876ff79d020e487784e082a441bd4d84~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_34c3ed762ada4f1da7b1b15908132e9f~mv2.png"}'::jsonb),
    ('Wellen Park Country Club', 'wellen-park-golf-%26-country-club', 'da9dd9b8-b3e4-40b3-9162-771dc9e345dc', 'https://www.lifeinwellenpark.com/neighborhood/wellen-park-golf-%26-country-club', '{"villageSortHelp":"Wellen Park Country Club","blueTag1":"https://static.wixstatic.com/media/d0be81_c5146d6c05f045748f3f247b303b6328~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_69220d35fef64735ab053df338ee0792~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_a475422c6d434323bc793f973c6614ae~mv2.png"}'::jsonb),
    ('Wysteria', 'wysteria', 'c697df42-4347-4121-ac7e-a9a50835c69f', 'https://www.lifeinwellenpark.com/neighborhood/wysteria', '{"villageSortHelp":"Wysteria","blueTag1":"https://static.wixstatic.com/media/d0be81_876ff79d020e487784e082a441bd4d84~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_a4a2f0774819424d9870dda0d94b7f93~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c5e0c6d37430473b890404a15eaab04a~mv2.png"}'::jsonb)
)
INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)
SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url, v.display FROM village_rows v, site
ON CONFLICT (site_id, name) DO UPDATE SET wix_slug = EXCLUDED.wix_slug, wix_item_id = EXCLUDED.wix_item_id, page_url = EXCLUDED.page_url, display = EXCLUDED.display, updated_at = now();

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeinwellenpark.com'),
term_rows(village_name, term, exclude_term) AS (VALUES
    ('Antigua', 'antigua', NULL),
    ('Ashcombe', 'ashcombe', NULL),
    ('Avelina', 'avelina', NULL),
    ('Boca Royale', 'boca royale', NULL),
    ('Brightmore', 'brightmore', NULL),
    ('Everly', 'everly', NULL),
    ('Gran Paradiso', 'gran paradiso', NULL),
    ('Gran Paradiso', 'grand paradiso', NULL),
    ('Gran Place', 'gran place', NULL),
    ('Grand Palm', 'grand palm', NULL),
    ('IslandWalk', 'islandwalk', NULL),
    ('Lakespur', 'lakespur', NULL),
    ('Oasis', 'oasis', NULL),
    ('Palmera', 'palmera', NULL),
    ('Renaissance', 'renaissance', NULL),
    ('Sarasota National', 'sarasota national', NULL),
    ('Sarasota National', 'sarasota n', NULL),
    ('Solstice', 'solstice', NULL),
    ('Sunstone', 'sunstone', NULL),
    ('The Preserve', 'preserve', 'kensington'),
    ('Tortuga', 'tortuga', NULL),
    ('Wellen Park Country Club', 'wellen park golf', NULL),
    ('Wellen Park Country Club', 'wellen pk golf', NULL),
    ('Wysteria', 'wysteria', NULL)
)
INSERT INTO ls_village_terms (site_id, village_id, term, exclude_term)
SELECT site.id, v.id, t.term, t.exclude_term FROM term_rows t JOIN site ON true JOIN ls_villages v ON v.site_id = site.id AND v.name = t.village_name
ON CONFLICT DO NOTHING;
