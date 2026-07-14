# SEO Strategy — Life at Lakewood, Life in Wellen Park, Life at Parrish, Life in Longboat Key

Organic-SEO playbook for prospective-homebuyer keywords across the four community guide sites:
**lifeatlakewood.com · lifeinwellenpark.com · lifeatparrish.com · lifeinlongboatkey.com**

Based on a July 2026 research pass (Google spam-policy review, Wix platform capabilities, local
real-estate link-building tactics, AI-search/GEO landscape) plus adversarial vetting of 54
candidate tools, and the site data already collected in `pipeline/audit/snapshots/`.

---

## 1. The one rule that protects the business

**Never point automated link-building tools at these domains.** Nearly everything on GitHub tagged
"backlink generator" or "link building" is spam automation — hidden-iframe/ping "backlinks," bulk
directory blasting, blog-comment/forum/contact-form spam bots (GSA Search Engine Ranker, XRumer,
ScrapeBox comment mode, backlink-pilot, and the entire
[`backlink-generator` topic](https://github.com/topics/backlink-generator)).

These violate [Google's spam policies](https://developers.google.com/search/docs/essentials/spam-policies).
As of 2026, SpamBrain devalues these link patterns in near-real-time and manual actions
(ranking collapse, deindexing) remain in force. These four domains are real revenue / lead-gen
properties — best case the links are neutralized and do nothing; worst case one campaign undoes
years of organic growth, and recovery from a manual action is slow and uncertain.

Also prohibited regardless of marketing language: PBNs, paid link packages, "guaranteed DA links,"
link exchanges, expired-domain schemes, fake/incentivized reviews (now FTC-illegal with per-violation
civil penalties), and Reddit/forum astroturfing.

The company's form-submission automation is for **our own inbound leads only** — never repurpose
form automation for outbound link placement.

---

## 2. 90-day action plan

### Phase 1 — Foundations (weeks 1–2)

| Action | Tool | Notes |
|---|---|---|
| Verify all 4 domains in Google Search Console | [search.google.com/search-console](https://search.google.com/search-console) | One-click from Wix; submit each sitemap |
| Verify all 4 domains in Bing Webmaster Tools + enable IndexNow | [bing.com/webmasters](https://www.bing.com/webmasters) | Imports from GSC in 2 clicks. **ChatGPT search retrieves from Bing's index** — not being in Bing means not being citable by ChatGPT |
| Confirm GA4 lead-form conversion events fire on all 4 sites | [analytics.google.com](https://analytics.google.com) | GSC diagnoses search; GA4 measures outcomes |
| Baseline JS-rendering crawl of each site | LibreCrawl (free, renders JS) or Screaming Frog free tier | Inventory duplicate/missing titles & metas, broken links, thin pages. Add lifeinlongboatkey.com — it is missing from `pipeline/audit/` today |
| Confirm Wix robots settings are not blocking AI crawlers | Wix SEO settings | GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended |
| Core Web Vitals baseline | [pagespeed.web.dev](https://pagespeed.web.dev) | See §7 — audited pages weigh 0.9–2.4 MB; compress hero images to WebP < 200 KB, prune Wix apps/animations |

### Phase 2 — Content hubs (weeks 1–6, parallel)

Hub-and-spoke per site. Start with the strongest site (Lakewood), then replicate the *template* —
never the content — for Wellen Park, Parrish, Longboat Key.

- **Pillar:** "Living in [Community]: 2026 Complete Guide" (1,500–3,000 words).
- **6–8 spokes:** villages/neighborhoods · schools · cost of living incl. **HOA + CDD fees and
  property taxes** · new construction & builders · amenities/things to do · quarterly market report
  · "Moving to [Community]" relocation guide.
- Interlink hub ↔ spokes bidirectionally, 3–5 contextual in-body links per page, funneling to the
  "homes for sale in [community]" money pages. Internal linking is the fastest fully-white-hat
  ranking lever we control.
- **Florida-specific angles we can own** (high intent, low competition): CDD vs HOA fees explained,
  homestead exemption, flood zones & insurance costs, 55+/active-adult communities, hurricane
  prep/what-to-know, snowbird/seasonal buying.
- **E-E-A-T (real estate is YMYL):** real named author bio with FL license info and photo on every
  guide; first-hand local specifics and original photos; cite Manatee/Sarasota County Property
  Appraiser, school districts, MLS data; robust About/Contact pages.

### Phase 3 — Structured data (weeks 4–8)

Wix supports custom JSON-LD three ways: the native Structured Data field (< 7,000 chars, static
per page/page-type), head code injection (premium plans), and the Velo API —
[`wixSeoFrontend.setStructuredData()`](https://dev.wix.com/docs/velo/apis/wix-seo-frontend/set-structured-data)
in `$w.onReady()`, which is the right mechanism for per-item schema on dynamic pages.

- `RealEstateAgent`/`LocalBusiness` with NAP + service area + `sameAs` array (GBP, LinkedIn,
  Facebook, YouTube) on each site's home/contact page.
- `BreadcrumbList` sitewide.
- `FAQPage` on community guides answering real buyer questions ("Is Wellen Park a good place to
  live?", "What are CDD fees in Lakewood Ranch?") — FAQ schema shows the strongest correlation with
  AI-answer citation rates. Only mark up FAQs actually rendered on the page.
- Listing/`Product`-style schema on floor-plan pages, generated from the floor-plan database
  (see §5). Keep prices dated and current.
- **Never** emit `Review`/`aggregateRating` stars we invented — that is a manual-action magnet.
- Validate everything in the [Rich Results Test](https://search.google.com/test/rich-results) and
  [validator.schema.org](https://validator.schema.org) before publishing.

### Phase 4 — Local presence + link earning (weeks 2–12, ongoing)

See §4 (playbook) and §6 (cross-site policy).

### Phase 5 — Measure and iterate (monthly)

- GSC: index coverage, query/page performance, the new generative-AI performance report.
- Rank tracking: SerpBear (self-hosted) fed by a low-cost SERP API — never scrape Google directly.
- Re-crawl each site monthly; catch thin/duplicate drift before Google does.
- Gate all programmatic scaling on indexation + engagement data (§5).

---

## 3. Vetted tool list

### ✅ Use — free / first-party
| Tool | Purpose |
|---|---|
| [Google Search Console](https://search.google.com/search-console) | The non-negotiable diagnostic for all four properties |
| [Bing Webmaster Tools + IndexNow](https://www.bing.com/webmasters) | Bing index feeds ChatGPT; free, imports from GSC |
| [GA4](https://analytics.google.com) | Outcomes: sessions, landing pages, lead-form conversions |
| [PageSpeed Insights](https://pagespeed.web.dev) | Core Web Vitals per page |
| [Rich Results Test](https://search.google.com/test/rich-results) + [Schema Validator](https://validator.schema.org) | Validate all JSON-LD before shipping |
| [Google Business Profile](https://business.google.com) | Under the real brokerage/agent entity (§4) |
| Wix–Semrush keyword integration | Built into Wix SEO Setup Checklist; free tier = 10 lookups/day |

### ✅ Use — open source (GitHub)
| Tool | Purpose |
|---|---|
| [advertools](https://github.com/eliasdabbas/advertools) | Python SEO library: crawling/audits, sitemap parsing, `kw_generate` to cross communities × builders × buyer-intent modifiers into a keyword map |
| [SEOnaut](https://github.com/StJudeWasHere/seonaut) / [LibreCrawl](https://librecrawl.com/) | Open-source technical audit crawlers; LibreCrawl renders JS (matters on Wix) |
| [Screaming Frog free tier](https://www.screamingfrog.co.uk/seo-spider/) | Industry-standard crawler; 500-URL free cap fits these sites but free tier does not render JS |
| [SerpBear](https://github.com/towfiqi/serpbear) | Self-hosted rank tracking (needs a SERP API such as serper.dev — do not scrape Google) |
| [OpenSEO](https://github.com/every-app/open-seo) | Free Semrush-style app, BYO DataForSEO key (~$50 min top-up); has an MCP server |
| [Unlighthouse](https://github.com/harlan-zw/unlighthouse) | Lighthouse across every page: `npx unlighthouse --site https://lifeatlakewood.com` |
| [joshcarty/google-searchconsole](https://github.com/joshcarty/google-searchconsole) / [mcp-gsc](https://github.com/AminForou/mcp-gsc) | Programmatic GSC exports; the MCP server plugs into Claude — natural fit for this Hub |
| [Merkle Schema Generator](https://technicalseo.com/tools/schema-markup-generator/) + [JSON-LD snippet library](https://github.com/JayHoltslander/Structured-Data-JSON-LD) | Paste-ready LocalBusiness/FAQ/Breadcrumb markup |

### ⚠️ Use with caution / situational
| Tool | Caveat |
|---|---|
| [BrightLocal](https://www.brightlocal.com/) (~$39/mo) / Whitespark / Moz Local | Legitimate citation managers — buy only if managing citations manually gets painful; they are local-pack tools, not content-SEO tools |
| [BuzzStream](https://www.buzzstream.com/) / [Respona](https://respona.com/) | Legitimate outreach CRMs. Personalized manual outreach only; never Respona's paid-placement/link-buying mode; send from a dedicated outreach domain |
| Semrush / Ahrefs paid seat | Worth it once the free keyword tiers are outgrown; billing caution |
| AI-visibility trackers ([Elmo](https://github.com/elmohq/elmo) self-hosted, Otterly ~$25/mo) | Measurement only — nice-to-have after content/schema work is underway |
| Wix App Market schema apps | Prefer verified-developer native apps; hard rule: no fabricated review stars |

### 🚫 Avoid — will not help, can destroy rankings
GSA Search Engine Ranker · XRumer · ScrapeBox (comment/blast modes) · RankerX ·
backlink-pilot · every repo in the GitHub `backlink-generator` topic · bulk directory-submission
services · PBN/link-package vendors ("guaranteed DA/DR links," "niche edits") · fake-review
vendors · "guaranteed AI citation" GEO vendors (2026 repackaging of link farms).

---

## 4. Link-building playbook (white-hat, local)

1. **Citations first (baseline, not a differentiator).** Byte-identical NAP on Google Business
   Profile, Apple Business Connect, Bing Places, Zillow, Realtor.com, Redfin. GBP belongs to the
   *real brokerage/agent entity* behind the sites (service-area business covering Sarasota/Manatee,
   category "Real Estate Agent") — not to the guide-site brands, which don't transact with
   customers and would risk suspension. Solicit genuine client reviews steadily (recency beats
   volume; 2–4/month is plenty).
2. **The floor-plan database is the linkable asset** (§5). Publish a quarterly per-community
   **New Construction Price & Floor-Plan Report** (median price by builder, $/sqft trends,
   inventory shifts) and pitch it to local media: Sarasota Herald-Tribune, Bradenton Herald,
   Your Observer (covers Longboat Key and East County/Lakewood Ranch), Sarasota Magazine, SRQ.
   Hyperlocal data is the top-earning link type in real estate right now.
3. **Local organizations.** Lakewood Ranch Business Alliance, Greater Sarasota Chamber, Manatee
   Chamber, Venice Area Chamber (Wellen Park), Longboat Key Chamber, Visit Sarasota County.
   Membership/directory links from these are genuine and locally relevant.
4. **Journalist queries.** Free accounts on [Featured.com](https://featured.com),
   [Qwoted](https://www.qwoted.com), Source of Sources. Respond to Florida
   housing/relocation/new-construction queries within the first hour (placement rates ~60% higher).
5. **Internal linking** (§2) — the highest-ROI "link building" available, and we control 100% of it.
6. **Earned third-party mentions for AI visibility.** Local "best places to live" listicles,
   honest and disclosed participation in local subreddits/home-buying threads, YouTube community
   tours. Genuine only — no astroturfing, ever.

---

## 5. Programmatic content from the floor-plan database

The scraped builder/floor-plan/pricing data (Supabase + `pipeline/audit/extracts/`) is our biggest
SEO advantage — and the biggest white-hat risk if mishandled. Google's scaled-content-abuse policy
targets exactly "same template, swapped plan name" pages, and it evaluates domains *holistically*:
a batch of thin pages can demote the whole site.

Guardrails:

- **Enrich, don't mirror.** Every generated page needs ≈25–30%+ genuinely unique content: local
  context, price commentary, community fit, an editorial intro, an FAQ. Rewrite builder marketing
  copy (copyright + duplicate-content risk); express facts (beds/baths/sqft/price) in our own words.
- **Stage rollouts.** Ship 20–50 pages, watch GSC indexation + engagement for 2–3 weeks, scale only
  the page types that hold up. Never dump the full dataset live at once.
- **Keep pricing dated and fresh** ("as of July 2026") — stale prices on a YMYL site erode trust
  and can surface wrong numbers in AI answers. The existing scrape refresh pipeline should feed
  Wix CMS collections on a schedule.
- **Mechanics on Wix:** one CMS collection per data type (communities, builders, floor plans);
  dynamic pages with title/meta/slug bound to collection fields
  (`{planName} by {builder} — New Construction in Parrish, FL`); per-item schema via Velo
  `setStructuredData()`; canonicals set so filter variants don't split equity.
- **Cross-site duplication:** the four sites must not share boilerplate intros, FAQs, or templates
  verbatim — each domain needs distinct local content and voice.

---

## 6. Cross-site linking policy (the four sister domains)

Owning four related domains is fine. **Cross-linking them manipulatively is the most likely
self-inflicted penalty available to us.** A sitewide keyword-rich footer/menu block
("Homes for sale in Lakewood Ranch | Wellen Park | Parrish | Longboat Key") linking
domain-to-domain is a textbook link scheme for a related-site network.

Policy:
- No reciprocal sitewide link blocks, footers, or "our other communities" link farms.
- A cross-reference is allowed when it genuinely helps the reader (e.g., a Lakewood Ranch vs
  Wellen Park comparison article), placed once, in body copy, as a natural brand mention —
  not a keyword-anchored template element.
- Treat the four sites as four independent local brands, each with its own entity signals
  (schema, consistent NAP, its own tracked keyword set).

---

## 7. Site-specific findings (from `pipeline/audit/snapshots/`, July 2026)

- **Titles are already well-formed** (geo + intent, e.g. "Homes for Sale in Lakewood Ranch FL |
  Life at Lakewood"). Keep the pattern; extend it to every new page via Wix bulk SEO settings.
- **Page weight is the top technical liability:** audited pages run ~0.9–2.4 MB
  (`/homes-for-sale` ≈ 2.38 MB, `/villages` ≈ 2.19 MB) on Wix's already JS-heavy stack.
  Fix: hero images → WebP < 200 KB, lazy-load below-fold media, remove unused Wix apps/animations.
- **URL patterns are inconsistent** (`/homes-for-sale-in-indigo` vs `/arbor-grande` vs
  `/village/waterbury-park` vs `/neighborhood/esplanade`). Standardize a scheme for new pages;
  don't mass-rename existing ranking URLs (Wix redirects are manual).
- **Content depth is lopsided:** Lakewood is well built out (~18 audited pages); Wellen Park and
  Parrish are thin (4–6); **Longboat Key isn't in the audit config at all.** Content-gap priority:
  Longboat Key → Parrish → Wellen Park.

---

## 8. AI search (GEO) checklist — 2026

Real estate triggers Google AI Overviews in only ~4.5% of searches, but a majority of buyers now
start research in conversational AI. The levers, in priority order:

1. **Bing indexation + IndexNow** (prerequisite for ChatGPT citations).
2. **FAQ schema + direct-answer formatting:** front-load the answer in the first 80–200 words,
   Q&A-style H2s, inline dated statistics with sources — that's what LLMs quote.
3. **Entity consistency:** identical brand name/NAP everywhere; `sameAs` arrays; consider Wikidata
   entries for the brands and a `Person` entity for the licensed author.
4. **Earned third-party consensus** (AI engines trust Reddit/listicles/reviews over brand-owned
   pages) — via §4, honestly.
5. **Measure:** GSC's generative-AI report + a weekly fixed prompt set per community
   ("best neighborhoods in Lakewood Ranch", "is Wellen Park a good place to live", …).
6. **Skip `llms.txt`** — Google has confirmed Search ignores it; no major engine uses it.

---

## 9. Possible next steps in this repo (Phase B — not yet built)

- Extend `pipeline/audit/fetch-sites.mjs` into a recurring SEO audit: flag missing/duplicate
  titles & metas, multiple/missing H1s, page weight over budget, broken internal links, missing
  alt text, schema presence. Run via the existing GitHub Actions audit workflow pattern
  (the dev sandbox has no egress to these domains; CI does).
- Add `lifeinlongboatkey.com` to the audit config.
- Generate JSON-LD (listing/FAQ/breadcrumb/LocalBusiness) from Supabase floor-plan data for
  injection into Wix via the existing `src/lib/wix/client.ts` integration, validated in CI against
  the schema.org validator.
- Wire GSC reporting (via `mcp-gsc` or `joshcarty/google-searchconsole`) for a monthly
  four-site keyword/indexation digest.
