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

**What a site rules out (Jeff, 2026-09-16).** The rule stands: a listing
whose subdivision matches no neighborhood term is not on the site. The
first discovery scan showed what that costs (73 Longboat Key for-sale
listings, most of them boat slips at the Moorings and homes under the
generic subdivision "LONGBOAT KEY"), so the Neighborhoods page gained a
**Not shown: no neighborhood term** table per location
(`GET /api/internal/listings/villages/unmatched`, `src/lib/listings/unmatched.ts`):
the Active, for-sale listings in the market the engine holds, classified
with the site's rules, the `no_village` ones grouped by MLS subdivision
with count, price range and a few addresses, and a "add as a term of
<neighborhood>" action that posts the subdivision as a term. A missing
term is a glance and a click; nothing changes until someone clicks.

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

