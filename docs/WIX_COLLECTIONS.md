# Wix Collections Reference — Floor Plan Sync

Recovered 2026-07-02 via the Wix Data API (prebuild verification run) and the
Parrish CSV export. This is the ground truth for the legacy schemas, the basis
for the standardized schema, and the per-site field maps.

## Sites

| Site | wix-site-id | Legacy Floorplans collection | Items |
|---|---|---|---|
| lifeatlakewood.com | `4fbabb96-2d6c-4f20-a240-9223153498b5` | `FloorPlans` ("Floor Plans", 48 fields) | 445 |
| lifeinwellenpark.com | `1a8c2755-823e-4882-ae32-e6c108a30e39` | `FloorPlans` ("Floor Plans", 32 fields) | 329 |
| lifeatparrish.com | `a704cfe5-dd9b-44ff-a017-9d637d8c6fdc` | `FloorPlans` ("Floor Plans", 38 fields) | 829 |
| lifeinlongboatkey.com | `8b20e921-5b70-4428-8fcd-8c8ef3bad3ab` | none (listings engine site; see `LISTINGS_ENGINE_PLAN.md`) | |

All three sites also carry `Builders` and a villages/neighborhoods collection
that the Floorplans reference fields point at. Where the Floor Plans V2
`villages` reference points differs by site: `HousesforSale-DynamicPages`
("Neighborhoods") on Wellen Park and Parrish, `AmenitiesbyVillage` on
Lakewood, whose `HousesforSale-DynamicPages` ("Dynamic Village Pages") holds
two items (found 2026-09-20, when every Isles row went out without its
neighborhood). The write-back reads the target from each site's V2 schema
rather than assuming one.

Key API facts confirmed:
- One account-level API key + `wix-site-id` header works across all four sites
  (Longboat Key verified 2026-09-14 by `scripts/listings-wix-phase1.mjs`).
- A write that supplies its own `_id` must also send `dataItem.id` with the
  same value, or Wix answers WDE0080 "dataItem id and data._id fields must
  match". The bulk endpoints (`/wix-data/v2/bulk/items/{insert,update,save,
  remove}`) take up to 1000 items per call, keep caller ids, and on Longboat
  Key wrote 50 realistic listing rows in about 0.2 to 0.3 s per call.
- Every FloorPlans collection exposes `_publishStatus`, `_publishDate`,
  `_draftDate` system fields — the CMS draft/published state the draft-first
  insert flow relies on (Parrish currently has 152 DRAFT / 829 PUBLISHED items).

## Legacy FloorPlans schemas

### lifeatlakewood.com (oldest pattern)
Data fields: `floorPlanName`, `floorPlanPrice`, `homeType`, `village`,
`bedrooms`, `bathrooms`, `garages`, `squareFeet`, `floorPlanDescription`,
`villageLink1` (URL), `floorPlanImage` (IMAGE), `virtualTourLink` (URL),
`floorPlanImageGalleryLink` (MEDIA_GALLERY), `floorPlanBluePrintGallery`
(MEDIA_GALLERY), `virtualTourImageV2` (IMAGE), `village1` (REFERENCE),
`builder`, `builderUrl` (URL), `estimatedAllInPrice`, `estimatedBuildTime`,
`estimatedUpgradesOrChanges`, `averageLotPrice`, `score` (NUMBER),
`villageV2` (RICH_TEXT), `villageHomesForSale` (RICH_TEXT), `moveInReady`,
`modelAvailable` (BOOLEAN), `newFilterBuildTime`, `quickMoveInAvailable`
(BOOLEAN), `quickMoveInImage` (IMAGE), `newConstructionOrMoveIn`,
`constructionDot` (IMAGE), plus parallel sort columns: `floorPlanPriceSort`,
`homeTypeSort`, `bedroomsSort`, `bathroomsSort`, `garagesSort`, `villageSort`,
`estimatedBuildTimeSort`, `builderSort`.

Notes: the `*Sort` columns are a legacy workaround to retire in the standard
schema. No `builder1`/reference to Builders; `village1` is the only reference.

### lifeinwellenpark.com (modern family)
`floorPlanName`, `floorPlanPrice`, `homeType`, `village`, `bedrooms`,
`bathrooms`, `garages`, `squareFeet`, `floorPlanDescription`, `floorPlanImage`,
`virtualTourLink`, `floorPlanImageGalleryLink`, `virtualTourImageV2`,
`builder`, `score` (NUMBER), `quickMoveInAvailable` (BOOLEAN),
`newConstructionOrMoveIn`, `constructionDot`, `villages` (REFERENCE),
`floorPlanPriceTags` (ARRAY_STRING), `builder1` (REFERENCE),
`relatedFloorPlanQuickMoveInOnly`, `quickMoveInImage`, `notes`.

### lifeatparrish.com (gold standard baseline)
Everything in the Wellen list, plus: `estimatedBuildTime`,
`estimatedUpgradesOrChanges`, `estimatedBuildTimeTags` (ARRAY_STRING),
`publishDate` (DATETIME), `unpublishDate` (TEXT), `score1` (NUMBER), and
`score` is ARRAY_STRING here (renamed wart — `score1` holds the number).

Notes/warts to fix when defining the standard schema (new collections only):
- `score` ARRAY_STRING vs `score1` NUMBER → one `score` NUMBER.
- `unpublishDate` TEXT → drop or make DATETIME.
- Numeric-ish fields (`bedrooms`, `bathrooms`, `squareFeet`, `floorPlanPrice`)
  are TEXT with display formatting ("$419,990", "1,953"); keep display fields
  as TEXT for repeater parity but the canonical Supabase record stores parsed
  numerics.

## Structural insights (from the Parrish CSV, 981 rows)

- **Quick move-ins are separate records** referencing their base plan via
  `relatedFloorPlanQuickMoveInOnly`. QMI rows are ~half the collection
  (494/981). The canonical model must preserve this parent/child relation.
- `Builder`/`Neighborhood` each appear as display text AND as a REFERENCE
  (UUID) to the Builders / Neighborhoods collections.
- Dynamic item pages exist: `link-floor-plans-floorPlanName` PAGE_LINK, paths
  like `/floor-plans/the-benton`. Cutover must preserve or recreate these slugs.
- Images are `wix:image://` URIs; galleries are JSON arrays of image objects —
  confirms Media Manager upload (with dedupe) is required.
- `notes` is freelancer editorial state ("Done", "Not Found") — not synced
  data; the pipeline replaces its purpose with run status.

## FloorPlansV2 (the new pipeline-operated collections) — verified behavior

Created on all three sites via the Data Collections API: id `FloorPlansV2`,
standardized schema (Parrish baseline, warts fixed, plus `syncKey`,
`sourceUrl`, `lastSyncedAt`), permissions read=ANYONE / writes=ADMIN, and the
publish plugin (`{"type":"PUBLISH","publishOptions":{"defaultStatus":
"PUBLISHED","lifecycleStatus":"ACTIVE"}}`) copied from the legacy collections.
Collection update endpoint is `PUT /wix-data/v2/collections` (id in body).

Verified item lifecycle (probe run 2026-07-02, test items cleaned up):

- Plain insert → lands `PUBLISHED`.
- Insert with `data._publishStatus: "DRAFT"` → lands `DRAFT`. **Draft-first
  inserts work.**
- Default reads/queries DO NOT see drafts; pass
  `publishPluginOptions.includeDraftItems: true` (body on query/update, query
  param on get/delete) to see/touch them. Datasets and public consumers never
  see drafts — exactly the safety wanted.
- `_publishStatus` CANNOT be flipped via item update (200 but stays DRAFT).
  Publishing a draft happens in the Wix CMS UI — which is the designed human
  step anyway. The pipeline detects publication via a drafts-inclusive query
  (status change → promote `synced_draft` → `synced`). Graduated
  published-on-sync mode needs no flip either: it just inserts without the
  DRAFT marker.
- Media Manager import works: `POST /site-media/v1/files/import` with a
  source `url` → returns Wix media file id + static URL (async,
  `operationStatus: PENDING`). Feed the returned id/URL into IMAGE fields and
  record it in `fp_media_map`.
- **IMAGE and MEDIA_GALLERY values must carry the picture's origin
  dimensions**: `wix:image://v1/<fileId>/<name>#originWidth=W&originHeight=H`.
  Without the fragment Wix accepts the write (the probe above only checked
  that the shape persists) but refuses to render the field: the CMS shows a
  broken image and the site falls back to its editor placeholder. Found on
  the listings engine 2026-09-16 (`LISTINGS_ENGINE_PLAN.md`, "Galleries Wix
  could not show"); the floor plan write-back was fixed 2026-09-18 (migration
  064, `src/lib/floorplans/media.ts`). Gallery entries are written as
  `{type: "image", src, title}`; the legacy collections also carry `alt`,
  `slug`, `fileName` and `settings.{width,height,focalPoint}`, which the CMS
  fills in itself.
- **An imported SVG is vector art, not an image.** Wix files a URL import
  of an SVG with mediaType VECTOR and a file id ending in `.svg`; an IMAGE
  field or MEDIA_GALLERY entry pointing at it renders as the CMS's broken
  slash. Found on The Isles 2026-09-20: every base plan's gallery ended in
  one slash per drawing, because Toll serves its floor plan drawings as
  SVG. The write-back now renders a drawing to a PNG (sharp, 1600 px wide,
  white background), stores it in the `photos` bucket and imports that; a
  vector import cached in `fp_media_map` is re-imported the same way. The
  legacy collections' 43 Lakewood drawings are all JPGs.
- **Every picture is verified with Wix before its row is written**
  (migration 067). After importing, the write-back asks
  `GET /site-media/v1/files/{fileId}` about each fresh import until Wix
  reports it READY as an IMAGE with a size (about half a minute at most),
  records `verified_at`, and leaves out, and forgets, anything Wix failed
  to fetch or filed as something other than an image. A plan whose photos
  all fail verification is not written at all; the approval fails with the
  reason instead.

## Quick move-ins: how Wellen Park and Parrish file them (read 2026-09-19)

Jeff's standard for every site, read from the two legacy `FloorPlans`
collections cached in `fp_legacy_items` (Wellen Park 329 rows, Parrish 829).

- **A quick move-in is its own row.** 130 of Wellen Park's 329 rows and 363
  of Parrish's 829 are quick move-ins; all but two are named by their street
  address (`floorPlanName` = "10694 Tiger Lily Drive").
- **It carries little.** Filled on a quick move-in row: `floorPlanName`,
  `floorPlanPrice`, `builder` + `builder1` (reference), `village` +
  `villages` (reference), one `floorPlanImage`, the dynamic page link and
  `relatedFloorPlanQuickMoveInOnly`. Wellen Park also fills
  `floorPlanDescription` with the builder's own text for that home; Parrish
  leaves it blank. Blank on every quick move-in of both sites: bedrooms,
  bathrooms, garages, square feet, home type, both galleries, the virtual
  tour, the price tags, `quickMoveInAvailable`, the badge and the dot.
- **`relatedFloorPlanQuickMoveInOnly` is the base plan's name, as text**,
  not a reference: "Pearson A", "Bay Breeze". It matches a base plan row of
  the same builder and village by name on 110 of 130 (Wellen Park) and 321
  of 363 (Parrish); the rest are the freelancers' typos and variants
  ("Almafi" for Amalfi, "Terrace - Carolina"), which is why the pipeline
  links by the builder's own plan id first and writes the base plan's exact
  name.
- **The base plan carries the flag and the dressing.** With quick move-ins:
  `quickMoveInAvailable` = true, `newConstructionOrMoveIn` = "QUICK MOVE-INS
  BELOW", `quickMoveInImage` = the badge (`28c2d7_1e474c9af37440efa879388e98
  27b4a9~mv2.png`), `constructionDot` = `d0be81_f345a9c85f234f6b8f240bbdefa0
  ed9b~mv2.png`; without: false, "NEW CONSTRUCTION", no badge, dot
  `d0be81_ad8e51464ee34d4b86f4b80584e8367a~mv2.png`. The four move together
  on every row of both sites (200 plans on Parrish, 66 on Wellen Park). The
  freelancers lag: 62 Parrish and 14 Wellen Park base plans have quick
  move-in rows under them but no flag. The pipeline derives the flag from
  the run, so it cannot lag.
- **Price tags** (`floorPlanPriceTags`, ARRAY_STRING) are one bracket per
  plan: "$200s" through "$900s", "1M+", and "Custom Pricing" on Wellen Park
  for a plan without a price. The pipeline derives them (`priceTagOf`).
- Lakewood's legacy collection has no quick move-in rows at all: 126 plans
  carry the flag and badge with nothing filed under them, and its banner
  text reads "READY FOR MOVE-IN". The Wellen Park / Parrish shape is what
  the pipeline writes on every site.

The pipeline's mapping (`quick-move-ins.ts`, `writeback.ts`): a quick
move-in record carries `relatedPlanKey` / `relatedPlanName`, tied by the
engine's own key, else the builder's plan id (Toll's `masterPlanID`), else
the plan's name; its Wix row is the address, price, builder, village, one
picture, description and `relatedFloorPlanQuickMoveInOnly`. A base plan
record carries `hasQuickMoveIns`, written as the four markers plus the price
tag. Every row also carries the `builder1` and `villages` references,
looked up by name in the collections the site's own V2 schema points at
(Builders, "Toll Brothers"; the neighborhoods collection, "The Isles":
`HousesforSale-DynamicPages` on Wellen Park and Parrish, `AmenitiesbyVillage`
on Lakewood), by exact title first, then by any title or name field of the
collection's items; a name with no item behind it is logged and the row
goes out without the reference. An update reads the Wix item first and sends back the fields
the pipeline does not own, because Wix's update replaces the whole item.
Every row carries `urlSlug` ("URL Slug"), unique per site: the plan's name
with its neighborhood and builder ("lori-the-isles-toll-brothers"), given
on the first write and kept through renames. The V2 dynamic page should
take its address from this field; the legacy collections derived theirs
from `floorPlanName` and the freelancers hand-suffixed duplicates.
A row with a virtual tour link carries its site's button picture in
`virtualTourImageV2` (`site-assets.ts`: the one value the freelancers put on
every legacy row of each site), never the builder's still.

## Schemas compared across sites (2026-09-19)

`scripts/floorplan-wix-schema-snapshot.mjs` (a prebuild step on the working
branch, like the legacy import) caches every active site's collection
schemas (Floor Plans V2, the legacy FloorPlans, Builders, the villages
collection) in `fp_collection_schemas` (migration 066) and the Floor Plans
V2 items in `fp_legacy_items`. The standard itself lives in code:
`src/lib/floorplans/standard-floor-plan-schema.json` (31 data fields with
their keys, types and labels; Jeff, 2026-09-19: labels and field names
identical on every site, "Neighborhood" rather than "Village"). The Hub's
Settings → Sites page reads each site's collection live and diffs it
against the standard: missing fields added and labels aligned with one
click each, extra fields removed only on a separate confirmed click, a
field whose type differs reported and left alone (Wix cannot retype a
field in place; it would have to be dropped and re-created). The snapshot
build applies the standard's labels and missing fields to every site as
well, so no site drifts for long. The rules are in
`src/lib/floorplans/collection-schema.ts`.

Findings from the snapshot of 2026-09-19 19:38 UTC:

- **The three Floor Plans V2 collections are identical**: 38 fields each,
  revision 3, the same keys, types and labels. They were created together
  on 2026-07-02 from the Parrish baseline with the warts fixed, and nothing
  has touched them since but the blueprint gallery field. There is nothing
  for Lakewood's V2 to change toward the other two.
- **Wellen Park's and Parrish's legacy Floor Plans collections are not the
  same.** Parrish has six fields Wellen Park lacks (`estimatedBuildTime`,
  `estimatedUpgradesOrChanges`, `estimatedBuildTimeTags`, `publishDate`,
  `unpublishDate` as TEXT, `score1`), and its `score` is an ARRAY_STRING
  labeled "Status" while Wellen Park's `score` is the NUMBER labeled
  "Score" (Parrish keeps the number in `score1`). Parrish labels `village`
  and `villages` "Neighborhood", Wellen Park "Village". Everything else
  matches key for key, and V2 carries all of it: V2 is Wellen Park's 24
  data fields plus Parrish's three estimate fields, the blueprint gallery
  and `syncKey`, `sourceUrl`, `lastSyncedAt`. Parrish's publish and
  unpublish dates and `score1` were dropped on purpose (Wix's own
  draft/publish state and one numeric `score` replace them). Since
  2026-09-21 the three estimate fields (`estimatedBuildTime`,
  `estimatedBuildTimeTags`, `estimatedUpgradesOrChanges`) are gone from
  the standard and the snapshot build removes them from every site's V2;
  V2 is 29 fields with `urlSlug`.
- **What a person sees differ in the CMS is the labels.** V2's labels are
  the raw keys ("FloorPlanImage", "RelatedFloorPlanQuickMoveInOnly"); the
  legacy collections read "Primary Image", "Primary Image + Rest of
  Images", "Related Floor Plan (Quick Move-In Only)", "Floor Plan Price
  (Tags)". The standard carries those human labels, with "Neighborhood"
  for both village fields on every site and "(Reference)" marking the two
  reference fields apart from their text twins; the snapshot build applied
  them to all three collections on 2026-09-19.
- The legacy collections also carry `link-floor-plans-floorPlanName`, the
  dynamic page link Wix adds when a dynamic page is built on a collection.
  V2 gets its own when its dynamic pages are created in the editor at
  cutover; the API cannot add it.
- The legacy `Builders` collections differ slightly by site (22, 21 and 23
  fields) and the villages collection (`HousesforSale-DynamicPages`) is
  116 to 129 fields wide; both are cached here for the reference fields.

## Supabase seed state

`fp_sites` seeded with the three sites (wix_site_id + legacy_collection_id);
`wix_collection_id` is `FloorPlansV2` on all three since Phase 2. Since
2026-09-20 every site is in `insert_publish_mode = 'published'`: an approval
in the Hub is the publication, and a row still in DRAFT is replaced by a
published item on its next approved write, because an update cannot flip
`_publishStatus` (see above).
