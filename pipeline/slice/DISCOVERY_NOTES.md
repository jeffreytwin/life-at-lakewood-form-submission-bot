# Extractor discovery notes — remaining builders

Working notes from the slice discovery rounds (`discover-round*.mjs`, output
in `discovery/round*/`). Updated as rounds complete. Goal: close out the 8
builders not yet runnable, in the order Meritage → render_claude five →
ICI/Neal Signature → (done) Toll QMIs.

## Meritage Homes — DONE (extractor live-verified)

- Data source: **Sitecore Discover** (`POST https://discover.sitecorecloud.io/discover/v2/173266879`,
  public client-side auth key from the site bundle) — a third-party API the
  WAF never sees; plain Node fetch gets 200 (round-6 replay + live
  integration test). One query per Salesforce community id (Classic
  `a078a0000115gcVAAQ`, Premier `a078a0000115gcGAAQ`) returns every home:
  floorplan_name, address, price, beds/baths/sqft, gallery,
  interactive_floorplan_image. Salt Meadows is "QMI Only" → records map to
  address-named QMIs with the plan in raw.relatedPlan.
- `extractors/meritage.ts`, registered in sync.ts; URL auto-discovery
  skipped for Meritage (URLLESS_BUILDERS) since its pages 403 Node fetch.
- There is also a Salesforce lots API (`apim-…azure-api.net/cache/sf/web-lots`,
  public subscription key) with richer pricing detail if ever needed.

### Original findings (rounds 2–5)

- Pages: `/state/fl/tampa/meritage-homes-salt-meadows` (master),
  `salt-meadows-classic-series`, `salt-meadows-premier-series`, plan pages
  like `salt-meadows-classic-series/bluebell-4l05`. All in sitemap.
- Site is Sitecore JSS behind Next.js. **The plan grid is client-fetched**:
  `__NEXT_DATA__` carries only the layout shell (round-2 dumps
  `round2/meritage-*.nextdata.pruned.json` — no plan names appear).
  `componentProps` has community aggregates (`lowPrice`, `totalQmis`,
  `communitySearch.communityData`) but no per-plan rows.
- Bot posture: 200 with the full Chrome header profile in round 2, then
  **403 for every Node-fetch attempt in rounds 3–4 regardless of headers**
  — the WAF is TLS-fingerprinting the client, not reading headers. Round 5
  renders with real Chrome (Playwright) and captures the plan-grid XHRs.
- Production caveat: the nightly runs on Vercel with Node fetch, so once
  the data API is known, verify Node fetch passes on the API path itself
  (WAFs often exempt API routes). If not, Meritage needs a
  Playwright-in-Actions engine instead of the Vercel path.

## Mattamy Homes — DONE pending live verify (extractor written)

- `extractors/mattamy.ts`: GET the Sitecore JSS layout service `/search-data`
  route (public sc_apikey) and scope planCards/qmiCards by the community
  page URL prefix. Unit-tested against round-7 captures.

### Original findings

- **Server-renders a full Sitecore `__JSS_STATE__`** on community pages
  (`round3/mattamy-brightmore.jss-state.json`, 275 KB raw).
- `QMIBlock` component carries QMI cards: title = street address,
  `price.price` ("$513,545"), attributes (Sq. Ft./Bed/Bath/Half Bath/Car
  Garage), image src, id. Brightmore page shows 4 cards with a "View all"
  CTA to `/search?productType=qmi&metro=Sarasota-Bradenton&country=USA&community=…&hideMap=true`.
- Bundles: Sitecore JSS with `graphQLEndpoint = https://mattamyhomes.com/api/mattamy-homes`,
  REST layout service config `jss`.
- Round 4: `/search` is a 22 KB JSS shell — results are client-fetched via
  the GraphQL endpoint. The community page's own subnav links the full
  lists: `/search?productType=plan&metro=…&community=Brightmore at Wellen Park`
  (plans) and `productType=qmi` (QMIs). Round 5+ captures the GraphQL
  queries those pages fire so the extractor can call them directly.

## Taylor Morrison — DONE pending live verify (extractor written)

- `extractors/taylor-morrison.ts`: parses the inline
  `window.TM.client.scDataStore.data` from `<community>/floor-plans`
  (floorPlansListDataArray + series) and `<community>/available-homes`
  (address-named QMIs). Plain fetch. Unit-tested against round-7 dumps.
- Connection URLs: use the community base page, e.g.
  `https://www.taylormorrison.com/fl/tampa/parrish/firethorn`.

### Original findings

- Sitemap exposes exact per-community pages:
  `/fl/tampa/parrish/firethorn/floor-plans`, per-plan pages, and QMI pages
  (`…/floor-plans/<plan>/home-available-now-at-<address>`).
- Round 5/6: the floor-plans page renders 37 plans with full specs and no
  data XHR — the dataset ships inline as `window.TM.client.scDataStore.data`
  (incl. `floorPlanCollections`), and **Node fetch reads the page fine**
  (200, 339 KB). Round 7 dumps the full object → json_api extractor that
  regex-extracts the inline JSON. No Playwright needed.

## M/I Homes — still blocked for Node fetch

- The SSC Search API (`/sitecore/api/ssc/MIHomes-Project-Website-Api/Search`,
  `searchtype=plans|inventory`) returns 500 KB+ in a real browser but
  **hangs until timeout for Node fetch** (rounds 6–7; Cloudflare holds
  non-browser TLS connections on the API path while page HTML is served
  fine). Options: Playwright-in-Actions engine, or a TLS-impersonation
  fetch. Parked behind the others.

### Original findings

- `cdn.mihomes.com/assets/toolkit/js/search.js` calls
  `GET /api/v1/community/hometypes/{communityId}` (context saved in
  `round3/mihomes-api-contexts.txt`).
- Community ids/urls not present on the metro listing page (round 3 found
  0). Round 4 crawls the listing for community hrefs and extracts ids from
  the community pages, then probes the API.

## DRB Homes — DONE pending live verify (extractor written)

- `extractors/drb.ts`: sweeps `api.drbhomes.com/api/v1/public/inventory`
  (filters are ignored server-side; ~19 pages at limit=50) and matches
  items by community name — Biscayne Landing at Seaire is communityId 281.
  Inventory homes only; DRB exposes no per-community to-be-built plan
  listing (plan resource is templates without community linkage).

### Original findings

- Community page found: `…/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/overview` (200).
- Round 5/6: the SPA is backed by an **open public REST API** —
  `api.drbhomes.com/api/v1/public/{division,plan,inventory}` (paginated,
  `items`+`meta`, plans 401 total / inventory 926 total, full specs +
  basePrice + marketing). Node fetch passes. Round 7 finds the community
  resource/filters and the Seaire community id by capturing the SPA's own
  calls.

## Lee Wetherington — use the generic fetch_claude engine

- Real site is `lwhomes.com` (WordPress). `/listings/` server-renders the
  for-sale homes as posts (round-7 rendered text shows the listings), and
  `/model-homes/` the models. No hidden API worth chasing (wp-json is
  auth-gated; page XHRs are chat/anti-spam widgets only).
- Action: reclassify the builder to `fetch_claude` with
  `url = https://lwhomes.com/listings/` (Settings → Builder Connections /
  fp_builders update — needs a DB write, Supabase MCP was approval-blocked
  this session).

### Original findings

- `leewetherington.com` is a 114-byte JS shell redirecting to `/lander`
  (empty). `www.leewetheringtonhomes.com` → **`lwhomes.com`**, a WordPress
  site (`round3/lee-wetherington-summary.json`).
- Round 4: `wp-json` is auth-gated (401 on `/wp/v2/types` and every CPT
  guess) — REST route closed. Fallback: the site is server-rendered WP, so
  `fetch_claude` over its community/available-homes pages; round 5 collects
  rendered links/text to pick the pages.

## ICI Homes (`Oakbend`, `Palmera`) — blocked at the IP level

- Hard 403 to GitHub runners on every header profile AND with real Chrome
  (Playwright, round 5) — the block is on the runner IP ranges, not the
  client fingerprint. Next option: probe from Vercel serverless egress
  (branch-guarded prebuild in `scripts/`); if that also 403s, this builder
  needs a residential-egress decision from Jeff before it can be automated.

## Neal Signature Homes (`Waterbury Park`, `The Alcove`) — blocked at the IP level

- Same picture as ICI: 403 for headers, wp-json, and real Chrome; only
  `robots.txt` passes. Same Vercel-egress next step.
- Parent `nealcommunities.com` (WordPress) works from runners but its
  sitemap carries **no Signature community pages** — only news posts.

## Toll Brothers QMI subpages — done (no scrape needed)

- QMI inventory is embedded in the master community page `__NEXT_DATA__`
  at `masterCommunityComponent.communities[].homes.models[].qmis[]`
  (collection pages: `communityComponent.homes.models[].qmis[]`).
- Extractor extended + unit-tested against the committed Isles dumps
  (`__tests__/unit/floorplans/toll-brothers.test.ts`). QMIs are named by
  street address (Lennar convention), base plan in `raw.relatedPlan`.
