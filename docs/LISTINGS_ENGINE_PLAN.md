# Listings Engine — Build Plan and Hand-off

Moves the MLSGrid listings sync out of each Wix site's Velo backend and into
one engine in this repo, controlled and monitored from the Hub. Starts with
Longboat Key (lifeinlongboatkey.com), built for twenty sites.

Prepared 2026-09-14 from the session that built the current Longboat Key
sync. Reference implementation: https://github.com/jeffreytwin/lifeinlongboatkey-listings
(public). Sister plan: `docs/FLOOR_PLAN_SYNC_PLAN.md`, which this follows
deliberately.

---

## Where things stand, and the next session's kickoff (2026-09-16)

Written at the end of the session that built the Hub's Listings section,
the photo pipeline and the cutover preparation, so the next session starts
from the facts rather than the chat.

**Cutover done (2026-09-16, 11:51 AM ET).** Longboat Key is live. The
order was the runbook's: Jeff published `backend/jobs.config` as
`{ "jobs": [] }` (~15:45 UTC), PR #289 was merged and its production
deploy (`dpl_Ee62GniUwbYpV58KsY1tedWNF72c`, commit `703689d`) confirmed
ready, then the step 3 SQL ran at 15:51:07 UTC (`write_mode = live`,
target `HousesforSale`, the 203 live rows marked for rewrite). The first
live run, `full:2026-09-16T15:52:14.284Z` (Run Full from the Hub),
finished ok in 21 s: 0 inserted / 203 updated / 0 deleted, 0 failed
writes, 0 errors, 0 warnings, 6 Wix requests, `stats_refreshed` true with
no `stats_failed` or `budget` event, so the neighborhood stats reached
`HousesforSale-DynamicPages`. Afterwards every live row carried a
`written_at` from that run, `needs_write` was 0, `ls_villages` summed to
203 across 105 neighborhoods (43 at zero with `zero_since`), and the photo
backlog was empty with the shadow grace off. The Errors panel held only
the pre-existing 2026-09-15 `warn/delete` for MFRA4697907. The site-side
checks of runbook step 5 (a listing page, a neighborhood page, a gallery,
the ads feed, the Live box against the inventory) were Jeff's in a
browser: the cutover session's egress policy blocked lifeinlongboatkey.com.
Rollback stays runbook step 6 through the 23rd; the step 7 cleanup follows
if the week is quiet. The "State of Longboat Key" paragraph below
describes the pre-cutover state.

**State of Longboat Key (11:30 AM ET, 2026-09-16).** The engine has been on
since 12:15 PM ET on the 15th. The site is still in **shadow mode**
(`write_mode = shadow`, target `HousesforSale2`): 203 live rows, 0 in
progress, 0 open errors. Every hourly run since the switch-on has finished
ok (the last six: +0/~11/-1, +1/~1, +0/~0, +0/~1, +0/~1, +0/~0, no failed
writes, no errors); the nightly full ran at 03:00 UTC on the 16th and the
retention purge with it. The photo backlog is empty and no photo run has
happened yet: in shadow mode the Velo pipeline still fetches each new
listing's photos and the engine waits 90 minutes before fetching one
itself, so far it has never had to.

**Merged to the default branch** (`claude/automate-form-routing-22fSB`):
PRs #283 to #288, the five Hub rounds (Neighborhoods, In Progress, Change
Log runs-first, Errors panel with dismissals, Eastern time, location names)
and step 3, the photo pipeline. Migrations 043, 044 and 045 are applied to
production (via the Supabase MCP; each file's header says so).

**Open:** PR #289 on `claude/intelligent-tesla-ba6jum` (neighborhood stats
for live sites + this doc's cutover runbook): draft, green, no review
threads. **It must be merged and deployed before the flip**, because the
Velo hourly job also writes each neighborhood's `activeListingCount` /
`zeroSince` and the four `*Active` ranges, which the neighborhood pages
show and the Google Ads inventory feed reads; #289 makes the engine write
them once the site is live. Once #289 is merged, restart the working
branch from the default branch (the branch then carries only merged
history).

**Jeff's position at hand-off:** he has read the runbook and intends to
proceed. He has **not** stopped the Velo jobs yet; he said he would
shortly. Nothing about the database has been flipped. The Supabase MCP
connection in the next session may need reconnecting (it dropped once in
this one); the runbook's SQL can equally be run in the Supabase SQL editor.

**The next session, in order:**

1. Confirm #289 merged and the production deploy finished (Vercel). If
   not merged, that is the first ask.
2. Wait for Jeff's word that `backend/jobs.config` on lifeinlongboatkey.com
   is `{ "jobs": [] }` and published (runbook step 2). Do not flip before:
   MLSGrid allows one download per photo per hour, and two pipelines
   fetching at once cost one of them its download.
3. On his go, run runbook step 3 (the `ls_sites` flip plus the nulling of
   `written_at` / `written_fingerprint`), then Run Full from the Hub or
   wait for the :30 hourly. Expect about 203 rewritten, 0 failed, 0
   removed, then the neighborhood stats step (no `stats_failed` entry).
4. Verify (runbook step 5): the Change Log run reads ok, the Errors panel
   is empty, a listing page, a neighborhood page and a gallery render on
   the live site, `GET /_functions/adsInventoryFeed` still answers with
   counts, the overview's Live box equals the site's inventory. Then
   watch the first few hourly runs: from now on the photo job fetches new
   listings' photos itself with no grace (expect `photos` entries and, on
   idle ticks, runs of mode `photos` when something is pending).
5. Rollback is runbook step 6; the week-later cleanup is step 7.

**Follow-ups not yet done, in rough priority:**

- Step 6 of the sequence: serve the ads inventory feed from the engine
  (today it is `GET /_functions/adsInventoryFeed` on the Wix site, which
  keeps working after cutover as long as the engine maintains the counts,
  which #289 does).
- The nightly shadow-vs-live comparison as a job: Jeff chose to run that
  analysis separately; the verification script has the comparison.
- `audit_log` entries for cutover and term edits (plan, "What the Hub
  already provides"): not written today.
- The Hub has no "Run Photos" button; `POST /api/internal/listings/run`
  with `mode: "photos"` (optionally `shadowGraceMinutes: 0`) is the
  manual path.
- Onboarding the other three sites (step 5): rows in `ls_sites` plus the
  neighborhoods import; no code.

**Operational facts.** Supabase project `hwjnymwzibpfylmkccox`
(form-submission-bot). Longboat Key `wix_site_id`
`8b20e921-5b70-4428-8fcd-8c8ef3bad3ab`. The engine's cron is
`/api/cron/listings-tick` every 15 minutes; the hourly currently starts at
:30. Hub: `/dashboard/listings` (Overview, Neighborhoods, Change Log; In
Progress from the site card). A check-in routine for PR #289
(`trig_011qSatiUvgFU1qSCTNZCCYA`) still fires into the old session at
16:32 UTC on the 16th; it is harmless and can be deleted.

**Kickoff prompt for the next session:**

> Read `docs/LISTINGS_ENGINE_PLAN.md`, starting with "Where things stand"
> and the "Cutover runbook: Longboat Key". Confirm PR #289 is merged and
> deployed. Then wait for my word that the Velo jobs are stopped, run the
> runbook's step 3 SQL on my go, start the first live run, and verify it
> per step 5. Keep the Hub's Errors panel and the Change Log in view for
> the first hours.

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
