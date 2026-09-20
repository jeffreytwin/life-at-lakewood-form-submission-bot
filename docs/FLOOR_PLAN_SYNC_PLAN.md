# Floor Plan Sync Pipeline — Build Plan

Replaces the manual freelancer process (~$700–1,000/mo, monthly cadence, frequent
misses) with an automated nightly pipeline: scrape floor plan data directly from
builder websites, diff against our own data, queue only the changes for one-click
human approval, and write approved changes into **new, private Wix collections** that
will eventually replace the legacy collections on each site.

Sites in scope: **lifeatlakewood.com**, **lifeinwellenpark.com**, **lifeatparrish.com**
(future sites added by config, not code).

---

## Where things stand (2026-09-18)

Written when the pipeline was picked back up after ten weeks idle. Built
July 2 to 3 (PRs #258 to #262), vertical slice run July 2 to 4, nothing
since; the listings engine (`LISTINGS_ENGINE_PLAN.md`) took September.

**Live state, from Supabase.** 34 builders seeded, every one paused. 99
builder×community connections; one has a recorded run (SimplyDwell at
Broadleaf, 2026-07-04, 26 plans, all 26 adds rejected). 10 Toll Brothers
plans at The Isles were synced to Lakewood's FloorPlansV2 as drafts on
2026-07-02 to 04 and are still there. The nightly loop is off and has never
run; only SimplyDwell is marked onboarded, so switching it on would run
nothing. No cutover report has ever been generated.

**Fixed on 2026-09-18 (this branch).**

- Photo URIs now carry origin dimensions (`media.ts`, migration 064). Every
  photo is fetched and measured with sharp before Wix imports it, the size
  is stored in `fp_media_map`, and a photo that cannot be measured is left
  out rather than written as a URI Wix refuses. The 10 Toll drafts were
  written without the fragment and are expected to show broken images in
  the CMS until a change touching them is approved.
- The record an approved update writes keeps user-edited fields
  (`diff.ts`, `mergeForUpdate`). Before, `{...current, ...plan}` reverted
  every override the diff had declined to propose.
- Galleries are diffed (photos and blueprints, in order, `fieldChanges`),
  described as "3 photos · 5f2a9c1e" so a rejection sticks to that exact
  set. This is also the repair path for the Toll drafts: Run the
  connection, approve the photo and blueprint updates.
- `pipeline/slice/pending-builder-updates.sql` applied: builder engine
  labels, Lee Wetherington's real base URL, Taylor Morrison and Mattamy
  connection URLs pre-seeded.
- The approve route has `maxDuration = 300`, like the nightly tick.

**Update 2026-09-19 (Toll Brothers first, per Jeff).**

- Records carry `description`, `virtualTourUrl`, `virtualTourImage` and
  `galleryMeta` (caption, room and origin per image); the write-back fills
  `floorPlanDescription`, `virtualTourLink`, `virtualTourImageV2`, and puts
  captions on gallery items as title and alt; both are diffed and editable
  in the Hub.
- Gallery ordering, first pass (`gallery-order.ts`): Jeff's room order,
  read off captions, titles and file names; unplaced photos keep page
  order before the exteriors. Applied by the Toll extractor; the vision
  pass slots into the same sort later.
- Toll Brothers reads each plan's own page for the captioned showcase
  photos, its elevations as the exterior options, its walkthrough as the
  Matterport share link (or InsideMaps link) with its still, and its
  description. Where each piece lives: `pipeline/slice/DISCOVERY_NOTES.md`.
- Settings → Builder Connections has **Reset**: removes a connection's
  plans from Floor Plans V2 (drafts included) and the Hub, clears its run
  history, and (since 2026-09-20) removes the imported pictures too. This is how the ten Toll drafts get
  replaced: Reset, then Run, then approve.
- The run route allows 300 s, since a Toll community is now a page per plan.

**Update 2026-09-19, later (Jeff's first pass over the review queue).**

- A plan's identity is builder + community + name (migration 065): two
  builders with an "Aria" on one site, or one builder's plan in two
  communities, no longer share a canonical row; the Wix row's `syncKey` is
  builder/community/plan. Wix makes dynamic-page slugs unique on its own
  (`the-aria`, `the-aria-1`).
- The review queue shows **one row per plan** (`group-changes.ts`): the
  queue still holds one row per changed field, so a rejection sticks to one
  exact change, but a person approves or rejects the plan, and the write
  happens once per plan (`POST /changes/bulk`). The edit overlay only
  saves; approval is from the list. The main photo opens the overlay;
  galleries reorder by drag and drop; hovering shows a picture large;
  square feet carry a thousands separator.
- Blueprints are appended to the end of the photo gallery on the site and
  keep their own gallery too. Anything with a loft sorts right after stairs.
- **Reset before re-running a builder whose Wix rows were deleted by hand.**
  Deleting items in the CMS leaves the canonical rows behind, so the diff
  proposes updates rather than adds and every approval 404s (WDE0073).
  The write-back now re-creates an item Wix no longer has (as a draft in
  draft mode) and treats a remove of a missing item as done, so nothing
  strands; but Reset is still the clean path, and it also forgets the
  scope's rejections. A rejection means "not this exact change": the nine
  quick move-in adds rejected on 2026-09-19 stay suppressed until their
  price changes or the connection is reset.

**Update 2026-09-19, evening (one schema for every site; quick move-ins).**

- Quick move-ins are filed the way Wellen Park and Parrish file them
  (`docs/WIX_COLLECTIONS.md`, "Quick move-ins"): their own row named by
  street address with a price, one picture, a description and the base
  plan's name in `relatedFloorPlanQuickMoveInOnly`; the base plan carries
  the flag, the banner text, the badge, the dot and the price tag.
  `quick-move-ins.ts` ties each quick move-in to its base plan and flags
  the base plans on every run, for every builder; the diff reviews a quick
  move-in only on what its row shows; the queue reads "Quick move-in of
  Lori" and warns when no base plan was found; the overlay edits the base
  plan.
- Every row carries the `builder1` and `villages` references the
  freelancers set, looked up by title in the site's Builders and villages
  collections. An update reads the Wix item first and sends back the
  fields the pipeline does not own (score, notes, anything set by hand).
  Wix's update replaces the whole item, so before this every approved
  update would have wiped them.
- **One standard Floor Plans V2 schema**, in code
  (`standard-floor-plan-schema.json`: 31 data fields, keys, types and
  labels, "Neighborhood" rather than "Village"). Settings → **Sites** reads
  every site's collection live from Wix, diffs it against the standard and
  aligns it step by step: add what a site lacks, apply the standard
  labels, or remove a site's extra fields (confirmed separately).
  `scripts/floorplan-wix-schema-snapshot.mjs` applies the labels and
  missing fields from a preview build and caches the schemas in
  `fp_collection_schemas` (migration 066). **Finding:** the three V2
  collections were already identical in keys and types (38 fields,
  revision 3); Wellen Park's and Parrish's legacy collections are not the
  same as each other (Parrish has six more fields and uses `score` as a
  "Status" tag list); what differed for a person was V2's raw-key labels,
  now the human ones everywhere. Details in `docs/WIX_COLLECTIONS.md`,
  "Schemas compared across sites".
- A base plan needs its **score** before it can be approved (Jeff: the
  sites list high scores first; the freelancers used 1 to 10, with a few
  11s). It is set in the edit overlay, kept across runs, never proposed as
  a change, and written to the row's `score`. Approve is held until it is
  set; Approve All leaves such plans pending and says so. A quick move-in
  carries no score and needs none.
- The whole review row opens the overlay.

**Update 2026-09-19, night (mobile, views, and how a broken builder site shows up).**

- On a phone or tablet the overlay's hover preview and drag-and-drop are
  off (there is no hover, and a press-and-hold started a drag); the arrows
  move pictures. The queue has a **Show** filter (floor plans only, quick
  move-ins only, both) and an **Approve all Quick Move-Ins** button, which
  takes every pending quick move-in on the selected site(s) whatever the
  view shows.
- **How a broken builder site shows up.** A run that throws, finds no
  plans, or finds far fewer plans than last time (under 60% of the last
  count, `coverage.ts`) is recorded on the connection as a failure:
  `last_run_status` reads "error: …", "zero results (treated as failure)"
  or "partial: 3 of the 16 plans found last time", and
  `consecutive_failures` counts up until a good run resets it. No removal
  is ever proposed from such a run, so a broken page cannot empty a site.
  Where a person sees it: a red **Builder sites needing attention** banner
  at the top of the Floor Plans page (every active connection whose last
  run failed, worst first, with the status and the run time); the same on
  Settings → Builder Connections, where a builder shows "N failures" from
  two in a row; and the nightly digest SMS, which now names the failing
  connections ("Needs attention: Toll Brothers/The Isles (zero results, 3×)")
  once nightly runs are on and a digest phone is set. What is still
  missing: nothing pages anyone between digests, and a page that changes
  shape while still returning most of its plans (wrong prices, missing
  photos) reads as "ok"; the review queue is the check for that.

**Update 2026-09-20 (broken drawings on The Isles; nothing broken is written again).**

- Every base plan's gallery on The Isles ended in one broken slash per
  floor plan drawing. Toll serves its drawings as SVG; Wix files a URL
  import of an SVG as vector art (mediaType VECTOR, file id ending in
  `.svg`), which no IMAGE field or gallery can show. Drawings are now
  rendered to PNG before import (`media.ts`, `rasterizeSvg`; stored in the
  `photos` bucket and imported from there), and a vector import already in
  `fp_media_map` is re-imported that way.
- **Every picture is verified with Wix before its row is written**
  (`writeback.ts`, `verifyImports`; migration 067 `verified_at`,
  `media_type`): Wix must report the file READY as an IMAGE with a size;
  a failed or non-image file is left out and forgotten; a plan whose
  photos all fail is not written, and the approval fails with the reason.
- Settings → Builder Connections → **Rewrite** writes every plan of a
  connection to Wix again under the current rules, keeping scores and
  edits: the repair for The Isles (16 plans, 16 drawings re-imported as
  PNG). It works within a time budget and continues across calls.
- **Standard values** (`standardize.ts`, applied to every engine's output
  before the diff): the home type is one of Single Family Home, Townhome,
  Condominium, Coach Home, Attached Villa (a builder's own label is mapped
  onto them and kept in `raw.homeTypeRaw`; an unplaceable label leaves the
  field blank for the overlay's drop-down), and bedrooms and bathrooms are
  one number, the larger end of any range ("3-4" is 4).
- **An approval publishes.** Every site's `insert_publish_mode` is
  'published' (2026-09-20): an approved plan is inserted as a published
  item, and an approved update to a row that is still a draft replaces the
  draft with a published item, since Wix will not flip a draft's status
  through an update. Rewrite does the same for a whole connection.
- **Scores are remembered apart from the plans** (`fp_plan_scores`,
  migration 068): the queue's PATCH route records every score by plan
  identity and the sync core puts it back on a plan it queues again, so a
  plan the builder drops and later lists again keeps its score. Reset
  asks for the word RESET to be typed.
- **Reset wipes everything** (Jeff, 2026-09-20): the plans' Wix rows, the
  pictures it imported (their files leave the Media Manager, rendered
  drawings leave storage, `fp_media_map` rows go; a picture another plan
  on the site still uses is kept), queued changes, follow-ups, plan links
  and scores. The next Run starts from nothing and tests the whole path
  from the builder's site: fetch, render, import, verify. An earlier
  version kept the pictures and the scores; it no longer does.
- **The Neighborhood reference follows the site's schema** (2026-09-20):
  every Isles row was published without its `villages` reference because the
  writer looked "The Isles" up in `HousesforSale-DynamicPages`, and on
  Lakewood that field points at `AmenitiesbyVillage` (Wellen Park and Parrish
  point at `HousesforSale-DynamicPages`). The writer now reads where
  `builder1` and `villages` point from each site's Floor Plans V2 schema,
  finds the item by exact title and then by any title or name field, and the
  snapshot build caches those collections and probes "The Isles". Rewrite
  (Settings → Builder Connections) fills the reference in on rows already
  published.
- **A quick move-in can stand in for its floor plan** (Jeff, 2026-09-20):
  quick move-ins only show on the sites under their plan, so a home of a
  plan the builder no longer lists had nowhere to appear. In the queue's
  edit overlay, an unmatched quick move-in (amber "base plan not found")
  offers "Create floor plan '<name>' from this home". The decision is
  remembered (`fp_stand_in_plans`, migration 069, keyed by the plan's name
  so a second home of the plan counts too) and every Run rebuilds the plan
  from the homes that name it (`stand-ins.ts`): the richest home's pictures
  read from its own page, the drawings, the description, the specs, the
  lowest of the homes' prices. It is queued as a new plan needing a score,
  the homes are tied to it, and it follows the homes' changes as updates.
  When the last home sells the plan leaves through the removal queue like
  any other; a real plan of the same name, listed again, takes the same row.
  Reset removes the rules with everything else.
- **The virtual tour button is the site's own** (Jeff, 2026-09-20): a row
  with a virtual tour link carries its site's button picture in
  `virtualTourImageV2` (`site-assets.ts`: the one value the freelancers put
  on every legacy row, per site), and the builder's still is no longer
  imported for it; a site without a button keeps the still. Rewrite puts
  the button on rows already published.
- **URL discovery prefers the site's market** (2026-09-20): Monterey's
  connection had been pointed at Toll's Regency at Monterey in California
  (`/regency/Monterey-CA`, the shortest sitemap URL named "monterey"), so
  every Run failed with "no models found". Discovery now boosts a candidate
  whose URL carries the site's name (`lakewood-ranch`) and accepts a page
  only when it names the community and, where the site's market is known,
  the market too (`discover-url.ts`, `rankCandidates` / `pageIsCommunity`).
  The snapshot build probes Toll's sitemap for Monterey and logs what each
  page carries.

**Known gaps, in the order they bite.**

1. Closed 2026-09-20: every import is verified with Wix (READY, an IMAGE,
   a size) before its row is written, inside the approval; see the update
   above.
2. Most extractors capture list-page images only: Lennar hero and
   elevations, Taylor Morrison 1 elevation, Mattamy and the MPC aggregator
   1 card image, the Claude engine whatever the list page shows. Only
   Meritage and DRB return interiors, and Toll Brothers since 2026-09-19
   (see below). The legacy galleries the freelancers built have median
   sizes of 6 (Lakewood), 16 (Parrish) and 12 (Wellen Park) with 158 / 297
   / 110 plans over 10 photos; `MAX_GALLERY_IMAGES` is a 40-photo safety
   bound until Jeff decides on a cap. Each remaining builder needs its own
   look at where the photos, the exterior options and the virtual tour
   live (Jeff: builder by builder, maybe community by community).
3. Approval does the Wix work inside the request, one image at a time,
   and bulk approve sends one request per change. Full galleries need the
   listings engine's tick-and-budget pattern.
4. The `builder1` and `villages` references are looked up by title at
   write time (since 2026-09-19); a builder or community whose name is not
   an item title on that site goes out without the reference, with a
   warning in the log. Lennar is "Lennar" in `fp_builders` and "Lennar
   Homes" on some sites; check the Builders titles before onboarding a
   builder, or the site's builder filter will not find its rows.
5. Gallery diffs for `fetch_claude` builders may be noisy: the Claude
   engine's image-to-plan association can vary run to run. The pending
   dedupe keeps it to one row per plan; watch the queue when they run.

**Planned: gallery ordering (Jeff, 2026-09-18).** Order wanted: primary
picture, kitchen, living room, dining room, pool/lanai, office, hallways,
stairs, bedrooms, bathrooms, laundry, closets, extra exterior. Approach:
detail-page galleries first (gap 2); then classify each photo by builder
metadata (DRB image types, Taylor Morrison alt text, Lennar's hero /
elevation / drawing split), then file-name room words (on Parrish 2,312 of
7,105 legacy gallery items carry one, Lakewood 870 of 4,337, Wellen Park
40 of 2,505), then Claude vision for the rest (one request per plan,
downscaled thumbnails, structured output of room and confidence per
photo). Labels stored beside each URL and cached per image so nightly runs
never reclassify; a manual reorder in the Hub is a user override; the room
name written into each gallery item's `title` and `alt`. Cost at 20 photos
a plan is about $0.06 with Opus 5 and $0.025 with Sonnet 5, so a one-time
pass over the ~1,600 legacy plans is on the order of $100, half through
the Batch API. Open questions: where foyer, garage, bonus/loft, outdoor
kitchen, amenities, aerials and virtual staging go; whether the primary
bedroom leads the bedrooms; whether the primary picture stays at gallery
position 1 as well as in `floorPlanImage`; whether to cap galleries;
whether quick move-ins follow the same rule; whether to reorder the legacy
galleries at cutover.

---

## Decisions locked (from planning discussions)

1. **New Wix collection per site, fully pipeline-operated.** Each site gets a fresh
   Floorplans collection that is not consumed by any public page until cutover.
   The pipeline writes to it with confidence from day 1. Freelancers continue to
   maintain the legacy collections until cutover; the two never interleave.
2. **Cutover = repeater re-bind.** When a site's new collection has proven itself,
   Jeff re-points the build page repeater (and community pages) to the new
   collection. Legacy collection is retired afterward.
3. **Standardize on the Parrish schema.** Life At Parrish carries the latest/best
   collection schema; all three new collections use it. The pipeline normalizes
   every builder's data into this one canonical shape.
4. **Images are uploaded to Wix Media Manager** (media galleries require Wix URLs).
   Uploads are deduped so unchanged images are never re-uploaded.
5. **Human approval gates every write.** Nothing reaches a Wix collection without an
   approved row. Approval lives in the Hub (this repo) with a badge, same pattern as
   the email hub drafts view.
6. **Starred floor plans.** Plans used in brand emails can be starred in the Hub.
   Changes to starred plans generate persistent follow-up tasks ("update the brand
   email pricing" / "plan removed — pick a replacement") with their own badge,
   because the brand email lives outside Wix and no write-back can fix it.
7. **Extraction is engine + config, not 36 bespoke scrapers.** Three generic engines
   (JSON API adapter, fetch → Claude extraction, Playwright render → Claude
   extraction); each builder is a config row selecting an engine plus params.
8. **New insertions land in Wix as Drafts.** After approval, an `add` is written to
   the Wix collection in draft state; the user publishes it in Wix manually. This is
   an initial safety measure — a Hub setting (`insert_publish_mode`) flips inserts to
   published-on-sync once confidence is earned. Updates and removes to existing rows
   apply normally. The Hub keeps a "publish queue" of synced drafts so none are
   forgotten; the nightly run detects items published in Wix and clears them
   automatically.
9. **Builders settings area in the Hub.** A Settings → Builders view shows every
   builder connection (method, communities served, last run, health, plan counts)
   with per-connection **pause/resume** — at both the builder level and the
   builder×community level. A paused connection is skipped entirely: no scrape, no
   diff, and critically no removals queued (a pause must never look like plans
   disappearing).

---

## Architecture

```
NIGHTLY (GitHub Actions cron)
  for each active builder_communities row:
    engine(builder.extraction_method, extractor_params)   → raw plans
    normalize into canonical (Parrish-standard) shape      → scraped plans
    match to known plans via plan_links (stable IDs)       → matched set
    diff scraped vs canonical floor_plans in Supabase      → adds / updates / removes
    apply removal guards (see Guardrails)
    upsert into pending_changes (status=pending)
  after all rows: send digest notification ("N changes await review")
  nightly cross-collection cutover report per site (new vs legacy, field-mapped)

REVIEW (Hub — this repo, on Vercel)
  "Floor Plans" view: pending changes table, filter by site/community/builder
  per-row approve/reject, bulk approve, sidebar badge with pending count
  inline warning when approving a change that touches a STARRED plan
  approve → status=approved

WRITE-BACK (Vercel serverless, on approve)
  resolve site → Wix collection ID + credentials
  upload any new/changed images to Wix Media Manager (deduped via media_map)
  adds   → insert as DRAFT (or published, per insert_publish_mode setting)
           → status=synced_draft, appears in Hub publish queue until published in Wix
  updates/removes → apply to the live row via Wix Data API → status=synced
  update canonical floor_plans table on success
  failure → status=failed + error_detail (visible in Hub)
  if plan is starred → create follow_up_task (own badge, persists until done)
```

Supabase is the system of record (`floor_plans` canonical table); the Wix
collections are render targets the write-back projects into. This is what makes
cutover safe and future sites cheap.

---

## Data model (Supabase migrations, continuing the 0NN_ series)

### `fp_sites`
- `id` pk, `name`, `domain`
- `wix_site_id` (Wix API keys are account-level; one key + per-site ID header)
- `wix_collection_id` (the NEW collection)
- `legacy_collection_id` (read-only; used only by the cutover report)
- `active` bool

### `fp_communities`
- `id` pk, `site_id` fk, `name`, `wix_village_slug`

### `fp_builders`
- `id` pk, `name`, `base_url`
- `extraction_method` enum: `json_api` | `fetch_claude` | `render_claude`
- `engine_config` jsonb (endpoint templates, selectors/hints, auth quirks)
- `audit_notes`, `active` bool (pause/resume from the Hub's Settings → Builders view;
  paused = skipped entirely by the nightly run, no diff, no removals)

### `fp_builder_communities` (the nightly work list)
- `id` pk, `builder_id` fk, `community_id` fk
- `extractor_params` jsonb (community URL, zip, builder-internal community id, …)
- `active` bool (per-community pause/resume, same semantics as the builder-level flag)
- `last_run_at`, `last_run_status`, `last_plan_count`, `consecutive_failures`
  (drives the zero/partial-scrape guard and the health display in Settings → Builders)

### `fp_floor_plans` (canonical record, Parrish-standard shape)
- `id` pk, `site_id` fk, `community_id` fk, `builder_id` fk
- `plan_key` (stable natural key: builder + community + normalized plan name)
- `wix_record_id` (nullable until first sync)
- canonical fields: `name`, `price`, `beds`, `baths`, `sqft`, `quick_move_in`, image refs, page/builder/village link fields (finalized in Phase 0 from the Parrish schema)
- `starred` bool (drives brand-email follow-ups; lives here, never in Wix)
- `source_url`, `first_seen_at`, `last_seen_at`, `removed_at` (nullable)

### `fp_plan_links` (fuzzy-match once, then never again)
- `id` pk, `floor_plan_id` fk
- `scraped_identity` (builder's own id/slug/name-as-scraped)
- `matched_by` enum: `exact` | `fuzzy` | `manual`, `confirmed` bool

### `fp_media_map` (image dedupe)
- `id` pk, `site_id` fk
- `source_url`, `content_hash`
- `wix_media_id`, `uploaded_at`

### `fp_pending_changes` (the review queue)
- `id` pk, `site_id`/`community_id`/`builder_id` fks, `floor_plan_id` fk nullable
- `change_type` enum: `add` | `update` | `remove`
- `field_changed`, `old_value`, `new_value` (nullable; for updates)
- `proposed_record` jsonb (full canonical record for adds/updates)
- `status` enum: `pending` | `approved` | `rejected` | `synced_draft` | `synced` | `failed`
  (`synced_draft` = insert landed in Wix as a draft; the nightly run promotes it to
  `synced` once it detects the item was published in Wix — until then it sits in the
  Hub's publish queue)
- `error_detail` nullable, `run_id`, `created_at`, `updated_at`
- unique dedupe index on (site, community, builder, plan_key, field_changed) WHERE status = 'pending' — re-runs update the existing pending row, never duplicate it

### `fp_follow_up_tasks` (starred-plan queue)
- `id` pk, `floor_plan_id` fk, `pending_change_id` fk
- `task_type` enum: `price_changed` | `plan_removed` | `other_change`
- `detail` (e.g. "$489,990 → $502,990")
- `status` enum: `open` | `done`, `created_at`, `resolved_at`

### `fp_field_maps` (per-site legacy → standard mapping)
- `id` pk, `site_id` fk, `legacy_field_key`, `standard_field_key`, `transform` nullable
- Powers the cutover report and the one-time editorial port.

### Settings (existing Hub settings mechanism)
- `insert_publish_mode`: `draft` (default) | `published` — controls whether approved
  `add`s land in Wix as drafts requiring manual publish, or go live on sync.
  Flipped in the Hub settings UI once the process has earned trust; can be set
  per site if we ever want to graduate sites independently.

RLS mirrors the existing Hub pattern: service-role key for the Action inserts and
write-back status updates; the Hub UI uses its existing authenticated access.

---

## Extraction engines (3, not 36)

| Engine | When | How |
|---|---|---|
| `json_api` | Builder exposes a discoverable JSON endpoint | Direct fetch, map fields. Most robust; prefer when the audit finds one. |
| `fetch_claude` | Server-rendered HTML | Fetch page(s), strip to relevant content, Claude API "extract these fields as JSON" with a strict schema. Survives redesigns. |
| `render_claude` | JS-heavy site | Playwright (pre-installed pattern) renders, then same Claude extraction. |

Claude extraction reuses the existing `src/lib/ai` integration pattern. Every engine
returns the same normalized plan shape; adding a builder is a config row, not code.
Estimated Claude cost at nightly × ~36 builders: single-digit dollars/month.

---

## Guardrails (non-negotiable)

- **No write without an approved row.** Ever. Auto-approve rules (later phase) are
  explicit, per-field, and conservative.
- **Drafts-first inserts.** While `insert_publish_mode = draft`, an approved `add`
  can never become publicly visible without a human publishing it in Wix. The Hub's
  publish queue tracks synced drafts so none are forgotten.
- **Pause is inert, never destructive.** A paused builder or builder×community is
  skipped by the nightly run entirely — no scrape, no diff, and no removals queued.
  Resuming picks up cleanly on the next run (the two-consecutive-nights removal rule
  restarts from zero after a resume).
- **Removal protection, two layers:** (1) zero-plan scrape for a builder that
  normally has plans = scrape FAILURE, skip diffing entirely; (2) a `remove` is only
  queued if the plan is missing on **two consecutive nights** AND the scrape returned
  ≥ 60% of that builder/community's last known plan count. No mass deletes, period.
- **Idempotent everything:** re-running the nightly job updates existing pending rows
  (dedupe index), image uploads are content-hash deduped, write-back is safe to retry
  per row via the status state machine.
- **Rejections stick.** The nightly diff must not re-queue a change identical to a
  rejected row (same plan_key + change_type + field + new_value). If the underlying
  scraped value later changes, that is a NEW change and queues fresh. Rejecting means
  "no to this," not "never sync this plan."
- **User edits are overrides.** Fields edited in the Hub before approval are recorded
  in the record's `userEditedFields`; the nightly diff skips proposing updates that
  would revert an overridden field to the builder's value.
- **Starred-plan friction:** approving a `remove` or price `update` on a starred plan
  shows an inline warning before the click and generates a follow-up task after sync.
- **Credentials as secrets:** Wix API key in GitHub Actions secrets + Vercel env vars;
  `fp_sites` stores only IDs, never keys.
- **Silence is an alarm:** if the nightly run produced no digest by morning, or a
  builder errors twice in a row, alert via the Hub's existing notification patterns.

---

## Build phases

### Phase 0 — Builder audit + schema standard (no scrapers yet)
- Script visits each of the ~36 builders' floor plan pages (≥1 community each),
  classifies extraction method, records candidate endpoint/page URLs and notes.
- **Run the audit from a GitHub Actions runner**, not locally — several national
  builders (Lennar, Pulte, …) sit behind bot protection that treats datacenter IPs
  differently. If a builder blocks the runner, note it; fallback options (different
  egress, cached-render path) get decided per builder, not globally.
- Document the **Parrish collection schema** as the canonical standard (field keys,
  types, reference fields, gallery expectations).
- Draft the **legacy → standard field maps** for Lakewood and Wellen Park.
- Output seeds `fp_builders` and `fp_field_maps`.

**Jeff provides:** Wix API key + the three site IDs; access/notes on the Parrish
collection; builder roster per site if handy (otherwise derived from the live
build-your-home pages during the audit).

**Done when:** every builder has a classification + candidate source, and the
standard schema doc exists.

### Phase 1 — Supabase foundation
- Migrations for all `fp_*` tables above (continuing this repo's `supabase/migrations` series), RLS, seed data from the audit.

**Done when:** tables exist, seeds loaded, `fp_builder_communities` reflects the real
builder×community matrix.

### Phase 2 — Wix side: new collections + client
- Create the new (private) Floorplans collection per site with the standard schema,
  including reference fields to the same Builders/Villages targets the repeaters
  will need.
- Build the Wix Data API client: CRUD on collection items + Media Manager upload,
  wired to `fp_media_map` for dedupe.
- **Verify draft support in the Data API** as part of this phase: confirm the API can
  insert items in draft state and read publish status. If the API can't express
  drafts directly, fallback is a `pipeline_status` field ("staged"/"live") on the
  collection plus a filter on the repeater's dataset at cutover — identical safety,
  same publish queue UX in the Hub.

**Done when:** a test record with an uploaded image can be created **as a draft**,
published, updated, and removed in each site's new collection via the client.

### Phase 3 — Vertical slice (one builder, one community, end to end)
- Pick the most robust builder from the audit (ideally `json_api`) in one Lakewood
  community. Build: engine run → normalize → plan matching → diff → pending rows →
  Hub review view (table, filters, approve/reject, sidebar badge) → write-back into
  the private Lakewood collection, including images. Inserts land as drafts
  (`synced_draft`) and appear in the Hub's publish queue; the nightly run promotes
  them to `synced` once published in Wix.
- Hub view lives alongside the existing dashboard views; write-back is a serverless
  route following the existing `internal/` API patterns.

**Done when:** Jeff approves a real detected change in the Hub and sees it appear in
the private collection, and a rejected change never lands.

### Phase 4 — Scale builders + starred plans + digest
- Onboard remaining builders as config rows, most robust first. Each builder
  automatically covers every community it serves via the join table.
- Starred plans: star toggle in the Hub, follow-up task queue + badge, inline
  warnings on approval.
- **Settings → Builders view**: every builder connection with its extraction method,
  communities served, last run time/status, consecutive-failure health indicator,
  and current plan counts — plus pause/resume toggles at the builder level and the
  builder×community level.
- Nightly digest notification ("14 changes await review — 2 touch starred plans").
- During this phase the collections are private, so **bulk-approve aggressively** to
  push volume through the state machine and surface edge cases early; tighten the
  approval posture before cutover.

**Done when:** all active builder×community rows run nightly and populate all three
private collections.

### Phase 5 — Harden + schedule
- Nightly GitHub Actions cron across all active rows. Failure visibility in the Hub
  (`failed` rows, per-builder last-run status), zero/partial-scrape guards verified
  with fault injection, alerting wired, optional per-field auto-approve rules
  (e.g. price deltas under a threshold) — reusing the email hub's auto-approve
  pattern.

**Done when:** two consecutive weeks of clean unattended nightly runs, with at least
one injected failure correctly caught and surfaced.

### Phase 6 — Cutover, per site
- Nightly **cutover report** (running since Phase 4): new collection vs legacy,
  field-mapped, per site. Go signal: several consecutive weeks where every
  disagreement is a legacy error, not a pipeline error.
- Pre-swap checklist per site:
  1. Inventory every consumer of the legacy collection (repeaters, community pages,
     dynamic item pages, datasets, Velo code querying by ID). If dynamic floor plan
     pages exist, recreate against the new collection with matching slugs first.
  2. One-time **editorial port**: migrate any freelancer-added content the scrapers
     can't source (curated copy, hero images, display order, featured flags) via the
     field map.
  3. Jeff re-binds the repeater(s). Off-hours, per site, one site at a time —
     Lakewood last or first at Jeff's preference; Parrish likely easiest (schema
     already matches).
  4. Freeze freelancer edits for that site; keep the legacy collection as a
     read-only archive for ~30 days, then retire it.

**Done when:** all three sites serve from pipeline-operated collections and the
freelancer engagement is ended.

### Phase 7 — New sites by config
- Adding lifeinlongboatkey.com (or any future site) = rows in `fp_sites`,
  `fp_communities`, `fp_builder_communities`, plus a new Wix collection from the
  standard schema. No new pipeline code.

---

## Open items (Jeff)

1. Wix account API key + site IDs for the three sites.
2. Confirmation of which Parrish collection is the schema gold standard.
3. Builder roster per site, if already documented (otherwise derived in Phase 0).
4. The current list of floor plans used in brand emails (to seed stars).
5. Preferred digest channel (SMS via existing Twilio number vs email) and time.

## Economics

Freelancer cost eliminated: **$700–1,000/mo**. Running cost: GitHub Actions minutes
(free tier likely sufficient) + single-digit dollars/month of Claude API + existing
Vercel/Supabase plans. Data freshness improves from ~monthly to nightly, which is a
product upgrade in itself (prices, quick move-in flags).
