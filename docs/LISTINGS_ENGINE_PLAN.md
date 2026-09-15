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
- ~~MLSGrid licence: one puller feeding multiple display sites, and the
  request rate allowed.~~ Both answered; see Phase 1 findings.

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
- ~~MLSGrid rate question~~ answered by their documentation (2/s, 7,200/hour,
  4 GB/hour, 40,000/day; see Phase 1 findings). ~~Licence question~~ Jeff
  confirmed 2026-09-14 that one puller may feed several display sites, and
  already does.

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
    client and the probe send both.
- **Second real run** (preview build, 2026-09-14 21:34 UTC; 56 Wix calls,
  no 429, no 5xx):
  - insert keyed by `MFRENGINEPROBE001`: 96 ms, the `_id` comes back
    unchanged; read 57 ms with the 20-item gallery and `listingPrimaryImage`
    carrying the imported `wix:image://` URI; full update 93 ms and the
    re-read shows the new price and a new `_updatedDate`;
  - DATETIME values sent as `{ "$date": iso }` are accepted and read back as
    `{ "$date": ... }`, so that is the form the engine uses;
  - one-at-a-time inserts: 10 of 10, median 87 ms, max 106 ms, so a 330-row
    reconcile that way is about 30 s and 330 requests;
  - bulk, 50 realistic rows (453 KB per call): insert 204 ms, update 248 ms,
    save of 50 existing + 5 new 313 ms (50 UPDATE, 5 INSERT, ids kept),
    remove of 65 172 ms; a query sees all 50 straight after the insert;
  - 20 parallel reads: all 200, 108 ms wall, median 75 ms;
  - `HousesforSale2` and the live collection both carry the PUBLISH plugin
    (default status PUBLISHED) and the EDITABLE_PAGE_LINK plugin; both read
    ANYONE, insert/update SITE_MEMBER, remove ADMIN.
  - Gate 1 of the sequence is now Jeff's check: bind a hidden dynamic page
    to `HousesforSale2` and open `MFRENGINEPROBE001`, which the probe leaves
    in place.
- **Live galleries** (read-only peek, 2026-09-14 21:47 UTC): across five
  sampled live listings, all 316 gallery items carry an `mlsSourceUrl` on
  `media.mlsgrid.com` in the signed form, and every one ends in
  `/images/<ListingId>/<uuid>.jpeg`. So seeding `ls_site_media` from the live
  galleries is a parse of that tail, and the sampled galleries had all been
  re-uploaded since 2026-09-08, which is the churn described above. The
  stored URLs themselves are long expired; the engine keeps only the tail.
- **MLSGrid subscription** (usage dashboard, 2026-09-14): Stellar MLS, IDX,
  5 active licences, API access active and "in good standing". One puller
  feeding several display sites is allowed and is how the account already
  runs (Jeff, 2026-09-14).
- **MLSGrid caps** (their documentation, "Rate Limits"): no more than
  2 requests per second at any time, 7,200 requests per hour, 4 GB
  downloaded per hour, 40,000 requests per 24 hours. Exceeding them in under
  an hour suspends the token (every request answers 429 until usage falls
  back inside the caps); warnings go to the primary contact's email. The
  Velo pipeline's spikes to 3 and 4 requests/s were over the first cap.
- **MLSGrid media regime** (their documentation, effective 2026-09-08):
  Media is served from `media.mlsgrid.com` as
  `https://media.mlsgrid.com/token=...&expires=...&id=.../images/<ListingId>/<uuid>.jpeg`.
  Each URL is signed, expires one hour after the record was retrieved, and
  allows one download; a second download, or a fresh URL for the same media
  inside that hour, answers 429. Consumers must keep their own copy of every
  file and must never serve or store MLS URLs. Consequences:
  - decision 4 is not optional: download each photo once from MLSGrid, store
    it in Supabase Storage, and let every Wix site import from the stored
    copy (exactly the path phase 1 verified). Wix can never import straight
    from an MLS URL, since Wix's fetch would spend the single download;
  - `ls_listing_media.path_key` is the stable tail `images/<ListingId>/<uuid>.<ext>`;
    the signed URL is kept only until the download succeeds and never
    longer than its hour;
  - a failed download cannot be retried inside the hour; `retry_after` on
    the media row holds the next allowed attempt;
  - fetch media URLs just in time: the photo job re-reads listings in
    batches sized to what it can download within the hour at 2 requests/s
    (about 50 listings, 1,500 photos, 12 minutes), instead of pulling every
    URL up front and letting most expire;
  - an initial seed for a large site (Lakewood Ranch at ~1,000 listings and
    ~30,000 photos, ~9 GB) paces at the caps to roughly 7,000 photos an hour
    over half a day, which is why seeding `ls_site_media` from the live
    galleries first matters;
  - the Velo pipeline keys photos by MLS URL (`mlsPhotoKey` in `diff.jsw`),
    so since 2026-09-08 every pull presents every photo as reissued; check
    `SyncEvents` for "photo URLs reissued by MLS" update messages, because
    that is re-uploading whole galleries on each change and burning the
    single downloads.
- **MLSGrid record semantics** (their documentation): `ModificationTimestamp`
  is the time the Grid converted the record and is the incremental
  watermark; `OriginatingSystemModificationTimestamp` is the MLS's own
  time (stored too, for display). All data dictionary dates are UTC.
  `MlgCanView` false means remove the record; records carry only the fields
  their source MLS filled. Replication only; no real-time queries.
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
    can show usage against the documented caps (2/s, 7,200/hour, 4 GB/hour,
    40,000/day).

## Phase 2 build notes (2026-09-14)

What landed with the engine core (PR after #280), and the decisions taken
while porting `runSync`.

- **Where it lives.** `src/lib/listings/`: `mlsgrid.ts` (OData client, one
  request in flight, 600 ms spacing, 429 stops the run), `normalize.ts`
  (record → `ls_listings` row + photo identities by path key, signed URLs
  stripped from the stored raw record), `classify.ts`, `transform.ts` (the
  `HousesforSale` record and its fingerprint), `villages.ts` (import from the
  Wix `Villages` collection), `media-seed.ts` (read the live galleries once,
  reuse their Media Manager URIs), `runs.ts` (runs + events), `reconcile.ts`
  (the run), `tick.ts` (the cron decision). Routes: `GET /api/cron/listings-tick`
  every 15 minutes (`vercel.json`), `POST /api/internal/listings/run`,
  `.../villages/import`, `.../media/seed`, `GET .../status`. The internal
  routes accept the dashboard session, `ADMIN_API_KEY` or `CRON_SECRET`.
- **Off by default.** `system_settings.ls_engine_enabled` is false, so the
  cron tick does nothing until it is switched on; the run route works
  regardless (it is the "run now" button). Longboat Key's `ls_sites` row is
  `write_mode = shadow`, target `HousesforSale2`; the engine refuses to write
  when a non-live site's target is its live collection (the database check
  forbids that row too).
- **Which records are stored.** The hourly pull is MLS-wide, so a record is
  kept only when it is in some site's `market_cities` or the engine already
  holds it (a held listing that moves city, changes status or loses
  `MlgCanView` still reaches the site showing it). Everything else is
  dropped unread; `fetched` and `relevant` are both reported.
- **Watermark and windows.** An incremental run pulls from the newest
  incremental run that finished complete (`stage = done`), minus two minutes
  of overlap; a truncated run (page cap or deadline) leaves the watermark
  where it was. The window is clamped to 24 hours with a `gap` warning; the
  nightly full run (after 03:00 UTC) verifies every held id at 50 a request
  and marks what MLSGrid no longer returns `not_in_feed`. After a run fails
  the tick waits 30 minutes before trying again, so a suspended MLSGrid token
  is not hammered.
- **Writes.** A site's rows are written with `bulkSaveItems` in chunks of 200
  keyed by `_id = ListingId`; live rows are rewritten only when the record's
  fingerprint changes or `dateOfMlsPull` is older than 12 hours. Removals go
  through the mass-delete guard: a full run that wants to remove max(10, 10 %)
  of the site's live rows removes nothing and records the candidates
  (`mass_delete_guard` error event); an hourly run holds back only the
  data-driven reasons (city, village, display rights, feed) at that
  threshold. `POST /api/internal/listings/run` with `allowMassDelete: true`
  applies a reviewed batch.
- **Photos in phase 2.** No downloads from MLSGrid yet. `media-seed.ts` keys
  every live gallery item by its MLS path and records the site's existing
  `wix:image://` URI, so a listing already on the site is written to the
  shadow collection with the photos the site has. Because the Velo pipeline
  re-uploads galleries and trashes the replaced files, every run of a
  shadow-mode site re-reads the live galleries first and a seeded URI follows
  the live one (rows the engine imports itself, from phase 3, are never
  touched). A listing with no photo the site holds stays `staged` (reported
  as `waitingForPhotos`); a partial gallery is written and the row keeps
  `gallery_ready = false` for the phase 3 photo job.
- **State meaning and cutover.** `ls_site_listings.state = live` means
  "written to the site's target collection", shadow or live. Cutover is the
  `ls_sites` edit the plan describes plus nulling `written_at` /
  `written_fingerprint` on the site's rows, so the first live run rewrites
  every listing into `HousesforSale`.
- **Verification.** `scripts/listings-engine-phase2.mjs` runs on every push
  of the engine branch as a prebuild step (or anywhere with `LS_PHASE2_RUN=1`)
  and drives `scripts/listings-engine-phase2.ts` under `tsx`: census of the
  live and shadow collections, village import, media seed, a full run and a
  bounded incremental run (skipped unless `MLSGRID_API_KEY` is enabled for
  the Vercel Preview environment, since the build on the engine branch is a
  preview build), a shadow-vs-live comparison by `_id`, and a snapshot of the
  engine's rows, runs and warn/error events. `LS_PHASE2_RESET_SHADOW=1` empties
  the shadow collection first (never the live one).
- **No row transfer needed.** The shadow collection does not need the live
  rows copied in: the media seed reads the live galleries and the first full
  run verifies every seeded id against MLSGrid and writes the eligible ones
  to `HousesforSale2` itself.
- **First runs against the shadow collection** (preview builds, 2026-09-15
  00:58 to 01:03 UTC, `MLSGRID_API_KEY` enabled for Preview):
  - village import: 105 villages, 111 terms, no conflicts; media seed: 202
    live listings, 10,178 gallery photos, all keyed by their MLS path;
  - full run: 203 held ids verified in 5 MLSGrid requests (7.0 MB), 202
    eligible, 200 written to `HousesforSale2` in 5 Wix requests with no
    failures, 21 s end to end. The first attempt had failed its 200-item bulk
    save with WDE0109 "Payload is too large" (about 5 MB of galleries), so
    the bulk writer now chunks by bytes (800 KB) and halves a chunk Wix
    still refuses;
  - incremental runs: a 2-hour window was 752 MLS-wide records in 4 requests
    (19.8 MB, about 26 KB a record); a 6-minute window was 299 records in 2
    requests (6.3 MB). Neither held a Longboat Key record, so nothing was
    stored from them. The 40-page cap bounds a run at 8,000 records;
  - shadow vs live: 203 items in the shadow collection (202 plus the phase 1
    probe item), and all 202 live listings identical on address, village,
    price, status, bedrooms, bathrooms, primary image and gallery length.
    Gate 2's comparison is therefore green on day one; the seven clean
    nights need the engine switched on after the merge.
- **Hub Listings section** (built right after the phase 2 merge): the
  sidebar's Listings entry opens three pages. Overview: the engine switch,
  run-now buttons (incremental, full verify), a card per site with its write
  mode, target collection and counts by state, pause/resume writes, an
  "apply held removals" button that appears when the guard has held a
  batch, the newest 24 runs and the newest 50 warnings and errors. Events:
  every event, filterable by site, level, kind, run and listing id (the
  listing lookup). Villages: per site, each village with its terms as chips,
  add/remove a term (street qualifier optional; a clash names the owning
  village), add/edit/deactivate/delete a village (delete only when nothing
  points at it), and a re-import from the site's Wix Villages collection.
  Every edit applies on the next run. Cutover to live is not in the UI: it
  stays an `ls_sites` edit gated to Jeff.
- **Deferred to the next phases.** The nightly shadow-vs-live comparison as
  a job (the verification script has the comparison), writing village counts
  to the Wix village pages (Postgres only until a site is live), and the
  photo pipeline.
- **Needs from Jeff.** ~~`MLSGRID_API_KEY` in the Vercel environment (Preview
  and Production); it lives in Wix Secrets on the Longboat Key site today.~~
  Added 2026-09-14; from then on the verification build runs the full and
  incremental pulls against the shadow collection on every push.

