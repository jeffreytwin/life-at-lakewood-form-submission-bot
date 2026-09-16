-- ============================================================
-- 046: Life At Parrish onboarding groundwork
--   - a per-site Media Manager folder for the photos the engine imports
--   - the 'discover' run mode (MLS-wide Active listings, a site's initial inventory)
--   - Life At Parrish as an inactive shadow-mode site, with its neighborhoods,
--     subdivision terms and tag icons transcribed from the site's manual
--     dashboard page code (scripts/listings-parrish-villages.mjs)
-- Applied to production via the Supabase MCP on 2026-09-16 (17:07 UTC), as
-- migration listings_parrish_site, with the site row inactive; the row is
-- activated by hand once the code that reads media_folder_* is deployed.
-- ============================================================

-- The folder name is configuration; the id is resolved once against the
-- site's root-level folders by the photo job and cached here. NULL name =
-- imports land wherever Wix puts them by default (Longboat Key today).
ALTER TABLE ls_sites ADD COLUMN media_folder_name TEXT;
ALTER TABLE ls_sites ADD COLUMN media_folder_id TEXT;

-- A discover run scans every Active listing MLS-wide (no Media), keeps the
-- ones in a site's market that the engine does not know yet, and pulls
-- those by id. It is how a site gets its starting inventory when its live
-- galleries cannot seed it (Parrish's carry no MLS source URLs).
ALTER TABLE ls_sync_runs DROP CONSTRAINT ls_sync_runs_mode_check;
ALTER TABLE ls_sync_runs ADD CONSTRAINT ls_sync_runs_mode_check
  CHECK (mode IN ('incremental', 'full', 'photos', 'manual', 'discover'));

-- ============================================================
-- SEED: Life At Parrish, shadow mode (HousesforSale2, created by Jeff on
-- 2026-09-16), inactive until the folder support is live so no photo is
-- imported outside ParrishListingPhotos. Parrish is a city, so the market
-- is the city name, as for Longboat Key.
-- ============================================================
INSERT INTO ls_sites (name, domain, wix_site_id, market_cities, write_mode, active, media_folder_name)
VALUES ('Life At Parrish', 'lifeatparrish.com', 'a704cfe5-dd9b-44ff-a017-9d637d8c6fdc', ARRAY['Parrish'], 'shadow', false, 'ParrishListingPhotos')
ON CONFLICT (domain) DO NOTHING;

-- 51 neighborhoods, 63 subdivision terms (scripts/listings-parrish-villages.mjs).
WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeatparrish.com'),
village_rows(name, wix_slug, wix_item_id, page_url, display) AS (VALUES
    ('Aberdeen', 'aberdeen', 'a1d14dd0-0470-468a-915b-7835e90bb0c6', 'https://www.lifeatparrish.com/neighborhood/aberdeen', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png"}'::jsonb),
    ('Ancient Oaks', 'ancient-oaks', 'df896cfd-c5fa-41e3-beaf-f30d4d8f094d', 'https://www.lifeatparrish.com/neighborhood/ancient-oaks', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_8443577a57464e3bb5d27fe1a80f3c0f~mv2.png"}'::jsonb),
    ('Aviary at Rutland Ranch', 'aviary-at-rutland-ranch', 'ef3e49d3-a2b6-4422-ae52-797cdd24beeb', 'https://www.lifeatparrish.com/neighborhood/aviary-at-rutland-ranch', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_7616448739964b708d5025c8b261e914~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_0f25a5fa4f72410aaa780cd592870c13~mv2.png"}'::jsonb),
    ('Bella Lago', 'bella-lago', '432d734b-059c-4cce-8955-6236356e795c', 'https://www.lifeatparrish.com/neighborhood/bella-lago', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_7b27a5adc02a4354a2b7892f7af85c2c~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('North River Ranch', 'north-river-ranch', 'faee3374-9bdb-48bb-872b-166c759e6923', 'https://www.lifeatparrish.com/neighborhood/north-river-ranch', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Broadleaf', 'broadleaf', '1673fe32-bb2e-44d9-ad96-68517e22f352', 'https://www.lifeatparrish.com/neighborhood/broadleaf', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png"}'::jsonb),
    ('Canoe Creek', 'canoe-creek', '0ecbf0ff-4ed7-4baf-8d9d-6009749fcedc', 'https://www.lifeatparrish.com/neighborhood/canoe-creek', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Chelsea Oaks', 'chelsea-oaks', '81583010-5d54-4bcf-872e-925d794e2748', 'https://www.lifeatparrish.com/neighborhood/chelsea-oaks', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Copperstone', 'copperstone', '7ba0577e-fb03-4dcf-a6cd-3d5983619130', 'https://www.lifeatparrish.com/neighborhood/copperstone', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Creekside Oaks', 'creekside-oaks', 'ba9b1209-2c6c-476f-95df-01ae1cee457b', 'https://www.lifeatparrish.com/neighborhood/creekside-oaks', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png"}'::jsonb),
    ('Creekside Preserve', 'creekside-preserve', 'f069eff5-2ac9-41df-a06e-869c4910db58', 'https://www.lifeatparrish.com/neighborhood/creekside-preserve', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png"}'::jsonb),
    ('Creekside at Rutland Ranch', 'creekside-at-rutland-ranch', 'ee8c7c34-d300-4049-83a7-3a0b5578bbe2', 'https://www.lifeatparrish.com/neighborhood/creekside-at-rutland-ranch', '{}'::jsonb),
    ('Cross Creek', 'cross-creek', '9960ce18-95c9-4669-8ae1-e57681d72a2e', 'https://www.lifeatparrish.com/neighborhood/cross-creek', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Crosswind', 'crosswind-point', '133e204d-ae4c-4c24-9360-215edf07930e', 'https://www.lifeatparrish.com/neighborhood/crosswind-point', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_0f25a5fa4f72410aaa780cd592870c13~mv2.png"}'::jsonb),
    ('Del Webb Sunchase', 'del-webb-sunchase', '20f479ec-3124-410a-ac06-4f7522850ba5', 'https://www.lifeatparrish.com/neighborhood/del-webb-sunchase', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Del Webb At Bayview', 'del-webb-at-bayview', '4c6971b1-4a1d-44c8-85f3-fa1d4143602b', 'https://www.lifeatparrish.com/neighborhood/del-webb-at-bayview', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_7b27a5adc02a4354a2b7892f7af85c2c~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Firethorn', 'firethorn', '8b5c944a-71bb-41ed-b160-7384af3ccda2', 'https://www.lifeatparrish.com/neighborhood/firethorn', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png"}'::jsonb),
    ('Forest Creek', 'forest-creek', 'd30a0060-00a9-4fc7-b365-97b0ea8da502', 'https://www.lifeatparrish.com/neighborhood/forest-creek', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_0f25a5fa4f72410aaa780cd592870c13~mv2.png"}'::jsonb),
    ('Foxbrook', 'foxbrook', 'fcbf8ad9-3943-4d34-93e5-48c99b9580ec', 'https://www.lifeatparrish.com/neighborhood/foxbrook', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png"}'::jsonb),
    ('Gamble Creek Estates', 'gamble-creek-estates', 'ead6a877-726c-4b9b-83d3-302d8aaa9513', 'https://www.lifeatparrish.com/neighborhood/gamble-creek-estates', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_d6998a26979b4dbdba0bde53d873a30f~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png"}'::jsonb),
    ('Grand Oak Preserve', 'grand-oak-preserve', '7e027556-dbc9-4b53-893d-311b8390a11f', 'https://www.lifeatparrish.com/neighborhood/grand-oak-preserve', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_d6998a26979b4dbdba0bde53d873a30f~mv2.png"}'::jsonb),
    ('Harrison Ranch', 'harrison-ranch', '9831be08-5d40-4ec7-b352-101411dcc668', 'https://www.lifeatparrish.com/neighborhood/harrison-ranch', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Isles at Bayview', 'isles-at-bayview', '117fa6da-1210-4625-80a3-8c91c205d7a2', 'https://www.lifeatparrish.com/neighborhood/isles-at-bayview', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Kingsfield', 'kingsfield', 'e5e4d3b8-b534-4609-8366-45b8b5e1db9c', 'https://www.lifeatparrish.com/neighborhood/kingsfield', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Kingsfield Lakes', 'kingsfield-lakes', '4ece3001-89c6-4db3-8f7c-48c9cbd5f208', 'https://www.lifeatparrish.com/neighborhood/kingsfield-lakes', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png"}'::jsonb),
    ('Lakeside Preserve', 'lakeside-preserve', '0b9b1062-15f7-43b8-baf4-544672a8f2dd', 'https://www.lifeatparrish.com/neighborhood/lakeside-preserve', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png"}'::jsonb),
    ('Legacy Preserve', 'legacy-preserve', '23a451f2-1d38-480c-a4d2-aa7047121bef', 'https://www.lifeatparrish.com/neighborhood/legacy-preserve', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Lexington', 'lexington', '69d106c3-2f52-4cc0-993a-771139a23d66', 'https://www.lifeatparrish.com/neighborhood/lexington', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('McKinley Oaks', 'mckinley-oaks', '349e45c5-7cce-42e2-b85f-6da2b9a31132', 'https://www.lifeatparrish.com/neighborhood/mckinley-oaks', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png"}'::jsonb),
    ('Oakfield', 'oakfield', 'f1bf8a4d-e8fb-42dc-ba4d-55e5bb72520e', 'https://www.lifeatparrish.com/neighborhood/oakfield', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Parkwood Lakes', 'parkwood-lakes', '935001ed-23ad-4cdf-8f3a-1583386730d3', 'https://www.lifeatparrish.com/neighborhood/parkwood-lakes', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_d6998a26979b4dbdba0bde53d873a30f~mv2.png"}'::jsonb),
    ('Prosperity Lakes', 'prosperity-lakes', 'b3e0a6a0-eb52-4c28-9e07-6c065740f0fc', 'https://www.lifeatparrish.com/neighborhood/prosperity-lakes', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8d4ae4966d7144039c8a9e212c09b48f~mv2.png"}'::jsonb),
    ('River Plantation', 'river-plantation', '43febbfd-41f2-4bfb-b9cc-b5f1f20c8933', 'https://www.lifeatparrish.com/neighborhood/river-plantation', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_7b27a5adc02a4354a2b7892f7af85c2c~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_0f25a5fa4f72410aaa780cd592870c13~mv2.png"}'::jsonb),
    ('River Wilderness', 'river-wilderness', '0f8e2b1f-150a-41ed-8c92-cca85b01cc5d', 'https://www.lifeatparrish.com/neighborhood/river-wilderness', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_c4b96b4e8980473db8573538ae5a4a31~mv2.png"}'::jsonb),
    ('River Woods', 'river-woods', 'bfd6e345-cc72-4521-b5ac-6ad5f12cdda8', 'https://www.lifeatparrish.com/neighborhood/river-woods', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png"}'::jsonb),
    ('Rivers Reach', 'rivers-reach', '3ed76e5f-6a63-4803-b4aa-1886477a7d5d', 'https://www.lifeatparrish.com/neighborhood/rivers-reach', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Riversong', 'riversong', 'bfa84164-7332-4cf1-b714-e490b8023125', 'https://www.lifeatparrish.com/neighborhood/riversong', '{}'::jsonb),
    ('Rye Crossing', 'rye-crossing', '852b5871-d06b-4817-9763-e842c3027dd0', 'https://www.lifeatparrish.com/neighborhood/rye-crossing', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Rye Ranch', 'rye-ranch', '79da75ec-b41e-4154-a859-5383f73a8814', 'https://www.lifeatparrish.com/neighborhood/rye-ranch', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_7616448739964b708d5025c8b261e914~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_ad755db7cad5428a89a7f9c1edd7a14e~mv2.png"}'::jsonb),
    ('Salt Meadows', 'salt-meadows', 'd0ec2799-324f-4b95-8520-d7609398556c', 'https://www.lifeatparrish.com/neighborhood/salt-meadows', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb),
    ('Sawgrass Lakes', 'sawgrass-lakes', '2ac9bd59-b28d-4c40-a317-aac12b66d4df', 'https://www.lifeatparrish.com/neighborhood/sawgrass-lakes', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png"}'::jsonb),
    ('Seaire', 'seaire', '5f5bede6-e2cd-4f00-ba57-17d3d08e3d9c', 'https://www.lifeatparrish.com/neighborhood/seaire', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_ad755db7cad5428a89a7f9c1edd7a14e~mv2.png"}'::jsonb),
    ('Silverleaf', 'silverleaf', '075e646a-f3e7-4b21-a82d-fa1a643cd3ad', 'https://www.lifeatparrish.com/neighborhood/silverleaf', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_d3a6386624504bdeb73cae209f6b469d~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Southern Oaks', 'southern-oaks', '953913c5-8508-4bbe-8bc3-0301b58ca512', 'https://www.lifeatparrish.com/neighborhood/southern-oaks', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Summerwoods', 'summerwoods', '3d256b8f-277c-4f33-8410-d469d7fb73eb', 'https://www.lifeatparrish.com/neighborhood/summerwoods', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_1228248c285845f1a9a0e2073fd93fde~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_233a0ae9d8eb44b38ab8c5dc32a2fa39~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('The Islands on The Manatee River', 'the-islands-on-the-manatee-river', 'f2289121-f7cb-4fc1-ac6b-f1477280acb5', 'https://www.lifeatparrish.com/neighborhood/the-islands-on-the-manatee-river', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('The Willows & The Laurels', 'the-willows', '17ffd87f-bb0e-4aa2-8b07-a9ba1ef94642', 'https://www.lifeatparrish.com/neighborhood/the-willows', '{}'::jsonb),
    ('Timberly', 'timberly', 'c170a900-e9f7-4107-ac64-99c73bf69465', 'https://www.lifeatparrish.com/neighborhood/timberly', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_2af917ac843644e9ad62ecba90efdf1a~mv2.png"}'::jsonb),
    ('Twin Rivers', 'twin-rivers', '1c3047f3-731b-4d15-91f8-652b79382eb5', 'https://www.lifeatparrish.com/neighborhood/twin-rivers', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_8443577a57464e3bb5d27fe1a80f3c0f~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_0f25a5fa4f72410aaa780cd592870c13~mv2.png"}'::jsonb),
    ('Windwater', 'windwater', '15877619-6a54-4b12-b717-ca976d2e2eef', 'https://www.lifeatparrish.com/neighborhood/windwater', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_09510d25dd304733a8924eebaf2c2147~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_8047b9269ae3438182f3f075f661ec92~mv2.png"}'::jsonb),
    ('Woodland Preserve', 'woodland-preserve', '81f1131e-4524-4ca3-be13-c712fafeebb9', 'https://www.lifeatparrish.com/neighborhood/woodland-preserve', '{"blueTag1":"https://static.wixstatic.com/media/d0be81_aae6b9125c784fffbe6b679d403c01d6~mv2.png","purpleTag1":"https://static.wixstatic.com/media/d0be81_12f5e34e37d54c11a1b630db35b9fcd6~mv2.png","greenTag1":"https://static.wixstatic.com/media/d0be81_b01f771f67cf41c6b51d04672c8b0da0~mv2.png"}'::jsonb)
)
INSERT INTO ls_villages (site_id, name, wix_slug, wix_item_id, page_url, display)
SELECT site.id, v.name, v.wix_slug, v.wix_item_id, v.page_url, v.display FROM village_rows v, site
ON CONFLICT (site_id, name) DO UPDATE SET wix_slug = EXCLUDED.wix_slug, wix_item_id = EXCLUDED.wix_item_id, page_url = EXCLUDED.page_url, display = EXCLUDED.display, updated_at = now();

WITH site AS (SELECT id FROM ls_sites WHERE domain = 'lifeatparrish.com'),
term_rows(village_name, term) AS (VALUES
    ('Aberdeen', 'aberdeen'),
    ('Ancient Oaks', 'ancient oaks'),
    ('Aviary at Rutland Ranch', 'aviary'),
    ('Bella Lago', 'bella lago'),
    ('North River Ranch', 'brightwood'),
    ('North River Ranch', 'crescent creek'),
    ('North River Ranch', 'del webb explore'),
    ('North River Ranch', 'highview'),
    ('North River Ranch', 'longmeadow'),
    ('North River Ranch', 'north river ranch'),
    ('North River Ranch', 'riverfield'),
    ('North River Ranch', 'wildleaf'),
    ('Broadleaf', 'broadleaf'),
    ('Canoe Creek', 'canoe creek'),
    ('Chelsea Oaks', 'chelsea oaks'),
    ('Copperstone', 'copperstone'),
    ('Creekside Oaks', 'creekside oaks'),
    ('Creekside Preserve', 'creekside preserve'),
    ('Creekside at Rutland Ranch', 'creekside at'),
    ('Cross Creek', 'cross creek'),
    ('Cross Creek', 'crosscreek'),
    ('Crosswind', 'crosswind'),
    ('Del Webb Sunchase', 'del webb sunchase'),
    ('Del Webb At Bayview', 'del webb at bayview'),
    ('Firethorn', 'firethorn'),
    ('Forest Creek', 'forest creek'),
    ('Foxbrook', 'foxbrook'),
    ('Gamble Creek Estates', 'gamble creek'),
    ('Grand Oak Preserve', 'grand oak preserve'),
    ('Harrison Ranch', 'harrison ranch'),
    ('Isles at Bayview', 'isles at bayview'),
    ('Kingsfield', 'kingsfield'),
    ('Kingsfield Lakes', 'kingsfield lakes'),
    ('Lakeside Preserve', 'lakeside preserve'),
    ('Legacy Preserve', 'legacy preserve'),
    ('Lexington', 'lexington'),
    ('McKinley Oaks', 'mckinley oaks'),
    ('Oakfield', 'oakfield lakes'),
    ('Oakfield', 'oakfield trails'),
    ('Parkwood Lakes', 'parkwood lakes'),
    ('Prosperity Lakes', 'prosperity lakes'),
    ('River Plantation', 'river plantation'),
    ('River Wilderness', 'river wilderness'),
    ('River Woods', 'river woods'),
    ('Rivers Reach', 'reach'),
    ('Riversong', 'riversong'),
    ('Rye Crossing', 'rye crossing'),
    ('Rye Ranch', 'rye ranch'),
    ('Salt Meadows', 'salt meadows'),
    ('Salt Meadows', 'saltmdws'),
    ('Salt Meadows', 'saltmeadows'),
    ('Sawgrass Lakes', 'sawgrass lakes'),
    ('Seaire', 'seaire'),
    ('Silverleaf', 'silverleaf'),
    ('Southern Oaks', 'southern oaks'),
    ('Summerwoods', 'summerwoods'),
    ('The Islands on The Manatee River', 'the islands on the manatee'),
    ('The Willows & The Laurels', 'willows'),
    ('The Willows & The Laurels', 'laurels'),
    ('Timberly', 'timberly'),
    ('Twin Rivers', 'twin rivers'),
    ('Windwater', 'windwater'),
    ('Woodland Preserve', 'woodland preserve')
)
INSERT INTO ls_village_terms (site_id, village_id, term)
SELECT site.id, v.id, t.term FROM term_rows t JOIN site ON true JOIN ls_villages v ON v.site_id = site.id AND v.name = t.village_name
ON CONFLICT DO NOTHING;
