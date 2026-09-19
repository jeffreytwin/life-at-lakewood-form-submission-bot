# Listings Engine — Build Plan and Hand-off

Moves the MLSGrid listings sync out of each Wix site's Velo backend and into
one engine in this repo, controlled and monitored from the Hub. Starts with
Longboat Key (lifeinlongboatkey.com), built for twenty sites.

Prepared 2026-09-14 from the session that built the current Longboat Key
sync. Reference implementation: https://github.com/jeffreytwin/lifeinlongboatkey-listings
(public). Sister plan: `docs/FLOOR_PLAN_SYNC_PLAN.md`, which this follows
deliberately.

---

## Where things stand, and the next session's kickoff (2026-09-18, 00:10 UTC)

Written at the end of the session that cut Parrish over, onboarded Wellen
Park, found three separate bounds the full run did not have, and prepared
Life At Lakewood. The 2026-09-16 hand-off it replaces is preserved in git
history.

**Four sites, two live.**

| site | mode | rows | notes |
|---|---|---|---|
| Life in Longboat Key | **live** | 197 live → 208 | since 2026-09-16; **shows new construction** from 061 |
| Life At Parrish | **live** | 276 live, 276 gallery_ready | cut over 19:36 UTC on the 17th |
| Life in Wellen Park | shadow → `HousesforSale2` | 156 written, 10,829 photos | backfill complete; cross-checked against Redfin, see below |
| Life At Lakewood | **inactive**, shadow when switched on | — | seeded 2026-09-18; waiting on the probe |

`needs_write` is 0 on both live sites and there are no open errors anywhere.

**Parrish is done, and its requirement was met.** Every image on every
listing is one the engine downloaded from MLSGrid and imported into
`ParrishListingPhotos`: all 14,030 `ls_site_media` rows are
`origin = 'imported'`, none seeded, because the old galleries carried no
`mlsSourceUrl` for the seed to adopt. The six stale rows the hand-run
process left were deleted after the flip. **Step 7 is the only thing
outstanding: around the 24th, trash the old Media Manager folders and
`HousesforSale2`.** Keep Jeff's `HousesforSale` export until then — with no
Velo pipeline to re-adopt the collection, that export plus those folders are
the only rollback Parrish has. Full runbook: "Cutover runbook: Life At
Parrish" below.

**Wellen Park is mid-backfill.** Discovery completed (111,026 Active
listings scanned MLS-wide, 6,164 now held). `WellenParkListingPhotos`
resolved — that was the probe's last open question and the name was right,
so `scripts/listings-wellen-probe.mjs` was never needed and never ran.
Photos are importing. The terms were checked against an export of the live
`HousesforSale`: **all 153 rows match a village**, and migration 056 fixed
the one that did not (see "Wellen Park switched on" below; `preserve` alone
was sweeping in Englewood's Hammocks and Grande Preserves).

### The full run's three bounds — all three fixed and proven

Tonight the full run hit three separate limits, each hiding behind the last:

1. **The fetch had no cursor.** `loadKnownListingIds` always restarted at the
   top, and `lastFullDate` only advanced for an untruncated run, so a set too
   big for one budget retried every five minutes until midnight UTC. Fixed by
   `FullCursor` (PR #325).
2. **The pass had no size cap.** The fetch turned out to be the *cheap* half:
   all 6,164 ids came back in 124 requests inside the fetch budget — 134 MB —
   and the invocation was killed at `upsert`. Fixed by
   `FULL_VERIFY_MAX_LISTINGS = 1500` (PR #326).
3. **The stale-media query got slow.** With the cap in place the first pass
   succeeded (1,500 verified, cursor saved) and the second died on
   `load listing media: canceling statement due to statement timeout
   (57014)`. `ls_listing_media` had grown to **179,170 rows / 163 MB** as
   Wellen Park's three cities landed, and `replaceListingMedia` ordered its
   stale sweep by `id` while the index is on `(listing_id, path_key)` — a
   sort of every matched row, on every page. Measured on production: 486 ms
   with a top-N heapsort versus **1.5 ms** as a merge join off the index.
   Fixed by ordering to match the index (PR #327).

**It works.** With #327 deployed, the 22:41 pass cleared `upsert` in about 24
seconds — the stage that had killed the 22:30 run — and finished
`ok · truncated` in 140s. The cursor advanced `MFRA4701053` →
`MFRC7528816` → `MFRN6144585`, 4,500 of 6,164 verified, 1,664 left. Each
pass costs about 2.5 minutes, so the cycle finishes on its own.

The run row's two-level trail (`status` plus `stage`) diagnosed all three of
these without a single log dive. That is worth keeping in mind as the next
site adds another few thousand listings to the same nightly.

**One thing the cursor does not cover, found while watching this:** a Hub
"Run Full" calls `runReconcile` directly and never touches
`ls_engine_state`, so a successful Hub run leaves `lastStatus` on whatever
the last *cron* run set. After a failure that means the tick keeps sitting
out its 30-minute `RETRY_AFTER_ERROR_MINUTES` backoff even though the work
has since succeeded by hand. Harmless — the next due incremental clears it —
but it is why "press the button again" and "wait for the cron" are not the
same thing after an error.

### The fourth bound, and the one that was not a query at all

Two hours after the third bound was fixed, Jeff: *"An update stopped early
while saving to Wix. This has happened several times."* Two more statement
timeouts, twenty minutes apart, in two different queries:

- **01:36, stage `write`** — `load galleries`. The same mistake as PR #327,
  two hundred lines away in the same file, missed when its sibling was
  fixed. `loadSiteGalleries` ordered `ls_listing_media` by `id` against an
  index on `(listing_id, path_key)`.

  Worse than #327 because the predicate differs. With a literal 200-id list
  the planner does not sort at all — it walks the **primary key** and filters
  each row against the list: **4,479 ms** for the first page, discarding
  15,901 rows to return 1,000, and deepening on every `OFFSET` page after
  that. Ordered to match the index it is **804 ms at the ninth page**. Four
  more paginated reads over the two big tables had the same bug and were
  fixed with it. (PR #329.)

- **01:45, stage `photos`** — `load photo backlog`. `ls_photo_backlog` built
  each row's `site_ids` with a correlated subquery over a materialised CTE,
  which carries no index: 4,375 loops over 6,001 rows. Replaced with one
  hash aggregate (migration 059), checked row-for-row against the old
  function first — 4,347 rows both ways, zero difference.

**The lesson is the third item, which was not code.** `ls_site_media` had
not been autovacuumed in **eleven hours**, through the entire Wellen Park
import, because autovacuum's default trigger is 20% of the live rows and at
28,000 rows that is ~5,600 dead tuples. Its index-only scan was doing 9,064
heap fetches — an index-only scan that is not index-only. A manual `VACUUM`
took that to 107 and the function from 2.7 s to 0.83 s.

Which means: **of the three changes made that hour, the vacuum did the most
work and the clever one did the least.** At today's size the 26 million
comparisons were not the dominant cost. The rewrite still earns its place —
it is the only term that grows as the *square* of the backlog — but the
honest ordering matters, because the reflex was to go looking for a bad
query and the bad query was only half the answer.

**And a mistake worth recording.** The `ALTER TABLE ... autovacuum_*`
statements were written into migration 059 *after* the migration had already
been applied, so they never reached production and `reloptions` stayed null.
The manual vacuum wore off inside forty minutes, and the backlog timed out
once more at 02:40 before the settings went out separately as
`listings_media_autovacuum_tuning`. Appending to a file that has already
been applied applies nothing; check `pg_class.reloptions` (or whatever the
statement was supposed to change) rather than trusting the file.

**Still ahead of the timeout, but next in line:** building `lacking` is now
the dominant cost in that function — a nested loop over `ls_listing_media`
for every staged or live listing, ~33,000 buffers today. Linear rather than
quadratic, so not urgent, but Lakewood's three cities would multiply it.

### Life At Lakewood: seeded, deliberately not switched on

The fourth site and the biggest by every measure — 404 listings in its live
collection, 39 neighborhoods, and a market of Lakewood Ranch, Bradenton and
Sarasota. Migrations 057 (site row, **inactive**) and 058 (neighborhoods and
terms) are applied; `HousesforSale2` and `LifeAtLakewoodListingPhotos`
already exist, Jeff created both on the 17th.

**Everything is ready except the one check that matters, and that check is
the reason this site did not get switched on the way Wellen Park did.**

Wellen Park proved that transcribing a dashboard's terms literally is unsafe:
the same word that *sorted* an already-chosen listing into a neighborhood
becomes, in the engine, the *filter* deciding whether the listing is the
site's at all. Migration 056 is what that cost. This site leans on the same
pattern far harder, so the terms were rebuilt rather than transcribed:

- Jeff's export of the live collection (404 rows) gives the ground truth —
  every (subdivision → neighborhood) pair the site files today. It is in the
  repo as `__tests__/fixtures/listings/lakewood-housesforsale.json`.
- **Nine of the dashboard's terms already collide** with subdivisions the
  engine holds in five cities this site does not even cover: `isles` (21
  subdivisions — Alameda, Englewood, Lemon Bay), `del webb` (5, including
  Parrish's own Del Webb at Bayview), `emerald`, `edgewater`, `esplanade`,
  `lake club`, `riverwalk`, `sweetwater`, `windward`. A floor, not a measure.
- So each was narrowed to the longest form the export proves every MLS
  spelling carries: `isles at lakewood ranch`, `harmony at lakewood`,
  `edgewater village` + `moorings at edgewater`, and so on. The dashboard's
  `country club village` was dropped outright — it covered nothing the other
  two Country Club terms did not.
- **Result: 403 of 404 rows file exactly where the site files them, and none
  files anywhere else.** The one exception is a listing whose subdivision is
  the bare word `ESPLANADE`, which no anchored term can reach; it will land
  in the unmatched view rather than be bought with a term that would also
  take Sarasota's Esplanades. `lakewood-villages.test.ts` holds that check.

**Six terms are still bare, because the MLS writes those names with nothing
to anchor to:** `aurora`, `cresswind`, `del webb`, `indigo`, `lake club`,
`palisades`. They are the open risk, and `scripts/listings-lakewood-probe.ts`
exists to settle them before anything stages. Set `LS_LAKEWOOD_PROBE=1` and
deploy the branch; it pages every Active listing in the MLS, keeps the three
market cities, and prints — term by term — every subdivision each one reaches
that the site does not already show. It also reports how many in-market
matches are `NewConstructionYN` (the engine excludes builder listings on
every site), which is the other number worth having before comparing the
engine's count to the collection's. Budget fifteen minutes.

**Two things to expect when the comparison is made.** 18 of the 404 rows are
Coming Soon, not Active: the dashboard chain computes `isActive` but JS
precedence binds that `&&` to the last term of its `||` chain alone, so
everything except Woodleaf Hammock passed whatever its status. The engine
will not stage those. And **Riverwalk is folded into Summerfield** — the
dashboard gives them two labels but one `village1` and one page
(`summerfield-and-riverwalk`), and `ls_villages` has a unique index on
`(site_id, wix_item_id)` because `village-stats` writes each neighborhood's
counts back to its row. Two listings will read "Summerfield" instead of
"Riverwalk", and the filter loses Riverwalk as an option. **Put to Jeff on
the 18th and confirmed** — fold it in; a real Riverwalk row in the
neighborhoods collection undoes it in one migration if that changes.

Jeff also chose the probe-first path over switching on in shadow and
watching, so the next move on this site is a Vercel build with
`LS_LAKEWOOD_PROBE=1` and nothing else.

### What else shipped today

- **Migration 055**, retention for listings no site ever showed. Status
  decides, not age: `349 of 379` unshown listings were Active, and the
  unmatched view (`in_feed = true AND standard_status = 'Active'`) is how a
  missing term or village is found, so the sweep's predicate is that view's
  exact complement. Inert until about mid-November. See "Storage" under
  Phase 5.
- **Migration 056**, The Preserve's terms. Also corrects a wrong call this
  session made and Jeff caught: reading the staged set alone suggested new
  construction was about to empty the site, when in fact all 153 of the
  site's own rows were still discovery skeletons and absent from the sample.
  **While a discovery scan is in flight, the fully-pulled subset is not a
  sample of anything.**
- PRs #321–#327, all merged. Migrations 055 and 056 applied via the Supabase
  MCP.

### Kickoff prompt for the next session

> Read `docs/LISTINGS_ENGINE_PLAN.md`, starting with "Where things stand".
> Confirm Wellen Park's full verification cycle finished — `fullCursor` was
> at `MFRN6144585` with 1,664 left — and that the 03:00 nightly ran clean
> with both live sites still at `needs_write` 0. Then two things are open:
> Wellen Park's staged inventory wants reviewing before any cutover
> (especially anything the terms caught that is not Wellen Park), and Life
> At Lakewood is seeded but inactive, waiting on
> `scripts/listings-lakewood-probe.ts` to clear its six unanchored terms
> against the real Bradenton / Sarasota market. Do not switch Lakewood on
> before reading that probe's output.

**Operational facts.** Supabase project `hwjnymwzibpfylmkccox`. Wix site ids:
Longboat Key `8b20e921-5b70-4428-8fcd-8c8ef3bad3ab`, Parrish
`a704cfe5-dd9b-44ff-a017-9d637d8c6fdc`, Wellen Park
`1a8c2755-823e-4882-ae32-e6c108a30e39`, Life At Lakewood
`4fbabb96-2d6c-4f20-a240-9223153498b5` (that last one from `fp_sites`, where
the floor-plan pipeline has held it since July). Cron
`/api/cron/listings-tick` every 5 minutes; hourly incremental, nightly full
after 03:00 UTC. Hub: `/dashboard/listings`. Run Full and Run Discovery post
to `/api/internal/listings/run`, which calls `runReconcile` directly — so a
Hub run saves the cursor but does **not** advance `lastFullDate`, nor clear
`lastStatus` after an error.

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
  keyed by `_id = ListingId`; a live row is rewritten when the record's
  fingerprint changes, when this run confirmed the listing against the MLS
  (see **Date of MLS Pull**), or when its `dateOfMlsPull` is older than
  12 hours. Removals go through the mass-delete guard: a full run that wants
  to remove max(10, 10 %) of the site's live rows removes nothing and
  records the candidates
  (`mass_delete_guard` error event); an hourly run holds back only the
  data-driven reasons (city, village, display rights, feed) at that
  threshold. `POST /api/internal/listings/run` with `allowMassDelete: true`
  applies a reviewed batch.
- **Date of MLS Pull.** `dateOfMlsPull` is the field an MLS auditor reads to
  check when the code last looked at the MLS, so it says when the engine last
  *confirmed* the listing, not when the listing last changed. An hourly run
  restamps every row: it asks MLSGrid for everything modified since the
  watermark, so a held listing absent from the answer is confirmed unchanged
  as of that moment -- absence is an answer, which is the basis of the
  replication model. A full run restamps only the ids that pass asked about
  by name; the cursor carries the rest and a later pass in the cycle picks
  them up. A discovery run restamps nothing: it pages Active listings
  MLS-wide for ones the engine does *not* hold and skips every one it does,
  so stamping those rows would assert a check that never happened. Rows no
  run confirmed still fall back to the 12-hour floor
  (`PULL_DATE_REFRESH_HOURS`). The cost is that every live row on every site
  is rewritten hourly rather than twice a day -- roughly 640 rows today, and
  around 1,040 once Life At Lakewood goes live.
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
- **Hub Listings section, second pass (2026-09-15).** The section is titled
  Listings and has four pages: Overview, Staging, Events, Neighborhoods
  ("village" is now "neighborhood" everywhere the Hub shows it; the tables,
  API paths and event kinds keep the old name). Sites show their proper
  name (Life in Longboat Key) and carry the Email Hub's colour (yellow
  Longboat Key, green Wellen Park, purple Lakewood, teal Parrish). The
  engine switch and each site's pause are "Listing Updates" toggles, blue
  while on and red while paused, next to the Run Incremental and Run Full
  buttons. The overview stats are
  listings in feed, in staging, last run. A site's Live box opens its target
  collection in the Wix CMS (`manage.wix.com/dashboard/<site id>/database/
  data/<collection>`); its Staged box opens the Staging page, which lists
  each staged listing with what it waits on (MLS data, a neighborhood, a
  first imported photo, or just the next run), from
  `GET /api/internal/listings/staging?siteId=`. Later that day: the tabs
  are Overview, Neighborhoods, Change Log (the events page, now at
  `/dashboard/listings/change-log`); a site card shows only its Live and
  In Progress boxes (In Progress opens the staging page, which has no tab);
  the run list shows the newest 10.
- **Hub Listings section, third pass (2026-09-15).** Migration 044 (applied
  via the Supabase MCP) adds `ls_sync_events.dismissed_at` and indexes on
  `(run_key, at)`, `(at)` and open errors. The Change Log is runs first
  (`GET /api/internal/listings/runs`, 20 a page, "load older"), each run
  opening to its entries; a listing lookup groups its entries under their
  runs. A run's badge is `ok` only when nothing it tried failed: `partial`
  when writes failed or errors were recorded (the stored status stays ok,
  since the scheduler only needs to know the pass completed), `failed` when
  the run stopped. Triggers read auto (cron), manual (hub), build check
  (the verification script). The overview's Errors panel lists error
  events until they are dismissed (`POST /api/internal/listings/errors`),
  Details opens the run with the entry highlighted, and the sidebar badge
  carries the open count. Retention stays 30 days of events / 90 days of
  runs, purged after each full run.
- **Hub Listings section, fourth pass (2026-09-15).** Timestamps are
  Eastern (the Hub's shared formatter); the incremental mode reads "hourly"
  (Run Hourly, "Updated every hour"); the toggles are green while on; sites
  are "locations" in the labels; the Neighborhoods page is one collapsible
  section per location, all collapsed to start (the overview's per-location
  link opens that one), loading a location's neighborhoods when it opens,
  without the Deactivate and Re-import from Wix buttons.
- **Hub Listings section, fifth pass (2026-09-15).** With a level, kind,
  location or listing filter the Change Log shows only the matching entries,
  grouped under their runs (`GET /api/internal/listings/events?before=` pages
  them, `GET /api/internal/listings/runs?runKeys=` fetches the run headers).
  Run entries name the location (`Written to Life in Longboat Key`), never
  the collection id, and the Hub maps older entries' domains and collection
  ids to the location name on display. A neighborhood's Wix slug is derived
  from its page URL on create and update (the form no longer asks for it).
  The overview's "Listings in feed" counts what the locations carry (live
  plus in progress) and notes how many pulled listings are not eligible.
- **Deferred to the next phases.** The nightly shadow-vs-live comparison as
  a job (the verification script has the comparison), writing village counts
  to the Wix village pages (Postgres only until a site is live), and the
  photo pipeline.

## Phase 3 build notes (2026-09-15): the photo pipeline

- **Where it lives.** `src/lib/listings/photos.ts` (`runPhotoJob`,
  `runStandalonePhotoJob`), `db.loadPhotoBacklog` over migration 045's
  `ls_photo_backlog(max_listings)` (applied via the Supabase MCP): the
  photos of the longest-waiting listings a site shows or is about to show
  that the site does not have yet, rows in a cooldown excluded. A seeded
  photo the site already serves is never downloaded: the engine fetches
  from MLSGrid only what some site lacks. On a shadow-mode site a photo
  counts as lacking only after 90 minutes (`shadow_grace_minutes`), because
  the Velo pipeline still fetches each new listing's photos and MLSGrid
  allows one download per photo per hour: the seed step copies what the
  live gallery got, and the engine fetches only what it never did. A
  live-mode site has no other pipeline and no grace.
- **Fair queueing (migration 064).** The pass is shared out by site, not
  taken strictly oldest-first MLS-wide. Each listing is ranked within its own
  site's queue, oldest first, and the pass takes every site's oldest, then
  every site's second oldest, and so on -- the output is ordered that way
  too, so a pass cut short by its deadline has still spread what it did.
  A site with nothing waiting takes no slots and the rest absorb them, so
  with only one site busy this is exactly the old behaviour. Before it,
  Life At Lakewood's 417 listings staged inside one hour on 2026-09-18 were
  older than everything that arrived after, and for twenty-three hours every
  pass was entirely Lakewood's: eight listings on three live, public sites
  went that long without a single photo. A pass of ten at 18:47 UTC the next
  day went from `Lakewood 10, Longboat 0, Parrish 0, Wellen Park 0` to
  `3 / 3 / 2 / 2`. Deliberately by site rather than live-before-shadow:
  weighting live sites ahead would have fixed that morning and made the next
  onboarding never finish.
- **The pass.** Listing by listing: (1) a listing whose pending downloads
  have no URL under 50 minutes old is re-read from MLSGrid with the others
  in its page (one verify-by-id request per 50 listings) and its media rows
  refreshed; (2) each pending photo is downloaded once, paced at two a
  second, hashed, stored in the public `photos` bucket as
  `listings/<path_key>` (bytes already stored under another photo are
  reused), and its signed URL dropped; (3) each stored photo a site lacks
  is imported into that site's Media Manager from the bucket URL, paced
  under Wix's 200/minute, recorded as `ls_site_media` origin `imported`,
  and the listing is flagged `needs_write` so the write step (same run) or
  the next run carries the new gallery. A failed download waits 65 minutes
  (a day after six failures); a failed import 30 minutes; a listing MLSGrid
  no longer returns waits six hours for the nightly verify.
- **When it runs.** Inside every reconcile between classify and write, for
  at most 90 s and always leaving the writes 60 s (`PHOTOS_BUDGET_MS`,
  `WRITE_RESERVE_MS`), so a new listing's photos land and the record is
  written in the same hourly run. Then, on the same tick, as its own run
  (mode `photos`) with whatever budget is left, and on every idle tick, so
  a backlog drains at roughly 480 photos a tick. `POST
  /api/internal/listings/run` with `mode: "photos"` starts one by hand. The
  photo run only exists when something is pending, so idle ticks stay
  quiet.
- **Counts and entries.** `images_downloaded`, `images_imported`,
  `images_failed` on the run; a `photos` entry per listing and site, a
  `photos_failed` warning per listing with failed downloads (error for a
  failed import). The Hub shows photo runs as "n downloaded · n imported"
  and treats failed images as a partial run.
- **Gate 3.** Every live gallery has matching imported media ids: the
  seeded rows stay (never touched by the job), and the backlog reports
  what is still missing; when `ls_photo_backlog` returns nothing the gate
  holds.
- **Neighborhood stats (2026-09-15, for cutover).** `village-stats.ts`
  ports `village-stats.jsw`: from the engine's live rows it recomputes
  each neighborhood row's `priceRangeActive`, `squareFeetActive`,
  `bedroomRangeActive`, `garageSizeRangeActive`, `activeListingCount` and
  `zeroSince` on the site's neighborhoods collection, widens the
  hand-curated `priceRange` / `squareFeet` / `bedroomRange` /
  `garageSizeRange` outward, and bulk-updates only the rows that changed.
  It runs at the end of every write for a **live** site (in shadow mode
  the Velo pipeline still maintains these), so the neighborhood pages and
  the Google Ads inventory feed (`GET /_functions/adsInventoryFeed`, which
  reads `activeListingCount` / `zeroSince`) keep working after cutover.

## Phase 4 build notes (2026-09-16): onboarding Life At Parrish

Started the afternoon Longboat Key went live. Parrish is the first site
that was never on the Velo sync: its listings were pushed by hand from a
Wix dashboard page (a curated `MLS_id_list`, subdivision `search()` terms,
`uploadImage` into the Media Manager) and that page stopped working on
the 16th, so there is nothing to shadow against and nothing to keep in
step with. Jeff's decisions: the Longboat Key rule applies (every Active
listing in the market whose subdivision matches a term goes live, no
hand-picked list); build discovery now; the Parrish neighborhood pages do
not use `activeListingCount` and the site has no `adsInventoryFeed` yet;
the Supabase project is on Pro (storage for fetched photos).

**What Parrish needed that Longboat Key did not.**

- **A starting inventory.** The hourly pull is MLS-wide but only over its
  window, and the full run only re-verifies ids the engine holds;
  Longboat Key's first 203 came from the media seed reading its live
  galleries. Parrish's galleries carry no `mlsSourceUrl` (the manual
  upload kept only `src`/`title`/`type`), so the seed records its listing
  ids as placeholders but reuses no photo, which is exactly what Jeff asked
  for: every Parrish photo is fetched afresh, so the old Media Manager
  files can be deleted once the site is live. The **`discover` run mode**
  (`src/lib/listings/discover.ts`, `MlsGridClient.fetchActive`) closes the
  gap for listings the hand-run process never added: one pass over every
  Active listing MLS-wide (`StandardStatus eq 'Active'`, no `$expand`),
  keep the ids in a market city the engine does not know, pull those by
  id with Media, then the normal classify / photos / write path. Stellar
  has tens of thousands of Active listings (a few hundred pages), more
  than one invocation's budget: a scan the deadline cuts short stores its
  `@odata.nextLink` in `system_settings.ls_engine_state.discoverCursor`
  and the next discover run continues it; the cron tick continues a
  cursor whenever the hourly and the full are not due, so one click on
  **Run Discovery** finishes on its own. Finds the deadline leaves
  unpulled are recorded without Media and the nightly full brings the
  rest. Whether MLSGrid accepts `StandardStatus` in a replication
  `$filter` was not verifiable from the build session (docs egress-blocked);
  a refusal surfaces as the run's error.
- **A Media Manager folder.** `ls_sites.media_folder_name` /
  `media_folder_id` (migration 046): the photo job resolves the name once
  against the site's root folders (`GET /site-media/v1/folders`), caches
  the id on the row and passes `parentFolderId` on every import. A named
  folder that cannot be found holds that site's imports with one
  `folder_missing` error per pass rather than scattering photos outside
  it. Parrish: `ParrishListingPhotos` (Jeff created it). Longboat Key keeps
  `NULL` = Wix's default location.
- **Neighborhoods from code, not from Wix.** Parrish has no `Villages`
  collection; `scripts/listings-parrish-villages.mjs` transcribes the
  dashboard page's term list and the three tag-icon ternaries (evaluated
  in order, first match wins, so `Del Webb At Bayview` gets pickleball,
  never the 55+ icon its lower-case twin would) into 51 neighborhoods,
  63 terms and per-neighborhood `display` JSON; migration 046 carries the
  output. Same answers as the old if-chain: longest term wins gives
  Kingsfield Lakes over Kingsfield, and the eight North River Ranch
  aliases (Brightwood, Crescent Creek, Del Webb Explore, Highview,
  Longmeadow, Riverfield, Wildleaf) fold into one. Two quirks kept as
  they were, for the Hub to tune: `reach` alone matches Rivers Reach, and
  Oakfield only matches with a `lakes` / `trails` suffix.
- **Site row.** `Life At Parrish`, `lifeatparrish.com`, Wix site
  `a704cfe5-dd9b-44ff-a017-9d637d8c6fdc`, `market_cities = ['Parrish']`,
  shadow mode against `HousesforSale2` (Jeff created it 2026-09-16),
  **inactive** in the migration so no photo lands outside the folder
  before the code that reads `media_folder_*` is deployed.

**Cutover additions for Parrish (Jeff, 2026-09-16): purge the old photos by
folder.** The site's Media Manager is full of listing photos the manual
process never deleted; once the engine's set is live Jeff will trash the
old upload folders himself. Two Hub additions make that safe. **Audit
photos & rows** on the site card (`GET /api/internal/listings/sites/:id/audit`,
`src/lib/listings/audit.ts`): lists the files in the site's folder and
checks every Media Manager file id the engine holds for the site against
them, checks every gallery `src` in the target collection (and the live
one while in shadow) against the folder, and lists the collection rows the
engine does not own (the 8 listings on lifeatparrish.com the engine did
not adopt: 6 no longer Active, 2 rentals) with a **Delete stale rows**
button that only ever acts on the site's *target* collection, so nothing
leaves the live collection before the flip. "Clean" = every engine photo
in the folder, no gallery pointing outside it, no stale row in the target.
Parrish's cutover order becomes: audit clean in shadow → flip → first live
run → audit again, delete the stale rows from `HousesforSale` → Jeff purges
the old folders after the rollback week.

**Property types per site (Jeff, 2026-09-16).** Vacant land is shown on
Life in Longboat Key only; every other site shows Residential alone for
now. Migration 047 adds `ls_sites.property_types` (default
`{Residential}`, Longboat Key `{Residential, Land}`) and classify reads it
instead of the former global constant. The first discovery scan had found
21 Parrish Land listings, which this keeps off the site; a Land listing a
Residential-only site had already staged is unstaged on its next
classification with reason `property_type`.

**New construction off every site (Jeff, 2026-09-16).** The 696 Parrish
listings the engine staged failed Jeff's smell test against the 267 the
old Velo pipeline held. The data: 262 of the 697 were already in the old
collection (the rest of the 267 were 6 no-longer-active listings and 2
leases); of the 435 the engine added, 426 carry `NewConstructionYN = true`
(D.R. Horton 109, Pulte 66, Mattamy 31, Meritage 30, Homes by WestBay
27, …; 248 under construction, 160 completed, 18 pre-construction), and
the old collection had none. The old `MLS_id_list` had simply never
included builder inventory. Jeff's decision: exclude new construction on
every site. Migration 048 adds `ls_listings.new_construction` (from
`NewConstructionYN`, backfilled from `raw`), the reason code
`new_construction`, and `ls_sites.show_new_construction` (default false
everywhere; a per-site switch so Longboat Key's ten live builder
listings, the St. Regis residences among them, can be restored with one
update if wanted). Classify rules it out after status and property type
and before the term match, so the non-neighborhood overlay never lists
builder homes. Parrish goes from 697 staged to about 271; Longboat Key
removes those ten on its next run.

**Photos Wix accepted but never fetched (Jeff, 2026-09-16).** Parrish
galleries had blanks scattered through them, and the file was genuinely
empty in the Media Manager, not just unrendered in the CMS. Wix's URL
import is asynchronous: `POST /site-media/v1/files/import` returns a file
id straight away and Wix fetches the picture afterwards. When that fetch
fails nothing in the response says so, so the engine records a file id that
renders as nothing, for ever. `mediaState()` in the Wix client reads a file
descriptor and calls it ready, pending, broken or unknown, and
`reimportBrokenPhotos()` in `audit.ts` clears the engine's record of the
broken ones so the next photo pass fetches them again and the listing is
rewritten. It runs on the Hub's audit panel as "Fetch them again", and once a day as
part of the nightly full run — the verify pass that already exists, rather
than a second daily job of its own (Jeff, on being shown one: "Don't we
already have a full run that happens once a day?"). Two things had to be
right for that to work. It sits at the *top* of each site's write phase,
not the tail: the nightly is the busiest run of the day (193 s of a 240 s
budget on 2026-09-16) and a check hanging off the end would often have
been skipped. And it no longer requires a named Media Manager folder,
which Longboat Key does not have; a site without one imports into Wix's
root, so that is where it looks. It never fails the run. Two
safeties: a file is only called broken on positive evidence (Wix said
FAILED, or it described the media and there were no dimensions), never on a
response that simply lacks the media block, and the repair refuses outright
when more than `BROKEN_SHARE_CAP` (35%) of a location's photos look broken,
on the grounds that Wix having changed its payload is likelier than a third
of the library failing. The refusal is an error in the panel.

**The price filter tag is per site (Jeff, 2026-09-16).** The engine wrote
Longboat Key's scheme everywhere: "Under $500k", "$500k - $1M", "$1M - $2M"
and up, ported from that site's own pipeline. Parrish's live collection
tags prices the way its older Velo `getNumber` did instead: `$600s` for a
six-figure price, `3M+` above a million. The two are not interchangeable —
a page filtering on `$600s` matches nothing when the row says
`$500k - $1M` — so the Parrish cutover would have left its price filter
empty. Caught in the shadow collection, before the flip. Migration 050
adds `ls_sites.price_sort_style` (`ranges` by default, so no site changes
unless it is named; Parrish set to `shorthand`) and `priceBucket()` takes
it. The shorthand reproduces `getNumber` exactly, digit slicing and all,
because that function is what produced the values sitting in the
collection today: 624,900 -> `$600s`, 3,295,000 -> `3M+`, 12,000,000 ->
`12M+`, and below six figures the bare `$99000`. Worth re-checking against
a live row before each new site's cutover; the same question will come up
for Lakewood Ranch and Wellen Park.

**Galleries Wix could not show (Jeff, 2026-09-16).** Five live Longboat
Key listings showed one stock photo each instead of their own, with a
warning and a broken primary image in the CMS. A Wix image URI needs its
origin dimensions —
`wix:image://v1/<fileId>/<name>#originWidth=1600&originHeight=898` — and
the engine's own imports were writing it without the fragment. Wix answers
that by refusing the field, so the site's gallery fell back to its editor
placeholder, the same photo on every affected listing. Only listings the
engine imported photos for were wrong: the 10,382 photos seeded from the
live collection at cutover carried Wix's own URIs, fragment included, and
all 2,420 imported ones did not. Nothing had to be re-imported — every
MLSGrid Media record carries `ImageWidth`/`ImageHeight` (48,296 of 48,296),
so migration 049 adds `ls_listing_media.image_width/image_height`,
backfills them from `raw`, and the URIs were rebuilt from them in place.
`wixImageUri()` and `isRenderableWixImage()` in `types.ts` are now the one
definition of the shape; the photo job refuses to import a photo whose
dimensions it does not have (a warning, escalating if it persists) rather
than writing a URI nothing can show.

**The guard (Jeff asked for an alert).** A photo whose src is not a
renderable Wix image never reaches a record: the write phase drops it and
raises `gallery_unusable` at error level, so it lands in the Errors panel
in plain language ("Some photos for this listing can't be shown on <site>,
so they were left off the listing"). A listing whose photos are all
unusable is not written at all and counts as waiting for photos. This is
the class of bug the Hub could not have caught before: the writes all
succeeded, Wix accepted the rows, and only the rendered page was wrong.

**Wix pushed back (Jeff, 2026-09-16, at a panel full of them: "why am I
being alerted? Is this something I need to deal with?").** Four imports at
a time every five minutes earned 256 refusals from Wix in an hour, up to
~1,200 failed attempts in a single pass, and 57 of them escalated into
errors in the panel. Two things were wrong. The job kept hammering: each
429 was recorded as that photo's failure, put the photo on a 30-minute
cool-down it had not earned, and the next worker tried again immediately.
And `escalateRepeats` promoted the repeats to errors, which is exactly
backwards for a rate limit — it repeats by design until the caller slows
down, and there is nothing a person can do about it. Now: a 429 stands the
location down for the rest of the pass, leaves its photos due, counts as
paced rather than failed, and is reported once per listing as a warning
(`rate_limited`, deliberately not in `RETRIED_KINDS`, so it can never
escalate). `IMPORT_CONCURRENCY` is back to 2. Downloads stay at 4: the MLS
media host never objected.

**Photo throughput (Jeff, 2026-09-16).** Parrish's galleries were going to
take about 33 hours. The engine was moving roughly 400 photos an hour, but
at 51 photos a listing that is only 8 listings an hour, which is what the
Hub showed. Two limits multiplied: the tick ran 4 minutes in every 15 (a
240 s budget under the 300 s function limit), and inside it every photo was
handled alone, one download at a time with a 500 ms gap and one import at a
time with a 320 ms gap, about a second each. Neither the media host nor Wix
was pushing back (no rate-limited responses in five passes). Both limits
lifted: the cron is `*/5` instead of `*/15`, and downloads and imports each
run `DOWNLOAD_CONCURRENCY`/`IMPORT_CONCURRENCY` (4) at a time through
`pool()` in `photos.ts`, each worker keeping its own spacing, so the rate
across the pool is four times the per-worker rate. Together that is roughly
12x: Parrish's remaining 13,000 photos go from about 33 hours to about 3.
The media host's documented limit is one download per photo per hour, not a
cap on parallel photos; if it does start refusing, each photo already waits
an hour and retries itself, and those are warnings, not errors. The folder
lookup is now held as one promise per site per pass, so the concurrent
importers share it instead of each asking Wix. Overlapping ticks are
harmless: `runningRun` makes a tick that finds a run in flight skip.

**Errors worth attention (Jeff, 2026-09-16).** The Errors panel is for
things a person has to act on; a failure the engine will retry by itself
is a warning. Levels now: a failed photo download is a warning until the
photo has used up its six hourly attempts (`download_failed`, then an
error: the URL is most likely dead); a Wix import the engine retries in
30 min is a warning (`import_failed`); a bulk save or remove that failed
whole, a neighborhood-stats refresh that failed, and a Media Manager
folder lookup that failed are warnings (retried next run); a run that
stopped on an MLSGrid or Wix 429/5xx or a network fault is a warning
(`run_error`; a 400, a 403 or a bug stays an error). Still errors on
sight: a Wix rejection of one listing's record, a folder that does not
exist, the mass-delete guard, a shadow site pointed at its live
collection. Repeats escalate: when earlier runs in the last 6 hours
already warned twice about the same problem (kind, location, listing),
the next warning is stored as an error (`escalateRepeats` in
`runs.ts`, one Postgres read per flush), once: while that error is open
the repeats stay warnings, and once it is dismissed a further repeat
raises it again. Wix's HTML error pages are reduced to one phrase in the
message.

**What a site rules out (Jeff, 2026-09-16).** The rule stands: a listing
whose subdivision matches no neighborhood term is not on the site. The
first discovery scan showed what that costs (73 Longboat Key for-sale
listings, most of them boat slips at the Moorings and homes under the
generic subdivision "LONGBOAT KEY"), so each location on the Neighborhoods
page carries a "See non-neighborhood matches here" link that opens an
overlay (`GET /api/internal/listings/villages/unmatched`,
`src/lib/listings/unmatched.ts`): the Active, for-sale listings in the
market the engine holds, classified with the site's rules, the
`no_village` ones grouped by MLS subdivision with count, price range and a
few addresses. Each row takes a **typed** term and a neighborhood (the
subdivision string itself is almost never the term wanted: "MORGANS GLEN
TWNHMS PH IIIA & IIIB" gets "morgans glen"), posted through the existing
terms endpoint. Nothing changes until someone adds a term.

**Rollout, in order:** merge and deploy → apply migration 046 → set
`active = true` on the Parrish row → Run Discovery from the Hub (the
ticks finish the scan) → the seed's placeholders and the finds are
verified, photos download into the `photos` bucket and import into
`ParrishListingPhotos` (about 500 listings, 15–20k photos, a few hours at
the caps), shadow writes to `HousesforSale2` → compare shadow with live →
cutover by the Longboat Key runbook, minus the Velo step (nothing to
stop). In live mode the engine will also write the neighborhood stats
fields onto Parrish's `HousesforSale-DynamicPages`; harmless today,
ready for when the pages and an ads feed use them.

**Risks noted at build time.** The photo pipeline had imported nothing in
production before this (all 10,382 Longboat Key photos were seeded), so
Parrish in shadow mode is its first real run at scale. The 90-minute
shadow grace still applies to Parrish (no pipeline to yield to, so it
only delays each new listing's photos by 90 minutes while in shadow).

## Cutover runbook: Longboat Key (step 4)

*Executed 2026-09-16, 15:45 to 15:52 UTC; the outcome is recorded under
"Where things stand" at the top of this document.*

Read with the "State meaning and cutover" note above. Order matters: the
Velo jobs stop first, the database flips second, the first live run comes
last; MLSGrid allows one download per photo per hour, so two pipelines
must never fetch at once.

1. **Pick the moment.** Just after the top of an hour (:05 to :20): the
   Velo hourly runs at :00 and its photo drain at :30; the engine's hourly
   currently starts at :30. Nothing is mid-flight at :05.
2. **Stop the Velo jobs** (lifeinlongboatkey.com, Wix editor, Dev Mode,
   Code Files → Backend → `jobs.config`): replace the file's contents with
   `{ "jobs": [] }` and **Publish**. That ends `hourlyIncremental`,
   `nightlyFull`, `nightlyPurge` and `processMediaStep`. Delete nothing
   else: `backend/sync/*` stays idle for the rollback week, and
   `http-functions.js` keeps serving the ads feed and the health endpoints
   on demand.
3. **Flip the site** (Supabase SQL editor; the check constraint requires
   the target and the mode to change together):

   ```sql
   begin;
   update ls_sites
      set write_mode = 'live', target_collection_id = live_collection_id, updated_at = now()
    where domain = 'lifeinlongboatkey.com';
   update ls_site_listings
      set written_at = null, written_fingerprint = null, needs_write = true
    where site_id = (select id from ls_sites where domain = 'lifeinlongboatkey.com')
      and state = 'live';
   commit;
   ```

   Nulling `written_at` / `written_fingerprint` makes the first live run
   rewrite every listing into `HousesforSale` (an upsert keyed by
   `ListingId`, so the site's rows are replaced in place; the galleries
   carry the Media Manager URIs the site already serves, so no photo
   moves). From this edit on the media seed stops (nothing else writes
   the live collection), the photo job fetches at once (no shadow grace),
   and the neighborhood stats are the engine's.
4. **Run it**: Hub → Listings → Run Full (or wait for the :30 hourly).
   Expect one run: about 200 rewritten, 0 failed, 0 removed; then
   `photos` entries only for whatever the site lacked; then the stats.
5. **Verify** within the hour: the Change Log run reads ok; the Errors
   panel is empty; a listing page, a neighborhood page and a gallery
   render; `GET /_functions/adsInventoryFeed` still answers with counts;
   the overview's Live box equals the site's inventory.
6. **Rollback** (any time in the first week): the reverse edit
   (`write_mode = 'shadow'`, `target_collection_id = 'HousesforSale2'`,
   the same nulling of `written_at` / `written_fingerprint`), restore
   `backend/jobs.config` from git and Publish. The engine goes back to the
   shadow collection on its next run; Velo's next hourly re-adopts
   `HousesforSale` (it keys photos by MLS URL, so its first run re-uploads
   galleries as it did before the engine existed).
7. **A week later, if quiet:** delete `backend/sync/*`, `backend/Fetch.jsw`
   and the Property Management page's backend calls from the Wix site,
   the `Stagging`, `SyncRuns` and `SyncEvents` collections, the
   `HousesforSale2` shadow collection, and the MLSGrid key from Wix
   Secrets. Step 6 (the ads feed from the engine, archiving the Longboat
   Key repo) follows.
- **Needs from Jeff.** ~~`MLSGRID_API_KEY` in the Vercel environment (Preview
  and Production); it lives in Wix Secrets on the Longboat Key site today.~~
  Added 2026-09-14; from then on the verification build runs the full and
  incremental pulls against the shadow collection on every push.

## Cutover runbook: Life At Parrish

*Written 2026-09-17, from the state below. Read it beside the Longboat Key
runbook above: the shape is the same, three things are not.*

**Cutover done (2026-09-17, 19:36 UTC).** Life At Parrish is live. Jeff
audited the photo library and took the `HousesforSale` export (steps 0 and
2), the flip ran at 19:36:25 with no run in flight, and the 19:40 cron tick
carried it: `incremental`, ok, 23.8 s, **0 inserted / 276 updated / 0
deleted**, 0 failed writes, 0 warnings, 0 errors, `stats_refreshed` true, so
the neighborhood stats reached `HousesforSale-DynamicPages`. Afterwards all
276 live rows carried a fresh `written_at`, `needs_write` was 0, and
`gallery_ready` was 276 of 276 — the one listing still waiting on a
re-imported photo at the flip completed itself in the same run. No open
errors on either site. Step 5 was Jeff's in a browser (this session's egress
cannot reach lifeatparrish.com): "looking good on the website".

Every gallery on the site is now the engine's, which was the requirement
this cutover was run against: all 14,030 `ls_site_media` rows for Parrish
are `origin = 'imported'` into `ParrishListingPhotos`, and nulling
`written_at` rewrote every row rather than only the changed ones.

**Step 6 done, same evening.** Jeff ran **Delete stale rows** against
`HousesforSale` once the target had moved: **6 rows**, the hand-pushed
leftovers the engine does not adopt. The 09-16 analysis had counted 8 (6 no
longer Active, 2 leases); what changed in between was not recorded, and the
button recomputes the set server-side rather than taking a stored list, so 6
is what was actually there.

Worth stating plainly, because the numbers look like they disagree: the
engine's count did not move, and should not have. `deleteStaleRows` deletes
the collection items whose `_id` is *not* in `loadOwnedIds`, and for Parrish
that owned set is exactly the 276 live rows (the 427 removed ones carry no
`wix_item_id`). So the six were never among the 276 — they had no
`ls_site_listings` row at all, which is why no engine count ever included
them and why they still carried photos from the old folders. The collection
went 282 to 276; the engine's 276 is what it converged on. A drop to 270
would have meant the button had deleted six of the engine's own listings,
which is what recomputing `owned` exists to prevent.

With those gone the collection is 276 rows, every one of them the engine's:
276 live rows carrying a `wix_item_id`, `needs_write` 0, `gallery_ready` 276,
no open events. That is the requirement met end to end — every image on every
listing on lifeatparrish.com is one the engine downloaded from MLSGrid and
imported into `ParrishListingPhotos`.

**Still open:** step 7, a week out (around the 24th) — the old Media Manager
folders and `HousesforSale2`. Not before: those folders and the
`HousesforSale` export Jeff took at step 2 are the only rollback Parrish has,
because nothing will re-adopt the collection the way Velo would have.

**What is different from Longboat Key.**

1. **There is no Velo job to stop.** Parrish was never on the Velo sync; its
   listings were pushed by hand from a dashboard page that stopped working on
   the 16th. Step 2 of the Longboat Key runbook has no equivalent here, and
   the "two pipelines must never fetch at once" reason for its ordering does
   not apply.
2. **Every photo is already the engine's.** Longboat Key's cutover moved no
   media because the seed had adopted the 10,382 files the Velo pipeline had
   uploaded. Parrish's live galleries carry no `mlsSourceUrl`, so the seed
   reused nothing and recorded listing ids only. Every Parrish photo was
   downloaded from MLSGrid by the engine and imported into
   `ParrishListingPhotos`: `ls_site_media` holds 14,030 rows for the site,
   all `origin = 'imported'`, none `seeded`.
3. **Rollback has nothing to restore.** Longboat Key's step 6 puts
   `jobs.config` back and Velo re-adopts `HousesforSale` on its next hourly.
   Nothing will re-adopt Parrish's. The flip overwrites the hand-pushed rows
   in place, so the only way back to them is a copy taken beforehand — which
   makes step 2 below the safety net the Longboat Key runbook got for free.

**State at writing (19:20 UTC).** Shadow mode against `HousesforSale2`,
active, 276 live rows, 0 `needs_write`, 275 of 276 `gallery_ready`, 0 staged,
no open errors on either site. 14,031 photo rows across those 276 listings
(51 each on average); exactly one lacks a verified `ls_site_media` row. The
photo backlog is drained — the last several passes imported 0. `market_cities
= {Parrish}`, Residential only, no new construction, `price_sort_style =
shorthand` (migration 050; `ranges` would leave the site's price filter
matching nothing), media folder `ParrishListingPhotos` resolved to
`71ff81dc89744d4e9aa739c308eec237`.

### Step 0. The photo gate, and why it is step zero

This is the step Longboat Key did not need, and the only one that should
delay the flip.

Migration 053's backfill stamped every `ls_site_media` row that existed at
migration time as verified, including imports it could not vouch for — the
alternative was emptying a live site's galleries. For Parrish that is
**13,613 of 14,030 photos carrying a verified stamp nobody checked**; only
417 have been confirmed by `verifyImportedPhotos` since. So the rule "never
show a broken photo" binds new imports, and the older 97% rest on
`reimportBrokenPhotos` catching them instead.

Until PR #320 (commit `60e7729`, production deploy 17:41 UTC today) that
sweep could not do it: `listMediaFiles` paged by offset against an endpoint
that pages by cursor, so it re-read page one — 157 times in the reading that
found it — and nothing past the first hundred files was ever examined, which
is where Parrish's are. That loop is also why the folder was reported as
holding 20,000-odd files; its real size is whatever the first untruncated
audit says. The walk follows `nextCursor` now and `media_scan_offset` stands
at 6,000 — but the verify pass
only lists the folder when something has been waiting on Wix, and Parrish has
nothing waiting, so the cursor has not moved since 18:25 and will next move
in the 03:00 UTC nightly, by whatever is left of that run's budget. Waiting
for the background sweep to cover ~14,000 photos is several nights.

Drive it from the Hub instead. On the site card:

1. **Audit photos & rows.** The folder walk gets 55 s and reports
   `listingTruncated` when it did not reach the end. A truncated listing
   cannot compare the galleries to the folder at all — absence is not
   evidence — so the report says "could not be checked" rather than guessing.
2. **Fetch them again** when the audit reports broken files. It gets 90 s,
   starts from the top of the folder (not the shared cursor, so the two
   agree), clears the engine's record of each broken photo and sends the
   listing back for a rewrite. It refuses outright if more than 35% of the
   photos it saw look broken, on the grounds that Wix changing its payload is
   likelier than a third of the library failing; that refusal is a finding,
   not a failure.
3. Let a photo pass run (every 5 minutes; `POST
   /api/internal/listings/run` with `mode: "photos"` forces one), which
   re-imports what was cleared.
4. Repeat until an audit comes back **untruncated**, `brokenFiles` 0 and
   `galleryOutsideFolder` 0.

**Gate:** do not flip while the audit is still truncated. A truncated audit
is not a clean one; it is an audit that did not finish.

### Step 1. Pick the moment

No Velo timing to work around, so the only concern is not flipping mid-run.
The tick is every 5 minutes, an incremental is due an hour after the last one
finished ok, and the nightly full starts at 03:00 UTC. Flip just after an
incremental reports done in the Change Log, and not in the hour before 03:00
— the nightly is the busiest run of the day and the 09-17 incident is what a
full run under pressure looks like.

### Step 2. Take the copy (this is the rollback)

Wix CMS → `HousesforSale` → export the collection. Keep it until the week is
out. The flip rewrites those rows in place and nothing else will ever put
them back.

Do not trash the old Media Manager folders yet, for the same reason: the
exported rows point at files in them. They go in step 7.

### Step 3. Flip the site

Supabase SQL editor. The check constraint requires the target and the mode to
change together:

```sql
begin;
update ls_sites
   set write_mode = 'live', target_collection_id = live_collection_id, updated_at = now()
 where domain = 'lifeatparrish.com';
update ls_site_listings
   set written_at = null, written_fingerprint = null, needs_write = true
 where site_id = (select id from ls_sites where domain = 'lifeatparrish.com')
   and state = 'live';
commit;
```

Nulling `written_at` / `written_fingerprint` is what makes every one of the
276 rows rewrite rather than only the changed ones. `buildListingRecord`
always writes `listingImageGallery`, and `loadSiteGalleries` builds it only
from verified `ls_site_media` rows for the site — all of which are the
engine's own imports — so **the rewrite replaces every gallery on every row
the engine owns with files from `ParrishListingPhotos`.** That is the whole
of the "every image from us" requirement, with one exception, which is step
6.

The write is an upsert keyed by `ListingId`, so the ~262 rows the hand-run
process had are replaced in place and the rest are inserted; the mass-delete
guard sees no flood.

### Step 4. Run it

Hub → Listings → **Run Full**, or wait for the next incremental. Expect about
276 written, 0 failed, 0 removed. The 90-minute shadow grace ends here, but
with the backlog empty there is nothing for it to release.

In live mode the engine also writes the neighborhood stats onto
`HousesforSale-DynamicPages`. Parrish's pages do not read
`activeListingCount` and the site has no `adsInventoryFeed`, so this is inert
today — it just stops being a thing to remember later.

### Step 5. Verify, within the hour

The Change Log run reads ok; the Errors panel is empty; a listing page, a
neighborhood page and a gallery render on lifeatparrish.com; the price filter
returns listings (this is the `shorthand` scheme's first outing in
production — `$600s`, `3M+` — and a mismatch shows up as an empty filter, not
an error); the overview's Live box equals the site's inventory.

### Step 6. Delete the stale rows — the one place old photos survive

The hand-run process left rows in `HousesforSale` the engine does not adopt
(at the 09-16 count: 6 no longer Active, 2 rentals). An upsert does not touch
them, so after step 4 they are still there, still carrying photos from the
old Media Manager folders — the only images on the live site that would not
be ours.

**Audit photos & rows** → **Delete stale rows**. The button recomputes the
set server-side and refuses any collection but the site's *target*, which is
why this cannot be done before the flip: in shadow mode the target is
`HousesforSale2`, and the guard exists precisely so nothing leaves the live
collection early. After the flip the target is `HousesforSale` and the same
button is the right tool.

Then audit once more: untruncated, `staleCount` 0, `galleryOutsideFolder` 0.
That report is the evidence for "every image on every listing is ours".

### Step 7. Rollback, and the week after

**Rollback** (any time in the first week): the reverse edit —
`write_mode = 'shadow'`, `target_collection_id = 'HousesforSale2'`, the same
nulling of `written_at` / `written_fingerprint` — stops the engine writing to
`HousesforSale`, and the export from step 2 restores its rows. There is no
pipeline to restart. Nothing re-uploads the old photos either, which is why
the folders stay until the week is out.

**A week later, if quiet:** trash the old listing-photo folders in the Media
Manager (everything outside `ParrishListingPhotos`), delete the
`HousesforSale2` shadow collection, and retire the dashboard page's code.


## Phase 5 build notes (2026-09-17): onboarding Life in Wellen Park

The third site, and the first whose market is not one city. Plan step 5 said
this onboarding needed "no code"; it needed a little, for one reason.

**Wellen Park is a community, not a city.** Longboat Key and Parrish are
places the MLS has a name for, so `market_cities` is that name and the
neighborhood terms only have to separate one neighborhood from its
neighbours. Wellen Park is a master-planned community the size of a town
straddling Sarasota County and the City of North Port, and the MLS files
its homes under whichever postal city the address falls in: Venice for most
of it, North Port to the east, Englewood for the neighborhoods the site
carries down there (Boca Royale). Jeff, 2026-09-17: Englewood, North Port
and Venice, and add more if the engine turns any up.

That is safe, because the city is only the first gate — a listing still has
to match a neighborhood term to reach the site — but it is not free, and the
two costs are worth watching after the first discovery:

- **Storage.** A record is kept when it is in *some* site's market
  (`isRelevant`), so these three cities put every Active listing in them
  into `ls_listings`, a few thousand rows that no site will show. Metadata
  only: photos are fetched for staged listings, so nothing is downloaded
  for them.

  **Measured, 2026-09-17**, when Jeff asked whether the unshown listings
  cost photos: of 1,295 listings held, 821 are on no site, and their 25,375
  `ls_listing_media` rows have `storage_path` null — **not one byte
  downloaded**. All 14,181 stored photos belong to the 474 that are on a
  site. `ls_photo_backlog` is why: its first CTE joins `ls_site_listings`
  with `state IN ('staged','live')`, and a listing that matches no term has
  no such row at all, so it can never reach the backlog. About 31 metadata
  rows per unshown listing is the whole cost.

  **Why the quiet cities stay** (Jeff, 2026-09-17). North Port does not
  appear at all in the site's crawled listings, and Englewood only four
  times against Venice's 182 — the market is tight, so the neighborhoods
  that reach into them have nothing for sale today. They stay anyway,
  because that is a statement about this month rather than about the
  geography, and a term that matches there when the market turns finds the
  listing's media metadata already on hand. Do not prune a market city on
  the evidence of a single crawl.

  **The sweep that bounds it (migration 055, same day).** Nothing used to
  delete an `ls_listings` row -- retention covered `ls_sync_runs` and
  `ls_sync_events` only -- so the unshown set was monotonic. Jeff: "I don't
  want to have any data get out of hand over time without us noticing."
  `ls_purge_unmatched_listings(older_than_days, max_rows)` runs in the
  nightly full, and `purgeUnmatchedListings` in `runs.ts` reports what it
  took.

  What it does **not** do is delete on age, and the reason is the whole
  design. Jeff's use for the unshown set is that he reads it: the unmatched
  view is how he finds a subdivision or street that should have matched a
  village he already has, and a village that is missing altogether. That
  view selects `in_feed = true AND standard_status = 'Active'`
  (`unmatched.ts`), and on the day this was built **349 of the 379 unshown
  listings were Active** -- so an age rule would have deleted the entire
  contents of the picture it is meant to protect, and they would not have
  come back (the incremental pulls by modification window, the full only
  re-verifies ids already held; only a discover scan finds a quiet Active
  listing again). So the sweep's predicate is the exact complement of that
  view's: out of the feed, or a status that can no longer reach a site.
  Nothing it deletes has ever been shown there.

  Two details worth keeping. The clock is `modification_timestamp`, not
  `last_seen_at`: the nightly re-verifies every id it holds, so
  `last_seen_at` read as *today* for all eight status cohorts including
  listings closed weeks earlier, and an age test against it would never have
  fired once -- a retention sweep that silently never runs being precisely
  the failure asked about. And a listing that was ever on a site is left
  alone: its `ls_site_listings` rows are the record of what went up and came
  down, and the FK cascades.

  Verified before it shipped: at 60 days it takes **0** rows today, at 0
  days it would take **18** (13 Closed, 2 Expired, 2 Withdrawn, 1 Canceled),
  and the 349 Active are untouched either way. It stays a no-op until about
  mid-November, when the first listings reach 60 days.
- **The unmatched view.** It lists the Active listings in a site's market
  that match no term, which for this site means every subdivision in three
  cities rather than the handful Wellen Park is missing. It stays the right
  tool for "what is this site not showing", but it needs reading with that
  in mind.

**Terms, derived rather than transcribed** (`src/lib/listings/seed-villages.ts`).
The site has no `Villages` collection to import the Longboat Key way, and
unlike Parrish it has no dashboard if-chain to transcribe either: its
neighborhoods live in `HousesforSale-DynamicPages` ("Neighborhoods") and the
subdivision each one covers is only visible in the listings it is already
showing, every one of which carries both `subdivision` as the MLS wrote it
and `village1`, the neighborhood it was filed under. So the seed reads the
neighborhoods for their identity (name, slug, page, tag icons, and the item
id the stats writeback needs) and derives each one's terms from the pairs
the site has been making all along. `POST /api/internal/listings/villages/import`
with `{ siteId, source: "site-collections" }`; a named site is imported
whether or not it is active, which is how a site being onboarded gets its
neighborhoods before its first run, and the seed only ever adds terms, so a
re-seed keeps whatever the Hub has tuned.

The derivation is the part that had to be careful, and the reason is the
city list above. A term is a `contains` against the subdivision, so on a
one-city site a loose term costs little; across Venice, North Port and
Englewood a loose term quietly puts someone else's listing on the site.
Two rules keep it honest:

- **Candidates are anchored.** Only the leading atoms of a subdivision's
  name, or of each `/`-separated part of it, ever become terms — "wellen",
  "wellen park", "wellen park golf", never "golf". An MLS name is
  `<NAME> <phase/unit>`, so its head is the part that identifies it, and
  anchoring is what keeps "palm", "national" and "royale" out of the
  running. Each candidate is checked against the string classify will
  actually see, so a run spanning a separator ("wellen park golf country"
  over "... GOLF & COUNTRY ...") is dropped where it is generated rather
  than matching nothing later.
- **Candidates are exclusive.** A term that also sits inside another
  neighborhood's subdivisions is rejected, so Wellen Park Golf & Country
  Club gets "wellen park golf" (LAKESPUR/WELLEN PARK and EVERLY AT WELLEN
  PARK rule out the shorter two) and Grand Palm gets "grand palm" (GRAND
  PARADISO rules out "grand"). Greedy set cover then takes the fewest,
  shortest terms that cover the neighborhood's subdivisions; a subdivision
  nothing exclusive covers is reported uncovered rather than given a term
  that would steal from a neighbour.

What the site's own listings show is a sample, not the whole MLS, so a
derived term can still be wider than the neighborhood it was read from. The
derivation therefore errs towards the specific: a term that is too narrow
puts a listing in the unmatched view, one click from a fix, while one that
is too wide puts someone else's listing on the site quietly. The Hub's
Neighborhoods page is where the result is tuned; a neighborhood with
nothing for sale today is reported termless rather than guessed at.

Checked against the 29 subdivision/neighborhood pairs the site was showing
in the snapshot under `pipeline/audit/snapshots/lifeinwellenpark.com`
(`__tests__/unit/listings/seed-villages.test.ts`, which also runs each pair
back through `matchVillage` to confirm it lands where the site had it):
14 neighborhoods, 15 terms, nothing uncovered.

**Site row.** `Life in Wellen Park`, `lifeinwellenpark.com`, Wix site
`1a8c2755-823e-4882-ae32-e6c108a30e39`, shadow mode against
`HousesforSale2`, `market_cities = ['Venice', 'North Port', 'Englewood']`,
Residential only, `price_sort_style = shorthand` (the site tags prices
"$300s"/"2M+", as Parrish does — ranges would leave its price filter
matching nothing), media folder `WellenParkListingPhotos`, **inactive**.
Migration 051, applied 2026-09-17.

**What this session could not verify, and the probe that will.** Its egress
policy blocked both wixapis.com and lifeinwellenpark.com, so the market
cities, the price scheme and the collection names above were read off the
site's own crawled pages rather than the live API.
`scripts/listings-wellen-probe.mjs` (a prebuild step, `LS_WELLEN_PROBE=1`,
read-only) answers the rest from a Vercel build log: which collections the
site has, whether `HousesforSale2` exists and can hold every field
`buildListingRecord` writes, the city and price-tag distribution across all
of the live rows, the neighborhoods with the terms the import would derive
(printed as SQL for review), and whether the media folder exists.

**Before the row is switched on:**
1. `HousesforSale2` on the site — duplicate `HousesforSale` without data,
   admin-only writes, as on Longboat Key and Parrish.
2. The `WellenParkListingPhotos` folder in the Media Manager — a named
   folder that cannot be found holds the site's photo imports with one
   `folder_missing` error per pass (migration 046) rather than scattering
   photos outside it.
3. The neighborhood seed — the village import above, then a read of the
   Hub's Neighborhoods page: tighten anything the derivation left wider
   than it should be, and give the neighborhoods with nothing for sale
   today a term by hand.
4. `active = true`, then Run Discovery from the Hub for the starting
   inventory, as Parrish did.

### The dashboard code arrives (2026-09-17, same day)

Jeff supplied Wellen Park's `backend/Fetch.jsw` and its dashboard page, so
the neighborhoods are now transcribed from the process the engine replaces
rather than derived from what the site happens to be showing —
`scripts/listings-wellen-villages.mjs`, carried by **migration 052**: 21
neighborhoods, 24 terms, the three tag ternaries, applied 2026-09-17.

**The derivation held up, which is worth recording.** Run over the same
site first, it found the 14 neighborhoods with listings on the crawl date
and gave every one of them the same Wix item id the dashboard code has, and
for 13 of 14 the same terms. Its one miss was Sarasota National, where it
chose `sarasota` and the dashboard has `sarasota national` + `sarasota n`
— the failure the derivation's own doc comment predicts, a term wider than
the neighborhood it was read from. What it could not have found is the
seven neighborhoods with nothing for sale that day (Antigua, Ashcombe,
Avelina, Brightmore, Gran Place, Palmera, The Preserve), which is the real
limit of reading a site's current inventory. `seed-villages.ts` stays the
path for a site with no dashboard page to transcribe; where both exist, the
dashboard wins.

**`exclude_term` (migration 052).** The dashboard assigns The Preserve on
`isThePreserve !== -1 && isKensington === -1`. Longest-term-wins settles a
contest between two of a site's own neighborhoods, and Kensington is not
one, so no longer term exists to beat `preserve`. `ls_village_terms` gains
a nullable `exclude_term`: the term does not match when the subdivision
contains it too. One user today; the Hub shows it on the chip
("preserve · not kensington") and `addTerm` refuses an exclusion the term
itself contains, which would match nothing.

**Three things to watch on the first shadow run.**

- **`preserve` reaches further here than it did there.** The old pipeline
  pulled a hand-curated `MLS_id_list` and used these terms only to decide
  which neighborhood an already-chosen listing belonged to. The engine has
  no such list: it takes every Active listing in the market, so the same
  terms are a filter now, and across Venice, North Port and Englewood
  `preserve` will match more than Wellen Park's Preserve. Check The
  Preserve's staged listings before cutover; `oasis`, `renaissance` and
  `sarasota n` deserve the same glance. This is what shadow mode is for.
- **The site will show more than it does today, and that is correct.** The
  dashboard's `.filter()` returns `valData` from both branches, so it never
  filtered — and its `isActive` test binds to the last `||` term only, so
  status was never really checked either. What kept the site honest was the
  curated id list. The engine applies status, property type, city, new
  construction and the term match properly, so expect its inventory to
  differ from the 153 rows in `HousesforSale`: more Wellen Park resales the
  list never had, and fewer non-Active rows.
- **Three neighborhood pages have no terms:** `esplanade`, `oakbend` and
  `sunstone-lakeside` exist on the site but appear nowhere in the dashboard
  chain, so they never received listings and still will not. (`sunstone`
  catches "SUNSTONE LAKESIDE…" for Sunstone.) If any should have their own,
  the Hub's Neighborhoods page is where to add them.

The probe (`scripts/listings-wellen-probe.mjs`) now cross-checks the
transcription instead of printing seed SQL: it runs every live listing
through the transcribed terms and reports any row the terms would file
somewhere other than where the site has it, then prints what the derivation
would have said for comparison, so a neighborhood the dashboard chain has
drifted away from shows up.

**Jeff has created** `HousesforSale2` and the `WellenParkListingPhotos`
folder (2026-09-17), so what is left before `active = true` is the probe
and a read of the Neighborhoods page.

**The MLSGrid token in `Fetch.jsw` is live and in plaintext** (the same key
the engine uses from Vercel). Rotate it when the Wellen Park cutover
deletes that file, as the Longboat Key runbook's step 7 already does for
its Wix Secrets copy.

## Photo import pacing (2026-09-17): going slower to go faster

Jeff, watching Parrish: "photo downloads are taking a really long time."
They were not downloads. Every five-minute tick looked like this:

```
02:55  29s  downloaded 0  imported 60  wix 429s 33
02:50   1s  downloaded 0  imported  0  wix 429s 34
02:45  30s  downloaded 0  imported 60  wix 429s 33
```

All 13,880 photos were already in Supabase storage; `images_downloaded` was
0 on every run. The slow hop was the Wix Media Manager import, moving 60
photos per tick — 720/hour against 2,407 still pending, about 3.3 hours —
in 30 seconds of a 240-second budget. Two causes, compounding.

**The rate was set for one worker and run with two.**
`IMPORT_SPACING_MS` was 320 ms, the right gap for a single worker under
Wix's documented 200 requests/minute. `IMPORT_CONCURRENCY` had since gone
to 2, and `pool()` says plainly that "the rate across the pool is the
per-worker rate times `limit`" — so the job was asking for ~375/min and Wix
refused about one import in three, around the clock. The gap is now 600 ms:
two workers, 200/min, the whole allowance and no more. A refused request
costs a round trip and imports nothing, so pacing down is what speeds the
pass up.

**The stand-down was scoped to one listing, not the pass.** `slowDown` was
declared inside `processListing` while its comment said "for the rest of the
pass". Each listing therefore started a fresh one, re-tested Wix, collected
a refusal and abandoned that listing's remaining photos — which is exactly
the 60-imports-then-idle shape above. It now lives in `runPhotoJob`, as the
comment always claimed, and the warning goes out once per pass at the point
the site stands down rather than once per listing in the `finally`.

**And a refusal is now waited out, not skipped.** `WixApiError` has carried
`retryAfterSeconds` since the client was written and nothing read it. On a
429 the worker now waits what Wix asks (floor `IMPORT_SPACING_MS`, cap
`RATE_LIMIT_MAX_WAIT_MS` = 60 s so one refusal cannot swallow the pass) and
offers the same photo again, up to `RATE_LIMIT_RETRIES` = 2 times. Only a
site that keeps refusing, or a wait that would run past the deadline, stands
down. Photos still take no cool-down and count as paced rather than failed,
so nothing about the alerting changes: one warning, never an error.

Expected effect: imports succeed instead of being refused, and a pass uses
its budget instead of exiting in 30 seconds. Worth confirming on the next
few ticks — `images_imported` per run should climb well past 60 and
`wix_rate_limited` should fall towards zero. If 429s persist at 200/min the
limit is tighter than Wix documents (the account-level key covers every
site, so the sites may share one allowance), and the next lever is
`IMPORT_CONCURRENCY` back to 1 at 300 ms rather than a shorter gap.

## Incident (2026-09-17): the nightly full run that could never finish

Jeff, mid-morning: "It's been hours and the 28 listings in progress have not
moved." They had not moved since 03:00 UTC, and neither had anything else.

**What happened.** `writeSite` opened, for a `full` run, with
`reimportBrokenPhotos(site.id)` — the check for photos Wix accepted but never
fetched, added on the 16th and folded into the nightly. It took no deadline,
and it begins by listing the site's whole Media Manager folder:
`listMediaFiles` pages at 100 files a request, up to 1,000 requests. Parrish's
folder holds about 22,000 photos, so that is some 220 sequential Wix round
trips before a single row could be written. The invocation hit Vercel's
300-second limit and was killed at `stage = write`.

Then the loop. `lastFullDate` is only advanced by a run that finishes ok
(`tick.ts`), and a killed run finishes nothing — so the next tick saw the full
run still due for today and started it again. **47 killed runs, 03:00 to
13:35, ten and a half hours**, in which:

- nothing was written to either site: `needs_write` stood at 271 of 271 on
  Parrish and 198 of 198 on Longboat Key, which is **live**;
- no staged listing went live, because promotion happens in the write — the
  28 Jeff was watching;
- no incremental and no standalone photo run happened at all, because the
  tick was always busy with the doomed full.

The photo work inside those runs still happened, which is why the symptom
looked like slow photos rather than a stalled engine.

**The fix.** Writes come first. The photo-library check moved to after every
site has been written, runs only when at least `BROKEN_PHOTO_CHECK_MIN_MS`
(45 s) remains, and takes the run's deadline; `listMediaFiles` takes a
deadline too and reports `truncated` instead of paging on. A check that is a
day late costs nothing; writes that never happen cost the sites. The
broken-share cap now divides by the engine photos the pass actually saw, not
the whole library, so a truncated listing cannot wave through a share the cap
exists to catch.

**Recovery.** `system_settings.ls_engine_state.lastFullDate` was set to
2026-09-17 by hand, which is all it took to stop the tick choosing `full`. The
next incremental finished ok in 106 s: 29 inserted, 393 updated, 0 rate
limits. Parrish went from 28 staged / 243 live to 3 staged / 272 live (the
last 3 are waiting on their own photos), Longboat Key to `needs_write` 0, and
the photo backlog to **empty** — the 1,663 photos outstanding at 05:30 all
landed once the passes could run.

**Two lessons for the next long-running step.** Anything that walks a whole
remote collection needs the run's deadline passed in, not just a page cap; and
a run mode that gates its own "done" flag needs a failure path, or one bad run
becomes an infinite one. The second is not fixed here: a full run that keeps
dying will still be retried every tick until midnight UTC. Worth a bounded
retry before the next nightly.

## Never show a broken photo (2026-09-17)

Jeff, after the day's photo work: *"We must never show broken photos in a
houses for sale database. Period."*

The engine could, and did. Wix's URL import is asynchronous: it takes a URL,
returns a file id immediately, and fetches the picture afterwards — or fails
to, leaving an id with nothing behind it. `ls_site_media` recorded the photo
the moment that id came back, so from then on the engine treated it as
available. The URI it builds is well-formed (it carries
`#originWidth/#originHeight` from the MLS record, so `isRenderableWixImage`
passes it), so it went straight into the gallery. Wix held no picture, and
the site showed a broken image.

The only thing that ever caught this was `reimportBrokenPhotos`, a nightly
sweep looking for the damage *after* it was already on the site — and which,
until today, had never once completed a run.

**`verified_at` (migration 053)** makes the bad state unrepresentable rather
than cleaning up after it. `loadSiteGalleries` returns a `src` only for rows
that carry one, so a gallery cannot contain an unconfirmed photo; the
listing's `gallery_ready` stays false, which already holds it in `staged`
instead of promoting it. An import writes `verified_at: null`. A *seeded*
photo was read out of the gallery the site is already serving, so Wix
demonstrably holds a picture for it: verified by definition.

**`verifyImportedPhotos`** runs at the head of every photo pass and settles
what Wix did with the last one:

- Wix holds a picture → `verified_at` stamped, and the photo may now be shown.
- Wix failed → the `ls_site_media` row is dropped and the listing goes back
  for a rewrite with `gallery_ready = false`, so the gallery is rebuilt
  without it and the photo is imported again.
- Still pending → left for the next pass.
- Neither, for more than `VERIFY_GIVE_UP_MS` (6 h) → treated as failed. Wix
  reports some files as an id with no media, which `mediaState` calls
  "unknown"; without this such a photo would be neither shown nor retried,
  for ever.

The folder listing is the bulk read (one request per hundred files against
one per file) and only runs when something has been waiting longer than
`VERIFY_AFTER_MS` (10 minutes), so a photo imported moments ago does not
trigger a walk of the whole folder to be told it is pending. A photo absent
from a *truncated* listing keeps waiting: not being seen is not evidence.

**What this costs.** Galleries appear later — a photo has to be confirmed
before it can be shown, so a new listing sits `staged` for a pass or two
longer than it used to. That is the right side of the trade: an incomplete
gallery is a smaller harm than a broken one, and the rule is absolute.

**The backfill is deliberate.** Every row that existed at migration time is
stamped verified, including imports this cannot vouch for. Requiring
verification retroactively would have emptied both live sites' galleries —
10,468 photos on Longboat Key — until a sweep caught up, to fix a handful of
broken pictures. The rule binds everything imported from here on; what is
already out there is a one-off cleanup (the Hub's "Audit photos & rows").

**Still worth doing.** `listMediaFiles` pages by offset from zero every
time, so a listing cut short by the deadline restarts in the same place and
never reaches the tail of a large folder. It is no longer load-bearing for
correctness — `verified_at` is — but the nightly sweep is weaker than it
looks on a folder Parrish's size, and a stored cursor would fix it.

## Wellen Park switched on (2026-09-17): what the first discovery caught

`active = true` at 20:51 UTC, shadow against `HousesforSale2`. Jeff pressed
Run Discovery a minute later. The run finished `ok` but **`stage:
truncated`** — 210 MLSGrid requests, 33,400 of 111,026 Active listings
scanned, 2,110 found — and left its cursor for the ticks to continue, which
is the designed behaviour, not a failure.

**The one wrong term, and how it was found.** Within minutes the site had
four staged listings and **all four were wrong**: HAMMOCKS PRESERVE PH 01
and PH 14, HAMMOCKS-PRESERVE PHASE 14 BUILD and GRANDE PRESERVE ON LEMON
BAY, every one of them Englewood, with EAGLE PRESERVE ESTATES queued behind.
This is exactly what the Phase 5 notes said to check — "`preserve` reaches
further here than it did there" — and the reason is structural: the old
dashboard's terms only sorted an already curated `MLS_id_list` into
neighborhoods, while the engine's terms are the filter deciding whether a
listing is the site's at all. Migration 056 replaces the bare `preserve`
with `preserve/west` and `the preserve`; its header carries the reasoning,
including why the anchor stops at "west" and why "PRESERVE AT WEST VILLAGES"
is deliberately left to the unmatched view.

**The export settled it, and corrected me.** Reading the staged set alone,
this session concluded that new construction was about to empty the site —
50 of the 52 classifiable Residential matches carried
`NewConstructionYN`, so `show_new_construction = false` looked fatal for a
master-planned community — and recommended flipping it. Jeff's answer was
"No. It's not new construction", with an export of the live
`HousesforSale` collection attached. He was right and the recommendation
was wrong: **all 153 of the site's own rows were still discovery skeletons**
(`property_type` and `new_construction` null, because the scan records a
find before it pulls the full record), so they were absent from the sample
the conclusion was drawn from. The 50 were whatever discovery had pulled
first, which skews to recently-modified builder inventory. The lesson is
narrow and worth keeping: **while a discovery scan is in flight, the
fully-pulled subset is not a sample of anything** — check against the site's
own collection, not against what the engine happens to hold.

**What the export proved.** All 153 rows are known to the engine, and after
migration 056 **all 153 match a village** (152 before it; the straggler was
12099 Firewheel Place, subdivision `THE PRESERVE`, which the site files
under the same village as the two `PRESERVE/WEST VLGS` rows). By
neighborhood: Sarasota National 26, Wellen Park Country Club 23, Gran
Paradiso 20, **Boca Royale 15**, IslandWalk 13, Grand Palm 9, Solstice 8,
Antigua 7, Renaissance 5, Everly 4, Lakespur 4, Sunstone 4, Tortuga 4,
Oasis 3, The Preserve 3, Brightmore 2, Avelina 1, Gran Place 1, Wysteria 1.
Boca Royale is 15 of the 153 and sits in Englewood, so that market city is
already earning its place; North Port contributes none of them today, which
is the tight market Jeff described rather than a wrong setting.

**Why the site showed 6 staged and not 153.** Not a matching problem at all:
the 153 are skeletons and classify rules a null `property_type` ineligible,
so they wait for the nightly full to pull them properly. Worth remembering
the next time a freshly onboarded site looks empty.

**Still open at hand-off.** The `WellenParkListingPhotos` folder has not
resolved yet (`media_folder_id` null) — no Wellen Park photo pass has needed
it, so the probe's last unanswered question stands until one runs. The four
Englewood listings stay staged until the nightly re-classifies them, since a
run only classifies what it pulled; nothing of theirs reached
`HousesforSale2`, because a staged listing with no confirmed photo is never
written. And the three cities have added about 3,800 `ls_listings` rows and
55,000 photo-metadata rows with **nothing downloaded**, which is the wide
market working as designed.

## The full run gets a cursor (2026-09-17): closing the incident's open half

The 09-17 incident above ended with one lesson fixed and one left open:

> "a run mode that gates its own 'done' flag needs a failure path, or one bad
> run becomes an infinite one. The second is not fixed here: a full run that
> keeps dying will still be retried every tick until midnight UTC. Worth a
> bounded retry before the next nightly."

It became urgent the same evening. Switching Wellen Park on took the held set
from about 1,300 listings to **6,154** — its three market cities are the whole
of Venice, North Port and Englewood. A full run verifies every held id at 50
per MLSGrid request with Media expanded, so the set now needs about **124
requests**, and the fetch phase gets **150 s** (`TICK_BUDGET_MS` 240 s less
`FETCH_RESERVE_MS` 90 s). This engine's own runs measure 4–13 s a request
against MLSGrid with Media, so the budget buys roughly **thirty**. The 03:00
nightly was going to truncate at about a quarter of the set.

Truncation was where two things compounded. `loadKnownListingIds` orders by
`listing_id` and always started at the beginning, so every attempt
re-verified the same opening slice and never reached the tail — and the 153
Wellen Park listings that needed it sat at positions 140 through 6,104.
Meanwhile `tick.ts` advanced `lastFullDate` only for a run that was *not*
truncated, so the tick chose `full` again five minutes later, and would have
kept choosing it until midnight UTC: no incremental, no photo pass, on two
sites that are live. Twenty-one hours of the thing that cost ten and a half
that morning.

**The fix is the shape discovery already uses.** `ls_engine_state.fullCursor`
holds the last id verified; `loadKnownListingIds({ after })` returns the
remainder; each run resumes and leaves its own mark, and reaching the end
clears it. `lastFullDate` now advances for a truncated run too — that is the
point of the cursor, since the remainder is carried rather than restarted —
and `decideMode` continues an outstanding cycle in an idle slot, after the
hourly and before discovery. A cycle finishes in a handful of runs instead of
looping, and the hourly keeps its cadence throughout.

Three details worth keeping. The resume key is a `listing_id`, not an offset,
because the order is stable: "everything after the last id verified" stays
exactly the remainder even as rows are inserted, and an id that lands behind
the cursor is picked up by the next cycle rather than skipped for ever. A run
that verified *nothing* leaves the cursor untouched instead of clearing it —
clearing would restart the cycle from the top, which is the bug wearing a
different hat. And a sliced full run is internally consistent: `missingIds`
is computed from `verifiedIds`, so only ids actually asked about can be
marked out of feed, the classify and write phases already work over
`[...pulledIds, ...missingIds]`, and `planRemovals` sees fewer candidates
against an unchanged `liveCount`, so the mass-delete guard errs safe.

### The cap the cursor needed (2026-09-17, an hour later)

The cursor above bounded the wrong half, and pressing Run Full proved it
within four minutes. The run fetched **all 6,164 held ids in all 124
requests** — 134 MB — comfortably inside the 150 s fetch budget, then died at
`upsert`: *"killed: the invocation ended before the run recorded a result"*,
Vercel's 300 s limit reached part-way through writing 6,164 raw records and
their roughly 300,000 media rows.

The estimate that sized the fetch budget was drawn from incremental runs
(4–13 s a request) and did not transfer: verify-by-id with `$expand=Media`
returns 50 listings a request and is far quicker per listing than an
incremental's paging. **Fetching by id is the cheap half; the write is what
costs.** So the cursor never engaged — it only saves a resume point when the
*fetch* truncates, and the fetch had finished.

`FULL_VERIFY_MAX_LISTINGS` (1,500) is the missing bound: a pass verifies at
most that many, `truncated` is now `verify.truncated || beyondCap`, and the
cursor carries the rest exactly as before. The size comes from what the
engine already does hourly without trouble — an incremental carried 1,431
listings end to end in 68 s, and 2,873 in 106 s — so six thousand held is
five passes across idle ticks.

Two things worth keeping from the failure. The partial upsert **persisted**:
`upsertListings` chunks at 50 and commits as it goes, so all 153 Wellen Park
skeletons came out of it with real data even though the run died before
classify. And the run row told the whole story without a log — stage
`upsert`, `mlsgrid_request_count` 124, `mlsgrid_items_fetched` 6,164,
`mlsgrid_bytes` 133,871,649 — which is the two-level trail earning its keep.

### The third bound: a query that outgrew its ordering (2026-09-17, 22:30)

With the cap in place the first pass worked — 1,500 verified, cursor saved at
`MFRA4701053`, 4,664 to go — and the second, resuming correctly from that
cursor, died at `upsert`:

```
load listing media: canceling statement due to statement timeout (57014)
```

`replaceListingMedia` sweeps stale rows by loading each batch's media and
comparing keys. It ordered that read by `id` while the only useful index is
`idx_ls_listing_media_key` on `(listing_id, path_key)`, so the filter used
the index and the sort did not — every matched row sorted, on every page of
`selectAll`. That was survivable at fifty thousand rows. Wellen Park's three
market cities took `ls_listing_media` to **179,170 rows / 163 MB**, and it
stopped being survivable.

Measured on production before changing anything:

| ordering | execution | plan |
|---|---|---|
| `order by id` | 486 ms | top-N heapsort over 5,962 rows, 5,989 buffers |
| `order by listing_id, path_key` | **1.5 ms** | merge semi join off the index, no sort, 948 buffers |

The caller reads the rows into a set and never looks at the order, so
`selectAll` only needs it to be *stable*. Matching the index costs nothing
and is about 325x faster per page.

**Three bounds in one evening, and the pattern is worth naming.** Each fix
revealed the next, because each removed whatever had been failing first: the
fetch had no cursor, so nothing reached the cap; the pass had no cap, so
nothing reached the query. The estimate that sized each one came from a
different workload than the one that broke — incremental request latency for
the fetch, incremental end-to-end time for the cap, a table a quarter of its
eventual size for the query. **Measure the thing that is about to run, not
the thing that looks like it.**

## Checking a site against a second source (2026-09-18): Wellen Park vs Redfin

Wellen Park's backfill finished with **156 listings written and 10,829
photos imported**. Jeff then pulled a Redfin search with his own filters
over the same area — 171 rows — and asked how it compared. This is the first
time one of these sites has been checked against something outside the
engine, and the method is worth keeping.

**Redfin's export carries `MLS#`, which is our `listing_id` without the
`MFR` prefix.** That makes it an exact join rather than an address match,
and it is the whole reason the comparison is worth anything. Of the 171
rows, 167 are sourced "Stellar MLS as Distributed by MLS Grid" — the same
feed the engine reads. The other four are two FSBO listings, one from a
different MLS, and Redfin's own footer row.

```
167  Redfin rows from MLS Grid
167  of those the engine holds, all Active      <- nothing missing from the feed
154  of those staged or live on the site
 13  Redfin has, the site does not
  2  the site has, Redfin does not
```

**The first line is the finding that matters.** Every single listing Redfin
found, the engine already had. The ingest is not missing anything; every
difference below is a question of what the site *shows*, which is a terms
question and a policy question, not a pipeline one.

### The 78 that are not a discrepancy at all

Venice has 118 Active Residential listings whose subdivision names Wellen
Park; the site shows 40. That gap looks alarming until you split it: **76 of
the 78 are `new_construction = true`.** Builder inventory is excluded on
every site (`classify.ts`, Jeff 2026-09-16), and Jeff's Redfin filter
excludes it too — which is why both lists agree despite neither mentioning
it. The two that are not new construction are two of the four real misses
below.

A second non-discrepancy in the same shape: 117 of the `%wellen%` rows are
`Residential Lease`. All 17 `ESPLANADE AT WELLEN PARK` listings are new
construction, so the site having no Esplanade neighborhood costs it nothing
today — but the first resale there will land in the unmatched view, and that
is the moment to decide whether Esplanade belongs on this site.

### What the thirteen actually were

Redfin's search is a **map polygon**; the engine's is a **set of subdivision
terms**. A polygon drawn around Wellen Park necessarily includes whatever
else is inside the rectangle, so most of the thirteen are other communities:

- **Seven correctly excluded.** Five in Plantation Golf & Country Club
  (`BERMUDA CLUB EAST AT PLANTATION`, `BUCKINGHAM MEADOWS` ×2,
  `KENWOOD GLEN 1 OF ST ANDREWS E`, `ST ANDREWS ESTS/PLANTATION`) and two in
  Oak Forest, Englewood, whose nearest neighbours are all Bay Vista Blvd.
- **Two that went to Jeff.** `THE RESERVE`, 434 and 444 Tremingham Way — a
  small enclave between Gran Paradiso and Plantation, $1.1M and $1.35M, and
  no such neighborhood on the site. **He confirmed they are not the site's**
  (2026-09-18), so the answer is to add nothing. Worth noticing that the
  terms reached that answer on their own: `THE RESERVE` is one letter from
  The Preserve's `the preserve`, and a looser term would have put both on
  the wrong neighborhood page.
- **Four the site arguably should show**, three of them fixed in migration
  060.

### Migration 060, and the repair that must not be made

`COACH HOMES II AT WELLEN PARK, PH 2` and `VERANDA III/WELLEN PARK PH I`
both say WELLEN PARK, and both are inside Wellen Park Golf & Country Club —
0.12 and 0.06 miles from listings the site already shows there. They are the
club's attached product, and its terms (`wellen park golf`, `wellen pk
golf`) reached only its single-family spellings.

**The obvious fix is a bare `wellen park` term, and it is the one that would
break the site.** Longest-term-wins compares term *lengths*: `wellen park`
is 11 characters and beats `brightmore` (10), `sunstone` (8), `lakespur` (8)
and `palmera` (7), so every `<neighborhood> AT WELLEN PARK` would quietly
move onto the country club's page. The same trap as `preserve` in migration
056, arriving from the opposite direction — there a term was too generic for
the market, here it would be too *long* for its neighbours.

So the terms name the products instead, each checked against every
subdivision in the database:

| term | matches | why it is safe |
|---|---|---|
| `veranda` | 1 subdivision | the only one anywhere in the feed |
| `coach homes` | 5 | three are Gran Paradiso's, excluded by `exclude_term` |
| `wellen park g` | WPGCC spellings only | covers `WELLEN PARK G & CC` |
| `wellen golf` | WPGCC spellings only | covers `WELLEN GOLF & COUNTRY CLUB` |
| `englewood golf course` | 1 subdivision | Boca Royale's name before it was Boca Royale |

The Gran Paradiso exclusion is redundant against longest-wins
(`gran paradiso` is 13 to `coach homes` 11) and is there anyway, because a
rule that holds by arithmetic accident stops holding the day someone renames
a neighborhood.

`ENGLEWOOD GOLF COURSE` is 84 Cayman Isles Boulevard, whose four nearest
listings are all Boca Royale — the closest, 11 Cayman Isles Boulevard, on
the same street. Its sibling `ENGLEWOOD GOLF VILLAS 11` (5 Barbados Road) is
**deliberately left out**: the name and the street fit Boca Royale's
Caribbean pattern, but its neighbours do not (Hebblewhite Court at 0.08
miles, Oak Grove on Englewood Road at 0.15, nearest Boca Royale 0.35 away at
the entrance boulevard). Equally consistent with just inside the gates or
just outside, so it went to Jeff — **not Boca Royale** (2026-09-18). That
decision is the difference between the term `englewood golf course` and the
term `englewood golf`, and it is why the narrow one is right.

**Both of the calls the data could not make came back "leave it off."** That
is the expected shape rather than a disappointment: the engine's terms fail
towards the unmatched view, where a human sees the row and decides, and two
out of two of those decisions here were to show nothing. A term set that had
guessed would have been wrong twice.

### Dry-run before applying, in SQL

The matcher is TypeScript, but its rule — longest matching term, street
qualifier, exclusion — is short enough to restate in SQL. Before applying
060, the proposed term set was run against every Active Residential resale
listing in Venice, North Port and Englewood and diffed against the current
assignment. It predicted exactly three changes and no movement anywhere
else, which is what the migration then did. **For a change whose blast
radius is "every listing on the site", a dry run that reproduces the
matching rule against production data is cheap and worth it.**

### The two the site has and Redfin does not

Both are `BOCA ROYALE EAST UNIT 20`, live, and both are flagged
`new_construction = false` while priced like builder inventory ($494,990 and
$527,990). Redfin almost certainly treats them as new construction and
filters them out. Nothing to fix; recorded because it is the one direction
where the site is the more inclusive of the two.

### Terms take effect on the next full run

Classification runs over the listings a run *pulled*. An incremental only
sees the modification window, and `discover` skips anything already known —
so a term change reaches listings the site does not yet hold only on a
**full** run, which verifies every held id. The 03:00 nightly picks it up;
the Hub's Run Full does it now.

## New construction is a fact about the site, not the listing (2026-09-18)

Jeff read Life in Wellen Park's shadow collection, saw an obvious builder
listing on it, and asked why. The answer was in two halves and only one of
them was a defect.

### Reading the collection, and a wrong guess worth recording

He first reported seeing `MFR103298178` as a row id. No such listing has ever
been in the engine: every one of the 6,215 ids is `MFR` + a **letter** +
digits, across seventeen prefixes, and none is `MFR` + a digit.

The guess made from that — that `HousesforSale2` still held rows from the
hand-run process, as Parrish's did — **was wrong**, and the export settled it
in one pass: 157 rows, every id engine-shaped, all Active, all
`MlgCanView true`. No residue at all. `MFR103298178` is the *listing agent's*
MLS id (John Neal, Neal Communities Realty), which the engine writes from
`ListAgentMlsId` into `listingAgentMls`; Stellar keys agents as `MFR` +
digits, which is exactly why it reads like one of ours.

Two lessons, both cheap: **a plausible mechanism is not evidence** — the
Parrish precedent fit so well that it got stated before the collection was
looked at. And in a 45-column export, "I saw this id" is worth resolving to a
*column* before theorising about what it means. (The `New Construction?` and
`Builder` columns are blank on all 157 rows and that is also not a signal:
the engine does not write them, they are leftovers from the old dashboard's
schema.)

### The real defect: the MLS flag is sometimes simply wrong

Jeff's instinct was right for a better reason. Two of those rows:

```
MFRA4704051   $527,990   BOCA ROYALE EAST UNIT 20   11417 Spring Hill Terrace
MFRA4704591   $494,990   BOCA ROYALE EAST UNIT 20   27633 Royale Dornoch Terrace
  PropertyCondition ["Under Construction"] · YearBuilt 2026
  BuilderName "Neal Communities of SWFL" · listed by Neal Communities Realty
  NewConstructionYN  false
```

Under construction, built this year, builder named, listed by the builder's
own brokerage — and the one field the engine reads says otherwise. These are
the same two that showed up in the morning's Redfin comparison as "on the
site, not in Redfin", which means **Redfin is not trusting that flag either**.

`PropertyCondition` is the corroborating RESO field, and across the 6,215
listings held it agrees with the flag almost perfectly:

```
["Under Construction"]   472 Active   466 flagged    6 not    98.7% agree
["Pre-Construction"]      49 Active    47 flagged    2 not
["Completed"]          1,015 Active   403 flagged  612 not    ← ambiguous
```

So `normalize.ts` takes **"Under Construction" only** as decisive. Not
`Pre-Construction`: `MFRTB8540951` on Longboat Key is Pre-Construction with
`YearBuilt 1974` and no builder — a $4M teardown lot sold for a proposed
rebuild, and a real listing. Not `Completed`: 612 of its 1,015 are ordinary
resales, and the word describes the house rather than who is selling it. Six
rows flipped; four were on a site.

### And the rule had a reason nobody had written down

Asked to confirm, Jeff gave the principle instead of the answer:

> Life in Longboat Key is okay to have new construction in its listings.
> That's because it doesn't have a new build section on its website. However,
> since all other sites we have new build sections (Life in Wellen Park, Life
> At Lakewood and Life At Parrish), new construction should be excluded from
> their collections.

`show_new_construction` had been false on every site since 2026-09-16 as a
blanket policy. It was never a fact about listings — it is a fact about
**whether the site has somewhere else to put them**. A site with a new-build
section would show the same home twice; a site without one just loses it.

Longboat Key has no such section, and the eleven listings it had been hiding
were the most expensive inventory on the island: $13,995,000 in Sleepy
Lagoon, St. Regis residences at $12,850,000 and $4,439,000, $11,900,000 in
Bay Isles, $6,495,000 in Emerald Harbor. Hiding those bought nothing.

Net, on each site's next full run:

```
lifeatparrish.com      277 → 275   2 Meritage, Oakfield Trails   (live)
lifeinwellenpark.com   159 → 157   2 Neal Communities            (shadow)
lifeinlongboatkey.com  197 → 208   +11 builder listings          (live)
lifeatlakewood.com       0 →   0   not switched on
```

**When a policy has a reason, put the reason in the column's comment.** Had
`show_new_construction` said "off wherever the site has its own new-build
section" from the start, Longboat would never have been set false, and the
eleven would not have spent a month invisible.

### A note on timing

Nothing in migration 061 touches `ls_site_listings`, deliberately. A
listing's place on a site is decided by `classifyListing` during a run, and a
run only judges what it pulled — an incremental sees its modification window,
`discover` skips anything already held. Term changes and eligibility changes
alike reach the sites on the next **full** run, which verifies every held id
across five cursor-paged passes.

## The Lakewood probe, and what it was worth (2026-09-18)

The probe had been the one thing gating Life At Lakewood since the morning,
and it had not run: every build logged `LWR: LS_LAKEWOOD_PROBE is not set`,
because the variable has to be added by hand in the Vercel console. Two
detours were taken before it ran, and both are worth recording.

**First detour: switching on in shadow instead.** Defensible —
`SHADOW_GRACE_MINUTES = 90` means a shadow site downloads no photo until its
media rows are ninety minutes old, so there is a designed window to read what
staged before anything reaches the Media Manager. The site was switched on at
15:52 and off again ten minutes later when Jeff asked for probe-first.
Nothing had happened: 0 site rows, 0 listings pulled, 0 runs in the window.

**Second: the variable was never the only way in.**
`listings-engine-phase2.mjs` had always run off a *branch* rather than a
variable. Giving the probe the same trigger meant a push was enough. The gate
came out again in the same change that recorded the findings, because a build
paying eight minutes for an answer already had is pure cost.

**And the engine had to be paused first.** The probe pages the whole MLS —
557 requests — on the same MLSGrid key the cron uses, and `mlsgrid.ts`
deliberately does not retry a 429: *"a 429 stops the run instead of retrying
into a longer token suspension."* Two clients at 600 ms spacing is about 3.3
requests/s against a documented 2/s. That would have failed the live sites'
runs, not just the probe. `ls_engine_enabled` went false at 15:55:50 and true
again at 16:10:37, with a failsafe check-in armed before anything else so a
lost container could not strand it. Zero runs missed.

### What it found

```
scanned 111,289 Active listings · 557 requests · 469s
6,804 in market — SARASOTA 3,726 · BRADENTON 2,736 · LAKEWOOD RANCH 342
743 match a neighborhood term
  − 159 new construction
  − 205 not Residential
  = ~415 would stage, against 404 rows in the collection today
LifeAtLakewoodListingPhotos: found
```

**One bad term, which is the whole point.** `indigo` reached
`INDIGO RIDGE AT UNIVERSITY PLACE` — a different master-planned community,
and it would have landed on this site's Indigo page. That is `preserve` on
Wellen Park again (migration 056), caught this time before a single row
staged. Migration 062 gives the term the guard the dashboard never needed.

**Five bare terms came back clean**, which is the other half of the point: a
probe that only ever confirms fears is not being read honestly. `cresswind`
reaches only `CRESSWIND LAKEWOOD RANCH`; `del webb` reaches Del Webb Catalina
at Lakewood Ranch, because Parrish's Del Webb at Bayview is in Parrish and
the city gate excludes it; `lake club` and `palisades` reach nothing the site
does not already show; `aurora` reaches `AURORA SUB`, which Jeff confirmed.
Two terms that had been guesses — `windward at lakewood` and
`windward/lakewood` — both hit real spellings, so Windward is no longer
unconfirmed.

Everything else in the "reaches a subdivision the site does not show" list is
the terms working rather than failing: `lakewood national` reaching twenty-one
Lakewood National subdivisions is correct, and those listings are simply ones
the old dashboard has not pushed.

### A site's own field names

The probe also reported four fields the engine writes that neither Lakewood
collection has. Jeff's export showed why — this is the original site, its
collection predates the engine, and three of them exist under older names:

| engine | Life At Lakewood |
|---|---|
| `villageSortHelp` | `villageSort` |
| `listingBrokerageContactInformation` | `listingBrokerContactInfo` |
| `lotSize` | `lotSize` *(Jeff added it)* |
| `isPublished` | `isPublished` *(Jeff added it)* |

Its page code reads those names, so writing the engine's names would put the
data in fields nothing renders: an empty neighborhood sort, and **no
brokerage attribution, which the MLS requires be displayed**.

`ls_sites.field_map` renames the engine's keys per site on the way out
(`transform.applyFieldMap`). The alternative was adding the engine's names
alongside the site's, which is what Wellen Park did — its collection carries
both `Listing Broker Contact Information` and
`listingBrokerageContactInformation`. That works, and leaves two fields
meaning one thing, and the next site drifts its own way again.

`_id` can never be remapped, and a test holds that: `deleteStaleRows` and
`loadOwnedIds` both match on it, so renaming it would make every row look
unowned and invite the stale sweep to delete the site's own listings.

**The reusable part:** an export of a Wix collection gives *display names*,
not field keys. The engine writes `purpleTag1`; Wellen Park's column for it
is labelled "Gold Tag 1". Diffing exports tells you where to look; only the
probe, which reads `.fields`, tells you what is actually there.

### And the probe could not have found the rest of it

Migration 062's rename was half right and would have shipped a quiet bug.
Jeff sent the site's own dashboard code, and `setDataObject` writes:

```js
"villageSort":  [villageSortHelp, 'Show All']
"homeTypeSort": [PropertySubType,  'Show All']
"bedroomsSort": [BedroomsTotal,    'Show All']
"garagesSort":  [GarageSpaces]
"galleryImage": <a constant camera badge>
```

`villageSort` is **multi-value**, and every row carries the literal string
`"Show All"` — which is what makes each filter's Show All option match
everything. Renaming `villageSortHelp` to it would have written a plain
string into an array field and broken the filter, with nothing to say so.
Three of those fields have no equivalent in the standard record at all, so
those filters would have gone blank on every engine-written row.

The asymmetry is the site's, not a slip: the sentinel is on `villageSort`,
`homeTypeSort` and `bedroomsSort` but **not** on `listingPriceSort`,
`bathroomsSort` or `garagesSort`. Migration 063 carries all of it as
`ls_sites.record_style`, the way `price_sort_style` already carries a
per-site difference in how one field is computed, and `field_map` keeps only
the rename that is genuinely just a rename.

**This is the limit of what a schema probe can tell you.** It compares field
*names* and can say one is missing. It cannot say what the page code does
with the fields that are present, and an export does not show it either —
an export has values, not the shape a filter expects. Ask for the page code
before writing to a collection built by someone else's pipeline.

### Two more things the dashboard code settled

**The `isActive` precedence bug is real.** `if (a !== -1 || b !== -1 || …
|| z !== -1 && isActive)` — `&&` binds tighter than `||`, so `isActive`
gates only the last term. Hence 18 Coming Soon rows in a collection meant to
be Active-only.

**And the chain never filtered anything.** Both branches return:

```js
if (…matched a village…) { …set Village/village1/URL…; return valData }
else { return valData }
```

A `.filter()` whose every branch returns a truthy object filters nothing.
Selection was entirely the curated `MLS_id_list`; the subdivision chain only
ever *labelled*. That is the difference between the old pipeline and the
engine stated as plainly as it can be, and it is why porting those terms as
filters was always going to behave differently — the thing migration 056
learned the hard way on Wellen Park.
