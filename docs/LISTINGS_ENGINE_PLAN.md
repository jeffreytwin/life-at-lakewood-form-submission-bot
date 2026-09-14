# Listings Engine — Build Plan and Hand-off

Moves the MLSGrid listings sync out of each Wix site's Velo backend and into
one engine in this repo, controlled and monitored from the Hub. Starts with
Longboat Key (lifeinlongboatkey.com), built for twenty sites.

Prepared 2026-09-14 from the session that built the current Longboat Key
sync. Reference implementation: https://github.com/jeffreytwin/lifeinlongboatkey-listings
(public). Sister plan: `docs/FLOOR_PLAN_SYNC_PLAN.md`, which this follows
deliberately.

---

## Decisions locked

1. **Wix keeps rendering; the engine decides.** Each site keeps `HousesforSale`,
   `Villages`, `HousesforSale-DynamicPages` and its dynamic pages. Everything
   that decides what a listing is, whether a site shows it, and what changed
   moves here. A site is a row in `ls_sites` plus the account-level Wix API key.
2. **Shadow collection per site, cutover is a one-row edit.** The engine writes
   to a shadow collection with the live collection's fields (`HousesforSale2`
   on Longboat Key, created 2026-09-14; admin-only) until it has proven
   itself. `ls_sites.target_collection_id` and `ls_sites.write_mode`
   (`shadow` | `live` | `paused`) are the switch. Rollback is the same edit
   the other way. Same pattern as floor plans' "new private collection, cutover
   = re-bind".
3. **No Stagging on Wix.** Staged state lives in Postgres. A record is written
   to a collection only when its photos are already imported.
4. **Photos are downloaded from MLSGrid once, stored once, imported per site.**
   Same dedupe pattern as `fp_media_map`. The media map is seeded from the
   live galleries first (each gallery item carries `mlsSourceUrl`; the path
   after the token is stable across MLS token rotations), so cutover moves no
   media.
5. **Villages: content stays in Wix, terms move to the Hub.** One village, a
   list of subdivision terms, edited in the Hub Listings section, applied on
   the next run. Longer term wins when two villages' terms both match.
6. **Same record identity as today.** Wix `_id` is the MLS `ListingId`
   (e.g. `MFRA4670555`), so the first live run is an upsert, not an insert
   flood that trips the mass-delete guard.
7. **Longboat Key Velo code is frozen.** Nothing else ships there before
   cutover.

## Target architecture

```
MLSGrid ──► Engine (this repo, Vercel cron tick) ──► Postgres (ls_ tables)
                                                        │
                       Wix Data + Media REST ◄──────────┘
                       (one API key, wix-site-id header)
                                │
                       Wix sites: HousesforSale, Villages, dynamic pages
```

Hub reads runs, events and alerts from the same tables. No health feed.

## What the Hub already provides (verified 2026-09-14)

- **Runtime pattern:** `vercel.json` crons; `src/lib/floorplans/nightly.ts`
  runs a 15-minute tick with `TICK_BUDGET_MS = 240_000` inside
  `maxDuration = 300`, resuming a cycle across ticks. The listings engine uses
  the same shape: an hourly-ish tick that pulls MLSGrid once and works a job
  queue (classify per site, photos per listing, writes per site) until its
  budget is spent.
- **Wix client:** `src/lib/wix/client.ts` exports `queryItems`,
  `queryAllItems`, `getItem`, `insertItem`, `updateItem`, `removeItem`,
  `importMediaFromUrl`. Auth is `WIX_API_KEY` (account-level) plus
  `wix-site-id`. Gallery fields take `wix:image://v1/<fileId>/<name>` URIs
  (see `src/lib/floorplans/writeback.ts` `importGallery`).
- **Sites:** `docs/WIX_COLLECTIONS.md` has site IDs for Lakewood, Wellen
  Park and Parrish. Longboat Key's site ID is still needed, and it must be in
  the same Wix account for the key to cover it.
- **Migrations:** `supabase/migrations/`, numbered; next is 040.
- **Dashboard:** `src/app/dashboard/*` sections (agents, audit, email-hub,
  floor-plans, leads, locations, settings, ...). Listings becomes a sibling.
- **Audit:** `audit_log` table exists; village term edits and cutover edits
  should write to it.

## What still needs verifying (phase 1)

- Longboat Key site ID and account membership.
- Bulk write behaviour and rate limits of the Wix Data API on a 330-row
  full reconcile. The client today is one-item-at-a-time; add bulk
  insert/update (up to 1000 per call) and measure.
- MLSGrid licence: one puller feeding multiple display sites, and the
  request rate allowed. Jeff is asking MLSGrid in writing.

## Data model (`ls_` prefix, same Supabase project)

| Table | One row per | Carries |
|---|---|---|
| `ls_sites` | Wix site | name, domain, `wix_site_id`, `target_collection_id`, `live_collection_id`, `villages_collection_id`, `write_mode`, active, timezone |
| `ls_villages` | village per site | name, Wix slug + item id, active, `active_listing_count`, `zero_since` |
| `ls_village_terms` | subdivision term | village, term (matched case-insensitively as "subdivision contains term") |
| `ls_listings` | MLS listing | normalised MLSGrid record, `standard_status`, city, subdivision, `modification_timestamp`, `mlg_can_view`, raw JSON |
| `ls_listing_media` | photo | listing, order, MLSGrid source URL, stable path key, content hash, storage path |
| `ls_site_listings` | listing × site | state (`staged` \| `live` \| `removed`), village, `wix_item_id`, last reason code, gallery readiness |
| `ls_site_media` | photo × site | `wix_media_id` after import |
| `ls_sync_runs` | run | today's SyncRuns columns plus site scope |
| `ls_sync_events` | event | today's SyncEvents columns plus site id |

## What ports, what is rewritten, what retires

From `backend/sync/` in the Longboat Key repo (about 5,800 lines of Velo):

| Today | Fate | Notes |
|---|---|---|
| `mlsgrid.jsw` | port | OData client. `wix-fetch` → `fetch`. Filter `OriginatingSystemName eq 'mfrmls'`, `$expand=Media`, verify-by-id in batches. Watermark = newest ok incremental run. |
| `diff.jsw` | port | `galleryDiff`, `describeGalleryDiff`, `changeReasons`, `planIncremental`, `planFull`, `planUnstage`. Pure. |
| classify (in `pipeline.jsw`) | port | status / property type / `MlgCanView === false` / city / village. Reason codes: `status_change`, `property_type`, `no_village`, `city_change`, `mls_revoked`, `not_in_feed`, `manual_refresh`. |
| `events.js`, `health.js`, `retention.js` | port | event kinds, alert codes, `RUNS_RETENTION_DAYS=90`, `EVENTS_RETENTION_DAYS=30`, `KEEP_NEWEST_RUNS=50`. |
| mass-delete guard (`pipeline.jsw`) | port | skip deletes ≥ max(10, 10 % of inventory) unless forced; `MASS_DELETE_BLOCKED` alert. |
| `media.jsw`, `stagging.jsw` | rewrite | becomes the photo job. Everything about cooldowns, fan-out, late children exists only because of Wix's 59 s limit. |
| `pipeline.jsw` orchestration | rewrite | job queue with retries; keep the run record. |
| `villages.jsw`, `villages.seed.jsw`, `village-stats.jsw` | rewrite | `ls_villages` + `ls_village_terms`; active counts are one SQL query written to the site's Villages collection. |
| `run.jsw`, `jobs.config`, `http-functions.js` | retire | scheduler and manual entry points move here; Hub buttons replace the Wix test panel. |
| `ads-feed.jsw` | rewrite | serve `adsInventoryFeed` for all sites from `ls_villages`. |
| Wix secrets, `Stagging`, `SyncRuns`, `SyncEvents` collections | retire | after cutover. |

Acceptance tests: `test/harness/` in the Longboat Key repo (44 Node
scenarios against in-memory Wix mocks) describe the expected behaviour of the
ported modules. Run with `test/harness/build.sh && node test/harness/test.mjs`.

### `HousesforSale` field shape

Authoritative source: `transformListing` in `backend/sync/pipeline.jsw`. The
pages read (non-exhaustive): `_id` (ListingId), `mls`, `propertyAddress`,
`streetAddress`, `city`, `postalCode`, `subdivision`, `village`, `villageLink`,
`villageSortHelp`, `homeType`, `standardStatus`, `mlgCanView`, `listingPrice`,
`listingPricePure`, `listingPriceSort`, `bedrooms`, `bathrooms`,
`bathroomsSort`, `garages`, `squareFeet`, `lotSize`, `propertyDescription`,
`listingPrimaryImage`, `listingImageGallery` (items `{ src, mlsSourceUrl,
title }`), `virtualTourUrl`, `listingAgentName`, `listingAgentCompany`,
`listingAgentPhone`, `listingAgentMls`, `listingBrokerageContactInformation`,
`propertyAddressGoogleMaps`, `location`, `dateOfMlsPull`,
`mlsModificationTimestamp`, `published`.

### Event kinds and alert codes (carry over unchanged)

Kinds: `insert`, `update`, `delete`, `unstage`, `restage`, `promote`,
`photos_failed`, `photos_recovered`, `rehydrate`, `promote_failed`,
`write_failed`, `mass_delete_guard`, `stats_failed`, `sweep_failed`, `budget`,
`gap`, `run_error`, `events_dropped`, `purge`.

Alerts: `NO_RECENT_RUN`, `RUN_INCOMPLETE`, `REPEATED_FAILURES`,
`NO_RECENT_FULL_RUN`, `MASS_DELETE`, `MASS_DELETE_BLOCKED`, `STAGGING_STUCK`,
`STAGGING_NO_PHOTOS`, `PHOTOS_FAILING`, `EVENTS_NOT_STORED`,
`STALE_PULL_DATES`, `STATS_STALE`, `FEED_TRUNCATED`, `MISCONFIGURED`,
`SITE_IDENTITY_MISMATCH`, `ZERO_INVENTORY`, `MLSGRID_VOLUME_HIGH`, `SLOW_RUN`.
The drain-specific ones retire with the drain. Full contract:
Longboat Key repo `README.md` → Monitoring.

## Hub Listings section

- Per-site health card (last run, last full run, counts, open alerts).
- Run list and event timeline, filterable by site, level, kind, listing.
- Listing lookup: every event for one `ListingId`.
- **Villages:** pick a site; villages with their terms as chips; add / edit /
  remove a term; add / rename / remove a village (name + Wix slug). Saves apply
  on the next run. No preview, no unmatched queue in v1.
- Operator buttons: run now, apply a blocked mass delete, recopy a gallery,
  pause a site. Cutover and rollback are edits to `ls_sites`, gated to Jeff.

## Sequence and gates

1. **Verify foundations** (Longboat Key): site ID + account; API-key writes to
   `HousesforSale2` render on a hidden dynamic page; media import from
   Supabase Storage returns a gallery-usable ID; bulk write limits measured;
   MLSGrid licence answered. *Gate: a listing written by API is visible on a
   Longboat Key page.*
2. **Engine core → shadow collection.** Migration 040+, puller, classify with
   terms imported from the site's Villages collection, runs/events, cron tick,
   Hub Listings section including the villages editor. Nightly shadow-vs-live
   comparison (by `_id`; galleries by source path and count). *Gate: seven
   consecutive clean nights.*
3. **Photo pipeline.** Seed `ls_site_media` from live galleries, then
   download/hash/store/import only new photos with one global concurrency cap.
   *Gate: every live gallery has matching imported media IDs.*
4. **Cutover Longboat Key.** Edit the `ls_sites` row; disable Wix jobs the same
   hour; Velo backend idle one week as rollback; then delete it and the
   `Stagging` / `SyncRuns` / `SyncEvents` / shadow collections.
5. **Onboard Lakewood Ranch, Wellen Park, Parrish.** Collections + dynamic
   pages, villages import, `ls_sites` row → shadow → live. No code.
6. **Retire the rest.** Ads feed from the engine; archive the Longboat Key repo.

## Open items on Jeff

- ~~Longboat Key `wix-site-id`~~ `8b20e921-5b70-4428-8fcd-8c8ef3bad3ab` (dashboard URL,
  2026-09-14); the probe confirms the account key reaches it.
- ~~Create the shadow collection on Longboat Key (duplicate without data,
  admin-only permissions).~~ Done 2026-09-14 as `HousesforSale2`.
- MLSGrid licence + rate question, in writing.

## Kickoff prompt for the build session

> Read `docs/LISTINGS_ENGINE_PLAN.md`. Start phase 1 against Longboat Key:
> add bulk insert/update to `src/lib/wix/client.ts`, write a verification
> script in `scripts/` (same style as `floorplan-wix-phase2.mjs`) that
> queries `HousesforSale_Engine`, inserts and updates a test item keyed by a
> fake ListingId, imports one image from a Supabase Storage URL into that
> site's Media Manager, and reports timings and any rate-limit responses.
> Then draft migration 040 for the `ls_` tables. Open a draft PR; do not
> touch live collections.

## Phase 1 findings (2026-09-14)

Recorded from the build session (PR #280) so the numbers outlive the chat.

- **Site id.** `8b20e921-5b70-4428-8fcd-8c8ef3bad3ab`, the UUID in the site's
  manage.wix.com dashboard URL; built into the probe as its default and
  seeded into `ls_sites`.
- **Shadow collection.** Created on Longboat Key as `HousesforSale2`, not the
  `HousesforSale_Engine` this document assumed. `ls_sites.target_collection_id`
  defaults to it; the probe reports whether its fields match the live
  collection.
- **Wix side.** The Wix Data bulk endpoints take up to 1000 items per call
  and honour a caller-supplied `_id`, so a full reconcile is one request
  rather than one per row; Wix documents 200 requests/minute per app
  instance. `src/lib/wix/client.ts` has the bulk methods;
  `scripts/listings-wix-phase1.mjs` measures them from the Vercel build log
  on every push to its branch.
- **First real run** (preview build, 2026-09-14 21:30 UTC):
  - the account key reaches the site; live `HousesforSale` ("Houses for
    Sale") has 38 fields and 202 items, permissions read ANYONE,
    insert/update SITE_MEMBER, remove ADMIN;
  - `HousesforSale2` matches it field for field and carries the PUBLISH
    plugin (default status PUBLISHED); a query with
    `publishPluginOptions.includeDraftItems` is accepted;
  - media import from a Supabase Storage URL: accepted in 0.6 s, READY
    after 3.4 s, file id `d0be81_...~mv2.jpg`, gallery URI built;
  - a keyed write must send `dataItem.id` equal to `data._id`, otherwise
    Wix answers WDE0080 "dataItem id and data._id fields must match". The
    client and the probe now send both; the item and bulk timings come from
    the next run.
- **MLSGrid subscription** (usage dashboard, 2026-09-14): Stellar MLS, IDX,
  5 active licences, API access active and "in good standing". The numeric
  caps are not shown on the dashboard; the written answer on one puller
  feeding several display sites is still open.
- **MLSGrid usage today** (Longboat Key's Velo pipeline, one site, hourly
  log 2026-09-11 to 09-14, times ET):
  - steady state, last 24 h: 83 requests, 308 MB, average max 1.5 requests/s,
    peak 3;
  - a daytime hour is 3-6 requests and 10-27 MB: the hourly incremental pulls
    every Stellar record modified in the window, MLS-wide (PostalCity is not
    filterable server-side), 200 per page with Media expanded, about 5 MB and
    25 KB per listing a page;
  - the nightly full at 23:00 ET is 7 requests and 36 MB: ~330 ids verified
    at 50 per request;
  - 09-11 19:00 to 09-12 06:00 had seven hours of 20-29 requests and 100-130 MB
    each: pulls of roughly 5,000 MLS-wide records, i.e. an incremental whose
    window had grown past an hour (or a manual full), around 1 GB that day;
  - the dashboard colours a max of 4 requests/s amber (3 stayed green), so the
    comfortable ceiling is 3 requests/s or less; the 4 came from parallel
    hydrate calls during a drain.
- **What that means for the engine.**
  - One puller for every site costs the same incremental as today's single
    site, because that pull is already MLS-wide. Only the nightly verify-by-id
    grows with total inventory (one request per 50 listings across all sites),
    and photo downloads go to the media host, not the API.
  - One MLSGrid request in flight at a time, pages fetched sequentially with a
    short gap, so the engine never exceeds 2 requests/s; no parallel hydrates.
  - Bound the incremental window. When the last ok pull is old, page the
    modified set with a hard cap and fall back to verify-by-id for the sites'
    inventory instead of re-pulling thousands of MLS-wide records every hour.
  - Keep `mlsgrid_request_count` and `mlsgrid_bytes` on every run so the Hub
    can show usage against whatever caps MLSGrid confirms in writing.
