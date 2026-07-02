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
