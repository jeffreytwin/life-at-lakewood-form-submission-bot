-- Deferred fp_builders metadata updates (Supabase MCP writes were
-- approval-blocked when the extractors landed). These are LABELS ONLY:
-- extractor dispatch is keyed by builder name in src/lib/floorplans/sync.ts
-- (BUILDER_EXTRACTORS takes precedence over extraction_method), and Lee
-- Wetherington's URL/hint defaults live in code — so every connection runs
-- correctly without this. Apply whenever convenient so Settings → Builder
-- Connections displays the real engines.

update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'Bespoke extractor: parses inline window.TM scDataStore.data from <community>/floor-plans and /available-homes (plans + address-named QMIs). Set connection URL to the community base page; auto-discovery works (sitemap is fetchable).'
where name = 'Taylor Morrison';

update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'Bespoke extractor: Sitecore JSS layout service /search-data route (public sc_apikey), planCards/qmiCards scoped by community page URL prefix. Connection URL = community page; optional extractor_params.market (default Sarasota-Bradenton).'
where name = 'Mattamy Homes';

update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'Bespoke extractor: open REST API api.drbhomes.com/api/v1/public/inventory (filters ignored server-side; paginated sweep, client-side community match). Biscayne Landing at Seaire = communityId 281. No URL needed. Inventory homes only — DRB exposes no per-community to-be-built plan list.'
where name = 'DRB Homes';

update fp_builders set
  audit_notes = 'Bespoke extractor: Sitecore Discover API (third-party host, bypasses the site WAF that 403s non-browser clients). One query per Salesforce community id; Salt Meadows Classic/Premier ids built into the extractor, extractor_params.communities overrides. No URL needed.'
where name = 'Meritage Homes';

update fp_builders set
  extraction_method = 'fetch_claude',
  base_url = 'https://lwhomes.com',
  audit_notes = 'Real site is lwhomes.com (WordPress, server-rendered; leewetherington.com is an empty JS shell). Routed through the generic Claude engine with a per-community hint over the shared /listings/ page (defaults live in sync.ts). wp-json is auth-gated.'
where name = 'Lee Wetherington';

-- Optional: pre-seed known community page URLs so the first Run skips
-- auto-discovery (all verified live during discovery).
update fp_builder_communities bc set extractor_params = jsonb_build_object('url', v.url)
from (values
  ('Taylor Morrison', 'Firethorn',           'https://www.taylormorrison.com/fl/tampa/parrish/firethorn'),
  ('Taylor Morrison', 'The Towns at Firethorn', 'https://www.taylormorrison.com/fl/tampa/parrish/the-towns-at-firethorn'),
  ('Mattamy Homes',   'Brightmore',          'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/brightmore'),
  ('Mattamy Homes',   'Lakespur',            'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/lakespur'),
  ('Mattamy Homes',   'Palmera',             'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/palmera'),
  ('Mattamy Homes',   'Sunstone',            'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/sunstone'),
  ('Mattamy Homes',   'Sunstone Lakeside',   'https://mattamyhomes.com/florida/sarasota-bradenton/venice/wellen-park/sunstone-lakeside')
) as v(builder, community, url)
join fp_builders b on b.name = v.builder
join fp_communities c on c.name = v.community
where bc.builder_id = b.id and bc.community_id = c.id
  and (bc.extractor_params is null or bc.extractor_params = '{}'::jsonb);


-- MPC-aggregator builders (dispatch is by builder name in sync.ts →
-- extractMpcAggregator; labels below are cosmetic for Settings display).
update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'Sourced from the MPC aggregator (wellenpark.com) — different origin than the IP-blocked ICI site. mpc-aggregator.ts parses server-rendered <article data-comp=property> cards, filtered to ici-homes + the community neighborhood slug. Oakbend + Palmera both live on Wellen Park. No URL needed.'
where name = 'ICI Homes';

update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'MPC aggregator. Palmera → wellenpark.com (default, live-verified 27 homes). Sweetwater/Nautique → Lakewood Ranch (set extractor_params.source=lakewoodranch once LWR client-rendered list is captured). Builder-direct M/I site is JA3-blocked. No URL needed.'
where name = 'M/I Homes';

update fp_builders set
  extraction_method = 'json_api',
  audit_notes = 'MPC aggregator, source=lakewoodranch (Waterbury Park + The Alcove are LWR communities). Pending: LWR renders home-finder client-side; needs a Playwright capture of its admin-ajax home-search action before this works. Builder-direct site is IP-blocked.'
where name = 'Neal Signature Homes';

-- The Lakewood Ranch connections should carry source=lakewoodranch so they
-- are ready when that data source is cracked (they fail cleanly until then):
-- update fp_builder_communities bc set extractor_params = jsonb_build_object('source','lakewoodranch')
-- from fp_builders b, fp_communities c
-- where bc.builder_id=b.id and bc.community_id=c.id
--   and ((b.name='M/I Homes' and c.name in ('Sweetwater','Nautique'))
--     or (b.name='Neal Signature Homes'));
