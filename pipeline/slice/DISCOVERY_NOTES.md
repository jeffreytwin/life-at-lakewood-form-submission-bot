# Extractor discovery notes — remaining builders

Working notes from the slice discovery rounds (`discover-round*.mjs`, output
in `discovery/round*/`). Updated as rounds complete. Goal: close out the 8
builders not yet runnable, in the order Meritage → render_claude five →
ICI/Neal Signature → (done) Toll QMIs.

## Meritage Homes (`json_api`, Salt Meadows @ Parrish)

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

## Mattamy Homes (was `render_claude`, 6 Wellen Park communities)

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

## Taylor Morrison (was `render_claude`, Azario/Esplanade/Firethorn…)

- Sitemap exposes exact per-community pages:
  `/fl/tampa/parrish/firethorn/floor-plans`, per-plan pages, and QMI pages
  (`…/floor-plans/<plan>/home-available-now-at-<address>`).
- Pages are client-rendered (visible text ≈ 40 chars). Components fetch
  `GET {origin}/api/sitecore/{controller}/{action}` (fetchData in
  `scDataStore`, see `round3/taylor-bundle-grep.json`). Round 4 greps the
  page bundles for controller/action pairs and probes them.

## M/I Homes (was `render_claude`, Sweetwater/Nautique/Palmera)

- `cdn.mihomes.com/assets/toolkit/js/search.js` calls
  `GET /api/v1/community/hometypes/{communityId}` (context saved in
  `round3/mihomes-api-contexts.txt`).
- Community ids/urls not present on the metro listing page (round 3 found
  0). Round 4 crawls the listing for community hrefs and extracts ids from
  the community pages, then probes the API.

## DRB Homes (was `render_claude`, Seaire → Biscayne Landing)

- Community page found: `…/find-your-home/communities/florida/tampa/biscayne-landing-at-seaire/overview` (200).
- Fully client-rendered SPA — visible text 33 chars on every tab; no
  same-host bundles matched round-3's hunt. Round 4 fetches the script
  bundles from whatever host serves them and greps for endpoints.

## Lee Wetherington (was `render_claude`, Star Farms/Shellstone/Wild Blue/Everly)

- `leewetherington.com` is a 114-byte JS shell redirecting to `/lander`
  (empty). `www.leewetheringtonhomes.com` → **`lwhomes.com`**, a WordPress
  site (`round3/lee-wetherington-summary.json`).
- Round 4: `wp-json` is auth-gated (401 on `/wp/v2/types` and every CPT
  guess) — REST route closed. Fallback: the site is server-rendered WP, so
  `fetch_claude` over its community/available-homes pages; round 5 collects
  rendered links/text to pick the pages.

## ICI Homes (`Oakbend`, `Palmera`) — blocked

- Hard 403 to GitHub runners on all header profiles (chrome-full, firefox,
  googlebot) — `round2/ici-attempts.json`. WAF/datacenter-IP block.
- Next option: run the fetch from Vercel serverless egress (the
  branch-guarded prebuild pattern in `scripts/`), which exits from a
  different IP space; if that also 403s, needs a residential-egress
  decision from Jeff before we can automate.

## Neal Signature Homes (`Waterbury Park`, `The Alcove`) — blocked

- `nealsignaturehomes.com` hard-403s like ICI (same rounds/profiles), and
  round 4 confirmed `wp-json` 403s too — but `robots.txt` returns 200, so
  the WAF is path-selective. Round 5 probes with real Chrome.
- Parent `nealcommunities.com` (WordPress) works from runners but its
  sitemap carries **no Signature community pages** — only news posts.

## Toll Brothers QMI subpages — done (no scrape needed)

- QMI inventory is embedded in the master community page `__NEXT_DATA__`
  at `masterCommunityComponent.communities[].homes.models[].qmis[]`
  (collection pages: `communityComponent.homes.models[].qmis[]`).
- Extractor extended + unit-tested against the committed Isles dumps
  (`__tests__/unit/floorplans/toll-brothers.test.ts`). QMIs are named by
  street address (Lennar convention), base plan in `raw.relatedPlan`.
