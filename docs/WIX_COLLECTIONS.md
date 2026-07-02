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

All three sites also carry `Builders` and a villages/neighborhoods collection
(`HousesforSale-DynamicPages`: "Dynamic Village Pages" on Lakewood,
"Neighborhoods" on Wellen/Parrish) that the Floorplans reference fields point at.

Key API facts confirmed:
- One account-level API key + `wix-site-id` header works across all three sites.
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

## Supabase seed state

`fp_sites` seeded with the three sites (wix_site_id + legacy_collection_id),
all in `insert_publish_mode = 'draft'`. `wix_collection_id` stays NULL until
the new standardized collections are created in Phase 2.
