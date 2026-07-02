# Floor Plan Sync Pipeline — Build Plan

Replaces the manual freelancer process (~$700–1,000/mo, monthly cadence, frequent
misses) with an automated nightly pipeline: scrape floor plan data directly from
builder websites, diff against our own data, queue only the changes for one-click
human approval, and write approved changes into **new, private Wix collections** that
will eventually replace the legacy collections on each site.

Sites in scope: **lifeatlakewood.com**, **lifeinwellenpark.com**, **lifeatparrish.com**
(future sites added by config, not code).

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
